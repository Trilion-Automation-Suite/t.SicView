"""Parser for system hardware/OS information from msinfo32.log.

msinfo32.log is UTF-16 LE encoded with tab-delimited key-value pairs,
organized into sections like [System Summary], [Hardware Resources], etc.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import SystemInfo
from .base import BaseParser

logger = logging.getLogger(__name__)

# Key fields to extract from the System Summary section
_SYSTEM_FIELDS = {
    "OS Name": "os_name",
    "Version": "os_version",
    "OS Version": "os_version",
    "System Name": "computer_name",
    "Computer Name": "computer_name",
    "System Manufacturer": "system_manufacturer",
    "System Model": "system_model",
    "Processor": "processor",
    "Total Physical Memory": "total_physical_memory",
    "Installed Physical Memory": "total_physical_memory",
    "BIOS Version/Date": "bios_version",
    "BIOS Version": "bios_version",
    "BaseBoard Product": "baseboard_product",
}


class SystemInfoParser(BaseParser):
    name = "system_info"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[SystemInfo]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        msinfo_path = layout.gomsic_dir / "msinfo32.log"
        ctx.file_searched(str(msinfo_path))

        if not msinfo_path.is_file():
            ctx.skip("msinfo32.log not found")
            return None

        ctx.file_found(str(msinfo_path))

        # msinfo32.log is UTF-16 LE (confirmed from real fixtures)
        text = self.read_utf16_file(msinfo_path)
        if text is None:
            ctx.fail("Could not read msinfo32.log")
            return None

        ctx.note(f"Read msinfo32.log ({len(text)} chars)")
        ctx.file_parsed(str(msinfo_path))

        info = SystemInfo()
        sections = self._parse_sections(text)
        info.sections = sections

        # Extract key fields from the first section (typically System Summary)
        summary_keys = ["System Summary", "Systemuebersicht", ""]
        summary_rows: list[dict[str, str]] = []
        for key in summary_keys:
            if key in sections:
                summary_rows = sections[key]
                break
        if not summary_rows and sections:
            summary_rows = next(iter(sections.values()))

        for row in summary_rows:
            item = row.get("Item", row.get("item", ""))
            value = row.get("Value", row.get("value", ""))
            for field_key, attr_name in _SYSTEM_FIELDS.items():
                if field_key.lower() in item.lower():
                    if not getattr(info, attr_name):
                        setattr(info, attr_name, value)

        # Extract Problem Devices section
        problem_devices = []
        for sec_name in ("Problem Devices", "Problemgeraete"):
            if sec_name in sections:
                for row in sections[sec_name]:
                    device = row.get("Item", "")
                    detail = row.get("Value", "")
                    # Skip header rows like "Device" / "PNP Device ID"
                    if device and device.lower() not in ("device", "item", ""):
                        if detail.lower() not in ("pnp device id", "error code", "value", ""):
                            problem_devices.append(f"{device}: {detail}" if detail else device)
                        elif device.lower() != "device":
                            problem_devices.append(device)
        info.problem_devices = problem_devices
        if problem_devices:
            ctx.note(f"Found {len(problem_devices)} problem device(s)")

        # Extract Display/GPU info as fallback (for non-NVIDIA systems)
        for sec_name in ("Display", "Anzeige", "Components|Display"):
            rows = sections.get(sec_name, [])
            if not rows:
                # Try partial match
                for k, v in sections.items():
                    if "display" in k.lower():
                        rows = v
                        break
            if rows:
                display_info = {}
                for row in rows:
                    item = row.get("Item", "").lower()
                    value = row.get("Value", "")
                    if ("adapter description" in item or ("name" in item and "adapter" in item)):
                        if "name" not in display_info:
                            display_info["name"] = value
                    elif "adapter ram" in item:
                        display_info["memory"] = value
                    elif "driver version" in item:
                        display_info["driver_version"] = value
                    elif "resolution" in item:
                        display_info["resolution"] = value
                if display_info:
                    info.display_info = display_info
                break

        # Extract Environment Variables for Rivermax checks
        for sec_name, rows in sections.items():
            if "environment" in sec_name.lower() and "variable" in sec_name.lower():
                env_vars = {}
                for row in rows:
                    env_vars[row.get("Item", "")] = row.get("Value", "")
                info.environment_variables = env_vars
                break

        return info

    def _parse_sections(self, text: str) -> dict[str, list[dict[str, str]]]:
        """Parse msinfo32.log into sections of key-value rows.

        Real format (UTF-16 decoded):
            System Information report written at: 01/16/26 12:22:42
            System Name: GOMPC
            [System Summary]

            Item\tValue\t
            OS Name\tMicrosoft Windows 10 Pro for Workstations\t
            Version\t10.0.19045 Build 19045\t

        Note the trailing tabs after values.
        """
        sections: dict[str, list[dict[str, str]]] = {}
        current_section = ""
        current_rows: list[dict[str, str]] = []

        # Handle header lines before first section (report timestamp, system name)
        header_rows: list[dict[str, str]] = []

        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue

            # Section header detection: [Section Name] pattern
            section_match = re.match(r"^\[(.+)\]\s*$", stripped)
            if section_match:
                if current_rows:
                    sections[current_section] = current_rows
                elif header_rows and not current_section:
                    sections["_header"] = header_rows
                current_section = section_match.group(1)
                current_rows = []
                continue

            # Tab-delimited key-value pair (real format has trailing tab)
            parts = line.split("\t")
            # Filter out empty parts from trailing tabs
            parts = [p.strip() for p in parts if p.strip()]

            if len(parts) >= 2:
                current_rows.append({
                    "Item": parts[0],
                    "Value": parts[1],
                })
            elif len(parts) == 1:
                # Could be a header line like "System Name: GOMPC"
                colon_match = re.match(r"^(.+?):\s*(.+)$", parts[0])
                if colon_match:
                    row = {"Item": colon_match.group(1).strip(), "Value": colon_match.group(2).strip()}
                    if current_section:
                        current_rows.append(row)
                    else:
                        header_rows.append(row)
                elif parts[0] and parts[0] != "Item":  # Skip the "Item" header
                    if current_section:
                        current_rows.append({"Item": parts[0], "Value": ""})

        # Don't forget the last section
        if current_rows:
            sections[current_section] = current_rows
        if header_rows and "_header" not in sections:
            sections["_header"] = header_rows

        return sections
