GOMSic Parser v0.3.0
Trilion Quality Systems
https://trilion.com

WHAT IS THIS?

  GOMSic Parser is a diagnostic tool that analyzes ZEISS Quality Suite
  support archives (GOMSic files). It automatically identifies system
  configuration issues, hardware problems, and software inconsistencies
  that commonly cause measurement failures.

HOW TO USE

  1. Launch gomsic-parser.exe
  2. Drop a .zip (QSR report) or .tgz (raw gomsic) archive onto the
     upload area, or click to browse
  3. Select the product type if known, or leave as Auto-detect
  4. Click "Parse Archive" and wait for the analysis to complete

  The tool will parse the archive and present results across six panels:

    System Info    System hardware, software versions, cameras, licenses,
                   network adapters, and Hardware Service (HAL) status

    Issues         Detected problems organized by category (HAL, network,
                   drivers, licenses) with severity and recommendations

    Verified       Confirmed-good checks (driver versions meet minimums,
                   correct NIC settings, licenses present)

    Activity       Chronological timeline of user actions extracted from
                   application logs (projects, acquisitions, inspections)

    Logs           All archive files grouped by type with inline viewer,
                   copy, and PDF export options

    Debug          Parser execution trace showing timing and status for
                   each analysis step

KEYBOARD SHORTCUTS

  Ctrl+K / Cmd+K    Open search palette (search sections, issues, logs)
  Esc               Close search or log viewer

GENERATING A GOMSIC ARCHIVE

  In ZEISS INSPECT:
    Help > Collect Support Information > Save

  This creates a .tgz file. For a full report including licenses and
  installed software details, use the ZEISS Quality Suite:
    Quality Suite > Support > Create Support Report

  The full .zip report provides the most complete diagnostic data.

WHAT IT CHECKS

  - ZEISS INSPECT, Correlate, Hardware Service, Quality Suite versions
  - .NET Runtime and Visual C++ Redistributable prerequisites
  - Mellanox, Rivermax, CodeMeter, CVB driver versions
  - NIC configuration (jumbo frames, flow control, offloads, buffers)
  - Hardware Service (HAL) port status, gRPC connectivity, restart cycles
  - Windows Firewall rules for ZEISS executables
  - Dongle presence and license validation
  - Disk space, problem devices, disconnected adapters
  - Camera/controller discovery and configuration
  - Rivermax environment variables (ARAMIS 24M)

SUPPORT

  For questions or feedback, contact devs@trilion.com

  This tool is in active development. Not all issues may be detected.
  Always verify findings against the actual system before taking action.
