"""Parser for camera .gcs GenICam settings files.

Sources:
- tests/fixtures/EVT HB-25000SBM *.gcs (camera configuration snapshots)
- gomsic archives may contain these in camera-related directories

Format: Key-value pairs, one per line:
    Cust::DeviceVendorName = "EVT"
    Cust::GevSCPSPacketSize = "7716"
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import CameraConfig, CameraInfo
from .base import BaseParser

logger = logging.getLogger(__name__)


class GCSParser(BaseParser):
    name = "gcs_camera_settings"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[list[dict[str, str]]]:
        """Parse .gcs camera settings files found in the archive.

        Returns a list of parsed camera setting dicts, or None if no .gcs found.
        These are merged into the CameraInfo by the API layer.
        """
        gcs_files: list[Path] = []

        # Search in gomsic directory and subdirectories
        if layout.gomsic_dir:
            gcs_files.extend(self.find_files(layout.gomsic_dir, "*.gcs"))
            for subdir in ("cameras", "config", "all-config"):
                d = layout.gomsic_dir / subdir
                if d.is_dir():
                    gcs_files.extend(self.find_files(d, "**/*.gcs"))

        for f in gcs_files:
            ctx.file_searched(str(f))
            ctx.file_found(str(f))

        if not gcs_files:
            ctx.skip("No .gcs camera settings files found in archive")
            return None

        results = []
        for gcs_file in gcs_files:
            settings = self._parse_gcs(gcs_file)
            if settings:
                ctx.file_parsed(str(gcs_file))
                results.append(settings)

        ctx.note(f"Parsed {len(results)} .gcs camera settings files")
        return results if results else None

    def _parse_gcs(self, path: Path) -> Optional[dict[str, str]]:
        """Parse a single .gcs file into a dict of key-value pairs."""
        text = self.read_text_file(path)
        if text is None:
            return None

        settings: dict[str, str] = {}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            match = re.match(r'^(?:Cust::)?(\w+)\s*=\s*"?([^"]*)"?\s*$', line)
            if match:
                settings[match.group(1)] = match.group(2)

        return settings if settings else None
