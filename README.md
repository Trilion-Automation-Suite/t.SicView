# t.SicView

Diagnostic viewer for ZEISS Quality Suite support archives -- no manual file sifting required.

Drop a GOMSic archive and instantly see the full diagnostic breakdown: system info, licensing, network config, driver versions, camera settings, error detection, and known issue identification. Runs as a standalone desktop app on Windows and macOS with the Python analysis engine bundled inside.

---

## Features

- Drag-and-drop or browse for ZEISS Quality Suite archives (.zip, .tgz)
- Automatic system type detection (ATOS Q, ARAMIS, GOM Scan, T-SCAN, ARGUS, etc.)
- 17 parsers covering versions, licensing, network, drivers, cameras, USB, logs, and more
- 8-pass error detection with severity levels (CRITICAL / WARNING / INFO)
- Knowledge base of 30+ known issue patterns (human-editable YAML)
- Export reports in HTML, Markdown, and PDF
- Light / dark theme
- Standalone desktop app -- no Python installation required

---

## Download

Go to [Releases](https://github.com/Trilion-Automation-Suite/t.SicView/releases) and download the installer for your platform:

| Platform | Asset |
|---|---|
| Windows | `t.SicView-*-Setup.exe` or `.zip` |
| macOS | `t.SicView-darwin-*.zip` |
| Python wheel | `t_sicview-*-py3-none-any.whl` |

---

## Target systems

ATOS Q, GOM Scan 1, GOM Scan Ports, T-SCAN, ATOS Q AWK, ARAMIS 4M, ARAMIS 12M, ARAMIS 24M, ARAMIS SRX, ARGUS

---

## Local development

### Prerequisites

- Python 3.9+
- Node.js 20+
- npm 10+

### Setup

```bash
git clone https://github.com/Trilion-Automation-Suite/t.SicView.git
cd t.SicView
pip install -e ".[dev]"
```

### Run the web UI (development)

```bash
python -m server.app
```

Opens at `http://127.0.0.1:8420`.

### Run tests

```bash
pytest                   # run once
pytest --cov             # with coverage
```

### Lint

```bash
ruff check gomsic_core server
```

---

## Building the standalone app

The standalone app bundles the Python engine inside an Electron shell. No Python installation is needed on the target machine.

```bash
# 1. Install Python + Node dependencies
pip install -e ".[server,standalone]"
cd standalone
npm install

# 2. Bundle the Python server via PyInstaller
npm run build-server

# 3. Build the Electron installer
npm run make
```

Output goes to `standalone/out/make/`.

---

## Deploying your own instance

The repo includes GitHub Actions workflows that build and release automatically.

### Automated releases

1. Tag a commit: `git tag v0.3.0 && git push --tags`
2. The **Release** workflow builds:
   - Python wheel (`.whl`)
   - Windows installer (`.exe`) and ZIP
   - macOS ZIP
3. All artifacts are attached to a GitHub Release

### GitHub Pages

The **Deploy** workflow publishes the web UI to GitHub Pages on every push to `main`. Note: the hosted page requires a running backend to parse archives -- the standalone app bundles everything.

---

## How it works

ZEISS Quality Suite report archives are ZIP files containing a `gomsic.tgz` (or raw tarballs) with 40+ diagnostic files in mixed formats (XML, CSV, INI, SQLite, log files, Windows Event Logs). t.SicView extracts and cross-references these files using 17 specialized parsers, then runs 8 detection passes against a YAML knowledge base to surface known issues and misconfigurations.

The Electron app runs a local FastAPI server as a sidecar process -- all processing happens on your machine, nothing is sent externally.

---

## Project structure

```
t.SicView/
  gomsic_core/       # Python analysis engine (17 parsers, error detection)
  knowledge_base/    # YAML rule definitions (patterns, drivers, NICs, licenses)
  server/            # FastAPI HTTP layer + web UI
  standalone/        # Electron desktop wrapper + PyInstaller config
  tests/             # Test suite with sample archives
  docs/              # Product requirements
```

---

## Contributing

See [CONTRIBUTING](/.github/pull_request_template.md) for the PR checklist. Bug reports and feature requests use the issue templates in this repo.

---

*Trilion Quality Systems -- ZEISS Certified Metrology Partner*
