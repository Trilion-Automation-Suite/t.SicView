"""Parser for driver and installed software information.

Sources:
- gomsic/InstalledPrograms.log (PowerShell Win32_Product table)
- gomsic/nvidia-smi.log (nvidia-smi + nvidia-smi -q output)
- gomsic/pnputil.log (PnP driver inventory)
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import DriverInfo, GPUInfo, InstalledDriver
from .base import BaseParser

logger = logging.getLogger(__name__)

# Programs we care about for diagnostics
_RELEVANT_PROGRAMS = [
    (re.compile(r"MLNX_WinOF2|Mellanox\s+WinOF", re.IGNORECASE), "mellanox"),
    (re.compile(r"Rivermax", re.IGNORECASE), "rivermax"),
    (re.compile(r"CodeMeter", re.IGNORECASE), "codemeter"),
    (re.compile(r"NVIDIA.*Driver|NVIDIA.*Graphics", re.IGNORECASE), "nvidia"),
    (re.compile(r"Common\s+Vision\s+Blox", re.IGNORECASE), "cvb"),
    (re.compile(r"ZEISS\s+Quality\s+Suite", re.IGNORECASE), "zeiss_qzs"),
    (re.compile(r"ZEISS\s+(?:INSPECT|CORRELATE)", re.IGNORECASE), "zeiss_inspect"),
    (re.compile(r"ZEISS.*Hardware\s+Service", re.IGNORECASE), "zeiss_hw_service"),
    (re.compile(r"MultiDeviceClient", re.IGNORECASE), "multidevice"),
    (re.compile(r"MVA_Myri", re.IGNORECASE), "myricom"),
    (re.compile(r"Intel.*Network\s+Connections", re.IGNORECASE), "intel_net"),
    (re.compile(r"\.NET\s+(?:Desktop\s+)?Runtime\s+-\s+\d", re.IGNORECASE), "dotnet"),
    (re.compile(r"Visual\s+C\+\+.*Redistributable.*x64|VC_Redist.*x64", re.IGNORECASE), "vcredist"),
    (re.compile(r"Emergent.*Camera|eCapture", re.IGNORECASE), "emergent_camera"),
    (re.compile(r"ZEISS\s+CORRELATE|GOM\s+Correlate", re.IGNORECASE), "correlate"),
]


class DriversParser(BaseParser):
    name = "drivers"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[DriverInfo]:
        info = DriverInfo()
        found_any = False

        # InstalledPrograms.log
        if layout.gomsic_dir:
            programs_path = layout.gomsic_dir / "InstalledPrograms.log"
            ctx.file_searched(str(programs_path))
            if programs_path.is_file():
                ctx.file_found(str(programs_path))
                self._parse_installed_programs(programs_path, info, ctx)
                found_any = True

        # nvidia-smi.log
        if layout.gomsic_dir:
            nvidia_path = layout.gomsic_dir / "nvidia-smi.log"
            ctx.file_searched(str(nvidia_path))
            if nvidia_path.is_file():
                ctx.file_found(str(nvidia_path))
                info.gpu = self._parse_nvidia_smi(nvidia_path, ctx)
                found_any = True

        # pnputil.log
        if layout.gomsic_dir:
            pnp_path = layout.gomsic_dir / "pnputil.log"
            ctx.file_searched(str(pnp_path))
            if pnp_path.is_file():
                ctx.file_found(str(pnp_path))
                self._parse_pnputil(pnp_path, info, ctx)
                found_any = True

        return info if found_any else None

    def _parse_installed_programs(self, path, info: DriverInfo, ctx: ParserTraceContext) -> None:
        """Parse InstalledPrograms.log (PowerShell table format).

        Real format has a wrapper:
          starting 'powershell.exe' with arguments 'Get-CimInstance Win32_Product ...'
          ---
          name                    version         installdate identifyingnumber
          ----                    -------         ----------- -----------------
          MLNX_WinOF2             3.10.50000      20240611    {63b5eb99-...}
          ...
          ---
          Exit code: 0

        Columns are space-aligned: name, version, installdate, identifyingnumber
        """
        text = self.read_text_file(path)
        if text is None:
            return

        # Strip the starting/--- wrapper to get just the table content
        lines = text.splitlines()
        table_lines: list[str] = []
        in_table = False
        col_positions: list[int] = []

        for line in lines:
            if line.strip() == "---":
                if in_table:
                    break  # End of table
                in_table = True
                continue
            if not in_table:
                continue

            # Detect column positions from the dash separator line
            if line.startswith("----") or (line.startswith("---") and not line.startswith("---\n")):
                # Find column start positions from groups of dashes
                col_positions = []
                i = 0
                while i < len(line):
                    if line[i] == "-":
                        col_positions.append(i)
                        while i < len(line) and line[i] == "-":
                            i += 1
                    else:
                        i += 1
                continue

            # Only capture data lines (after col_positions is set)
            if col_positions and line.strip():
                table_lines.append(line)

        for line in table_lines:
            # Use column positions if detected, otherwise fall back to multi-space split
            if col_positions and len(col_positions) >= 2:
                name_col = line[:col_positions[1]].strip() if len(col_positions) > 1 else line.strip()
                ver_col = ""
                if len(col_positions) > 1:
                    end = col_positions[2] if len(col_positions) > 2 else len(line)
                    ver_col = line[col_positions[1]:end].strip()
                install_col = ""
                if len(col_positions) > 2:
                    end = col_positions[3] if len(col_positions) > 3 else len(line)
                    install_col = line[col_positions[2]:end].strip()
            else:
                parts = re.split(r"\s{2,}", line.strip())
                name_col = parts[0] if parts else line.strip()
                ver_col = parts[1] if len(parts) > 1 else ""
                install_col = parts[2] if len(parts) > 2 else ""

            if not name_col:
                continue

            # Format date: YYYYMMDD -> YYYY-MM-DD
            formatted_date = install_col
            if install_col and len(install_col) == 8 and install_col.isdigit():
                formatted_date = f"{install_col[:4]}-{install_col[4:6]}-{install_col[6:]}"

            driver = InstalledDriver(
                name=name_col,
                version=ver_col or None,
                install_date=formatted_date or None,
            )

            # Add ALL programs to timeline
            info.install_timeline.append(driver)

            # Filter relevant drivers
            for pattern, category in _RELEVANT_PROGRAMS:
                if pattern.search(name_col):
                    info.all_relevant_drivers.append(driver)

                    if category == "mellanox" and info.mellanox_driver is None:
                        info.mellanox_driver = driver
                    elif category == "rivermax" and info.rivermax is None:
                        info.rivermax = driver
                    elif category == "codemeter" and info.codemeter is None:
                        info.codemeter = driver
                    elif category == "nvidia" and info.nvidia_driver is None:
                        info.nvidia_driver = driver
                    break

        # Sort timeline by install date (newest first)
        info.install_timeline.sort(key=lambda d: d.install_date or "0", reverse=True)

        ctx.file_parsed(str(path))
        ctx.note(f"Found {len(info.all_relevant_drivers)} relevant, {len(info.install_timeline)} total programs")

    def _parse_nvidia_smi(self, path, ctx: ParserTraceContext) -> Optional[GPUInfo]:
        """Parse nvidia-smi.log.

        Contains two sections with starting/--- wrappers:
        1. nvidia-smi (compact table with driver/CUDA version, GPU name, memory usage)
        2. nvidia-smi -q (detailed key-value output with Product Name, temps, etc.)
        """
        text = self.read_text_file(path)
        if text is None:
            return None

        gpu = GPUInfo()

        # Driver/CUDA from header line:
        # "| NVIDIA-SMI 516.94       Driver Version: 516.94       CUDA Version: 11.7     |"
        header = re.search(
            r"Driver\s+Version:\s+([\d.]+).*?CUDA\s+Version:\s+([\d.]+)",
            text,
        )
        if header:
            gpu.driver_version = header.group(1)
            gpu.cuda_version = header.group(2)

        # GPU name from -q output: "    Product Name                          : NVIDIA T1000 8GB"
        name_match = re.search(r"Product\s+Name\s*:\s*(.+)", text)
        if name_match:
            gpu.name = name_match.group(1).strip()
        else:
            # From compact table: "|   0  NVIDIA T1000 8GB   WDDM  |"
            table_match = re.search(r"\|\s+\d+\s+(.+?)\s+(?:WDDM|TCC)", text)
            if table_match:
                gpu.name = table_match.group(1).strip()

        # Memory from compact table: "|    630MiB /  8192MiB |"
        mem_match = re.search(r"(\d+)\s*MiB\s*/\s*(\d+)\s*MiB", text)
        if mem_match:
            gpu.memory_used = f"{mem_match.group(1)} MiB"
            gpu.memory_total = f"{mem_match.group(2)} MiB"

        # Temperature from compact table: "| 33%   39C    P8 ..."
        temp_table = re.search(r"\|\s*\d+%\s+(\d+)C\s+P\d", text)
        if temp_table:
            gpu.temperature = f"{temp_table.group(1)} C"
        else:
            # From -q: "GPU Current Temp            : 39 C"
            temp_q = re.search(r"GPU\s+Current\s+Temp\s*:\s*(\d+\s*C)", text)
            if temp_q:
                gpu.temperature = temp_q.group(1)

        # Power from compact table: "Pwr:Usage/Cap ... N/A /  50W"
        power_match = re.search(r"([\d.]+)\s*W\s*/\s*([\d.]+)\s*W", text)
        if power_match:
            gpu.power_draw = f"{power_match.group(1)} W"
        else:
            power_q = re.search(r"Power\s+Draw\s*:\s*([\d.]+\s*W)", text)
            if power_q:
                gpu.power_draw = power_q.group(1)

        # Product Brand from -q
        brand_match = re.search(r"Product\s+Brand\s*:\s*(.+)", text)
        if brand_match:
            gpu.raw_data["product_brand"] = brand_match.group(1).strip()

        # Product Architecture from -q
        arch_match = re.search(r"Product\s+Architecture\s*:\s*(.+)", text)
        if arch_match:
            gpu.raw_data["architecture"] = arch_match.group(1).strip()

        ctx.file_parsed(str(path))
        return gpu

    def _parse_pnputil(self, path, info: DriverInfo, ctx: ParserTraceContext) -> None:
        """Parse pnputil.log for additional driver info."""
        text = self.read_text_file(path)
        if text is None:
            return

        # pnputil lists drivers in blocks. Look for relevant ones.
        for pattern, category in _RELEVANT_PROGRAMS:
            if pattern.search(text):
                ctx.note(f"Found {category} reference in pnputil.log")

        ctx.file_parsed(str(path))
