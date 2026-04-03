"""Parser for camera/acquisition configuration from acquisition logs.

Sources:
- gomsic/log/zi_acq_*.log (ZEISS 2026 acquisition session logs)
- gomsic/log/GOM-ACQ-*.log (older ZEISS 2023 acquisition logs)
- gomsic/log/GOM-HAL-*.log (Hardware Abstraction Layer logs)
- gomsic/log/sensor_initialization_protocol.log
- ZQS/gom/log/ (duplicate location)

Extracts controller discovery (broadcast JSON), detected sensor types,
camera model/serial pairs, and controller IPs.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import CameraConfig, CameraInfo, ControllerDiscovery
from .base import BaseParser

logger = logging.getLogger(__name__)

# Log file patterns for acquisition-related logs
_ACQ_LOG_PATTERNS = [
    "zi_acq_*.log",
    "GOM-ACQ-*.log",
    "GOM-HAL-*.log",
    "sensor_initialization_protocol.log",
]


class CamerasParser(BaseParser):
    name = "cameras"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[CameraInfo]:
        # Collect acquisition log files from both locations
        log_files: list[Path] = []
        existing_names: set[str] = set()

        log_dirs: list[Path] = []
        if layout.gomsic_log_dir:
            log_dirs.append(layout.gomsic_log_dir)
        if layout.zqs_gom_log_dir:
            log_dirs.append(layout.zqs_gom_log_dir)

        if not log_dirs:
            ctx.skip("No log directories found")
            return None

        for log_dir in log_dirs:
            for pattern in _ACQ_LOG_PATTERNS:
                for f in self.find_files(log_dir, pattern):
                    ctx.file_searched(str(f))
                    if f.name not in existing_names:
                        ctx.file_found(str(f))
                        log_files.append(f)
                        existing_names.add(f.name)

        if not log_files:
            ctx.skip("No acquisition log files found")
            return None

        ctx.note(f"Found {len(log_files)} acquisition log files")

        info = CameraInfo()
        seen_cameras: set[str] = set()
        seen_controllers: set[str] = set()

        for log_file in log_files:
            text = self.read_text_file(log_file)
            if text is None:
                continue

            ctx.file_parsed(str(log_file))

            # Extract data based on log type
            self._extract_controller_discovery(text, info, seen_controllers)
            self._extract_detected_sensors(text, info)
            self._extract_found_cameras(text, info, seen_cameras)
            self._extract_sensor_init_protocol(text, info, log_file.name)

            # Legacy patterns (GigE camera discovery)
            self._extract_legacy_cameras(text, info, seen_cameras)
            self._extract_controller_ip(text, info)

        return info if (info.cameras or info.controllers or info.detected_sensors) else None

    def _extract_controller_discovery(
        self, text: str, info: CameraInfo, seen: set[str]
    ) -> None:
        """Extract controller discovery from broadcast Answer lines.

        Format:
            Answer on 255.255.255.255:25025 = {"Version":"2","DeviceType":"ARAMIS Controller","SensorType":"C2023","Name":"241547","Firmware":"1.0.2-052","IP":",192.168.6.200"}
        """
        pattern = re.compile(
            r"Answer on ([\d.]+:\d+)\s*=\s*(\{.*?\})", re.MULTILINE
        )
        for match in pattern.finditer(text):
            broadcast_addr = match.group(1)
            json_str = match.group(2)
            try:
                data = json.loads(json_str)
            except (json.JSONDecodeError, ValueError):
                continue

            name = data.get("Name", "")
            if name in seen:
                continue
            seen.add(name)

            # The IP field sometimes has a leading comma: ",192.168.6.200"
            ip_raw = data.get("IP", "")
            ip_address = ip_raw.lstrip(",").strip() if ip_raw else None

            controller = ControllerDiscovery(
                device_type=data.get("DeviceType"),
                sensor_type=data.get("SensorType"),
                name=name or None,
                firmware=data.get("Firmware"),
                ip_address=ip_address,
                broadcast_address=broadcast_addr,
                raw_json=json_str,
            )
            info.controllers.append(controller)

            # Also set top-level controller_ip from discovery
            if ip_address and info.controller_ip is None:
                info.controller_ip = ip_address

    def _extract_detected_sensors(self, text: str, info: CameraInfo) -> None:
        """Extract 'Detected sensor type X at IP Y' lines.

        Format:
            Detected sensor type C2023 at IP 192.168.6.200
        """
        pattern = re.compile(
            r"Detected sensor type\s+(\S+)\s+at IP\s+([\d.]+)", re.IGNORECASE
        )
        for match in pattern.finditer(text):
            sensor_type = match.group(1)
            ip = match.group(2)
            entry = {"sensor_type": sensor_type, "ip": ip}
            if entry not in info.detected_sensors:
                info.detected_sensors.append(entry)

    def _extract_found_cameras(
        self, text: str, info: CameraInfo, seen: set[str]
    ) -> None:
        """Extract 'Found camera MODEL with serial number SERIAL' lines.

        Format:
            Found camera HB-25000SBM with serial number 2007241
        """
        pattern = re.compile(
            r"Found camera\s+(\S+)\s+with serial number\s+(\S+)", re.IGNORECASE
        )
        for match in pattern.finditer(text):
            model = match.group(1)
            serial = match.group(2)
            key = f"{model}:{serial}"
            if key in seen:
                continue
            seen.add(key)

            camera = CameraConfig(
                camera_name=model,
                model=model,
                serial_number=serial,
            )
            info.cameras.append(camera)

    def _extract_sensor_init_protocol(
        self, text: str, info: CameraInfo, filename: str
    ) -> None:
        """Extract controller entries from sensor_initialization_protocol.log.

        Format (older GOM-ACQ archives):
            [2024-09-11T07:55:18] "242723" "0.0.0.0"
        """
        if filename != "sensor_initialization_protocol.log":
            return

        pattern = re.compile(
            r'\[([^\]]+)\]\s+"([^"]+)"\s+"([^"]+)"'
        )
        for match in pattern.finditer(text):
            _timestamp = match.group(1)
            name = match.group(2)
            ip = match.group(3)

            # Treat as a controller/sensor entry
            entry = {"sensor_type": "unknown", "ip": ip, "name": name}
            if entry not in info.detected_sensors:
                info.detected_sensors.append(entry)

            if ip != "0.0.0.0" and info.controller_ip is None:
                info.controller_ip = ip

    def _extract_legacy_cameras(
        self, text: str, info: CameraInfo, seen: set[str]
    ) -> None:
        """Extract camera configuration from legacy GigE discovery patterns.

        Handles older log formats with Camera/IP/MAC triplets.
        """
        cam_pattern = re.compile(
            r"(?:camera|Camera|device)\s*(?:name)?[:\s]+([^\s,]+).*?"
            r"(?:IP|ip)[:\s]+([\d.]+).*?"
            r"(?:MAC|mac)[:\s]+([\da-fA-F:.-]+)",
            re.IGNORECASE,
        )
        for match in cam_pattern.finditer(text):
            cam_name = match.group(1)
            key = f"legacy:{cam_name}"
            if key in seen:
                continue
            seen.add(key)

            camera = CameraConfig(
                camera_name=cam_name,
                ip_address=match.group(2),
                mac_address=match.group(3),
            )
            info.cameras.append(camera)

        # GevSCPSPacketSize
        pkt_pattern = re.compile(r"GevSCPSPacketSize\s*=\s*(\d+)", re.IGNORECASE)
        for match in pkt_pattern.finditer(text):
            pkt_size = int(match.group(1))
            if info.cameras:
                info.cameras[-1].gev_scps_packet_size = pkt_size

        # Interface binding
        iface_pattern = re.compile(
            r"(?:interface|Interface)\s*[:\s]+([^\s,]+).*?"
            r"(?:camera|Camera)\s*[:\s]+([^\s,]+)",
            re.IGNORECASE,
        )
        for match in iface_pattern.finditer(text):
            iface_name = match.group(1)
            cam_name = match.group(2)
            for cam in info.cameras:
                if cam.camera_name == cam_name:
                    cam.interface_name = iface_name

    def _extract_controller_ip(self, text: str, info: CameraInfo) -> None:
        """Extract controller IP/subnet from legacy log patterns."""
        if info.controller_ip is not None:
            return

        ctrl_pattern = re.compile(
            r"(?:controller|Controller)\s*(?:IP|ip)[:\s]+([\d.]+)",
            re.IGNORECASE,
        )
        match = ctrl_pattern.search(text)
        if match:
            info.controller_ip = match.group(1)

        subnet_pattern = re.compile(
            r"(?:controller|Controller)\s*(?:subnet|Subnet)[:\s]+([\d.]+)",
            re.IGNORECASE,
        )
        match = subnet_pattern.search(text)
        if match and info.controller_subnet is None:
            info.controller_subnet = match.group(1)
