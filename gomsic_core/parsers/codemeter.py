"""Parser for CodeMeter/WIBU dongle diagnostics.

Sources:
- gomsic/CodeMeter.log (CmDust structured output)
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import CodeMeterInfo, StorageDrive
from .base import BaseParser

logger = logging.getLogger(__name__)


class CodeMeterParser(BaseParser):
    name = "codemeter"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[CodeMeterInfo]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        cm_path = layout.gomsic_dir / "CodeMeter.log"
        ctx.file_searched(str(cm_path))

        if not cm_path.is_file():
            ctx.skip("CodeMeter.log not found")
            return None

        ctx.file_found(str(cm_path))
        text = self.read_text_file(cm_path)
        if text is None:
            ctx.fail("Could not read CodeMeter.log")
            return None

        ctx.file_parsed(str(cm_path))

        info = CodeMeterInfo()

        # Extract CodeMeter Runtime version
        ver_match = re.search(r"CodeMeter\s+Runtime\s+Version[:\s]+([\d.]+)", text, re.IGNORECASE)
        if ver_match:
            info.version = ver_match.group(1)

        # Parse sections (CmDust output is section-based with headers)
        info.raw_sections = self._parse_sections(text)

        # Extract container info
        container_pattern = re.compile(
            r"CmContainer\s+#(\d+).*?Serial\s*:\s*(\S+)",
            re.DOTALL | re.IGNORECASE,
        )
        for match in container_pattern.finditer(text):
            info.containers.append({
                "number": match.group(1),
                "serial": match.group(2),
            })

        # Status
        if re.search(r"CmContainer.*running|Status.*OK", text, re.IGNORECASE):
            info.status = "OK"
        elif re.search(r"error|fail", text, re.IGNORECASE):
            info.status = "Error"

        # Extract drive information
        # Format: "  C:\ = Fix Drive  (966367 MB, 588600 MB free)"
        # Format: "  E:\ = Removable Drive Bus=Usb;Lexar   USB Flash Drive  (118820 MB, 105124 MB free)"
        drive_pattern = re.compile(
            r"^\s+([A-Z]:\\)\s*=\s*(Fix Drive|Removable Drive|Network Drive|CD-ROM Drive)(?:\s+(?:Bus=\S+;)?(.+?))?\s*\((\d+)\s*MB,\s*(\d+)\s*MB free\)",
            re.MULTILINE,
        )
        for match in drive_pattern.finditer(text):
            label = match.group(3).strip() if match.group(3) else None
            info.drives.append(StorageDrive(
                letter=match.group(1),
                drive_type=match.group(2),
                label=label,
                total_mb=int(match.group(4)),
                free_mb=int(match.group(5)),
            ))

        ctx.note(f"CodeMeter v{info.version}, {len(info.containers)} containers, {len(info.drives)} drives")
        return info

    def _parse_sections(self, text: str) -> dict[str, str]:
        """Parse CmDust output into named sections."""
        sections: dict[str, str] = {}
        current_section = "header"
        current_lines: list[str] = []

        for line in text.splitlines():
            # Section headers are typically lines of "=" or "-" followed by a title
            if re.match(r"^={3,}|^-{3,}", line):
                if current_lines:
                    sections[current_section] = "\n".join(current_lines)
                    current_lines = []
                continue

            # Check if this line is a section title (all caps or specific format)
            if re.match(r"^[A-Z][A-Z\s/]+:?\s*$", line.strip()) and len(line.strip()) > 3:
                if current_lines:
                    sections[current_section] = "\n".join(current_lines)
                current_section = line.strip().rstrip(":")
                current_lines = []
                continue

            current_lines.append(line)

        if current_lines:
            sections[current_section] = "\n".join(current_lines)

        return sections
