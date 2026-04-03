# GOMSic Parser - Standalone Desktop App

Electron desktop wrapper for the GOMSic Parser. Bundles the Python FastAPI
server as a sidecar process so the app runs on a clean Windows machine
without requiring a Python installation.

## Architecture

```
Electron App (.exe)
  |
  +-- main.js (spawns Python sidecar, manages lifecycle)
  +-- preload.js (minimal bridge to renderer)
  +-- gomsic_server/ (PyInstaller bundle)
  |     +-- gomsic_server.exe
  |     +-- knowledge_base/ (YAML rules)
  |     +-- server/static/ (web UI)
  |     +-- resources/Images/ (logos)
  |     +-- (Python runtime + dependencies)
  +-- BrowserWindow -> http://127.0.0.1:8420/
```

## Quick Start (Development Mode)

Dev mode runs Electron against your live Python code -- no PyInstaller
needed, changes take effect immediately.

```powershell
# 1. Install Python package (from gomsic-parser root)
cd C:\Repo\TrilionSuite\gomsic-parser
pip install -e .

# 2. Install Node dependencies
cd standalone
npm install

# 3. Run
npm start
```

Electron spawns `python server/app.py` directly and opens a window to
`http://127.0.0.1:8420/`.

## Web-Only Mode (No Electron Needed)

If you just want the web UI in a browser:

```powershell
cd C:\Repo\TrilionSuite\gomsic-parser
pip install -e .
python -m uvicorn server.app:app --host 127.0.0.1 --port 8420
```

Then open `http://localhost:8420` in your browser.

## Full Build (Windows Installer)

Building the distributable .exe requires three stages: install dependencies,
bundle the Python server with PyInstaller, then package with Electron Forge.

### Prerequisites

- **Node.js** >= 18 (for Electron)
- **Python** >= 3.9 with pip
- **PyInstaller** (`pip install pyinstaller`)

### Step 1: Install everything

```powershell
# From gomsic-parser root
cd C:\Repo\TrilionSuite\gomsic-parser
pip install -e .
pip install pyinstaller

cd standalone
npm install
```

### Step 2: Bundle the Python server

**Important:** Run from the `standalone/` directory. The `--distpath` and
`--workpath` flags are required so the output lands in `build/dist/` where
Electron Forge expects it.

```powershell
cd C:\Repo\TrilionSuite\gomsic-parser\standalone
python -m PyInstaller --noconfirm --distpath build/dist --workpath build/work build/gomsic_server.spec
```

Or use the npm script shortcut:

```powershell
npm run build-server
```

> **Windows Store Python note:** If `pyinstaller` is not recognized as a
> command, use `python -m PyInstaller` instead. The Windows Store Python
> install does not always add Scripts/ to PATH.

This creates `standalone/build/dist/gomsic_server/` containing
`gomsic_server.exe` and all bundled dependencies. The Electron packager
expects this directory to exist -- if you skip this step, `npm run make`
will fail with `ENOENT: ...build\dist\gomsic_server`.

### Step 3: Package for distribution

```powershell
cd C:\Repo\TrilionSuite\gomsic-parser\standalone
npm run make
```

Creates a Windows installer in `standalone/out/make/`.

### All-in-one (copy-paste)

```powershell
cd C:\Repo\TrilionSuite\gomsic-parser
pip install -e .
pip install pyinstaller
cd standalone
npm install
npm run build-server
npm run make
```

## How It Works

1. **Splash screen** appears with Trilion branding while the server starts
2. **Python sidecar** is spawned (PyInstaller .exe in packaged mode, `python` in dev)
3. **Health polling** checks `http://127.0.0.1:8420/api/health` every 300ms
4. **Main window** loads the web UI once the server responds
5. **On close**, the server process is gracefully terminated (SIGTERM, then SIGKILL after 3s)

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `GOMSIC_PORT` | `8420` | Server port |
| `GOMSIC_HOST` | `127.0.0.1` | Server host |
| `GOMSIC_KB_DIR` | (bundled) | Knowledge base directory |
| `GOMSIC_STATIC_DIR` | (bundled) | Static files directory |
| `GOMSIC_RESOURCES_DIR` | (bundled) | Resources directory (logos) |

## Assets

Place `icon.ico` and `icon.png` in `standalone/assets/` for the app icon.
The Trilion logo is loaded at runtime from the resources directory.

## Troubleshooting

- **`pyinstaller` not recognized:** Use `python -m PyInstaller` instead.
  The Windows Store Python does not always put Scripts/ on PATH.
- **`ENOENT: ...build\dist\gomsic_server`:** You skipped Step 2. Run the
  PyInstaller command first -- `npm run make` needs the bundled server.
- **"Server did not start within timeout":** Check the console for Python
  errors. In dev mode, ensure `pip install -e .` was run from the
  `gomsic-parser/` root directory.
- **Port conflict:** Set `GOMSIC_PORT=8421` or another free port.
- **PyInstaller hidden import errors:** Add missing modules to the
  `hiddenimports` list in `build/gomsic_server.spec`.
