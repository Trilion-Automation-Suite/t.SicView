"""Parser for ZEISS Hardware Service (HAL) status and diagnostics.

The Hardware Service (HAL = Hardware Abstraction Layer) mediates between
ZEISS INSPECT and measurement hardware. It runs as a Windows Service
(`ZEISS_INSPECT_HardwareService.exe`) and communicates via:
  - TCP port 39000 (backend, ZEISS 2025+)
  - gRPC port 39002 (hardware RPC, ZEISS 2025+) or 50002 (ZEISS 2023)
  - TCP port 39003 (PStore data buffer)
  - TCP port 39035 (CMD client interface)

Sources:
  - GOM-HAL-*.log (HAL process logs -- startup, ports, errors)
  - tasklist.log (running process check)
  - all-config/hardware_status.db (SQLite -- session history, devices, errors)
  - all-config/hardware_cfg.xml (hardware configuration)
  - ZQS/InstalledSoftware/ZEISS-INSPECT-Hardware-Service/*/version-index.json
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import (
    HardwareServiceDevice,
    HardwareServiceError,
    HardwareServiceInfo,
    HardwareServicePort,
    HardwareServiceSession,
)
from .base import BaseParser

logger = logging.getLogger(__name__)


class HardwareServiceParser(BaseParser):
    name = "hardware_service"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[HardwareServiceInfo]:
        info = HardwareServiceInfo()
        found_any = False

        # 1. Version from version-index.json (ZQS archives only)
        if layout.zqs_installed_software_dir:
            for vi in self.find_files(
                layout.zqs_installed_software_dir,
                "ZEISS-INSPECT-Hardware-Service/*/version-index.json",
            ):
                ctx.file_searched(str(vi))
                try:
                    data = json.loads(vi.read_text(encoding="utf-8"))
                    ctx.file_found(str(vi))
                    ctx.file_parsed(str(vi))
                    index = data.get("index", [])
                    if index and isinstance(index, list):
                        info.version = index[0].get("version")
                    found_any = True
                except (json.JSONDecodeError, OSError) as e:
                    ctx.note(f"Failed to parse {vi.name}: {e}")

        # 2. Parse GOM-HAL-*.log files for port status, gRPC, timeline
        hal_logs = []
        if layout.gomsic_log_dir:
            hal_logs.extend(self.find_files(layout.gomsic_log_dir, "GOM-HAL-*.log"))
        if layout.zqs_gom_log_dir:
            existing = {f.name for f in hal_logs}
            hal_logs.extend(f for f in self.find_files(layout.zqs_gom_log_dir, "GOM-HAL-*.log")
                           if f.name not in existing)

        for hal_log in hal_logs:
            ctx.file_searched(str(hal_log))
            ctx.file_found(str(hal_log))

        # Use the most recent HAL log (last by name sort = latest timestamp)
        if hal_logs:
            hal_logs.sort()
            latest_hal = hal_logs[-1]
            self._parse_hal_log(latest_hal, info, ctx)
            found_any = True

        # 3. Check if running from tasklist.log (enhanced: multi-instance, other ZEISS processes)
        if layout.gomsic_dir:
            tasklist_path = layout.gomsic_dir / "tasklist.log"
            ctx.file_searched(str(tasklist_path))
            if tasklist_path.is_file():
                ctx.file_found(str(tasklist_path))
                text = self.read_text_file(tasklist_path)
                if text:
                    ctx.file_parsed(str(tasklist_path))
                    hw_procs = [line for line in text.splitlines()
                                if re.search(r"hardware.?service|HardwareSer", line, re.IGNORECASE)]
                    if hw_procs:
                        info.running = True
                        info.process_name = hw_procs[0].split()[0]
                        pid_match = re.search(r"\b(\d{2,})\b", hw_procs[0])
                        if pid_match:
                            info.pid = int(pid_match.group(1))
                        if len(hw_procs) > 1:
                            info.multiple_instances = True
                            info.timeline.append(f"WARNING: {len(hw_procs)} Hardware Service instances running (stale process?)")
                        ctx.note(f"Hardware Service running ({len(hw_procs)} process(es))")
                    else:
                        info.running = False
                        ctx.note("Hardware Service not found in tasklist")

                    # Check for other ZEISS processes
                    related = {}
                    for line in text.splitlines():
                        ll = line.lower()
                        if "zeiss_inspect" in ll or "gom_inspect" in ll:
                            related["ZEISS INSPECT"] = True
                        elif "multideviceclient" in ll:
                            related["MultiDeviceClient (MDM)"] = True
                        elif "codemeter" in ll:
                            related["CodeMeter"] = True
                    info.related_processes = related
                    found_any = True

        # 4. Parse hardware_status.db (SQLite) with schema discovery
        if layout.gomsic_dir:
            db_path = layout.gomsic_dir / "all-config" / "hardware_status.db"
            ctx.file_searched(str(db_path))
            if db_path.is_file():
                ctx.file_found(str(db_path))
                self._parse_hardware_db(db_path, info, ctx)
                found_any = True

        # 5. Parse hardware_cfg.xml (enhanced: extract device entries)
        if layout.gomsic_dir:
            cfg_path = layout.gomsic_dir / "all-config" / "hardware_cfg.xml"
            ctx.file_searched(str(cfg_path))
            if cfg_path.is_file():
                ctx.file_found(str(cfg_path))
                text = self.read_text_file(cfg_path)
                if text:
                    stripped = text.strip()
                    if stripped.endswith("<Configs/>") or "<Configs/>" in stripped:
                        info.timeline.append("hardware_cfg.xml is empty (<Configs/>) -- no hardware configured")
                        ctx.note("hardware_cfg.xml is empty")
                    else:
                        self._parse_hardware_cfg_xml(text, info, ctx)
                    ctx.file_parsed(str(cfg_path))

        # 6. Registry extraction (enhanced: install path, service startup, env vars, firewall)
        if layout.gomsic_dir:
            reg_path = layout.gomsic_dir / "registry.log"
            if reg_path.is_file():
                text = self.read_text_file(reg_path)
                if text:
                    self._parse_registry(text, info, ctx)

        info.config_path = "C:/ProgramData/Zeiss/HardwareServer"
        return info if found_any else None

    def _extract_ts(self, line: str) -> str:
        """Extract timestamp prefix from a log line, or return empty string."""
        m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)", line)
        return m.group(1) if m else ""

    def _ts_event(self, line: str, event: str) -> str:
        """Format a timeline event with timestamp if available."""
        ts = self._extract_ts(line)
        return f"[{ts}] {event}" if ts else event

    def _parse_hal_log(self, path: Path, info: HardwareServiceInfo, ctx: ParserTraceContext) -> None:
        """Parse a GOM-HAL-*.log file for startup sequence, ports, and errors."""
        text = self.read_text_file(path)
        if text is None:
            return
        ctx.file_parsed(str(path))

        lines = text.splitlines()

        # Header: version and branch
        for line in lines[:5]:
            if line.startswith("HAL "):
                info.hal_version = line.strip()
                info.timeline.append(f"HAL version: {line.strip()}")
            elif line.startswith("Branch:"):
                info.hal_branch = line.replace("Branch:", "").strip()
            elif line.startswith("PID:"):
                try:
                    info.hal_pid = int(line.replace("PID:", "").strip())
                except ValueError:
                    pass

        # Count startup events to detect restart cycles
        start_count = sum(1 for line in lines if "Starting HAL" in line or "HAL initialization" in line)
        if start_count > 1:
            info.timeline.append(f"WARNING: {start_count} HAL startup events detected (restart cycle?)")

        # Port detection (including 39001 Web Management and 39025 Device Communication)
        for line in lines:
            # CMD listener: "Listening for clients on address 0.0.0.0:39035"
            m = re.search(r"Listening for clients on address ([\d.]+):(\d+)", line)
            if m:
                port = HardwareServicePort(
                    port=int(m.group(2)), service="HAL CMD",
                    address=m.group(1), status="listening",
                )
                info.ports.append(port)
                info.timeline.append(f"CMD listening on {m.group(1)}:{m.group(2)}")

            # Backend: "Backend is listening for clients at localhost:39000"
            m = re.search(r"Backend is listening.*?at ([\w.]+):(\d+)", line)
            if m:
                port = HardwareServicePort(
                    port=int(m.group(2)), service="HAL Backend",
                    address=m.group(1), status="listening",
                )
                info.ports.append(port)
                info.timeline.append(f"Backend listening on {m.group(1)}:{m.group(2)}")

            # gRPC listening: "gRPC Server listening on 127.0.0.1:39002"
            m = re.search(r"gRPC Server listening on ([\d.]+):(\d+)", line)
            if m:
                port = HardwareServicePort(
                    port=int(m.group(2)), service="gRPC",
                    protocol="gRPC", address=m.group(1), status="listening",
                )
                info.ports.append(port)
                info.grpc_status = "listening"
                info.timeline.append(f"gRPC listening on {m.group(1)}:{m.group(2)}")

            # gRPC blocked: "gRPC server port already blocked :39002"
            m = re.search(r"gRPC server port already blocked\s*:(\d+)", line)
            if m:
                port = HardwareServicePort(
                    port=int(m.group(1)), service="gRPC",
                    protocol="gRPC", status="blocked",
                )
                info.ports.append(port)
                info.grpc_status = "blocked"
                info.timeline.append(f"gRPC BLOCKED on port {m.group(1)} -- stale process?")

            # PStore: "Project store (hal-server) is started for ip: 127.0.0.1, port: 39003"
            m = re.search(r"Project store.*?started for ip: ([\d.]+), port: (\d+)", line)
            if m:
                port = HardwareServicePort(
                    port=int(m.group(2)), service="PStore",
                    address=m.group(1), status="listening",
                )
                info.ports.append(port)
                info.timeline.append(self._ts_event(line, f"PStore on {m.group(1)}:{m.group(2)}"))

            # Web Management: port 39001
            m = re.search(r"(?:Web|HTTP|management).*?(?:listening|started).*?(?:on|at)\s*([\d.]+)?:?(\d+)\b", line, re.IGNORECASE)
            if m and m.group(2) and int(m.group(2)) == 39001:
                port = HardwareServicePort(
                    port=39001, service="Web Management",
                    protocol="HTTP", address=m.group(1) or "127.0.0.1", status="listening",
                )
                info.ports.append(port)
                info.timeline.append(self._ts_event(line, "Web Management (MDM) listening on port 39001"))

            # Device Communication: port 39025
            m = re.search(r"(?:device|communication).*?(?:listening|started|bound).*?:?(\d+)", line, re.IGNORECASE)
            if m and int(m.group(1)) == 39025:
                port = HardwareServicePort(
                    port=39025, service="Device Communication",
                    address="0.0.0.0", status="listening",
                )
                info.ports.append(port)
                info.timeline.append(self._ts_event(line, "Device Communication listening on port 39025"))

            # Generic port detection fallback for any unmatched port lines
            m = re.search(r"(?:listening|bound|started).*?(?:port|:)\s*(\d{4,5})", line, re.IGNORECASE)
            if m:
                port_num = int(m.group(1))
                if 39000 <= port_num <= 39099 and not any(p.port == port_num for p in info.ports):
                    info.ports.append(HardwareServicePort(
                        port=port_num, service=f"Port {port_num}",
                        status="listening",
                    ))

            # Cold Start events
            m = re.search(r"\[Cold Start\]\s*\[(.+?)\]:\s*(.+)", line)
            if m:
                info.timeline.append(self._ts_event(line, f"[{m.group(1)}] {m.group(2)}"))

            # IoT/SQLite
            if "Database: connection ok" in line:
                info.timeline.append(self._ts_event(line, "SQLite database connected OK"))
            if "IoT Server has been started" in line:
                info.timeline.append(self._ts_event(line, "IoT Server started"))
            if re.search(r"IoT Server.*fail|Cannot start IoT", line, re.IGNORECASE):
                info.timeline.append(self._ts_event(line, "ERROR: IoT Server failed to start"))

            # TLS/certificate errors
            if re.search(r"SSL.*fail|certificate.*fail|TLS.*error", line, re.IGNORECASE):
                info.timeline.append(self._ts_event(line, f"TLS ERROR: {line.strip()[:120]}"))

            # detectHardware
            if "detectHardware" in line:
                info.timeline.append(f"detectHardware: {line.strip()[:120]}")

            # FG errors
            m = re.search(r"Error (FG-\w+):(.+?)(?:\n|$)", line)
            if m:
                info.timeline.append(f"ERROR {m.group(1)}: {m.group(2).strip()}")

            # HALDATA errors
            m = re.search(r"Error (HALDATA-\w+)", line)
            if m:
                info.timeline.append(f"ERROR {m.group(1)}: config error")

            # Generic initialization errors
            if "Cannot connect to" in line:
                info.timeline.append(f"CONNECTION FAILED: {line.strip()[:120]}")
            if "hardware specification is incomplete" in line:
                info.timeline.append("Hardware specification incomplete")

        ctx.note(f"HAL log: {len(info.ports)} ports, gRPC={info.grpc_status}, {len(info.timeline)} events")

    def _parse_hardware_db(self, db_path: Path, info: HardwareServiceInfo, ctx: ParserTraceContext) -> None:
        """Parse hardware_status.db SQLite database."""
        db = None
        try:
            db = sqlite3.connect(str(db_path))
            cursor = db.cursor()

            # DB version
            try:
                cursor.execute("SELECT version_number FROM db_version LIMIT 1")
                row = cursor.fetchone()
                if row:
                    info.db_version = row[0]
            except sqlite3.OperationalError:
                pass

            # Sessions (most recent 5)
            try:
                cursor.execute("""
                    SELECT timestamp, sw_name, sw_version, sw_revision, sw_build_date,
                           hardware_type, hardware_family, manufacturer, product_instance_uri
                    FROM session_data ORDER BY rowid DESC LIMIT 5
                """)
                for row in cursor.fetchall():
                    info.sessions.append(HardwareServiceSession(
                        timestamp=row[0], sw_name=row[1], sw_version=row[2],
                        sw_revision=row[3], sw_build_date=row[4],
                        hardware_type=row[5], hardware_family=row[6],
                        manufacturer=row[7], product_instance_uri=row[8],
                    ))
            except sqlite3.OperationalError:
                pass

            # Devices (from group_data)
            try:
                cursor.execute("""
                    SELECT DISTINCT id, name, ip_address, type, uuid, version
                    FROM group_data
                """)
                seen = set()
                for row in cursor.fetchall():
                    key = (row[0], row[3])
                    if key not in seen:
                        seen.add(key)
                        info.devices.append(HardwareServiceDevice(
                            device_id=row[0], name=row[1], ip_address=row[2],
                            device_type=row[3], uuid=row[4], version=row[5],
                        ))
            except sqlite3.OperationalError:
                pass

            # Errors
            try:
                cursor.execute("""
                    SELECT source_name, error_code, description, severity
                    FROM error_list
                """)
                for row in cursor.fetchall():
                    info.errors.append(HardwareServiceError(
                        source_name=row[0], error_code=row[1],
                        description=row[2], severity=row[3],
                    ))
            except sqlite3.OperationalError:
                pass

            # Schema discovery: enumerate all tables
            try:
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = [row[0] for row in cursor.fetchall()]
                info.db_tables = tables
                ctx.note(f"DB tables: {', '.join(tables)}")
            except sqlite3.OperationalError:
                pass

            # Total session count
            try:
                cursor.execute("SELECT COUNT(*) FROM session_data")
                row = cursor.fetchone()
                if row:
                    info.total_session_count = row[0]
            except sqlite3.OperationalError:
                pass

            ctx.file_parsed(str(db_path))
            ctx.note(f"hardware_status.db: {len(info.sessions)} sessions (of {info.total_session_count or '?'} total), "
                     f"{len(info.devices)} devices, {len(info.errors)} errors")

        except (sqlite3.Error, OSError) as e:
            ctx.note(f"Failed to parse hardware_status.db: {e}")
        finally:
            if db:
                db.close()

    def _parse_hardware_cfg_xml(self, text: str, info: HardwareServiceInfo, ctx: ParserTraceContext) -> None:
        """Parse hardware_cfg.xml for device entries and bound NIC IPs."""
        try:
            # Defuse XXE: strip DOCTYPE declarations before parsing
            safe_text = re.sub(r'<!DOCTYPE[^[>]*(?:\[[^\]]*\])?\s*>', '', text, flags=re.DOTALL)
            safe_text = re.sub(r'<!ENTITY[^>]*>', '', safe_text, flags=re.DOTALL)
            root = ET.fromstring(safe_text)
            cfg_devices = []
            for config in root.iter():
                attribs = config.attrib
                if attribs:
                    entry = {k: v for k, v in attribs.items() if v}
                    if entry:
                        cfg_devices.append(entry)
            info.hardware_cfg_entries = cfg_devices
            ctx.note(f"hardware_cfg.xml: {len(cfg_devices)} config entries")
            # Extract bound NIC IPs
            for entry in cfg_devices:
                for key, val in entry.items():
                    if "ip" in key.lower() or "address" in key.lower():
                        if re.match(r"\d+\.\d+\.\d+\.\d+", val):
                            info.timeline.append(f"Config bound IP: {val} ({key})")
        except Exception as e:
            ctx.note(f"Failed to parse hardware_cfg.xml: {e}")

    def _parse_registry(self, text: str, info: HardwareServiceInfo, ctx: ParserTraceContext) -> None:
        """Extract diagnostic data from registry.log."""
        # Install path
        m = re.search(r"InstallPath.*?(C:\\[^\r\n]+Hardware[^\r\n]+)", text, re.IGNORECASE)
        if m:
            info.install_path = m.group(1).strip()

        # Service startup type: Start REG_DWORD 0x00000002 = Automatic
        # Search within the HardwareService registry key section only (no DOTALL to avoid cross-section matches)
        m = re.search(r"Hardware.?Service[^\n]*\n[^\[]*?\"Start\"\s*=\s*dword:0*(\d+)", text, re.IGNORECASE)
        if m:
            start_val = int(m.group(1))
            start_types = {2: "Automatic", 3: "Manual", 4: "Disabled"}
            info.service_startup_type = start_types.get(start_val, f"Unknown ({start_val})")
            if start_val != 2:
                info.timeline.append(f"WARNING: Service startup type is {info.service_startup_type} (should be Automatic)")

        # Rivermax environment variables
        if "RIVERMAX_LOG_LEVEL" in text:
            info.rivermax_env_vars["RIVERMAX_LOG_LEVEL"] = "present"
        if "MELLANOX_RINGBUFF_FACTOR" in text:
            info.rivermax_env_vars["MELLANOX_RINGBUFF_FACTOR"] = "present"

        # Firewall rules for ZEISS executables
        # Look for firewall rule entries containing the exe names
        fw_checks = {
            "zeiss_inspect_hardwareserver.exe": False,
            "zeiss_inspect_hardwareservice.exe": False,
            "zeiss_inspect.exe": False,
        }
        for exe_name in fw_checks:
            if re.search(re.escape(exe_name), text, re.IGNORECASE):
                fw_checks[exe_name] = True
                info.firewall_rules_found.append(exe_name)
        # Also look for firewall rule blocks (registry format)
        for m in re.finditer(r"FirewallRules.*?\"([^\"]+)\"=\"([^\"]+)\"", text, re.IGNORECASE):
            rule_value = m.group(2)
            for exe_name in fw_checks:
                if exe_name.lower() in rule_value.lower() and exe_name not in info.firewall_rules_found:
                    info.firewall_rules_found.append(exe_name)
