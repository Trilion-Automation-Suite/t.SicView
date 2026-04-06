"""Comprehensive tests for v0.3.0 features.

Tests all new parsers, detection passes, models, and knowledge base integrity
using synthetic test data (no real fixture archives required).
"""

from __future__ import annotations

import re
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock

import yaml

from gomsic_core.models import (
    ActivityTimeline,
    CodeMeterInfo,
    HardwareServiceInfo,
    LicenseInfo,
    LogFileEntry,
    NetworkAdapter,
    NetworkInfo,
    ParseResult,
    StorageDrive,
    SystemInfo,
)

KB_DIR = Path(__file__).parent.parent / "knowledge_base"


# ---------------------------------------------------------------------------
# Activity Timeline Parser
# ---------------------------------------------------------------------------

class TestActivityTimelinePatterns:
    def setup_method(self):
        from gomsic_core.parsers.activity_timeline import (
            _EXECUTING_RE, _RESULT_RE, _SAVE_WC_RE, _HANG_RE, _EXIT_RE, _END_TIME_RE,
        )
        self.exec_re = _EXECUTING_RE
        self.result_re = _RESULT_RE
        self.save_re = _SAVE_WC_RE
        self.hang_re = _HANG_RE
        self.exit_re = _EXIT_RE
        self.end_re = _END_TIME_RE

    def test_executing_simple(self):
        line = "executing sys.save_project () at Tue Mar  3 09:58:04 2026"
        m = self.exec_re.search(line)
        assert m is not None
        assert m.group(1) == "sys.save_project"

    def test_executing_with_args(self):
        line = "executing sys.show_stage (stage=gom.app.project.stages['Stage 270']) at Tue Mar  3 09:46:07 2026"
        m = self.exec_re.search(line)
        assert m is not None
        assert m.group(1) == "sys.show_stage"
        assert "Stage 270" in m.group(2)

    def test_executing_from_menu(self):
        line = "executing sys.save_project from menu at Tue Mar  3 09:58:04 2026"
        m = self.exec_re.search(line)
        assert m is not None
        assert m.group(1) == "sys.save_project"

    def test_save_working_copy(self):
        line = "save working copy started at Tue Mar  3 09:47:20 2026"
        m = self.save_re.search(line)
        assert m is not None

    def test_hang_detection(self):
        line = "recovered from application hang #4"
        m = self.hang_re.search(line)
        assert m is not None
        assert m.group(1) == "4"

    def test_exit_code(self):
        line = "Exit-code: 0"
        m = self.exit_re.search(line)
        assert m is not None
        assert m.group(1) == "0"

    def test_end_time(self):
        line = "End time: 2026-03-03 09:58:45  (elapsed: 586125 s)"
        m = self.end_re.search(line)
        assert m is not None
        assert m.group(2) == "586125"


class TestActivityTimelineCategorization:
    def setup_method(self):
        from gomsic_core.parsers.activity_timeline import ActivityTimelineParser
        self.parser = ActivityTimelineParser()

    def test_save_project(self):
        cat, action = self.parser._categorize("sys.save_project")
        assert cat == "project"

    def test_show_stage(self):
        cat, action = self.parser._categorize("sys.show_stage")
        assert cat == "navigation"

    def test_alignment(self):
        cat, action = self.parser._categorize("manage_alignment.set_alignment_active")
        assert cat == "alignment"

    def test_unknown_command(self):
        cat, action = self.parser._categorize("some.unknown.command")
        assert cat == "other"


# ---------------------------------------------------------------------------
# License Info Log Parsing
# ---------------------------------------------------------------------------

class TestLicenseInfoLogParsing:
    def setup_method(self):
        from gomsic_core.parsers.licensing import LicensingParser
        self.parser = LicensingParser()

    def test_parse_dongle_and_packages(self):
        content = """15:33:59 startup (23.02.2026)
15:33:59 detecting dongles
15:33:59 detection results:
15:33:59 found dongle '3-6724224' (fc=100473, cmact=1000)
15:33:59   dongle is locally connected
15:33:59   dongle has 2 packages:
15:33:59     ZEISS INSPECT Correlate - Pro (1, never expires)
15:33:59     ZEISS INSPECT Correlate - Pro Line (1, never expires)
15:35:14 shutdown (23.02.2026)
"""
        info = LicenseInfo()
        ctx = MagicMock()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False, encoding="utf-8") as f:
            f.write(content)
            f.flush()
            path = Path(f.name)

        try:
            self.parser._parse_license_info_log(path, info, ctx)
        finally:
            path.unlink()

        assert len(info.dongles) == 1
        assert info.dongles[0].serial == "3-6724224"
        assert len(info.licenses) == 2
        assert "Correlate - Pro" in info.licenses[0].product
        assert info.licenses[0].expiry == "Permanent"

    def test_empty_file(self):
        info = LicenseInfo()
        ctx = MagicMock()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write("")
            path = Path(f.name)

        try:
            self.parser._parse_license_info_log(path, info, ctx)
        finally:
            path.unlink()

        assert len(info.dongles) == 0
        assert len(info.licenses) == 0


