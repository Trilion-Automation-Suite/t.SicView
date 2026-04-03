// ============================================================
// models.ts — Full TypeScript port of gomsic_core/models.py
// Every Pydantic model becomes a TypeScript interface.
// ============================================================

// ----- Enum-like union types -----

export type Severity = 'CRITICAL' | 'WARNING' | 'INFO'

export type ProductType =
  | 'ATOS Q'
  | 'GOM Scan 1'
  | 'GOM Scan Ports'
  | 'T-SCAN'
  | 'ATOS Q AWK'
  | 'ARAMIS 4M'
  | 'ARAMIS 12M'
  | 'ARAMIS 24M'
  | 'ARAMIS SRX'
  | 'ARGUS'
  | 'Unknown'

export type ParserStatus = 'success' | 'partial' | 'skipped' | 'failed'

// ----- Debug / Trace models -----

export interface ParserTrace {
  parser_name: string
  status: ParserStatus
  duration_ms: number
  files_searched: number
  files_found: number
  files_parsed: number
  error_message?: string
  notes?: string
}

export interface DebugTrace {
  started_at: string
  finished_at: string
  total_duration_ms: number
  archive_filename: string
  extraction_path?: string
  parser_traces: ParserTrace[]
  warnings: string[]
}

// ----- Version / software info -----

export interface ZeissVersions {
  inspect_version?: string
  quality_suite_version?: string
  hardware_service_version?: string
  product_name?: string
  raw_version_data: Record<string, unknown>
}

// ----- System info -----

export interface SystemInfo {
  computer_name?: string
  os_name?: string
  os_version?: string
  os_build?: string
  system_manufacturer?: string
  system_model?: string
  processor?: string
  total_physical_memory?: string
  bios_version?: string
  baseboard_product?: string
  problem_devices: string[]
  display_info: Record<string, unknown>
  environment_variables: Record<string, string>
  /** Section name → array of {Item, Value} rows */
  sections: Record<string, Record<string, string>[]>
}

// ----- GPU -----

export interface GPUInfo {
  name?: string
  driver_version?: string
  cuda_version?: string
  memory_total?: string
  memory_used?: string
  temperature?: string
  power_draw?: string
  pcie_gen?: string
  raw_data: Record<string, unknown>
}

// ----- Network -----

export interface NetworkAdapter {
  name: string
  description?: string
  mac_address?: string
  ip_addresses: string[]
  subnet_masks: string[]
  default_gateway?: string
  dhcp_enabled?: boolean
  link_speed?: string
  driver_name?: string
  driver_version?: string
  dns_servers: string[]
  advanced_properties: Record<string, unknown>
}

export interface NetworkInfo {
  adapters: NetworkAdapter[]
  hostname?: string
  domain?: string
  dns_servers: string[]
}

// ----- Licensing -----

export interface LicenseEntry {
  product?: string
  key?: string
  expiry?: string
  license_type?: string
  version?: string
  raw_fields: Record<string, unknown>
}

export interface DongleInfo {
  dongle_type?: string
  serial?: string
}

export interface LicenseInfo {
  licenses: LicenseEntry[]
  dongles: DongleInfo[]
  licensed_products: string[]
  license_manifest: Record<string, unknown>
}

// ----- Drivers -----

export interface InstalledDriver {
  name: string
  version?: string
  publisher?: string
  install_date?: string
}

export interface DriverInfo {
  nvidia_driver?: string
  mellanox_driver?: string
  rivermax?: string
  codemeter?: string
  gpu?: GPUInfo
  all_relevant_drivers: InstalledDriver[]
  install_timeline: InstalledDriver[]
}

// ----- Cameras -----

export interface CameraConfig {
  camera_name?: string
  serial_number?: string
  model?: string
  ip_address?: string
  mac_address?: string
  gev_packet_size?: string
  gev_scps_packet_size?: string
  interface_name?: string
  raw_config: Record<string, unknown>
}

export interface ControllerDiscovery {
  device_type?: string
  sensor_type?: string
  name?: string
  firmware?: string
  ip_address?: string
  broadcast_address?: string
  raw_json?: string
}

export interface CameraInfo {
  cameras: CameraConfig[]
  controllers: ControllerDiscovery[]
  detected_sensors: string[]
  controller_ip?: string
  controller_subnet?: string
}

// ----- USB -----

export interface USBDevice {
  name?: string
  device_id?: string
  status?: string
  driver?: string
}

export interface USBInfo {
  devices: USBDevice[]
}

// ----- Logs -----

