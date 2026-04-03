/**
 * t.SicView - Electron Main Process
 *
 * Lifecycle:
 * 1. Show splash screen
 * 2. Spawn the bundled Python FastAPI server (PyInstaller output)
 * 3. Poll the health endpoint until the server is ready
 * 4. Load the web UI in the main window
 * 5. On close, gracefully kill the Python process
 */

const { app, BrowserWindow, dialog, Menu, Tray, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// Handle Squirrel installer events (Windows)
if (require('electron-squirrel-startup')) app.quit();

// --- Configuration ---
const SERVER_PORT = 8420;
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/api/health`;
const UI_URL = `http://127.0.0.1:${SERVER_PORT}/`;
const HEALTH_POLL_INTERVAL_MS = 300;
const HEALTH_TIMEOUT_MS = 30000;

let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let isQuitting = false;

// --- Server Path Resolution ---
function getServerPath() {
  // In packaged app: resources/gomsic_server/gomsic_server.exe
  // In development: ../build/dist/gomsic_server/gomsic_server.exe (or run via python)
  const possiblePaths = [
    // Packaged (extraResource)
    path.join(process.resourcesPath, 'gomsic_server', 'gomsic_server.exe'),
    // Packaged (alternate layout)
    path.join(process.resourcesPath, 'gomsic_server', 'gomsic_server'),
    // Development (PyInstaller output)
    path.join(__dirname, 'build', 'dist', 'gomsic_server', 'gomsic_server.exe'),
    path.join(__dirname, 'build', 'dist', 'gomsic_server', 'gomsic_server'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// --- Splash Screen ---
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#25283d',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><style>
      body {
        margin: 0; display: flex; flex-direction: column;
        justify-content: center; align-items: center; height: 100vh;
        background: #25283d; color: #ddd1c7;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }
      h1 { font-size: 1.6rem; margin-bottom: 0.3rem; }
      .sub { color: #8a8a8a; font-size: 0.85rem; margin-bottom: 1.5rem; }
      .spinner {
        width: 32px; height: 32px; border: 3px solid #3d4060;
        border-top-color: #cc0000; border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .status { color: #8a8a8a; font-size: 0.75rem; margin-top: 1rem; }
    </style></head>
    <body>
      <h1>t.SicView</h1>
      <div class="sub">Trilion Quality Systems</div>
      <div class="spinner"></div>
      <div class="status">Starting server...</div>
    </body>
    </html>
  `)}`);

  return splashWindow;
}

// --- Main Window ---
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#25283d',
    title: 't.SicView',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;  // Set BEFORE killing server to suppress exit dialog
      shutdownServer().then(() => {
        app.quit();
      });
    }
  });

  return mainWindow;
}

// --- Server Lifecycle ---
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();

    if (serverPath) {
      // Bundled mode: run the PyInstaller executable
      console.log(`Starting bundled server: ${serverPath}`);
      serverProcess = spawn(serverPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, GOMSIC_PORT: String(SERVER_PORT) },
      });
    } else {
      // Development mode: run via python
      console.log('No bundled server found, starting in dev mode via python');
      const pythonScript = path.join(__dirname, '..', 'server', 'app.py');
      serverProcess = spawn('python', [pythonScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, GOMSIC_PORT: String(SERVER_PORT) },
      });
    }

    serverProcess.stdout.on('data', (data) => {
      console.log(`[server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[server] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
      if (!isQuitting) {
        dialog.showErrorBox(
          'Server Error',
          `The t.SicView server exited unexpectedly (code ${code}).\nThe application will close.`
        );
        isQuitting = true;
        app.quit();
      }
    });

    resolve();
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function poll() {
      if (Date.now() - startTime > HEALTH_TIMEOUT_MS) {
        reject(new Error('Server did not start within timeout'));
        return;
      }

      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
        }
      });

      req.on('error', () => {
        setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
      });
    }

    poll();
  });
}

async function shutdownServer() {
  if (serverProcess && !serverProcess.killed) {
    console.log('Shutting down server...');
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill on Windows via taskkill if still alive
        if (serverProcess && !serverProcess.killed) {
          console.log('Force-killing server');
          try {
            if (process.platform === 'win32') {
              require('child_process').execSync(`taskkill /F /T /PID ${serverProcess.pid}`, { stdio: 'ignore' });
            } else {
              serverProcess.kill('SIGKILL');
            }
          } catch (e) { /* process already dead */ }
        }
        resolve();
      }, 3000);

      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Try graceful kill (on Windows this terminates the process tree)
      try {
        if (process.platform === 'win32') {
          require('child_process').exec(`taskkill /PID ${serverProcess.pid}`, { stdio: 'ignore' });
        } else {
          serverProcess.kill('SIGTERM');
        }
      } catch (e) { /* process already dead */ }
    });
  }
}

// --- App Lifecycle ---
app.whenReady().then(async () => {
  createSplashWindow();
  createMainWindow();

  try {
    await startServer();
    await waitForServer();

    // Server is ready -- load the UI
    mainWindow.loadURL(UI_URL);

    mainWindow.once('ready-to-show', () => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    });
  } catch (err) {
    console.error('Startup failed:', err);
    if (splashWindow) splashWindow.close();
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start t.SicView:\n${err.message}\n\nMake sure the server is built (npm run build-server).`
    );
    isQuitting = true;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    app.quit();
  }
});

app.on('before-quit', async () => {
  await shutdownServer();
});
