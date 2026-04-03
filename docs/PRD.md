# GOMSic Parser -- Product Requirements Document

**Version:** 0.3.0
**Owner:** Trilion Quality Systems
**Status:** Active development (beta)
**Target Users:** Trilion field engineers, ZEISS support escalation

## Overview

GOMSic Parser is an internal diagnostic tool that automatically analyzes ZEISS Quality Suite support archives ("GOMSic files"). It parses system configuration, hardware status, network settings, driver versions, license data, and application logs to identify issues that commonly cause measurement failures on ZEISS INSPECT workstations.

The tool replaces manual log inspection by surfacing actionable findings with severity levels and recommendations, reducing diagnostic time from hours to seconds.

## Architecture

- **Backend:** Python 3.9+ with FastAPI, Pydantic v2
- **Frontend:** Single-file HTML/CSS/JS SPA (no build tools)
- **Deployment:** Web server (uvicorn) or Electron desktop app
- **Knowledge Base:** Human-editable YAML files for patterns, rules, compatibility

## Supported Archive Formats

1. **Full QSR ZIP** -- Quality Suite Report (ZIP containing ZQS/ + ZEISS-INSPECT/gomsic.tgz)
2. **Raw .tgz** -- Direct gomsic archive (no ZQS wrapper, fewer data sources)

## Panels

### 1. System Info
- System overview cards: product type, dongle, ZEISS INSPECT/Correlate/QSS/HW Service versions, .NET Runtime, computer, OS, CPU, RAM, GPU, CUDA, storage
- Cameras and controllers (GigE IP/MAC for ARAMIS 24M/SRX)
- Licenses with dongle info (from licenses.csv, license_info.log, or app log fallback)
- Problem devices from Windows Device Manager
- Key software and drivers table
- Software install timeline
- Network adapters with IPs, MAC, DNS
- Hardware Service (HAL): version, gRPC status, running state, startup type, ports, firewall rules, prerequisites, connection timeline, sessions, devices, DB errors

### 2. Issues
- Findings organized by category: HAL, network, driver, license, system, logs
- NIC misconfiguration with PowerShell fix commands
- HAL structural issues (not running, gRPC blocked, multi-instance, restart cycle, empty config, DB errors)
- Prerequisite failures (.NET, VC++, Rivermax env vars)
- Disconnected NICs, low disk space, problem devices
- Firewall reminder block

### 3. Verified
- Confirmed-good checks: driver versions meet minimums, NIC settings correct, licenses present, HAL operational

### 4. Activity Timeline
- Last actions before archive (crash context)
- Session summary: last action, last project, exit status, hang count, total commands, stages
- Most frequent commands table
- Full event log with category filters
- Parsed from GOM scripting command log format

### 5. Logs
- All archive files grouped by type (HAL, acquisition, app, system diagnostic, etc.)
- Inline expand with copy button
- Full viewer modal with copy/save
- Include-in-PDF checkboxes
- Collapse/expand all
- Timestamp spans and file descriptions

### 6. Debug
- Parser execution trace with timing
- Per-parser status, files searched/found/parsed, notes

## Parsers (17 total)

| Parser | Source Files | Data Extracted |
|--------|-------------|----------------|
| zeiss_versions | version-index.json, registry.log, app logs | INSPECT, HW Service, QSS versions, Correlate detection |
| system_info | msinfo32.log | OS, CPU, RAM, problem devices, display info, env vars |
| licensing | licenses.csv, dongles.csv, license_info.log, app logs | Licenses, dongles, licensed products |
| network | nics.log | Adapters, IPs, DNS, MAC, MTU, connection state, advanced properties |
| drivers | InstalledPrograms.log, nvidia-smi.log, pnputil.log | All installed software, GPU, relevant drivers |
| cameras | zi_acq/GOM-ACQ logs | Controllers, cameras, serial numbers, IPs |
| usb | msinfo32.log | USB devices |
| hardware_service | GOM-HAL logs, hardware_status.db, hardware_cfg.xml, tasklist.log, registry.log | HAL version, ports, gRPC, timeline, devices, errors, service startup type, firewall, env vars |
| logs | All .log files | Error/warning entries with context, full file inventory |
| codemeter | CmDust output | CodeMeter version, containers, drives |
| windows_events | .evtx files | Critical/error/warning events with EventID and provider |
| gomsoftware_cfg | gomsoftware.cfg | Configuration sections |
| quality_suite_log | Suite.log | Log4j XML errors/warnings/fatals |
| windows_update | Windows10Update.log | Installed updates with KB numbers |
| activity_timeline | ZEISS_INSPECT/GOMSoftware logs | Command timeline, project lifecycle, hangs, exit status |

## Detection Engine (8 passes)

1. **Pattern matching** -- Regex patterns from patterns.yaml against log content
2. **NIC validation** -- Adapter settings vs nic_rules.yaml
3. **Driver checks** -- Version minimums from driver_rules.yaml
4. **License checks** -- Required products from license_rules.yaml
5. **Log analysis** -- Error/warning counts
6. **HAL structural** -- Service running, gRPC state, multi-instance, restart cycles, DB errors, empty config, missing ports
7. **Prerequisites** -- .NET Runtime, VC++ Redistributable against compatibility.yaml
8. **System health** -- Problem devices, disconnected NICs, disk space, Rivermax env vars

## Knowledge Base

- `patterns.yaml` -- 30+ regex and structural patterns with severity, description, recommendation
- `nic_rules.yaml` -- NIC adapter rules (Mellanox, Intel) with expected properties
- `driver_rules.yaml` -- Driver version requirements per product type
- `license_rules.yaml` -- Required licenses per product type
- `compatibility.yaml` -- ZEISS version compatibility matrix, port maps, firewall executables

## Frontend Features

- **Ctrl+K search palette** -- Search sections, findings, log files, log content
- **PDF export** -- Browser print with optional log file inclusion
- **Sidebar navigation** -- Auto-generated from section headers per panel
- **Dark/light theme** -- Trilion brand colors
- **Compact mode** -- Header and upload shrink after parsing
- **Progress indicator** -- Step counter during parsing
- **Log viewer modal** -- Full text with copy/save

## Security

- ZIP-slip protection (filtered member extraction)
- XXE mitigation (DOCTYPE/ENTITY stripping before XML parse)
- Upload file size limit (500MB)
- No SQL injection (parameterized queries only)
- No command injection (no subprocess calls)

## Build and Deployment

- **Dev mode:** `pip install -e . && cd standalone && npm start`
- **Web only:** `python -m uvicorn server.app:app --port 8420`
- **Full build:** `npm run build-server && npm run make` (produces Windows installer)