export interface LogEntry {
  timestamp?: string
  level?: string
  source_file: string
  line_number?: number
  message: string
  context_before: string[]
  context_after: string[]
}

export interface LogSummary {
  total_errors: number
  total_warnings: number
  entries: LogEntry[]
  files_analyzed: string[]
}

export interface LogFileEntry {
  filename: string
  path: string
  size_bytes: number
  content?: string
  line_count: number
  has_errors: boolean
  has_warnings: boolean
  first_timestamp?: string
  last_timestamp?: string
  description?: string
}

// ----- Activity timeline -----

export interface ActivityEvent {
  timestamp?: string
  category: string
  action: string
  detail: string
  source_file: string
}

export interface ActivityTimeline {
  events: ActivityEvent[]
  last_action?: string
  last_project?: string
  project_open?: boolean
  project_size?: string
  stage_count?: number
  hang_count: number
  total_commands: number
  command_summary: Record<string, number>
}

// ----- Log inventory -----

export interface LogInventory {
  files: LogFileEntry[]
}

// ----- Storage -----

export interface StorageDrive {
  letter: string
  drive_type?: string
  label?: string
  total_mb?: number
  free_mb?: number
}

// ----- CodeMeter -----

export interface CodeMeterInfo {
  version?: string
  containers: string[]
  status?: string
  raw_sections: Record<string, unknown>
  drives: StorageDrive[]
}

// ----- Windows updates -----

export interface WindowsUpdateInfo {
  installed_updates: string[]
  pending_updates: string[]
}

// ----- GOM software config -----

export interface GomSoftwareConfig {
  sections: Record<string, unknown>
  raw_text?: string
}

// ----- Hardware service -----

export interface HardwareServicePort {
  port: number
  service: string
  protocol: string
  status: string
  address: string
}

export interface HardwareServiceSession {
  timestamp?: string
  sw_name?: string
  sw_version?: string
  sw_revision?: string
  sw_build_date?: string
  hardware_type?: string
  hardware_family?: string
  manufacturer?: string
  product_instance_uri?: string
}

export interface HardwareServiceDevice {
  device_id?: string
  name?: string
  ip_address?: string
  device_type?: string
  uuid?: string
  version?: string
}

export interface HardwareServiceError {
  source_name?: string
  error_code?: string
  description?: string
  severity?: string
}

export interface HardwareServiceInfo {
  version?: string
  hal_version?: string
  hal_branch?: string
  hal_pid?: string
  running?: boolean
  process_name?: string
  pid?: number
  install_path?: string
  config_path?: string
  ports: HardwareServicePort[]
  grpc_status?: string
  timeline: string[]
  sessions: HardwareServiceSession[]
  devices: HardwareServiceDevice[]
  errors: HardwareServiceError[]
  db_version?: string
  db_tables: string[]
  total_session_count?: number
  multiple_instances: boolean
  related_processes: Record<string, unknown>
  hardware_cfg_entries: string[]
  service_startup_type?: string
  rivermax_env_vars: Record<string, string>
  firewall_rules_found: string[]
}

// ----- Quality Suite logs -----

export interface QualitySuiteLogEntry {
  timestamp?: string
  level: string
  logger?: string
  message: string
  exception?: string
  thread?: string
  properties: Record<string, unknown>
}

export interface QualitySuiteLogSummary {
  entries: QualitySuiteLogEntry[]
  total_errors: number
  total_warnings: number
  files_analyzed: string[]
}

// ----- Findings -----

export interface Finding {
  severity: Severity
  title: string
  description: string
  source_file?: string
  source_line?: number
  recommendation?: string
  pattern_id?: string
  category?: string
  raw_context: string[]
}

// ----- Top-level parse result -----

export interface ParseResult {
  archive_filename: string
  parsed_at: string
  tool_version: string
  product_type: ProductType
  user_description?: string
  user_issue_description?: string
  detected_product?: string
  zeiss_versions?: ZeissVersions
  system_info?: SystemInfo
  network?: NetworkInfo
  licensing?: LicenseInfo
  drivers?: DriverInfo
  cameras?: CameraInfo
  usb?: USBInfo
  hardware_service?: HardwareServiceInfo
  logs?: LogSummary
  codemeter?: CodeMeterInfo
  windows_updates?: WindowsUpdateInfo
  gomsoftware_config?: GomSoftwareConfig
  quality_suite_log?: QualitySuiteLogSummary
  log_inventory?: LogInventory
  activity_timeline?: ActivityTimeline
  findings: Finding[]
  verified_checks: string[]
  debug_trace?: DebugTrace
}
