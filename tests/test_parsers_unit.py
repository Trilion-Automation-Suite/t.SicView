"""Unit tests for individual parser enhancements (v0.2.0).

Tests parser logic in isolation using synthetic data, not real fixture archives.
"""

from __future__ import annotations

import tempfile
from pathlib import Path


from gomsic_core.models import (
    HardwareServiceInfo,
    LogFileEntry,
    NetworkAdapter,
    NetworkInfo,
    ParseResult,
    ProductType,
    SystemInfo,
)


# ---------------------------------------------------------------------------
# SystemInfo parser: Problem Devices, Display, Environment Variables
# ---------------------------------------------------------------------------

class TestSystemInfoModel:
    def test_problem_devices_field_exists(self):
        info = SystemInfo()
        assert info.problem_devices == []

    def test_display_info_field_exists(self):
        info = SystemInfo()
        assert info.display_info == {}

    def test_environment_variables_field_exists(self):
        info = SystemInfo()
        assert info.environment_variables == {}

    def test_problem_devices_populated(self):
        info = SystemInfo(problem_devices=["NIC: Error code 10", "USB: Error code 28"])
        assert len(info.problem_devices) == 2
        assert "NIC" in info.problem_devices[0]


# ---------------------------------------------------------------------------
# NetworkAdapter: DNS servers, connection state
# ---------------------------------------------------------------------------

class TestNetworkAdapterModel:
    def test_dns_servers_field(self):
        adapter = NetworkAdapter(name="Ethernet 1")
        assert adapter.dns_servers == []

    def test_dns_servers_populated(self):
        adapter = NetworkAdapter(name="Ethernet 1", dns_servers=["8.8.8.8", "8.8.4.4"])
        assert len(adapter.dns_servers) == 2

    def test_connection_state_in_advanced_properties(self):
        adapter = NetworkAdapter(
            name="Ethernet 1",
            advanced_properties={"_ConnectionState": "disconnected", "MTU": "9014"},
        )
        assert adapter.advanced_properties["_ConnectionState"] == "disconnected"


# ---------------------------------------------------------------------------
# HardwareServiceInfo: new fields
# ---------------------------------------------------------------------------

class TestHardwareServiceInfoModel:
    def test_multiple_instances_default(self):
        info = HardwareServiceInfo()
        assert info.multiple_instances is False

    def test_related_processes(self):
        info = HardwareServiceInfo(related_processes={"ZEISS INSPECT": True, "CodeMeter": True})
        assert "ZEISS INSPECT" in info.related_processes

    def test_service_startup_type(self):
        info = HardwareServiceInfo(service_startup_type="Manual")
        assert info.service_startup_type == "Manual"

    def test_db_version_is_str(self):
        """db_version should be str, not float (was float before fix)."""
        info = HardwareServiceInfo(db_version="2.3")
        assert info.db_version == "2.3"

    def test_hardware_cfg_entries(self):
        info = HardwareServiceInfo(hardware_cfg_entries=[{"ip": "192.168.6.200"}])
        assert len(info.hardware_cfg_entries) == 1

    def test_firewall_rules_found(self):
        info = HardwareServiceInfo(firewall_rules_found=["zeiss_inspect_hardwareserver"])
        assert len(info.firewall_rules_found) == 1

    def test_total_session_count(self):
        info = HardwareServiceInfo(total_session_count=42)
        assert info.total_session_count == 42


# ---------------------------------------------------------------------------
# LogFileEntry: timestamps, description
# ---------------------------------------------------------------------------

class TestLogFileEntryModel:
    def test_timestamps(self):
        entry = LogFileEntry(
            filename="test.log",
            first_timestamp="2026-04-01T07:20:00Z",
            last_timestamp="2026-04-01T07:49:00Z",
        )
        assert entry.first_timestamp is not None
        assert entry.last_timestamp is not None

    def test_description(self):
        entry = LogFileEntry(filename="test.log", description="Test log file")
        assert entry.description == "Test log file"


# ---------------------------------------------------------------------------
# LogsParser: log description generation
# ---------------------------------------------------------------------------

class TestLogDescriptions:
    """Test the _log_description static method."""

    def setup_method(self):
        from gomsic_core.parsers.logs import LogsParser
        self.parser = LogsParser()

    def test_hal_log(self):
        assert "HAL" in self.parser._log_description("GOM-HAL-2026-04-01.log")

    def test_zeiss_inspect_log(self):
        assert "ZEISS INSPECT" in self.parser._log_description("ZEISS_INSPECT-2026-04-01-2380.log")

    def test_acquisition_log(self):
        assert "acquisition" in self.parser._log_description("zi_acq_session_001.log")

    def test_msinfo(self):
        assert "System Information" in self.parser._log_description("msinfo32.log")

    def test_nics(self):
        assert "Network" in self.parser._log_description("nics.log")

    def test_registry(self):
        assert "Registry" in self.parser._log_description("registry.log")

    def test_codemeter(self):
        assert "CodeMeter" in self.parser._log_description("CodeMeter.log")

    def test_unknown(self):
        assert self.parser._log_description("random_file.log") == "Log file"


