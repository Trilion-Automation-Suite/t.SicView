"""FastAPI server for t.SicView.

Provides HTTP endpoints for the web UI:
- POST /api/parse - Upload and parse an archive
- GET /api/health - Health check
- GET / - Serve the web UI
"""

from __future__ import annotations

import base64
import json
import os
import tempfile
import traceback
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse

from gomsic_core import __version__
from gomsic_core.api import parse_archive
from gomsic_core.models import ProductType

app = FastAPI(
    title="t.SicView",
    description="Diagnostic viewer for ZEISS Quality Suite support archives",
    version=__version__,
)

# Paths -- support both development and PyInstaller bundled mode
_STATIC_DIR = Path(os.environ.get("GOMSIC_STATIC_DIR", Path(__file__).parent / "static"))
_RESOURCES_DIR = Path(os.environ.get(
    "GOMSIC_RESOURCES_DIR",
    Path(__file__).parent.parent.parent / "resources",  # TrilionSuite/resources/
))
_KB_DIR = os.environ.get("GOMSIC_KB_DIR")  # None = use default in api.py


@app.get("/api/logo/{variant}")
async def logo(variant: str = "dark"):
    """Serve the Trilion logo as base64 data URI."""
    if variant == "white":
        logo_path = _RESOURCES_DIR / "Images" / "trilion-logo-2017_RGB-white-medium.png"
    else:
        logo_path = _RESOURCES_DIR / "Images" / "trilion-logo-2017_RGB-medium.png"
    if logo_path.is_file():
        b64 = base64.b64encode(logo_path.read_bytes()).decode()
        return {"data_uri": f"data:image/png;base64,{b64}"}
    return {"data_uri": ""}


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": __version__}


@app.post("/api/parse")
async def parse(
    file: UploadFile = File(...),
    product: str = Form("Unknown"),
    description: str = Form(""),
):
    """Upload and parse a ZEISS Quality Suite archive."""
    MAX_UPLOAD_SIZE = 500 * 1024 * 1024  # 500 MB
    suffix = Path(file.filename or "archive.zip").suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        total_size = 0
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_SIZE:
                tmp.close()
                os.unlink(tmp.name)
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"File too large (max {MAX_UPLOAD_SIZE // (1024*1024)} MB)"},
                )
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        kb = Path(_KB_DIR) if _KB_DIR else None
        result = parse_archive(tmp_path, product=product, description=description or None,
                               knowledge_base_dir=kb)
        return JSONResponse(content=json.loads(result.model_dump_json()))
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ERROR] Parse failed: {e}\n{tb}")
        return JSONResponse(
            status_code=500,
            content={"detail": str(e), "traceback": tb},
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the web UI."""
    index = _STATIC_DIR / "index.html"
    if index.is_file():
        return HTMLResponse(content=index.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>index.html not found</h1>", status_code=500)


if __name__ == "__main__":
    port = int(os.environ.get("GOMSIC_PORT", "8420"))
    uvicorn.run(app, host="127.0.0.1", port=port)
