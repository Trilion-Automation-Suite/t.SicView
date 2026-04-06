"""Parser for Windows Event Log (.evtx) binary files.

Sources:
- gomsic/eventlog-system.evtx
- gomsic/eventlog-application.evtx
- ZQS/application.evtx
- ZQS/system.evtx

Requires optional dependency: python-evtx
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import LogEntry, LogSummary
from .base import BaseParser

logger = logging.getLogger(__name__)

try:
    import Evtx.Evtx as evtx
    import Evtx.Views as evtx_views  # noqa: F401
    HAS_EVTX = True
except ImportError:
    HAS_EVTX = False


class WindowsEventsParser(BaseParser):
    name = "windows_events"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[LogSummary]:
        if not HAS_EVTX:
            ctx.skip("python-evtx not installed (optional dependency)")
            return None

        evtx_files: list[Path] = []

        # gomsic location
        if layout.gomsic_dir:
            for name in ("eventlog-system.evtx", "eventlog-application.evtx"):
                p = layout.gomsic_dir / name
                ctx.file_searched(str(p))
                if p.is_file():
                    ctx.file_found(str(p))
                    evtx_files.append(p)

        # ZQS location
        if layout.zqs_dir:
            for name in ("system.evtx", "application.evtx"):
                p = layout.zqs_dir / name
                ctx.file_searched(str(p))
                if p.is_file():
                    ctx.file_found(str(p))
                    evtx_files.append(p)

        if not evtx_files:
            ctx.skip("No .evtx files found")
            return None

        summary = LogSummary()

        for evtx_path in evtx_files:
            try:
                self._parse_evtx_file(evtx_path, summary, ctx)
            except Exception as e:
                ctx.note(f"Error parsing {evtx_path.name}: {e}")

        ctx.note(f"Parsed {len(evtx_files)} evtx files, {summary.total_errors} errors")
        return summary if summary.entries else None

    # ZEISS-relevant EventIDs for priority tagging
    _PRIORITY_EVENT_IDS = {
        7000: "Service failed to start",
        7001: "Service dependency failure",
        7011: "Service timeout (30s)",
        7034: "Service terminated unexpectedly",
        41: "Kernel-Power: unexpected shutdown",
        1001: "Windows Error Reporting (app crash)",
        10016: "DCOM permission error",
        6008: "Unexpected previous shutdown",
    }

    def _parse_evtx_file(self, path: Path, summary: LogSummary, ctx: ParserTraceContext) -> None:
        """Parse a single .evtx file for error/warning entries."""

        with evtx.Evtx(str(path)) as log:
            for record in log.records():
                try:
                    xml_str = record.xml()
                    # Level 1 = Critical, 2 = Error, 3 = Warning
                    level_match = re.search(r"<Level>([123])</Level>", xml_str)
                    if not level_match:
                        continue

                    level_num = int(level_match.group(1))
                    if level_num > 3:
                        continue

                    level = "ERROR" if level_num <= 2 else "WARNING"

                    # Extract structured fields
                    provider = re.search(r'Name="([^"]+)"', xml_str)
                    event_id_match = re.search(r"<EventID[^>]*>(\d+)</EventID>", xml_str)
                    ts_match = re.search(r'SystemTime="([^"]+)"', xml_str)
                    event_id = int(event_id_match.group(1)) if event_id_match else None

                    message = self._extract_message(xml_str)

                    # Tag ZEISS-relevant events
                    priority_tag = ""
                    if event_id and event_id in self._PRIORITY_EVENT_IDS:
                        priority_tag = f"[PRIORITY: {self._PRIORITY_EVENT_IDS[event_id]}] "

                    provider_name = provider.group(1) if provider else ""
                    full_message = (
                        f"{priority_tag}"
                        f"[{provider_name}] "
                        f"EventID={event_id or '?'}: "
                        f"{message}"
                    )

                    entry = LogEntry(
                        source_file=path.name,
                        level=level,
                        message=full_message,
                        timestamp=ts_match.group(1) if ts_match else None,
                    )
                    summary.entries.append(entry)

                    if level == "ERROR":
                        summary.total_errors += 1
                    else:
                        summary.total_warnings += 1
                except Exception:
                    continue

        ctx.file_parsed(str(path))
        summary.files_analyzed.append(path.name)

    def _extract_message(self, xml_str: str) -> str:
        """Extract a human-readable message from evtx XML record."""
        data_matches = re.findall(r"<Data[^>]*>([^<]+)</Data>", xml_str)
        if data_matches:
            return " | ".join(data_matches[:5])

        provider = re.search(r'Name="([^"]+)"', xml_str)
        event_id = re.search(r"<EventID[^>]*>(\d+)</EventID>", xml_str)
        parts = []
        if provider:
            parts.append(provider.group(1))
        if event_id:
            parts.append(f"EventID={event_id.group(1)}")
        return " ".join(parts) if parts else "Unknown event"
