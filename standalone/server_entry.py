"""Standalone entry point for the t.SicView server.

This is the script that PyInstaller bundles into gomsic_server.exe.
It starts the FastAPI server with uvicorn, using the port from the
GOMSIC_PORT environment variable (default 8420).

When running as a PyInstaller bundle, it adjusts sys.path and the
knowledge_base/static file paths to find bundled data files.
"""

import os
import sys

# PyInstaller sets _MEIPASS for bundled mode
_BUNDLED = getattr(sys, '_MEIPASS', None)

if _BUNDLED:
    # Add the bundle directory to sys.path so imports work
    sys.path.insert(0, _BUNDLED)

    # Patch the knowledge_base path used by the API
    os.environ['GOMSIC_KB_DIR'] = os.path.join(_BUNDLED, 'knowledge_base')
    os.environ['GOMSIC_STATIC_DIR'] = os.path.join(_BUNDLED, 'server', 'static')
    os.environ['GOMSIC_RESOURCES_DIR'] = os.path.join(_BUNDLED, 'resources')


def main():
    import uvicorn

    port = int(os.environ.get('GOMSIC_PORT', '8420'))
    host = os.environ.get('GOMSIC_HOST', '127.0.0.1')

    print(f"t.SicView server starting on {host}:{port}")

    # Import the app after path setup
    from server.app import app  # noqa: E402

    uvicorn.run(app, host=host, port=port, log_level='info')


if __name__ == '__main__':
    main()
