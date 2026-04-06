"""Verification engine -- confirms what IS correct in the system.

Produces a list of VerifiedCheck items that appear in the "Verified" panel.
Each check says "we confirmed X is correct" with a source reference.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import yaml

from ..models import ParseResult

logger = logging.getLogger(__name__)


class VerifiedCheck:
    """A single verification that passed."""

    def __init__(self, category: str, title: str, detail: str, source: str = ""):
        self.category = category   # "license", "driver", "network", "version", "system"
        self.title = title         # Short label
        self.detail = detail       # What was verified
        self.source = source       # Where the requirement comes from


def load_compatibility(kb_dir: Path) -> dict[str, Any]:
    """Load compatibility.yaml."""
    path = kb_dir / "compatibility.yaml"
    if not path.is_file():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except yaml.YAMLError:
        return {}


def run_verifications(result: ParseResult, kb_dir: Path) -> list[VerifiedCheck]:
    """Run all verification checks and return what passed."""
    checks: list[VerifiedCheck] = []
    compat = load_compatibility(kb_dir)

    # Determine the ZEISS major version for compatibility lookup
    major = _get_major_version(result)
    version_rules = compat.get("zeiss_inspect_versions", {}).get(major, {})
    components = version_rules.get("components", {})
    display_ver = version_rules.get("display", f"ZEISS INSPECT {major}")

    # --- Version Checks ---
    if result.zeiss_versions:
        v = result.zeiss_versions
        if v.inspect_version:
            checks.append(VerifiedCheck(
                "version", "ZEISS INSPECT version detected",
                f"Version {v.inspect_version} installed",
                "version-index.json",
            ))

        # Hardware Service version
        hw_rule = components.get("hardware_service", {})
        if v.hardware_service_version and hw_rule:
            min_ver = hw_rule.get("min_version", "")
            if min_ver and not _version_lt(v.hardware_service_version, min_ver):
                checks.append(VerifiedCheck(
                    "version",
                    f"Hardware Service >= {min_ver}",
                    f"Installed: {v.hardware_service_version} (required >= {min_ver} for {display_ver})",
                    hw_rule.get("source", "Release Notes"),
                ))

    # --- Driver Checks ---
    if result.drivers:
        drv = result.drivers

        # Mellanox
        mlnx_rule = components.get("mellanox_winof2", {})
        if drv.mellanox_driver and mlnx_rule:
            min_ver = mlnx_rule.get("min_version", "")
            if min_ver and drv.mellanox_driver.version and not _version_lt(drv.mellanox_driver.version, min_ver):
                checks.append(VerifiedCheck(
                    "driver",
                    f"Mellanox WinOF-2 >= {min_ver}",
                    f"Installed: {drv.mellanox_driver.version}",
                    mlnx_rule.get("source", "Release Notes"),
                ))

        # Rivermax
        rmax_rule = components.get("rivermax", {})
        if rmax_rule:
            required_for = rmax_rule.get("required_for", [])
            if result.product_type.value in required_for:
                if drv.rivermax:
                    min_ver = rmax_rule.get("min_version", "")
                    if min_ver and drv.rivermax.version and not _version_lt(drv.rivermax.version, min_ver):
                        checks.append(VerifiedCheck(
                            "driver",
                            f"Rivermax >= {min_ver}",
                            f"Installed: {drv.rivermax.version} (required for {result.product_type.value})",
                            rmax_rule.get("source", "Release Notes"),
                        ))

        # CodeMeter
        cm_rule = components.get("codemeter", {})
        if drv.codemeter and cm_rule:
            min_ver = cm_rule.get("min_version", "")
            if min_ver and drv.codemeter.version:
                # CodeMeter version format: "8.30.6885.501" -- compare major.minor
                cm_ver = drv.codemeter.version.split(".")[0] + "." + drv.codemeter.version.split(".")[1] if "." in drv.codemeter.version else drv.codemeter.version
                if not _version_lt(cm_ver, min_ver):
                    checks.append(VerifiedCheck(
                        "driver",
                        f"CodeMeter >= {min_ver}",
                        f"Installed: {drv.codemeter.version}",
                        cm_rule.get("source", "Release Notes"),
                    ))

        # CVB
        cvb_rule = components.get("common_vision_blox", {})
        if cvb_rule:
            min_ver = cvb_rule.get("min_version", "")
            cvb_driver = next((d for d in drv.all_relevant_drivers if "vision blox" in (d.name or "").lower()), None)
            if cvb_driver and min_ver and cvb_driver.version and not _version_lt(cvb_driver.version, min_ver):
                checks.append(VerifiedCheck(
                    "driver",
                    f"Common Vision Blox >= {min_ver}",
                    f"Installed: {cvb_driver.version}",
                    cvb_rule.get("source", "Release Notes"),
                ))

        # GPU detected
        if drv.gpu and drv.gpu.name:
            checks.append(VerifiedCheck(
                "driver", "GPU detected",
                f"{drv.gpu.name}, Driver: {drv.gpu.driver_version}, CUDA: {drv.gpu.cuda_version}",
                "nvidia-smi.log",
            ))

    # --- License Checks ---
    if result.licensing:
        lic = result.licensing

        # Dongle present
        if lic.dongles:
            d = lic.dongles[0]
            checks.append(VerifiedCheck(
                "license", "License dongle detected",
                f"{d.dongle_type}={d.serial}",
                "dongles.csv",
            ))

        # Check product-specific licenses are present
        product_val = result.product_type.value
        for entry in lic.licenses:
            prod = (entry.product or "").lower()
            if product_val.lower() in prod or "sensor driver" in prod:
                ver_info = f" (v{entry.version})" if entry.version else ""
                checks.append(VerifiedCheck(
                    "license",
                    f"License: {entry.product}",
                    f"License Name: {entry.raw_fields.get('License Name', '?')}{ver_info}, "
                    f"Expiry: {entry.expiry or 'N/A'}",
                    "licenses.csv",
                ))

        # CORRELATE license for DIC systems
        if product_val.startswith("ARAMIS"):
            correlate = [entry for entry in lic.licenses if "CORRELATE" in (entry.product or "").upper()]
            if correlate:
                c = correlate[0]
                checks.append(VerifiedCheck(
                    "license",
                    "ZEISS CORRELATE license present",
                    f"Version: {c.version or '?'}, Expiry: {c.expiry or 'N/A'}",
                    "licenses.csv",
                ))

    # --- Network Checks (things that are GOOD) ---
    if result.network:
        for adapter in result.network.adapters:
            desc = adapter.description or adapter.name
            props = adapter.advanced_properties

            # Check if jumbo frames are enabled on camera adapters
            jumbo = props.get("JumboPacket", "")
            if "mellanox" in desc.lower() or "connectx" in desc.lower():
                if jumbo and _is_gte(jumbo, 9000):
                    checks.append(VerifiedCheck(
                        "network",
                        f"Jumbo frames enabled on {adapter.name}",
                        f"JumboPacket={jumbo} (>= 9000)",
                        "nics.log (PowerShell advanced properties)",
                    ))

                recv_buf = props.get("ReceiveBuffers", "")
                if recv_buf and _is_gte(recv_buf, 4096):
                    checks.append(VerifiedCheck(
                        "network",
                        f"Receive buffers adequate on {adapter.name}",
                        f"ReceiveBuffers={recv_buf} (>= 4096)",
                        "nics.log (PowerShell advanced properties)",
                    ))

            # I210 controller adapter checks
            if "i210" in desc.lower():
                if jumbo and _is_gte(jumbo, 9014):
                    checks.append(VerifiedCheck(
                        "network",
                        f"Jumbo frames enabled on {adapter.name}",
                        f"JumboPacket={jumbo} (>= 9014)",
                        "nics.log (PowerShell advanced properties)",
                    ))

            # IPs assigned
            if adapter.ip_addresses:
                checks.append(VerifiedCheck(
                    "network",
                    f"IP assigned on {adapter.name}",
                    f"{', '.join(adapter.ip_addresses)}",
                    "nics.log (ipconfig /all)",
                ))

    # --- Hardware Service Checks ---
    if result.hardware_service:
        hs = result.hardware_service
        if hs.grpc_status == "listening":
            grpc_port = next((p for p in hs.ports if p.service == "gRPC" and p.status == "listening"), None)
            port_str = f" on port {grpc_port.port}" if grpc_port else ""
            checks.append(VerifiedCheck(
                "system", f"HAL gRPC service listening{port_str}",
                "Hardware Service RPC interface is operational",
                "GOM-HAL log",
            ))
        if hs.running:
            checks.append(VerifiedCheck(
                "system", "Hardware Service process running",
                f"PID: {hs.pid or '?'}",
                "tasklist.log",
            ))
        if hs.hal_version:
            checks.append(VerifiedCheck(
                "version", "HAL version detected",
                hs.hal_version,
                "GOM-HAL log header",
            ))
        if not hs.errors:
            checks.append(VerifiedCheck(
                "system", "No hardware errors in database",
                "hardware_status.db error_list is empty",
                "all-config/hardware_status.db",
            ))

    # --- Prerequisite Checks (.NET, VC++) ---
    dotnet_rule = components.get("dotnet", {})
    vcredist_rule = components.get("vcredist", {})

    if result.drivers and (dotnet_rule or vcredist_rule):
        all_sw = result.drivers.install_timeline + result.drivers.all_relevant_drivers
        dotnet_version = None
        vcredist_version = None

        for prog in all_sw:
            name_lower = (prog.name or "").lower()
            if (".net runtime" in name_lower or ".net desktop runtime" in name_lower) and "framework" not in name_lower and prog.version and re.match(r"^\d\.\d", prog.version or ""):
                if prog.version and (dotnet_version is None or _version_lt(dotnet_version, prog.version)):
                    dotnet_version = prog.version
            if "visual c++" in name_lower and "redistributable" in name_lower and "x64" in name_lower:
                if prog.version and (vcredist_version is None or _version_lt(vcredist_version, prog.version)):
                    vcredist_version = prog.version

        if dotnet_version and dotnet_rule:
            min_ver = dotnet_rule.get("min_version", "")
            if min_ver and not _version_lt(dotnet_version, min_ver):
                checks.append(VerifiedCheck(
                    "driver",
                    f".NET Runtime >= {min_ver}",
                    f"Installed: {dotnet_version}",
                    dotnet_rule.get("source", "Release Notes"),
                ))

        if vcredist_version and vcredist_rule:
            checks.append(VerifiedCheck(
                "driver",
                "Visual C++ Redistributable (x64) installed",
                f"Version: {vcredist_version}",
                vcredist_rule.get("source", "Release Notes"),
            ))

    # --- Firewall Executables ---
    hs_compat = compat.get("hardware_service", {})
    if hs_compat.get("firewall_executables"):
        # We can't verify firewall state from gomsic data, but we note the requirement
        pass

    # --- Camera/Controller Checks ---
    if result.cameras:
        cam = result.cameras
        if cam.controllers:
            for ctrl in cam.controllers:
                checks.append(VerifiedCheck(
                    "system",
                    f"Controller discovered: {ctrl.name or '?'}",
                    f"{ctrl.device_type or '?'} at {ctrl.ip_address or '?'}, "
                    f"Firmware: {ctrl.firmware or '?'}",
                    "zi_acq log (UDP broadcast discovery)",
                ))
        if cam.cameras:
            for c in cam.cameras:
                checks.append(VerifiedCheck(
                    "system",
                    f"Camera found: {c.model or c.camera_name or '?'}",
                    f"Serial: {c.serial_number or '?'}",
                    "zi_acq log (camera scan)",
                ))

    return checks


def _get_major_version(result: ParseResult) -> str:
    """Extract the major ZEISS version (e.g., '2026') from the result."""
    if result.zeiss_versions and result.zeiss_versions.inspect_version:
        ver = result.zeiss_versions.inspect_version
        # "2026.2.0.1091" -> "2026"
        return ver.split(".")[0]
    return ""


def _version_lt(actual: Optional[str], minimum: str) -> bool:
    """Check if actual version is less than minimum."""
    if actual is None:
        return True
    try:
        actual_parts = [int(x) for x in re.split(r"[.\-]", actual) if x.isdigit()]
        min_parts = [int(x) for x in re.split(r"[.\-]", minimum) if x.isdigit()]
        return actual_parts < min_parts
    except ValueError:
        return False


def _is_gte(value: str, threshold: int) -> bool:
    """Check if a numeric string value is >= threshold."""
    try:
        return int(value) >= threshold
    except (ValueError, TypeError):
        return False
