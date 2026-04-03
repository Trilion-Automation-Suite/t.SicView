"""Parser for USB device information from msinfo32.log.

Extracts the USB section from the already-parsed msinfo32 data.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import USBDevice, USBInfo
from .base import BaseParser

logger = logging.getLogger(__name__)


class USBParser(BaseParser):
    name = "usb"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[USBInfo]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        msinfo_path = layout.gomsic_dir / "msinfo32.log"
        ctx.file_searched(str(msinfo_path))

        if not msinfo_path.is_file():
            ctx.skip("msinfo32.log not found")
            return None

        ctx.file_found(str(msinfo_path))

        text = self.read_utf16_file(msinfo_path)
        if text is None:
            ctx.fail("Could not read msinfo32.log")
            return None

        ctx.file_parsed(str(msinfo_path))

        info = USBInfo()

        # Look for USB section in msinfo32.log
        # Section markers vary: [USB], "USB", or lines containing "USB" in headers
        usb_section = self._extract_usb_section(text)
        if usb_section is None:
            ctx.note("No USB section found in msinfo32.log")
            return None

        # Parse USB entries
        for line in usb_section.splitlines():
            line = line.strip()
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) >= 1:
                device = USBDevice(name=parts[0].strip())
                if len(parts) >= 2:
                    device.device_id = parts[1].strip()
                if len(parts) >= 3:
                    device.status = parts[2].strip()
                info.devices.append(device)

        ctx.note(f"Found {len(info.devices)} USB devices")
        return info if info.devices else None

    def _extract_usb_section(self, text: str) -> Optional[str]:
        """Extract the USB section from msinfo32.log text."""
        # Try [USB] section header
        usb_match = re.search(
            r"\[USB\](.*?)(?:\[|\Z)",
            text,
            re.DOTALL | re.IGNORECASE,
        )
        if usb_match:
            return usb_match.group(1)

        # Try looking for "USB" as a section in tab-delimited format
        lines = text.splitlines()
        in_usb = False
        usb_lines = []
        for line in lines:
            if re.match(r"^\s*USB\s*$", line, re.IGNORECASE):
                in_usb = True
                continue
            if in_usb:
                if line.strip() and not line.startswith("\t") and not line.startswith(" "):
                    break  # New section
                usb_lines.append(line)

        return "\n".join(usb_lines) if usb_lines else None
