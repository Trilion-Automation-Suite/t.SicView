"""Integration tests: run the full parse pipeline against real fixtures.

Tests the ZIP archive (full QSR format) and .tgz archives (raw gomsic format).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from gomsic_core.api import parse_archive
from gomsic_core.models import ProductType

FIXTURES = Path(__file__).parent / "fixtures"

ZIP_FIXTURE = FIXTURES / "zeiss_quality_suite_report_2026-01-16_12-21-41.zip"
TGZ_2024A = FIXTURES / "gomsic-report-2024-04-19-16-04-18.tgz"
TGZ_2024B = FIXTURES / "gomsic-report-2024-05-21-13-22-16.tgz"
TGZ_2025 = FIXTURES / "gomsic-report-2025-08-01-15-48-32.tgz"


# ---------------------------------------------------------------------------
# Full QSR ZIP (ARAMIS 24M system, ZEISS INSPECT 2026)
# ---------------------------------------------------------------------------

class TestZIPArchive:
    """Tests against the full Quality Suite Report ZIP fixture."""

    @pytest.fixture(autouse=True)
    def parse_zip(self):
        if not ZIP_FIXTURE.is_file():
            pytest.skip("ZIP fixture not found")
        self.result = parse_archive(ZIP_FIXTURE, product="ARAMIS 24M")

    def test_archive_filename(self):
        assert self.result.archive_filename == ZIP_FIXTURE.name

    def test_product_type(self):
        assert self.result.product_type == ProductType.ARAMIS_24M

    def test_description_txt(self):
        assert self.result.user_issue_description is not None
        assert "24M" in self.result.user_issue_description

    # --- ZEISS Versions ---

    def test_zeiss_inspect_version(self):
        v = self.result.zeiss_versions
        assert v is not None
        assert v.inspect_version == "2026.2.0.1091"

    def test_hardware_service_version(self):
        v = self.result.zeiss_versions
        assert v is not None
        assert v.hardware_service_version == "1.0.2.1"

    def test_product_name(self):
        v = self.result.zeiss_versions
        assert v is not None
        assert v.product_name is not None
        assert "ZEISS INSPECT" in v.product_name

    # --- System Info ---

    def test_system_info_parsed(self):
        si = self.result.system_info
        assert si is not None

    def test_computer_name(self):
        si = self.result.system_info
        assert si is not None
        assert si.computer_name == "GOMPC"

    def test_os_name(self):
        si = self.result.system_info
        assert si is not None
        assert "Windows 10" in si.os_name

    def test_system_model(self):
        si = self.result.system_info
        assert si is not None
        assert "5820" in si.system_model

    def test_processor(self):
        si = self.result.system_info
        assert si is not None
        assert "Xeon" in si.processor

    # --- Licensing ---

    def test_licensing_parsed(self):
        lic = self.result.licensing
        assert lic is not None
        assert len(lic.licenses) > 0

    def test_dongle_id(self):
        lic = self.result.licensing
        assert lic is not None
        assert len(lic.dongles) > 0
        assert lic.dongles[0].serial == "3-7335918"
        assert lic.dongles[0].dongle_type == "WIBU"

    def test_aramis_24m_license_present(self):
        lic = self.result.licensing
        assert lic is not None
        # Check that ARAMIS 24M sensor driver license exists
        product_names = [entry.product for entry in lic.licenses if entry.product]
        assert any("ARAMIS 24M" in p for p in product_names)

    # --- Network ---

    def test_network_parsed(self):
        net = self.result.network
        assert net is not None
        assert len(net.adapters) > 0

    def test_hostname(self):
        net = self.result.network
        assert net is not None
        assert net.hostname == "GOMPC"

    def test_mellanox_adapters_found(self):
        net = self.result.network
        assert net is not None
        mellanox = [a for a in net.adapters if a.description and "Mellanox" in a.description]
        assert len(mellanox) >= 2

    def test_mellanox_advanced_properties(self):
        net = self.result.network
        assert net is not None
        mellanox = [a for a in net.adapters if a.description and "Mellanox" in a.description]
        assert len(mellanox) >= 1
        # Check that advanced properties were parsed
        props = mellanox[0].advanced_properties
        assert len(props) > 0
        # FlowControl should be present (real value is "0" on this system)
        assert "FlowControl" in props

    def test_intel_i210_found(self):
        net = self.result.network
        assert net is not None
        intel = [a for a in net.adapters if a.description and "I210" in a.description]
        assert len(intel) >= 1

    # --- Drivers ---

    def test_drivers_parsed(self):
        drv = self.result.drivers
        assert drv is not None

    def test_mellanox_driver(self):
        drv = self.result.drivers
        assert drv is not None
        assert drv.mellanox_driver is not None
        assert drv.mellanox_driver.version == "3.10.50000"

    def test_rivermax_installed(self):
        drv = self.result.drivers
        assert drv is not None
        assert drv.rivermax is not None
        assert drv.rivermax.version == "1.20.10"

    def test_codemeter_installed(self):
        drv = self.result.drivers
        assert drv is not None
        assert drv.codemeter is not None
        assert "8.30" in drv.codemeter.version

    def test_gpu_info(self):
        drv = self.result.drivers
        assert drv is not None
        assert drv.gpu is not None
        assert drv.gpu.name is not None
        assert "T1000" in drv.gpu.name
        assert drv.gpu.driver_version == "516.94"
        assert drv.gpu.cuda_version == "11.7"

    # --- Cameras ---

    def test_cameras_parsed(self):
        cam = self.result.cameras
        assert cam is not None

    def test_controller_discovered(self):
        cam = self.result.cameras
        assert cam is not None
        assert len(cam.controllers) > 0
        ctrl = cam.controllers[0]
        assert ctrl.device_type == "ARAMIS Controller"
        assert ctrl.sensor_type == "C2023"
        assert ctrl.ip_address == "192.168.6.200"
        assert ctrl.name == "241547"

    def test_cameras_found(self):
        cam = self.result.cameras
        assert cam is not None
        assert len(cam.cameras) >= 2
        models = [c.model for c in cam.cameras]
        assert all(m == "HB-25000SBM" for m in models)

    # --- Logs ---

    def test_logs_parsed(self):
        logs = self.result.logs
        assert logs is not None
        assert logs.total_errors > 0

    # --- Debug Trace ---

    def test_debug_trace_present(self):
        trace = self.result.debug_trace
        assert trace is not None
        assert trace.total_duration_ms > 0
        assert len(trace.parser_traces) > 0

    def test_all_parsers_ran(self):
        trace = self.result.debug_trace
        assert trace is not None
        parser_names = [pt.parser_name for pt in trace.parser_traces]
        assert "extractor" in parser_names
        assert "system_info" in parser_names
        assert "network" in parser_names
        assert "licensing" in parser_names
        assert "drivers" in parser_names
        assert "cameras" in parser_names

    # --- Error Detection / Findings ---

    def test_findings_produced(self):
        assert len(self.result.findings) > 0

    def test_mellanox_flow_control_no_warning(self):
        """Both Mellanox adapters have FlowControl=0 (Disabled), which is correct per nic_rules.yaml."""
        flow_findings = [
            f for f in self.result.findings
            if "FlowControl" in f.title and "NIC" in f.title
        ]
        assert len(flow_findings) == 0

    def test_license_parse_error_detected(self):
        """The zi_acq log contains 'Error parsing license string'."""
        license_findings = [
            f for f in self.result.findings
            if "license" in f.title.lower() and "pars" in f.title.lower()
        ]
        # This should be caught by patterns.yaml
        assert len(license_findings) >= 1 or any(
            "license" in f.description.lower() and "pars" in f.description.lower()
            for f in self.result.findings
        )


# ---------------------------------------------------------------------------
# Raw .tgz archives (gomsic only, no ZQS wrapper)
# ---------------------------------------------------------------------------

class TestTGZArchive2025:
    """Tests against the 2025 raw gomsic .tgz fixture."""

    @pytest.fixture(autouse=True)
    def parse_tgz(self):
        if not TGZ_2025.is_file():
            pytest.skip("2025 tgz fixture not found")
        self.result = parse_archive(TGZ_2025)

    def test_system_info_parsed(self):
        si = self.result.system_info
        assert si is not None
        assert si.computer_name == "GOMPC"

    def test_no_zqs_data(self):
        """Raw tgz has no ZQS wrapper: licensing is absent and ZQS-specific version fields are None.
        inspect_version and product_name may be populated from gomsic log fallbacks."""
        assert self.result.licensing is None
        zv = self.result.zeiss_versions
        if zv is not None:
            assert zv.quality_suite_version is None
            assert zv.hardware_service_version is None

    def test_drivers_parsed(self):
        drv = self.result.drivers
        assert drv is not None
        assert drv.gpu is not None

    def test_network_parsed(self):
        net = self.result.network
        assert net is not None
        assert len(net.adapters) > 0

    def test_logs_parsed(self):
        logs = self.result.logs
        assert logs is not None

    def test_debug_trace(self):
        assert self.result.debug_trace is not None
        assert self.result.debug_trace.total_duration_ms > 0


class TestTGZArchive2024A:
    """Tests against the 2024-04 raw gomsic .tgz fixture."""

    @pytest.fixture(autouse=True)
    def parse_tgz(self):
        if not TGZ_2024A.is_file():
            pytest.skip("2024A tgz fixture not found")
        self.result = parse_archive(TGZ_2024A)

    def test_system_info_parsed(self):
        si = self.result.system_info
        assert si is not None

    def test_gomsoftware_cfg_parsed(self):
        self.result.gomsoftware_config  # noqa: B018
        # May or may not exist depending on archive contents
        # Just ensure no crash

    def test_parse_completes(self):
        """Verify parsing completes without errors."""
        trace = self.result.debug_trace
        assert trace is not None
        failed = [pt for pt in trace.parser_traces if pt.status.value == "failed"]
        # Allow some parsers to fail gracefully (missing files), but not crash
        for f in failed:
            assert f.error_message is not None


class TestTGZArchive2024B:
    """Tests against the 2024-05 raw gomsic .tgz fixture."""

    @pytest.fixture(autouse=True)
    def parse_tgz(self):
        if not TGZ_2024B.is_file():
            pytest.skip("2024B tgz fixture not found")
        self.result = parse_archive(TGZ_2024B)

    def test_parse_completes(self):
        assert self.result.debug_trace is not None

    def test_system_info_parsed(self):
        si = self.result.system_info
        assert si is not None


# ---------------------------------------------------------------------------
# Performance test
# ---------------------------------------------------------------------------

class TestPerformance:
    def test_parse_under_10_seconds(self):
        """Full parse should complete in under 10 seconds."""
        import time
        if not ZIP_FIXTURE.is_file():
            pytest.skip("ZIP fixture not found")
        start = time.monotonic()
        parse_archive(ZIP_FIXTURE, product="ARAMIS 24M")
        elapsed = time.monotonic() - start
        assert elapsed < 10, f"Parse took {elapsed:.1f}s (should be <10s)"
