"""Parser for ZEISS software version information.

Sources:
- ZQS/InstalledSoftware/ZEISS-INSPECT/<version>/version-index.json
- ZQS/InstalledSoftware/ZEISS-INSPECT-Hardware-Service/<version>/version-index.json
- ZQS/InstalledSoftware/ZQS_*.json (Quality Suite metadata)
- ZQS/InstalledSoftware/ZEISS-INSPECT_*.json (license/product manifest)

version-index.json format: {"fileVersion": "0.1.0", "index": [{"version": "2026.2.0.1091"}]}
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import ZeissVersions
from .base import BaseParser

logger = logging.getLogger(__name__)


def _extract_version(data: dict[str, Any]) -> Optional[str]:
    """Extract version string from version-index.json format.

    Handles both direct {"version": "X"} and nested {"index": [{"version": "X"}]}.
    """
    # Direct version field
    ver = data.get("version") or data.get("Version")
    if ver:
        return str(ver)

    # Nested in index array
    index = data.get("index", [])
    if isinstance(index, list) and index:
        first = index[0]
        if isinstance(first, dict):
            ver = first.get("version") or first.get("Version")
            if ver:
                return str(ver)

    return None


class ZeissVersionsParser(BaseParser):
    name = "zeiss_versions"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[ZeissVersions]:
        versions = ZeissVersions()
        raw: dict = {}
        found_any = False

        sw_dir = layout.zqs_installed_software_dir

        # --- ZQS-based version extraction (full ZIP archives) ---
        if sw_dir:
            # ZEISS INSPECT version
            for vi in self.find_files(sw_dir, "ZEISS-INSPECT/*/version-index.json"):
                ctx.file_searched(str(vi))
                try:
                    data = json.loads(vi.read_text(encoding="utf-8"))
                    ctx.file_found(str(vi))
                    ctx.file_parsed(str(vi))
                    versions.inspect_version = _extract_version(data)
                    raw["inspect"] = data
                    found_any = True
                except (json.JSONDecodeError, OSError) as e:
                    ctx.note(f"Failed to parse {vi.name}: {e}")

            # Hardware Service version
            for vi in self.find_files(sw_dir, "ZEISS-INSPECT-Hardware-Service/*/version-index.json"):
                ctx.file_searched(str(vi))
                try:
                    data = json.loads(vi.read_text(encoding="utf-8"))
                    ctx.file_found(str(vi))
                    ctx.file_parsed(str(vi))
                    versions.hardware_service_version = _extract_version(data)
                    raw["hardware_service"] = data
                    found_any = True
                except (json.JSONDecodeError, OSError) as e:
                    ctx.note(f"Failed to parse {vi.name}: {e}")

            # Quality Suite metadata (ZQS_7.json etc.)
            for mf in self.find_files(sw_dir, "ZQS_*.json"):
                ctx.file_searched(str(mf))
                try:
                    data = json.loads(mf.read_text(encoding="utf-8"))
                    ctx.file_found(str(mf))
                    ctx.file_parsed(str(mf))
                    sw = data.get("software", {})
                    versions.quality_suite_version = sw.get("majorVersion")
                    raw["qzs"] = data
                    found_any = True
                except (json.JSONDecodeError, OSError):
                    pass

            # Product manifest (ZEISS-INSPECT_2026.json etc.)
            for mf in self.find_files(sw_dir, "ZEISS-INSPECT_*.json"):
                ctx.file_searched(str(mf))
                try:
                    data = json.loads(mf.read_text(encoding="utf-8"))
                    ctx.file_found(str(mf))
                    ctx.file_parsed(str(mf))
                    sw = data.get("software", {})
                    display_name = sw.get("displayName", {})
                    versions.product_name = display_name.get("en", sw.get("name"))
                    raw["manifest"] = data
                    found_any = True
                except (json.JSONDecodeError, OSError) as e:
                    ctx.note(f"Failed to parse {mf.name}: {e}")
        else:
            ctx.note("No ZQS InstalledSoftware directory -- trying gomsic-level fallbacks")

        # --- Gomsic-level fallbacks (raw .tgz archives) ---
        if layout.gomsic_dir:
            # Extract INSPECT version from registry.log
            if not versions.inspect_version:
                reg_path = layout.gomsic_dir / "registry.log"
                if reg_path.is_file():
                    ctx.file_searched(str(reg_path))
                    text = self.read_text_file(reg_path)
                    if text:
                        ctx.file_found(str(reg_path))
                        # "DisplayVersion    REG_SZ    2026.3.0.984"
                        m = re.search(r"ZEISS.INSPECT.*?DisplayVersion\s+REG_SZ\s+([\d.]+)", text, re.DOTALL)
                        if m:
                            versions.inspect_version = m.group(1)
                            found_any = True
                            ctx.note(f"INSPECT version from registry: {m.group(1)}")
                        # Hardware Service version from registry
                        if not versions.hardware_service_version:
                            m2 = re.search(r"Hardware.?Service.*?DisplayVersion\s+REG_SZ\s+([\d.]+)", text, re.DOTALL | re.IGNORECASE)
                            if m2:
                                versions.hardware_service_version = m2.group(1)
                                found_any = True
                                ctx.note(f"HW Service version from registry: {m2.group(1)}")

            # Extract from ZEISS_INSPECT application logs (richest source)
            if layout.gomsic_log_dir:
                for log_file in self.find_files(layout.gomsic_log_dir, "ZEISS_INSPECT-*.log"):
                    ctx.file_searched(str(log_file))
                    text = self.read_text_file(log_file)
                    if not text:
                        continue
                    ctx.file_found(str(log_file))
                    header = text[:3000]

                    # "Version:          2026.3.0.984 (Build 2026-03-04)"
                    if not versions.inspect_version:
                        m = re.search(r"Version:\s+(20\d{2}\.\d+\.\d+\.\d+)", header)
                        if m:
                            versions.inspect_version = m.group(1)
                            found_any = True
                            ctx.note(f"INSPECT version from app log: {m.group(1)}")

                    # "Command line:     ...ZEISS_INSPECT.exe -license correlate_all"
                    if not versions.product_name:
                        m = re.search(r'Command line:.*-license\s+(\S+)', header)
                        if m:
                            lic_mode = m.group(1)
                            if 'correlate' in lic_mode.lower():
                                versions.product_name = "ZEISS CORRELATE"
                            ctx.note(f"License mode from app log: {lic_mode}")

                    break  # only need one log file

        versions.raw_version_data = raw
        return versions if found_any else None
