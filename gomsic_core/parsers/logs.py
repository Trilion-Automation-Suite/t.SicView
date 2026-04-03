"""Parser for application and hardware log errors.

Sources:
- gomsic/log/zi_acq_*.log (ZEISS 2026 acquisition session logs)
- gomsic/log/GOM-HAL-*.log (Hardware Abstraction Layer logs, all versions)
- gomsic/log/GOM-ACQ-*.log (older ZEISS 2023 acquisition logs)
- gomsic/log/ZEISS_INSPECT-*.log (main application logs)
- gomsic/log/GOM-*.log (generic process logs, ZEISS 2025)
- gomsic/log/GOMSoftware-*.log (older ZEISS 2024 format)
- ZQS/gom/log/ (duplicate location)

Extracts ERROR, WARNING, FATAL, TIMEOUT, and FAIL entries with surrounding
context lines for diagnostic use.

Handles two timestamp formats:
- ISO 8601 with milliseconds: 2026-01-16T19:58:50.239Z
- Space-separated datetime: 2025-07-31 08:49:24
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import LogEntry, LogFileEntry, LogInventory, LogSummary
from .base import BaseParser

logger = logging.getLogger(__name__)

# Patterns to match error/warning lines
_ERROR_PATTERNS = [
    re.compile(r"\bERROR\b", re.IGNORECASE),
    re.compile(r"\bFATAL\b", re.IGNORECASE),
    re.compile(r"\bTIMEOUT\b", re.IGNORECASE),
    re.compile(r"\bFAIL(?:ED|URE)?\b", re.IGNORECASE),
    re.compile(r"\bException\b"),
    re.compile(r"\bCRITICAL\b", re.IGNORECASE),
]

_WARNING_PATTERNS = [
    re.compile(r"\bWARN(?:ING)?\b", re.IGNORECASE),
]

# Context lines to include before/after each match
_CONTEXT_LINES = 3

# Log file patterns to search (covers ZEISS 2023 through 2026 naming)
_LOG_PATTERNS = [
    "zi_acq_*.log",       # ZEISS 2026 acquisition logs
    "GOM-HAL-*.log",      # Hardware Abstraction Layer (all versions)
    "GOM-ACQ-*.log",      # Older ZEISS 2023 acquisition logs
    "ZEISS_INSPECT-*.log", # Main application logs
    "GOM-*.log",          # Generic process logs (ZEISS 2025)
    "GOMSoftware-*.log",  # Older ZEISS 2024 format
]

# Timestamp extraction: handles both ISO 8601 (with optional millis/Z) and
# space-separated datetime formats.
# Examples:
#   2026-01-16T19:58:50.239Z  (zi_acq format)
#   2025-07-31 08:49:24       (GOM-HAL format)
_TIMESTAMP_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)"
)


class LogsParser(BaseParser):
    name = "logs"

    def __init__(self) -> None:
        super().__init__()
        self.log_inventory: Optional[LogInventory] = None

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[LogSummary]:
        # Collect log files from log directories
        log_dirs = []
        if layout.gomsic_log_dir:
            log_dirs.append(layout.gomsic_log_dir)
        if layout.zqs_gom_log_dir:
            log_dirs.append(layout.zqs_gom_log_dir)

        all_files: list[Path] = []       # files to analyze for errors
        extra_files: list[Path] = []     # additional files for inventory only
        seen_names: set[str] = set()

        for log_dir in log_dirs:
            for pattern in _LOG_PATTERNS:
                for f in self.find_files(log_dir, pattern):
                    ctx.file_searched(str(f))
                    if f.name not in seen_names:
                        ctx.file_found(str(f))
                        all_files.append(f)
                        seen_names.add(f.name)

        # Also find any .log files not matching the named patterns
        for log_dir in log_dirs:
            for f in self.find_files(log_dir, "*.log"):
                if f.name not in seen_names:
                    ctx.file_searched(str(f))
                    ctx.file_found(str(f))
                    all_files.append(f)
                    seen_names.add(f.name)

        # Collect root-level text files for inventory (not error analysis)
        if layout.gomsic_dir:
            for pattern in ["*.log", "*.txt", "*.csv"]:
                for f in self.find_files(layout.gomsic_dir, pattern):
                    if f.name not in seen_names and f.is_file():
                        extra_files.append(f)
                        seen_names.add(f.name)

        if not all_files and not extra_files:
            ctx.skip("No log files found")
            return None

        ctx.note(f"Found {len(all_files)} log files to analyze")

        summary = LogSummary()
        inventory = LogInventory()

        for log_file in all_files:
            text = self.read_text_file(log_file)
            if text is None:
                continue

            ctx.file_parsed(str(log_file))
            summary.files_analyzed.append(str(log_file.name))

            lines = text.splitlines()
            file_has_errors = False
            file_has_warnings = False

            for i, line in enumerate(lines):
                level = self._classify_line(line)
                if level is None:
                    continue

                if level == "ERROR":
                    file_has_errors = True
                elif level == "WARNING":
                    file_has_warnings = True

                entry = LogEntry(
                    source_file=log_file.name,
                    line_number=i + 1,
                    level=level,
                    message=line.strip(),
                    context_before=[
                        lines[j].strip()
                        for j in range(max(0, i - _CONTEXT_LINES), i)
                    ],
                    context_after=[
                        lines[j].strip()
                        for j in range(i + 1, min(len(lines), i + 1 + _CONTEXT_LINES))
                    ],
                )

                # Try to extract timestamp from the line
                ts_match = _TIMESTAMP_RE.match(line)
                if ts_match:
                    entry.timestamp = ts_match.group(1)

                summary.entries.append(entry)
                if level == "ERROR":
                    summary.total_errors += 1
                elif level == "WARNING":
                    summary.total_warnings += 1

            # Build inventory entry with full content
            try:
                size = log_file.stat().st_size
            except OSError:
                size = len(text.encode("utf-8", errors="replace"))

            try:
                rel_path = str(log_file.relative_to(log_file.parent.parent))
            except ValueError:
                rel_path = log_file.name

            # Extract first/last timestamps
            first_ts = None
            last_ts = None
            for ln in lines:
                ts_m = _TIMESTAMP_RE.match(ln)
                if ts_m:
                    if first_ts is None:
                        first_ts = ts_m.group(1)
                    last_ts = ts_m.group(1)

            inventory.files.append(LogFileEntry(
                filename=log_file.name,
                path=rel_path,
                size_bytes=size,
                content=text,
                line_count=len(lines),
                has_errors=file_has_errors,
                has_warnings=file_has_warnings,
                first_timestamp=first_ts,
                last_timestamp=last_ts,
                description=self._log_description(log_file.name),
            ))

        # Add extra root-level files to inventory (not analyzed for errors)
        for extra_file in extra_files:
            text = self.read_text_file(extra_file)
            if text is None:
                continue
            try:
                size = extra_file.stat().st_size
            except OSError:
                size = len(text.encode("utf-8", errors="replace"))
            lines = text.splitlines()
            inventory.files.append(LogFileEntry(
                filename=extra_file.name,
                path=extra_file.name,
                size_bytes=size,
                content=text,
                line_count=len(lines),
                has_errors=False,
                has_warnings=False,
                description=self._log_description(extra_file.name),
            ))

        self.log_inventory = inventory if inventory.files else None
        ctx.note(f"Found {summary.total_errors} errors, {summary.total_warnings} warnings across {len(inventory.files)} files")
        return summary if (summary.entries or extra_files) else None

    @staticmethod
    def _log_description(name: str) -> str:
        """Return a brief description based on filename."""
        n = name.lower()
        if n.startswith("zi_acq"):
            return "ZEISS 2026 acquisition session log"
        if n.startswith("gom-hal"):
            return "Hardware Abstraction Layer (HAL) log"
        if n.startswith("gom-acq"):
            return "ZEISS 2023 acquisition log"
        if n.startswith("zeiss_inspect-"):
            return "ZEISS INSPECT application log"
        if n.startswith("gom-"):
            return "ZEISS process log"
        if n.startswith("gomsoftware"):
            return "ZEISS 2024 application log"
        if n == "codemeter.log":
            return "WIBU CodeMeter dongle diagnostics"
        if n == "msinfo32.log":
            return "Windows System Information dump"
        if n == "nics.log":
            return "Network adapter config (ipconfig + netsh + PowerShell)"
        if n == "tasklist.log":
            return "Running processes snapshot"
        if n == "registry.log":
            return "Windows Registry dump (ZEISS keys)"
        if n == "licenses.csv":
            return "ZEISS license entries"
        if n == "dongles.csv":
            return "WIBU dongle serial numbers"
        if n == "installedprograms.log":
            return "Installed software list (Win32_Product)"
        if n == "nvidia-smi.log":
            return "NVIDIA GPU diagnostics"
        if n == "pnputil.log":
            return "PnP driver inventory"
        if n.endswith(".evtx"):
            return "Windows Event Log (binary)"
        if n.endswith(".csv"):
            return "Data file"
        return "Log file"

    def _classify_line(self, line: str) -> Optional[str]:
        """Classify a log line as ERROR, WARNING, or None."""
        for pattern in _ERROR_PATTERNS:
            if pattern.search(line):
                return "ERROR"
        for pattern in _WARNING_PATTERNS:
            if pattern.search(line):
                return "WARNING"
        return None