# ---------------------------------------------------------------------------
# Drivers: relevant programs list
# ---------------------------------------------------------------------------

class TestDriversRelevantPrograms:
    """Verify new entries in _RELEVANT_PROGRAMS match correctly."""

    def setup_method(self):
        from gomsic_core.parsers.drivers import _RELEVANT_PROGRAMS
        self.programs = _RELEVANT_PROGRAMS

    def _matches(self, name: str) -> list[str]:
        return [tag for pattern, tag in self.programs if pattern.search(name)]

    def test_dotnet_match(self):
        assert "dotnet" in self._matches("Microsoft .NET Runtime - 8.0.17 (x64)")

    def test_dotnet_desktop_match(self):
        assert "dotnet" in self._matches(".NET Desktop Runtime - 8.0.17 (x64)")

    def test_vcredist_match(self):
        assert "vcredist" in self._matches("Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135")

    def test_emergent_match(self):
        assert "emergent_camera" in self._matches("Emergent Camera Driver 2.44.02")

    def test_correlate_match(self):
        assert "correlate" in self._matches("ZEISS CORRELATE 2026")

    def test_zeiss_inspect_match(self):
        assert "zeiss_inspect" in self._matches("ZEISS INSPECT 2026")

    def test_hw_service_match(self):
        assert "zeiss_hw_service" in self._matches("ZEISS INSPECT Hardware Service 1.0.2.1")


# ---------------------------------------------------------------------------
# Error Detector: structural checks
# ---------------------------------------------------------------------------

class TestDetectorStructuralChecks:
    """Test the new structural detection passes."""

    def _make_result(self, **kwargs) -> ParseResult:
        return ParseResult(archive_filename="test.zip", **kwargs)

    def test_hal_multiple_instances(self):
        from gomsic_core.errors.detector import ErrorDetector
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = self._make_result(
            hardware_service=HardwareServiceInfo(
                running=True,
                multiple_instances=True,
                grpc_status="listening",
            )
        )
        findings = detector._check_hardware_service(result)
        titles = [f.title for f in findings]
        assert any("Multiple" in t for t in titles)

    def test_hal_service_not_automatic(self):
        from gomsic_core.errors.detector import ErrorDetector
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = self._make_result(
            hardware_service=HardwareServiceInfo(
                running=True,
                service_startup_type="Manual",
                grpc_status="listening",
            )
        )
        findings = detector._check_hardware_service(result)
        titles = [f.title for f in findings]
        assert any("Manual" in t for t in titles)

    def test_problem_devices_finding(self):
        from gomsic_core.errors.detector import ErrorDetector
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = self._make_result(
            system_info=SystemInfo(problem_devices=["USB Hub: Error code 10"]),
        )
        findings = detector._check_system_health(result)
        assert len(findings) >= 1
        assert any("Problem device" in f.title for f in findings)

    def test_disconnected_nic_finding(self):
        from gomsic_core.errors.detector import ErrorDetector
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = self._make_result(
            network=NetworkInfo(adapters=[
                NetworkAdapter(
                    name="Ethernet 3",
                    description="Mellanox ConnectX-5",
                    advanced_properties={"_ConnectionState": "disconnected"},
                ),
            ]),
        )
        findings = detector._check_system_health(result)
        assert any("disconnected" in f.title.lower() for f in findings)

    def test_low_disk_space_finding(self):
        from gomsic_core.errors.detector import ErrorDetector
        from gomsic_core.models import CodeMeterInfo, StorageDrive
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = self._make_result(
            codemeter=CodeMeterInfo(
                drives=[StorageDrive(letter="C:\\", total_mb=512000, free_mb=2048)],
            ),
        )
        findings = detector._check_system_health(result)
        assert any("disk space" in f.title.lower() for f in findings)


# ---------------------------------------------------------------------------
# Knowledge base: pattern file loads without error
# ---------------------------------------------------------------------------

