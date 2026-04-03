"""Pydantic data models for the GOMSic Parser.

All parsed data flows through these models. Each parser produces one or more
model instances. The Report model aggregates everything for report generation.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    INFO = "INFO"


class ProductType(str, Enum):
    ATOS_Q = "ATOS Q"
    GOM_SCAN_1 = "GOM Scan 1"
    GOM_SCAN_PORTS = "GOM Scan Ports"
    T_SCAN = "T-SCAN"
    ATOS_Q_AWK = "ATOS Q AWK"
    ARAMIS_4M = "ARAMIS 4M"
    ARAMIS_12M = "ARAMIS 12M"
    ARAMIS_24M = "ARAMIS 24M"
    ARAMIS_SRX = "ARAMIS SRX"
    ARGUS = "ARGUS"
    UNKNOWN = "Unknown"


class ParserStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    SKIPPED = "skipped"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# Debug / Trace Models
# ---------------------------------------------------------------------------

class ParserTrace(BaseModel):
    """Execution record for a single parser."""
    parser_name: str
    status: ParserStatus
    duration_ms: float = 0.0
    files_searched: list[str] = Field(default_factory=list)
    files_found: list[str] = Field(default_factory=list)
    files_parsed: list[str] = Field(default_factory=list)
    error_message: Optional[str] = None
    notes: list[str] = Field(default_factory=list)


class DebugTrace(BaseModel):
    """Full execution trace for a parse run."""
    started_at: datetime
    finished_at: Optional[datetime] = None
    total_duration_ms: float = 0.0
    archive_filename: str = ""
    extraction_path: str = ""
    parser_traces: list[ParserTrace] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Parsed Data Models
# ---------------------------------------------------------------------------

class ZeissVersions(BaseModel):
    """Version information for ZEISS software components."""
    inspect_version: Optional[str] = None
    quality_suite_version: Optional[str] = None
    hardware_service_version: Optional[str] = None
    product_name: Optional[str] = None
    raw_version_data: dict[str, Any] = Field(default_factory=dict)


class SystemInfo(BaseModel):
    """System hardware and OS information from msinfo32.log."""
    computer_name: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    os_build: Optional[str] = None
    system_manufacturer: Optional[str] = None
    system_model: Optional[str] = None
    processor: Optional[str] = None
    total_physical_memory: Optional[str] = None
    bios_version: Optional[str] = None
    baseboard_product: Optional[str] = None
    # New: structured extractions
    problem_devices: list[str] = Field(default_factory=list)
    display_info: dict[str, str] = Field(default_factory=dict)
    environment_variables: dict[str, str] = Field(default_factory=dict)
    # Full sections for deep inspection
    sections: dict[str, list[dict[str, str]]] = Field(default_factory=dict)


class GPUInfo(BaseModel):
    """GPU information from nvidia-smi and display device logs."""
    name: Optional[str] = None
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None
    memory_total: Optional[str] = None
    memory_used: Optional[str] = None
    temperature: Optional[str] = None
    power_draw: Optional[str] = None
    pcie_gen: Optional[str] = None
    raw_data: dict[str, str] = Field(default_factory=dict)


class NetworkAdapter(BaseModel):
    """A single network adapter with its configuration."""
    name: str
    description: Optional[str] = None
    mac_address: Optional[str] = None
    ip_addresses: list[str] = Field(default_factory=list)
    subnet_masks: list[str] = Field(default_factory=list)
    default_gateway: Optional[str] = None
    dhcp_enabled: Optional[bool] = None
    link_speed: Optional[str] = None
    driver_name: Optional[str] = None
    driver_version: Optional[str] = None
    dns_servers: list[str] = Field(default_factory=list)
    # Advanced properties (from PowerShell Get-NetAdapterAdvancedProperty)
    advanced_properties: dict[str, str] = Field(default_factory=dict)


class NetworkInfo(BaseModel):
    """All network adapters and configuration."""
    adapters: list[NetworkAdapter] = Field(default_factory=list)
    hostname: Optional[str] = None
    domain: Optional[str] = None
    dns_servers: list[str] = Field(default_factory=list)


class LicenseEntry(BaseModel):
    """A single license from licenses.csv."""
    product: Optional[str] = None
    key: Optional[str] = None
    expiry: Optional[str] = None
    license_type: Optional[str] = None
    version: Optional[str] = None
    raw_fields: dict[str, str] = Field(default_factory=dict)


class DongleInfo(BaseModel):
    """Dongle/WIBU information from dongles.csv."""
    dongle_type: Optional[str] = None
    serial: Optional[str] = None


class LicenseInfo(BaseModel):
    """All licensing information."""
    licenses: list[LicenseEntry] = Field(default_factory=list)
    dongles: list[DongleInfo] = Field(default_factory=list)
    licensed_products: list[str] = Field(default_factory=list)
    license_manifest: dict[str, Any] = Field(default_factory=dict)


class InstalledDriver(BaseModel):
    """An installed driver or program relevant to diagnostics."""
    name: str
    version: Optional[str] = None
    publisher: Optional[str] = None
    install_date: Optional[str] = None


class DriverInfo(BaseModel):
    """Driver and software installation information."""
    nvidia_driver: Optional[InstalledDriver] = None
    mellanox_driver: Optional[InstalledDriver] = None
    rivermax: Optional[InstalledDriver] = None
    codemeter: Optional[InstalledDriver] = None
    gpu: Optional[GPUInfo] = None
    all_relevant_drivers: list[InstalledDriver] = Field(default_factory=list)
    # Full install timeline -- ALL programs sorted by install date (newest first)
    install_timeline: list[InstalledDriver] = Field(default_factory=list)


class CameraConfig(BaseModel):
    """Camera/acquisition configuration from zi_acq logs."""
    camera_name: Optional[str] = None
    serial_number: Optional[str] = None
    model: Optional[str] = None
    ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    gev_packet_size: Optional[int] = None
    gev_scps_packet_size: Optional[int] = None
    interface_name: Optional[str] = None
    raw_config: dict[str, str] = Field(default_factory=dict)


class ControllerDiscovery(BaseModel):
    """Controller discovered via network broadcast."""
    device_type: Optional[str] = None
    sensor_type: Optional[str] = None
    name: Optional[str] = None
    firmware: Optional[str] = None
    ip_address: Optional[str] = None
    broadcast_address: Optional[str] = None
    raw_json: Optional[str] = None


class CameraInfo(BaseModel):
    """All camera/acquisition information."""
    cameras: list[CameraConfig] = Field(default_factory=list)
    controllers: list[ControllerDiscovery] = Field(default_factory=list)
    detected_sensors: list[dict[str, str]] = Field(default_factory=list)
    controller_ip: Optional[str] = None
    controller_subnet: Optional[str] = None


class USBDevice(BaseModel):
    """A USB device from msinfo32 USB section."""
    name: Optional[str] = None
    device_id: Optional[str] = None
    status: Optional[str] = None
    driver: Optional[str] = None


class USBInfo(BaseModel):
    """USB device information."""
    devices: list[USBDevice] = Field(default_factory=list)


class LogEntry(BaseModel):
    """A parsed log entry with context."""
    timestamp: Optional[str] = None
    level: Optional[str] = None
    source_file: str
    line_number: Optional[int] = None
    message: str
    context_before: list[str] = Field(default_factory=list)
    context_after: list[str] = Field(default_factory=list)


class LogSummary(BaseModel):
    """Summary of log analysis."""
    total_errors: int = 0
    total_warnings: int = 0
    entries: list[LogEntry] = Field(default_factory=list)
    files_analyzed: list[str] = Field(default_factory=list)


class LogFileEntry(BaseModel):
    """A log file found in the archive, with full content for the viewer."""
    filename: str
    path: str = ""             # relative path within archive
    size_bytes: int = 0
    content: Optional[str] = None
    line_count: int = 0
    has_errors: bool = False
    has_warnings: bool = False
    first_timestamp: Optional[str] = None
    last_timestamp: Optional[str] = None
    description: Optional[str] = None


class ActivityEvent(BaseModel):
    """A single user activity event from ZEISS INSPECT logs."""
    timestamp: Optional[str] = None
    category: str = ""          # project, acquisition, component, inspection, etc.
    action: str = ""            # "Project opened", "Acquisition started", etc.
    detail: str = ""            # project name, component name, etc.
    source_file: str = ""


class ActivityTimeline(BaseModel):
    """Chronological timeline of user activity extracted from app logs."""
    events: list[ActivityEvent] = Field(default_factory=list)
    last_action: Optional[str] = None
    last_project: Optional[str] = None
    project_open: Optional[bool] = None
    project_size: Optional[str] = None
    stage_count: Optional[int] = None
    hang_count: int = 0
    total_commands: int = 0
    command_summary: dict[str, int] = Field(default_factory=dict)


class LogInventory(BaseModel):
    """All log files found in the archive."""
    files: list[LogFileEntry] = Field(default_factory=list)


class StorageDrive(BaseModel):
    """A storage drive detected in the system."""
    letter: str                          # e.g. "C:\\"
    drive_type: Optional[str] = None     # e.g. "Fix Drive", "Removable Drive"
    label: Optional[str] = None          # e.g. "Lexar USB Flash Drive"
    total_mb: Optional[int] = None
    free_mb: Optional[int] = None

    @property
    def used_mb(self) -> Optional[int]:
        if self.total_mb is not None and self.free_mb is not None:
            return self.total_mb - self.free_mb
        return None

    @property
    def used_pct(self) -> Optional[float]:
        if self.total_mb and self.total_mb > 0 and self.free_mb is not None:
            return round((self.total_mb - self.free_mb) / self.total_mb * 100, 1)
        return None


class CodeMeterInfo(BaseModel):
    """CodeMeter/WIBU dongle diagnostics from CmDust output."""
    version: Optional[str] = None
    containers: list[dict[str, str]] = Field(default_factory=list)
    status: Optional[str] = None
    raw_sections: dict[str, str] = Field(default_factory=dict)
    drives: list[StorageDrive] = Field(default_factory=list)


class WindowsUpdateInfo(BaseModel):
    """Windows Update information."""
    installed_updates: list[dict[str, str]] = Field(default_factory=list)
    pending_updates: list[dict[str, str]] = Field(default_factory=list)


class GomSoftwareConfig(BaseModel):
    """Parsed gomsoftware.cfg (T.O.M. config format)."""
    sections: dict[str, dict[str, Any]] = Field(default_factory=dict)
    raw_text: Optional[str] = None


class HardwareServicePort(BaseModel):
    """A port used by the ZEISS Hardware Service."""
    port: int
    service: str           # e.g. "HAL Backend", "gRPC", "CMD", "PStore"
    protocol: str = "TCP"  # TCP or gRPC
    status: str = ""       # "listening", "blocked", "unknown"
    address: str = ""      # e.g. "127.0.0.1", "0.0.0.0"


class HardwareServiceSession(BaseModel):
    """A session record from hardware_status.db."""
    timestamp: Optional[str] = None
    sw_name: Optional[str] = None
    sw_version: Optional[str] = None
    sw_revision: Optional[str] = None
    sw_build_date: Optional[str] = None
    hardware_type: Optional[str] = None
    hardware_family: Optional[str] = None
    manufacturer: Optional[str] = None
    product_instance_uri: Optional[str] = None


class HardwareServiceDevice(BaseModel):
    """A device record from hardware_status.db group_data."""
    device_id: Optional[str] = None
    name: Optional[str] = None
    ip_address: Optional[str] = None
    device_type: Optional[str] = None   # "GMS", "IPC"
    uuid: Optional[str] = None
    version: Optional[str] = None


class HardwareServiceError(BaseModel):
    """An error record from hardware_status.db error_list."""
    source_name: Optional[str] = None
    error_code: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None


class HardwareServiceInfo(BaseModel):
    """ZEISS Hardware Service (HAL) status and diagnostics."""
    version: Optional[str] = None
    hal_version: Optional[str] = None       # e.g. "2026-Service-Pack-1 Rev. 984"
    hal_branch: Optional[str] = None        # e.g. "tag-2026-Service-Pack-1.3"
    hal_pid: Optional[int] = None
    running: Optional[bool] = None
    process_name: Optional[str] = None
    pid: Optional[int] = None
    install_path: Optional[str] = None      # C:\Program Files\Zeiss\INSPECT-Hardware-Service\
    config_path: Optional[str] = None       # C:\ProgramData\Zeiss\HardwareServer\
    # Port status
    ports: list[HardwareServicePort] = Field(default_factory=list)
    grpc_status: Optional[str] = None       # "listening", "blocked", "not_started"
    # Connection timeline events
    timeline: list[str] = Field(default_factory=list)
    # hardware_status.db data
    sessions: list[HardwareServiceSession] = Field(default_factory=list)
    devices: list[HardwareServiceDevice] = Field(default_factory=list)
    errors: list[HardwareServiceError] = Field(default_factory=list)
    db_version: Optional[str] = None
    db_tables: list[str] = Field(default_factory=list)
    total_session_count: Optional[int] = None
    # Multi-instance detection
    multiple_instances: bool = False
    related_processes: dict[str, bool] = Field(default_factory=dict)
    # hardware_cfg.xml parsed entries
    hardware_cfg_entries: list[dict[str, str]] = Field(default_factory=list)
    # Registry-derived fields
    service_startup_type: Optional[str] = None
    rivermax_env_vars: dict[str, str] = Field(default_factory=dict)
    firewall_rules_found: list[str] = Field(default_factory=list)


class QualitySuiteLogEntry(BaseModel):
    """A parsed entry from QualitySuite Suite.log (log4j XML format)."""
    timestamp: Optional[str] = None
    level: str = "INFO"
    logger: Optional[str] = None
    message: str = ""
    exception: Optional[str] = None
    thread: Optional[str] = None
    properties: dict[str, str] = Field(default_factory=dict)


class QualitySuiteLogSummary(BaseModel):
    """Parsed QualitySuite log data."""
    entries: list[QualitySuiteLogEntry] = Field(default_factory=list)
    total_errors: int = 0
    total_warnings: int = 0
    files_analyzed: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Finding (Error Detection Output)
# ---------------------------------------------------------------------------

class Finding(BaseModel):
    """A diagnostic finding from the error detection engine."""
    severity: Severity
    title: str
    description: str
    source_file: Optional[str] = None
    source_line: Optional[int] = None
    recommendation: Optional[str] = None
    pattern_id: Optional[str] = None
    category: Optional[str] = None
    raw_context: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-Level Report Model
# ---------------------------------------------------------------------------

class ParseResult(BaseModel):
    """Complete result of parsing a GOMSic archive."""
    # Metadata
    archive_filename: str
    parsed_at: datetime = Field(default_factory=datetime.now)
    tool_version: str = "0.3.0"
    product_type: ProductType = ProductType.UNKNOWN
    user_description: Optional[str] = None
    user_issue_description: Optional[str] = None  # from description.txt in archive

    # Detected system type
    detected_product: Optional[ProductType] = None

    # Parsed data (each Optional -- parser may have been skipped/failed)
    zeiss_versions: Optional[ZeissVersions] = None
    system_info: Optional[SystemInfo] = None
    network: Optional[NetworkInfo] = None
    licensing: Optional[LicenseInfo] = None
    drivers: Optional[DriverInfo] = None
    cameras: Optional[CameraInfo] = None
    usb: Optional[USBInfo] = None
    hardware_service: Optional[HardwareServiceInfo] = None
    logs: Optional[LogSummary] = None
    codemeter: Optional[CodeMeterInfo] = None
    windows_updates: Optional[WindowsUpdateInfo] = None
    gomsoftware_config: Optional[GomSoftwareConfig] = None
    quality_suite_log: Optional[QualitySuiteLogSummary] = None
    log_inventory: Optional[LogInventory] = None
    activity_timeline: Optional[ActivityTimeline] = None

    # Findings from error detection
    findings: list[Finding] = Field(default_factory=list)

    # Verified checks (things confirmed correct)
    verified_checks: list[dict[str, str]] = Field(default_factory=list)

    # Debug trace
    debug_trace: Optional[DebugTrace] = None
