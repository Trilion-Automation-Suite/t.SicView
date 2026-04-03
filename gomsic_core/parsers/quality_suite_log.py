"""Parser for ZEISS Quality Suite log files (log4j XML format).

Sources:
- ZQS/QualitySuite/user/Suite.log
- ZQS/QualitySuite/Administrator/Suite.log

These are log4j XML format with <log4j:event> elements containing
logger, level, timestamp, thread, message, exception, and properties.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import QualitySuiteLogEntry, QualitySuiteLogSummary
from .base import BaseParser

logger = logging.getLogger(__name__)


class QualitySuiteLogParser(BaseParser):
    name = "quality_suite_log"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[QualitySuiteLogSummary]:
        if not layout.zqs_dir:
            ctx.skip("ZQS directory not found")
            return None

        log_files: list[Path] = []
        qs_dir = layout.zqs_dir / "QualitySuite"
        if qs_dir.is_dir():
            for sub in ("user", "Administrator"):
                log_path = qs_dir / sub / "Suite.log"
                ctx.file_searched(str(log_path))
                if log_path.is_file():
                    ctx.file_found(str(log_path))
                    log_files.append(log_path)

        if not log_files:
            ctx.skip("No QualitySuite Suite.log files found")
            return None

        summary = QualitySuiteLogSummary()

        for log_file in log_files:
            text = self.read_text_file(log_file)
            if text is None:
                continue

            ctx.file_parsed(str(log_file))
            summary.files_analyzed.append(log_file.name)

            # Parse log4j:event elements
            event_pattern = re.compile(
                r'<log4j:event\s+logger="([^"]*?)"\s+level="([^"]*?)"\s+'
                r'timestamp="(\d+)"\s+thread="([^"]*?)">'
                r'(.*?)</log4j:event>',
                re.DOTALL,
            )

            for match in event_pattern.finditer(text):
                log_logger = match.group(1)
                level = match.group(2)
                timestamp = match.group(3)
                thread = match.group(4)
                body = match.group(5)

                # Extract message
                msg_match = re.search(r'<log4j:message>(.*?)</log4j:message>', body, re.DOTALL)
                message = msg_match.group(1).strip() if msg_match else ""

                # Extract exception/throwable
                exc_match = re.search(r'<log4j:throwable>(.*?)</log4j:throwable>', body, re.DOTALL)
                exception = exc_match.group(1).strip() if exc_match else None

                # Extract properties
                props: dict[str, str] = {}
                for pm in re.finditer(r'<log4j:data\s+name="([^"]*?)"\s+value="([^"]*?)"\s*/>', body):
                    props[pm.group(1)] = pm.group(2)

                # Only keep ERROR/WARN entries and key INFO entries
                if level in ("ERROR", "WARN", "FATAL"):
                    entry = QualitySuiteLogEntry(
                        timestamp=timestamp,
                        level=level,
                        logger=log_logger,
                        message=message,
                        exception=exception,
                        thread=thread,
                        properties=props,
                    )
                    summary.entries.append(entry)
                    if level in ("ERROR", "FATAL"):
                        summary.total_errors += 1
                    elif level == "WARN":
                        summary.total_warnings += 1

        ctx.note(f"QualitySuite logs: {summary.total_errors} errors, "
                 f"{summary.total_warnings} warnings from {len(summary.files_analyzed)} files")
        return summary if summary.entries else None
