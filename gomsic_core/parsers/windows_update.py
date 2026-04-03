"""Parser for Windows Update and reliability information.

Sources:
- gomsic/Windows10Update.log (Windows Update history)
- gomsic/WindowsReliabilityRecords.log (reliability records)
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import WindowsUpdateInfo
from .base import BaseParser

logger = logging.getLogger(__name__)


class WindowsUpdateParser(BaseParser):
    name = "windows_update"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[WindowsUpdateInfo]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        info = WindowsUpdateInfo()
        found_any = False

        # Windows10Update.log
        update_path = layout.gomsic_dir / "Windows10Update.log"
        ctx.file_searched(str(update_path))
        if update_path.is_file():
            ctx.file_found(str(update_path))
            text = self.read_text_file(update_path)
            if text:
                ctx.file_parsed(str(update_path))
                info.installed_updates = self._parse_update_log(text)
                found_any = True
                ctx.note(f"Found {len(info.installed_updates)} installed updates")

        # WindowsReliabilityRecords.log
        reliability_path = layout.gomsic_dir / "WindowsReliabilityRecords.log"
        ctx.file_searched(str(reliability_path))
        if reliability_path.is_file():
            ctx.file_found(str(reliability_path))
            # Just note it exists for now; full parsing requires understanding the format
            ctx.note("WindowsReliabilityRecords.log found")
            found_any = True

        return info if found_any else None

    def _parse_update_log(self, text: str) -> list[dict[str, str]]:
        """Parse Windows10Update.log for installed update entries."""
        updates: list[dict[str, str]] = []

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue

            # Look for KB article references
            kb_match = re.search(r"(KB\d+)", line, re.IGNORECASE)
            update: dict[str, str] = {"raw": line}

            if kb_match:
                update["kb"] = kb_match.group(1)

            # Try to extract date
            date_match = re.search(r"(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})", line)
            if date_match:
                update["date"] = date_match.group(1)

            # Try to extract title (common format: "Title - KB123456")
            parts = re.split(r"\s{2,}", line)
            if parts:
                update["title"] = parts[0]

            updates.append(update)

        return updates