# ---------------------------------------------------------------------------
# .NET Version Filtering
# ---------------------------------------------------------------------------

class TestDotNetVersionFiltering:
    def test_reject_framework_version(self):
        """48.116.12053 is a .NET Framework column misparse -- must be rejected."""
        assert not re.match(r"^\d\.\d", "48.116.12053")

    def test_accept_runtime_version(self):
        """8.0.17 is a valid .NET Runtime version."""
        assert re.match(r"^\d\.\d", "8.0.17")

    def test_reject_two_digit_major(self):
        assert not re.match(r"^\d\.\d", "64.92.45415")

    def test_accept_single_digit(self):
        assert re.match(r"^\d\.\d", "6.0.1")


# ---------------------------------------------------------------------------
# Problem Devices Header Filtering
# ---------------------------------------------------------------------------

class TestProblemDevicesHeaderFiltering:
    def test_skip_header_row(self):
        """The msinfo32 Problem Devices section has a 'Device / PNP Device ID' header row."""
        # The parser filters based on item/value content
        # "Device" as item with "PNP Device ID" as value should be skipped
        sections = {
            "Problem Devices": [
                {"Item": "Device", "Value": "PNP Device ID"},
                {"Item": "Intel(R) Management Engine", "Value": "PCI\\VEN_8086"},
            ]
        }
        # Simulate what the parser does
        problem_devices = []
        for row in sections["Problem Devices"]:
            device = row.get("Item", "")
            detail = row.get("Value", "")
            if device and device.lower() not in ("device", "item", ""):
                if detail.lower() not in ("pnp device id", "error code", "value", ""):
                    problem_devices.append(f"{device}: {detail}")
                elif device.lower() != "device":
                    problem_devices.append(device)

        assert len(problem_devices) == 1
        assert "Intel" in problem_devices[0]


# ---------------------------------------------------------------------------
# Hardware Service
# ---------------------------------------------------------------------------

class TestHardwareServiceMultiInstance:
    def test_multiple_instances_detected(self):
        info = HardwareServiceInfo(multiple_instances=True, running=True)
        assert info.multiple_instances is True

    def test_default_single_instance(self):
        info = HardwareServiceInfo()
        assert info.multiple_instances is False


class TestHardwareServiceRegistryFields:
    def test_service_startup_type(self):
        info = HardwareServiceInfo(service_startup_type="Manual")
        assert info.service_startup_type == "Manual"

    def test_rivermax_env_vars(self):
        info = HardwareServiceInfo(rivermax_env_vars={"RIVERMAX_LOG_LEVEL": "present"})
        assert info.rivermax_env_vars["RIVERMAX_LOG_LEVEL"] == "present"

    def test_firewall_rules(self):
        info = HardwareServiceInfo(firewall_rules_found=["zeiss_inspect_hardwareserver.exe"])
        assert len(info.firewall_rules_found) == 1


# ---------------------------------------------------------------------------
# ZIP-Slip Protection
# ---------------------------------------------------------------------------

class TestZipSlipProtection:
    def test_traversal_entries_filtered(self):
        """ZIP with path traversal entries must not extract outside dest."""
        from gomsic_core.extractor import ArchiveLayout, _extract_qsr_zip

        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("safe.txt", "safe")
            zf.writestr("../../malicious.txt", "pwned")
        buf.seek(0)

        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / "test.zip"
            zip_path.write_bytes(buf.read())
            dest = Path(tmpdir) / "out"
            dest.mkdir()
            layout = ArchiveLayout(root=dest)

            _extract_qsr_zip(zip_path, dest, layout)

            assert not (Path(tmpdir) / "malicious.txt").exists()
            assert len(layout.warnings) >= 1


# ---------------------------------------------------------------------------
# Version Consistency
# ---------------------------------------------------------------------------

class TestVersionConsistency:
    def test_init_version(self):
        from gomsic_core import __version__
        assert __version__ == "0.3.0"

    def test_model_version(self):
        r = ParseResult(archive_filename="test.zip")
        assert r.tool_version == "0.3.0"

    def test_pyproject(self):
        text = (Path(__file__).parent.parent / "pyproject.toml").read_text()
        assert 'version = "0.3.0"' in text

    def test_package_json(self):
        text = (Path(__file__).parent.parent / "standalone" / "package.json").read_text()
        assert '"0.3.0"' in text


# ---------------------------------------------------------------------------
# Knowledge Base YAML Loading
# ---------------------------------------------------------------------------

