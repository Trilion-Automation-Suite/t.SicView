"""Multi-pass error detection engine.

Runs eight detection passes against parsed archive data:
1. Regex pattern matching against knowledge_base/patterns.yaml
2. NIC configuration validator against knowledge_base/nic_rules.yaml
3. Driver version checker against knowledge_base/driver_rules.yaml
4. License consistency checker against knowledge_base/license_rules.yaml
5. Log entry analysis (ERROR/WARNING counts)
6. Hardware Service (HAL) structural checks
7. Prerequisite checks (.NET Runtime, VC++ Redistributable)
8. System health (problem devices, disconnected NICs, disk space, env vars)
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

import yaml

from ..models import (
    Finding,
    NetworkInfo,
    DriverInfo,
    LicenseInfo,
    LogSummary,
    ParseResult,
    ProductType,
    Severity,
)
from . import known_issues

logger = logging.getLogger(__name__)


class ErrorDetector:
    """Runs all detection passes and collects findings."""

    def __init__(self, knowledge_base_dir: Path):
        self.kb_dir = knowledge_base_dir
        self._patterns = known_issues.load_patterns(knowledge_base_dir)
        self._nic_rules = known_issues.load_nic_rules(knowledge_base_dir)
        self._driver_rules = known_issues.load_driver_rules(knowledge_base_dir)
        self._license_rules = known_issues.load_license_rules(knowledge_base_dir)
        self._compatibility = self._load_compatibility(knowledge_base_dir)

    def detect(self, result: ParseResult) -> list[Finding]:
        """Run all detection passes and return findings."""
        findings: list[Finding] = []

        # Pass 1: Pattern matching against log content
        findings.extend(self._run_pattern_matching(result))

        # Pass 2: NIC configuration validation
        if result.network:
            findings.extend(self._check_nic_config(result.network, result.product_type))

        # Pass 3: Driver version checks
        if result.drivers:
            findings.extend(self._check_drivers(result.drivers, result.product_type))

        # Pass 4: License consistency
        if result.licensing:
            findings.extend(self._check_licenses(result.licensing, result.product_type))

        # Pass 5: Log-based findings (from already-parsed log entries)
        if result.logs:
            findings.extend(self._analyze_log_entries(result.logs))

        # Pass 6: Hardware Service (HAL) structural checks
        findings.extend(self._check_hardware_service(result))

        # Pass 7: Prerequisite checks (.NET, VC++ Redistributable)
        findings.extend(self._check_prerequisites(result))

        # Pass 8: System health (problem devices, disconnected NICs, disk space, env vars)
        findings.extend(self._check_system_health(result))

        return findings

    def _run_pattern_matching(self, result: ParseResult) -> list[Finding]:
        """Match regex patterns from patterns.yaml against parsed data."""
        findings: list[Finding] = []

        # Collect text sources to scan
        text_sources: list[tuple[str, str]] = []  # (source_name, text)

        if result.logs:
            for entry in result.logs.entries:
                text_sources.append((entry.source_file, entry.message))

        for pattern_def in self._patterns:
            for source_name, text in text_sources:
                finding = known_issues.match_pattern(pattern_def, text)
                if finding:
                    finding.source_file = source_name
                    findings.append(finding)
                    break  # One match per pattern is enough

        return findings

    def _check_nic_config(self, network: NetworkInfo, product: ProductType) -> list[Finding]:
        """Validate NIC settings against rules for the product type."""
        findings: list[Finding] = []
        adapter_rules = self._nic_rules.get("adapters", {})
        display_names = self._nic_rules.get("property_display_names", {})
        value_descs = self._nic_rules.get("value_descriptions", {})

        for adapter in network.adapters:
            # Try to match adapter to a rule set by description/name
            matched_rule = None
            for rule_name, rule_def in adapter_rules.items():
                # Skip rules that are product-specific and don't match
                required_for = rule_def.get("required_for", [])
                if required_for and product.value not in required_for:
                    continue
                match_patterns = rule_def.get("match", [])
                for mp in match_patterns:
                    desc = adapter.description or adapter.name
                    if re.search(mp, desc, re.IGNORECASE):
                        matched_rule = rule_def
                        break
                if matched_rule:
                    break

            if not matched_rule:
                continue

            # Check advanced properties against expected values
            expected = matched_rule.get("expected_properties", {})
            for prop_name, expected_value in expected.items():
                actual = adapter.advanced_properties.get(prop_name)
                if actual is None:
                    continue

                if not self._value_matches(actual, expected_value):
                    severity_str = matched_rule.get("violation_severity", "WARNING")
                    gui_name = display_names.get(prop_name, prop_name)
                    # Human-readable value descriptions
                    prop_vals = value_descs.get(prop_name, {})
                    actual_desc = prop_vals.get(str(actual), actual)
                    expected_desc = prop_vals.get(str(expected_value), expected_value)
                    findings.append(Finding(
                        severity=Severity(severity_str),
                        title=f"NIC misconfiguration: {prop_name} on {adapter.name}",
                        description=(
                            f"{gui_name} is '{actual_desc}' ({actual}) "
                            f"but should be '{expected_desc}' ({expected_value}) "
                            f"for {adapter.description or adapter.name}"
                        ),
                        recommendation=matched_rule.get("recommendation", ""),
                        source_file="nics.log",
                        category="network",
                    ))

        return findings

    def _check_drivers(self, drivers: DriverInfo, product: ProductType) -> list[Finding]:
        """Check driver versions against requirements."""
        findings: list[Finding] = []
        rules = self._driver_rules.get("drivers", {})

        # Check Mellanox
        mlnx_rule = rules.get("mellanox", {})
        if mlnx_rule.get("required_for") and product.value in mlnx_rule["required_for"]:
            if drivers.mellanox_driver is None:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    title="Mellanox driver not found",
                    description=f"Mellanox WinOF-2 driver is expected for {product.value}",
                    recommendation="Install MLNX_WinOF2 driver",
                    category="driver",
                ))
            elif mlnx_rule.get("min_version"):
                if self._version_lt(drivers.mellanox_driver.version, mlnx_rule["min_version"]):
                    findings.append(Finding(
                        severity=Severity.WARNING,
                        title="Mellanox driver version outdated",
                        description=(
                            f"Installed: {drivers.mellanox_driver.version}, "
                            f"minimum: {mlnx_rule['min_version']}"
                        ),
                        recommendation="Update MLNX_WinOF2 driver",
                        category="driver",
                    ))

        # Check Rivermax (required for ARAMIS 24M)
        rmax_rule = rules.get("rivermax", {})
        if rmax_rule.get("required_for") and product.value in rmax_rule["required_for"]:
            if drivers.rivermax is None:
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    title="Rivermax not installed",
                    description=f"Rivermax is required for {product.value} but was not found",
                    recommendation="Install NVIDIA Rivermax SDK",
                    category="driver",
                ))

        return findings

    def _check_licenses(self, licensing: LicenseInfo, product: ProductType) -> list[Finding]:
        """Check license consistency."""
        findings: list[Finding] = []
        rules = self._license_rules.get("licenses", {})

        # Check required licenses for the product
        for rule_name, rule_def in rules.items():
            required_for = rule_def.get("required_for", [])
            if product.value not in required_for:
                continue

            # Match against product_patterns (checked against both Product Name
            # and License Name columns in the CSV)
            patterns = rule_def.get("product_patterns", [])
            # Fallback to old product_name field
            if not patterns:
                old_name = rule_def.get("product_name", "")
                if old_name:
                    patterns = [old_name]

            found = False
            for pattern in patterns:
                pat_lower = pattern.lower()
                for lic in licensing.licenses:
                    product_name = (lic.product or "").lower()
                    license_name = lic.raw_fields.get("License Name", "").lower()
                    if pat_lower in product_name or pat_lower in license_name:
                        found = True
                        break
                if found:
                    break

            if not found:
                findings.append(Finding(
                    severity=Severity(rule_def.get("severity", "WARNING")),
                    title=f"Required license not found: {rule_name}",
                    description=rule_def.get("description", ""),
                    recommendation=rule_def.get("recommendation", ""),
                    category="license",
                ))

        return findings

    def _analyze_log_entries(self, logs: LogSummary) -> list[Finding]:
        """Produce findings from already-parsed log entries."""
        findings: list[Finding] = []

        # Group errors by message similarity and produce summary findings
        error_count = logs.total_errors
        if error_count > 0:
            findings.append(Finding(
                severity=Severity.INFO,
                title=f"{error_count} error(s) found in log files",
                description=f"Found {error_count} ERROR-level entries across {len(logs.files_analyzed)} log files",
                category="logs",
            ))

        return findings

    def _check_hardware_service(self, result: ParseResult) -> list[Finding]:
        """Pass 6: Check Hardware Service (HAL) state from parsed data."""
        findings: list[Finding] = []
        hs = result.hardware_service

        if hs is None:
            # Only flag if we expected hardware data (i.e., not a pure SW analysis)
            return findings

        # Service not running
        if hs.running is False:
            findings.append(Finding(
                severity=Severity.CRITICAL,
                title="Hardware Service not running",
                description=(
                    "ZEISS_INSPECT_HardwareService.exe was not found in the process list. "
                    "Without the Hardware Service, ZEISS INSPECT cannot communicate with "
                    "measurement hardware."
                ),
                recommendation=(
                    "Start the Hardware Service from Windows Services (services.msc) or "
                    "reinstall via the ZEISS Quality Suite installer. Check Windows Firewall "
                    "rules for zeiss_inspect_hardwareserver.exe and "
                    "zeiss_inspect_hardwareservice.exe."
                ),
                pattern_id="hal_service_not_running",
                category="hal",
            ))

        # gRPC not started (never reached listening or blocked state)
        if hs.grpc_status is None and hs.running is not False:
            findings.append(Finding(
                severity=Severity.WARNING,
                title="HAL gRPC interface never started",
                description=(
                    "The Hardware Service gRPC interface was not detected as listening or "
                    "blocked. The HAL process may have failed during startup before reaching "
                    "gRPC initialization."
                ),
                recommendation=(
                    "Check the GOM-HAL log for startup errors. Ensure .NET Runtime 8.0+ and "
                    "Visual C++ 2015-2022 Redistributable (x64) are installed. Try "
                    "reinstalling the Hardware Service and running 'Correct System'."
                ),
                pattern_id="hal_grpc_not_started",
                category="hal",
            ))

        # Empty hardware config
        if any("hardware_cfg.xml is empty" in ev for ev in hs.timeline):
            findings.append(Finding(
                severity=Severity.WARNING,
                title="Hardware configuration is empty",
                description=(
                    "hardware_cfg.xml contains no device configuration. This typically "
                    "occurs on fresh installations or after a failed 'Correct System' operation."
                ),
                recommendation=(
                    "In ZEISS INSPECT, run 'Correct System' from the Measuring Device "
                    "Manager (MDM). If the MDM web interface is not accessible, check that "
                    "port 39025 is not blocked by the firewall."
                ),
                pattern_id="hal_empty_config",
                category="hal",
            ))

        # DB errors
        if hs.errors:
            error_summary = "; ".join(
                f"{e.error_code or '?'}: {e.description or '?'}" for e in hs.errors[:5]
            )
            findings.append(Finding(
                severity=Severity.CRITICAL,
                title=f"{len(hs.errors)} hardware error(s) recorded in database",
                description=(
                    f"hardware_status.db error_list contains {len(hs.errors)} error(s). "
                    f"Errors: {error_summary}"
                ),
                recommendation=(
                    "Review the specific error codes in the Hardware Service section. "
                    "Common fixes: re-run 'Correct System', check network cables, verify "
                    "NIC configuration."
                ),
                pattern_id="hal_db_errors_present",
                category="hal",
            ))

        # Missing expected ports (39000 Backend, 39002 gRPC)
        if hs.ports:
            port_numbers = {p.port for p in hs.ports}
            missing = []
            if 39000 not in port_numbers:
                missing.append("39000 (Backend)")
            if 39002 not in port_numbers:
                missing.append("39002 (gRPC)")
            if missing and hs.running is not False:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    title="Expected HAL ports not detected",
                    description=(
                        f"Missing ports: {', '.join(missing)}. Some Hardware Service "
                        "components may not have started successfully."
                    ),
                    recommendation=(
                        "Review the GOM-HAL log timeline for startup failures. Try "
                        "restarting the Hardware Service. Ensure firewall rules allow "
                        "zeiss_inspect_hardwareserver.exe and zeiss_inspect_hardwareservice.exe."
                    ),
                    pattern_id="hal_missing_expected_ports",
                    category="hal",
                ))

        # Multiple instances
        if hs.multiple_instances:
            findings.append(Finding(
                severity=Severity.CRITICAL,
                title="Multiple Hardware Service instances running",
                description=(
                    "More than one ZEISS_INSPECT_HardwareService.exe process was found. "
                    "This typically means a previous instance did not shut down cleanly "
                    "and is holding ports (especially gRPC 39002)."
                ),
                recommendation="Kill all Hardware Service processes in Task Manager, then restart.",
                pattern_id="hal_multiple_instances",
                category="hal",
            ))

        # Service startup type not Automatic
        if hs.service_startup_type and hs.service_startup_type != "Automatic":
            findings.append(Finding(
                severity=Severity.WARNING,
                title=f"Hardware Service startup type is {hs.service_startup_type}",
                description=(
                    f"The service is set to '{hs.service_startup_type}' startup. "
                    "It will not start automatically after a reboot."
                ),
                recommendation="Set to Automatic: sc config \"ZeissInspectHardwareService\" start=auto",
                pattern_id="hal_service_not_automatic",
                category="hal",
            ))

        # HAL restart cycle
        restart_warnings = [e for e in hs.timeline if "startup events detected" in e.lower()]
        if restart_warnings:
            findings.append(Finding(
                severity=Severity.WARNING,
                title="HAL restart cycle detected",
                description="Multiple HAL startup events in a single log file indicate crash-restart cycles.",
                recommendation="Review GOM-HAL log for errors preceding each restart.",
                pattern_id="hal_restart_cycle",
                category="hal",
            ))

        return findings

    def _check_system_health(self, result: ParseResult) -> list[Finding]:
        """Pass 8: Check system-level health indicators."""
        findings: list[Finding] = []

        # Problem devices from msinfo32
        if result.system_info and result.system_info.problem_devices:
            for dev in result.system_info.problem_devices:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    title=f"Problem device: {dev[:80]}",
                    description=f"Windows Device Manager reports: {dev}",
                    recommendation="Open Device Manager and resolve the flagged device.",
                    pattern_id="problem_device_detected",
                    category="system",
                ))

        # Disconnected NICs
        if result.network:
            for adapter in result.network.adapters:
                state = adapter.advanced_properties.get("_ConnectionState", "")
                if state.lower() in ("disconnected", "not present"):
                    findings.append(Finding(
                        severity=Severity.WARNING,
                        title=f"NIC disconnected: {adapter.name}",
                        description=f"{adapter.description or adapter.name} is {state}",
                        recommendation="Check the physical cable connection.",
                        pattern_id="nic_disconnected",
                        category="network",
                    ))

        # Disk space
        if result.codemeter:
            for drive in result.codemeter.drives:
                if drive.letter and drive.letter.startswith("C") and drive.free_mb is not None:
                    if drive.free_mb < 5120:  # < 5 GB
                        findings.append(Finding(
                            severity=Severity.WARNING,
                            title=f"Low disk space: {drive.letter} ({drive.free_mb} MB free)",
                            description=(
                                f"System drive {drive.letter} has only {drive.free_mb} MB free "
                                f"({drive.used_pct or '?'}% used). Low disk space causes ZEISS failures."
                            ),
                            recommendation="Free up disk space on the system drive.",
                            pattern_id="disk_space_low",
                            category="system",
                        ))

        # Rivermax environment variables (for ARAMIS 24M)
        product = result.product_type
        if product and product.value == "ARAMIS 24M":
            has_registry_var = bool(
                result.hardware_service
                and result.hardware_service.rivermax_env_vars.get("RIVERMAX_LOG_LEVEL")
            )
            has_sys_var = bool(
                result.system_info
                and result.system_info.environment_variables
                and "RIVERMAX_LOG_LEVEL" in result.system_info.environment_variables
            )
            if not has_registry_var and not has_sys_var:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    title="Rivermax environment variables not found",
                    description=(
                        "RIVERMAX_LOG_LEVEL and/or MELLANOX_RINGBUFF_FACTOR are not set. "
                        "These are required for ARAMIS 24M streaming."
                    ),
                    recommendation="Set RIVERMAX_LOG_LEVEL=6 and MELLANOX_RINGBUFF_FACTOR=18 in system environment.",
                    pattern_id="rivermax_env_missing",
                    category="system",
                ))

        return findings

    def _check_prerequisites(self, result: ParseResult) -> list[Finding]:
        """Pass 7: Check .NET Runtime and VC++ Redistributable prerequisites."""
        findings: list[Finding] = []

        # Determine required versions from compatibility matrix
        major = self._get_major_version(result)
        version_rules = self._compatibility.get("zeiss_inspect_versions", {}).get(major, {})
        components = version_rules.get("components", {})

        # Search for .NET and VC++ in install_timeline
        dotnet_version = None
        vcredist_found = False

        if result.drivers and result.drivers.install_timeline:
            for prog in result.drivers.install_timeline:
                name_lower = (prog.name or "").lower()
                if (".net runtime" in name_lower or ".net desktop runtime" in name_lower) and "framework" not in name_lower and prog.version and re.match(r"^\d\.\d", prog.version or ""):
                    if prog.version and (dotnet_version is None or self._version_lt(dotnet_version, prog.version)):
                        dotnet_version = prog.version
                if "visual c++" in name_lower and "redistributable" in name_lower and "x64" in name_lower:
                    vcredist_found = True

        # Also check all_relevant_drivers
        if result.drivers and result.drivers.all_relevant_drivers:
            for drv in result.drivers.all_relevant_drivers:
                name_lower = (drv.name or "").lower()
                if ".net runtime" in name_lower or ".net desktop runtime" in name_lower:
                    if drv.version and (dotnet_version is None or self._version_lt(dotnet_version, drv.version)):
                        dotnet_version = drv.version
                if "visual c++" in name_lower and "redistributable" in name_lower and "x64" in name_lower:
                    vcredist_found = True

        # Check .NET version
        dotnet_rule = components.get("dotnet", {})
        if dotnet_rule:
            min_ver = dotnet_rule.get("min_version", "")
            if dotnet_version is None:
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    title=".NET Runtime not found",
                    description=(
                        f"The required .NET Runtime was not detected in the installed software "
                        f"list. ZEISS INSPECT {major} requires .NET Runtime >= {min_ver}."
                    ),
                    recommendation=(
                        "Install the .NET Runtime 8.0 (x64) from Microsoft. The ZEISS "
                        "Quality Suite installer should include this."
                    ),
                    pattern_id="prerequisite_dotnet_missing",
                    category="hal",
                ))
            elif min_ver and self._version_lt(dotnet_version, min_ver):
                findings.append(Finding(
                    severity=Severity.WARNING,
                    title=f".NET Runtime version outdated",
                    description=(
                        f"Installed .NET Runtime: {dotnet_version}, required >= {min_ver} "
                        f"for ZEISS INSPECT {major}."
                    ),
                    recommendation="Update .NET Runtime to the version specified in the ZEISS release notes.",
                    pattern_id="prerequisite_dotnet_missing",
                    category="hal",
                ))

        # Check VC++ Redistributable
        vcredist_rule = components.get("vcredist", {})
        if vcredist_rule and not vcredist_found:
            findings.append(Finding(
                severity=Severity.WARNING,
                title="Visual C++ 2015-2022 Redistributable (x64) not found",
                description=(
                    "The Microsoft Visual C++ 2015-2022 Redistributable (x64) was not "
                    "detected in the installed software list. This runtime is required "
                    "by several ZEISS components including the Hardware Service."
                ),
                recommendation=(
                    "Download and install the latest Visual C++ Redistributable (x64) "
                    "from Microsoft."
                ),
                pattern_id="prerequisite_vcredist_missing",
                category="hal",
            ))

        return findings

    @staticmethod
    def _get_major_version(result: ParseResult) -> str:
        """Extract major ZEISS version (e.g. '2026') from the result."""
        if result.zeiss_versions and result.zeiss_versions.inspect_version:
            return result.zeiss_versions.inspect_version.split(".")[0]
        return ""

    @staticmethod
    def _load_compatibility(kb_dir: Path) -> dict:
        """Load compatibility.yaml."""
        path = kb_dir / "compatibility.yaml"
        if not path.is_file():
            return {}
        try:
            with open(path, encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except yaml.YAMLError:
            return {}

    @staticmethod
    def _value_matches(actual: str, expected: str) -> bool:
        """Check if an actual value matches an expected value/range."""
        expected_str = str(expected)

        # Exact match
        if actual.strip() == expected_str.strip():
            return True

        # Numeric comparison with >= prefix
        if expected_str.startswith(">="):
            try:
                return int(actual) >= int(expected_str[2:])
            except ValueError:
                return False

        return False

    @staticmethod
    def _version_lt(actual: Optional[str], minimum: str) -> bool:
        """Check if actual version is less than minimum. Handles non-numeric segments."""
        if actual is None:
            return True
        try:
            actual_parts = [int(x) for x in re.split(r"[.\-]", actual) if x.isdigit()]
            min_parts = [int(x) for x in re.split(r"[.\-]", minimum) if x.isdigit()]
            return actual_parts < min_parts
        except ValueError:
            return False