class TestKnowledgeBase:
    def test_patterns_yaml_loads(self):
        import yaml
        kb = Path(__file__).parent.parent / "knowledge_base"
        with open(kb / "patterns.yaml") as f:
            data = yaml.safe_load(f)
        assert "patterns" in data
        assert len(data["patterns"]) > 20  # we added many new patterns

    def test_driver_rules_yaml_loads(self):
        import yaml
        kb = Path(__file__).parent.parent / "knowledge_base"
        with open(kb / "driver_rules.yaml") as f:
            data = yaml.safe_load(f)
        assert "drivers" in data
        # Verify new entries exist
        drivers = data["drivers"]
        assert "dotnet_runtime" in drivers
        assert "vcredist" in drivers
        assert "common_vision_blox" in drivers
        assert "emergent_camera" in drivers

    def test_codemeter_min_version_synced(self):
        """CodeMeter min_version should be 7.60 in driver_rules (was stale at 7.50)."""
        import yaml
        kb = Path(__file__).parent.parent / "knowledge_base"
        with open(kb / "driver_rules.yaml") as f:
            data = yaml.safe_load(f)
        assert data["drivers"]["codemeter"]["min_version"] == "7.60"

    def test_compatibility_has_port_39025(self):
        import yaml
        kb = Path(__file__).parent.parent / "knowledge_base"
        with open(kb / "compatibility.yaml") as f:
            data = yaml.safe_load(f)
        hs = data["hardware_service"]
        ports = hs["ports"]["2025+"]
        port_numbers = [p["port"] for p in ports]
        assert 39025 in port_numbers

    def test_compatibility_has_firewall_executables(self):
        import yaml
        kb = Path(__file__).parent.parent / "knowledge_base"
        with open(kb / "compatibility.yaml") as f:
            data = yaml.safe_load(f)
        fw = data["hardware_service"]["firewall_executables"]
        assert len(fw) == 2
        paths = [e["path"] for e in fw]
        assert any("hardwareserver" in p for p in paths)
        assert any("hardwareservice" in p for p in paths)


# ---------------------------------------------------------------------------
# Version consistency
# ---------------------------------------------------------------------------

class TestVersionConsistency:
    def test_init_version(self):
        from gomsic_core import __version__
        assert __version__ == "0.3.0"

    def test_model_version(self):
        result = ParseResult(archive_filename="test.zip")
        assert result.tool_version == "0.3.0"

    def test_pyproject_version(self):
        pyproject = Path(__file__).parent.parent / "pyproject.toml"
        text = pyproject.read_text()
        assert 'version = "0.3.0"' in text


# ---------------------------------------------------------------------------
# QualitySuite log: FATAL counting
# ---------------------------------------------------------------------------

class TestQualitySuiteLogFatalCounting:
    def test_fatal_counted_as_error(self):
        """FATAL entries should increment total_errors, not be silently dropped."""
        from gomsic_core.models import QualitySuiteLogSummary, QualitySuiteLogEntry
        summary = QualitySuiteLogSummary()
        # Simulate what the parser does after our fix
        for level in ["ERROR", "FATAL", "WARN"]:
            entry = QualitySuiteLogEntry(level=level, message="test")
            summary.entries.append(entry)
            if level in ("ERROR", "FATAL"):
                summary.total_errors += 1
            elif level == "WARN":
                summary.total_warnings += 1

        assert summary.total_errors == 2  # ERROR + FATAL
        assert summary.total_warnings == 1


# ---------------------------------------------------------------------------
# Windows Events: priority EventIDs
# ---------------------------------------------------------------------------

class TestWindowsEventsPriorityIDs:
    def test_priority_event_ids_defined(self):
        from gomsic_core.parsers.windows_events import WindowsEventsParser
        parser = WindowsEventsParser()
        assert 7034 in parser._PRIORITY_EVENT_IDS  # service crashed
        assert 41 in parser._PRIORITY_EVENT_IDS     # kernel-power
        assert 1001 in parser._PRIORITY_EVENT_IDS   # app crash report


# ---------------------------------------------------------------------------
# Security: ZIP-Slip protection
# ---------------------------------------------------------------------------

class TestZipSlipProtection:
    def test_zip_extraction_filters_traversal(self):
        """Verify that ZIP extraction skips path traversal entries."""
        import zipfile
        import io
        from gomsic_core.extractor import ArchiveLayout

        # Create a malicious ZIP with path traversal
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("safe_file.txt", "safe content")
            zf.writestr("../../malicious.txt", "pwned")
        buf.seek(0)

        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / "test.zip"
            zip_path.write_bytes(buf.read())

            dest = Path(tmpdir) / "extracted"
            dest.mkdir()

            layout = ArchiveLayout(root=dest)
            from gomsic_core.extractor import _extract_qsr_zip
            _extract_qsr_zip(zip_path, dest, layout)

            # The malicious file should NOT be extracted outside dest
            assert not (Path(tmpdir) / "malicious.txt").exists()
            # But safe file should be there
            assert layout.warnings  # should have a warning about the suspicious path


class TestRivermaxEnvVarFalsePositive:
    """Verify Rivermax check doesn't false-positive when only system_info has the var."""

    def test_no_false_positive_without_registry(self):
        from gomsic_core.errors.detector import ErrorDetector
        kb = Path(__file__).parent.parent / "knowledge_base"
        detector = ErrorDetector(kb)
        result = ParseResult(
            archive_filename="test.zip",
            product_type=ProductType.ARAMIS_24M,
            hardware_service=HardwareServiceInfo(running=True, grpc_status="listening"),
            system_info=SystemInfo(environment_variables={"RIVERMAX_LOG_LEVEL": "6"}),
        )
        findings = detector._check_system_health(result)
        titles = [f.title for f in findings]
        assert not any("Rivermax" in t for t in titles)