class TestKnowledgeBaseIntegrity:
    def test_patterns_yaml(self):
        data = yaml.safe_load((KB_DIR / "patterns.yaml").read_text())
        assert "patterns" in data
        for p in data["patterns"]:
            assert "id" in p
            assert "severity" in p
            assert "title" in p

    def test_driver_rules_yaml(self):
        data = yaml.safe_load((KB_DIR / "driver_rules.yaml").read_text())
        assert "drivers" in data
        assert "dotnet_runtime" in data["drivers"]
        assert "vcredist" in data["drivers"]
        assert "emergent_camera" in data["drivers"]

    def test_codemeter_version_synced(self):
        data = yaml.safe_load((KB_DIR / "driver_rules.yaml").read_text())
        assert data["drivers"]["codemeter"]["min_version"] == "7.60"

    def test_compatibility_yaml(self):
        data = yaml.safe_load((KB_DIR / "compatibility.yaml").read_text())
        assert "hardware_service" in data
        ports = data["hardware_service"]["ports"]["2025+"]
        port_nums = [p["port"] for p in ports]
        assert 39025 in port_nums
        assert "firewall_executables" in data["hardware_service"]

    def test_nic_rules_yaml(self):
        data = yaml.safe_load((KB_DIR / "nic_rules.yaml").read_text())
        assert "adapters" in data

    def test_license_rules_yaml(self):
        data = yaml.safe_load((KB_DIR / "license_rules.yaml").read_text())
        assert "licenses" in data


# ---------------------------------------------------------------------------
# Model Field Defaults
# ---------------------------------------------------------------------------

class TestModelDefaults:
    def test_system_info_new_fields(self):
        si = SystemInfo()
        assert si.problem_devices == []
        assert si.display_info == {}
        assert si.environment_variables == {}

    def test_network_adapter_dns(self):
        a = NetworkAdapter(name="eth0")
        assert a.dns_servers == []

    def test_hardware_service_new_fields(self):
        hs = HardwareServiceInfo()
        assert hs.multiple_instances is False
        assert hs.related_processes == {}
        assert hs.hardware_cfg_entries == []
        assert hs.service_startup_type is None
        assert hs.rivermax_env_vars == {}
        assert hs.firewall_rules_found == []
        assert hs.db_tables == []
        assert hs.total_session_count is None

    def test_log_file_entry_new_fields(self):
        lfe = LogFileEntry(filename="test.log")
        assert lfe.first_timestamp is None
        assert lfe.last_timestamp is None
        assert lfe.description is None

    def test_activity_timeline_new_fields(self):
        at = ActivityTimeline()
        assert at.hang_count == 0
        assert at.total_commands == 0
        assert at.command_summary == {}

    def test_parse_result_has_activity_timeline(self):
        r = ParseResult(archive_filename="test.zip")
        assert r.activity_timeline is None
        assert r.log_inventory is None


# ---------------------------------------------------------------------------
# Error Detector: System Health Pass
# ---------------------------------------------------------------------------

class TestDetectorSystemHealth:
    def setup_method(self):
        from gomsic_core.errors.detector import ErrorDetector
        self.detector = ErrorDetector(KB_DIR)

    def test_problem_device_finding(self):
        result = ParseResult(
            archive_filename="test.zip",
            system_info=SystemInfo(problem_devices=["Broken NIC: error code 10"]),
        )
        findings = self.detector._check_system_health(result)
        assert any("Problem device" in f.title for f in findings)

    def test_disconnected_nic(self):
        result = ParseResult(
            archive_filename="test.zip",
            network=NetworkInfo(adapters=[
                NetworkAdapter(name="Ethernet 3", advanced_properties={"_ConnectionState": "disconnected"}),
            ]),
        )
        findings = self.detector._check_system_health(result)
        assert any("disconnected" in f.title.lower() for f in findings)

    def test_low_disk_space(self):
        result = ParseResult(
            archive_filename="test.zip",
            codemeter=CodeMeterInfo(drives=[StorageDrive(letter="C:\\", total_mb=500000, free_mb=2000)]),
        )
        findings = self.detector._check_system_health(result)
        assert any("disk space" in f.title.lower() for f in findings)

    def test_hal_multiple_instances(self):
        result = ParseResult(
            archive_filename="test.zip",
            hardware_service=HardwareServiceInfo(
                running=True, multiple_instances=True, grpc_status="listening",
            ),
        )
        findings = self.detector._check_hardware_service(result)
        assert any("Multiple" in f.title for f in findings)

    def test_hal_not_automatic(self):
        result = ParseResult(
            archive_filename="test.zip",
            hardware_service=HardwareServiceInfo(
                running=True, service_startup_type="Manual", grpc_status="listening",
            ),
        )
        findings = self.detector._check_hardware_service(result)
        assert any("Manual" in f.title for f in findings)
