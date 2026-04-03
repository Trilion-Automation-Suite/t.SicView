"""Parser for gomsoftware.cfg (T.O.M. configuration format).

Sources:
- gomsic/local-config/<version>/gomsoftware.cfg
- gomsic/config/<version>/ (other config files)

The T.O.M. config format is an XML-like structure with nested sections.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import GomSoftwareConfig
from .base import BaseParser

logger = logging.getLogger(__name__)


class GomSoftwareCfgParser(BaseParser):
    name = "gomsoftware_cfg"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[GomSoftwareConfig]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        # Look for gomsoftware.cfg in local-config/<version>/ directories
        cfg_files = self.find_files(layout.gomsic_dir, "local-config/*/gomsoftware.cfg")
        if not cfg_files:
            cfg_files = self.find_files(layout.gomsic_dir, "config/*/gomsoftware.cfg")
        if not cfg_files:
            ctx.skip("gomsoftware.cfg not found")
            return None

        # Use the most recent version (last in sorted order)
        cfg_path = cfg_files[-1]
        ctx.file_searched(str(cfg_path))
        ctx.file_found(str(cfg_path))

        text = self.read_text_file(cfg_path)
        if text is None:
            ctx.fail(f"Could not read {cfg_path}")
            return None

        ctx.file_parsed(str(cfg_path))

        config = GomSoftwareConfig(raw_text=text)
        config.sections = self._parse_tom_config(text)

        ctx.note(f"Parsed {len(config.sections)} top-level sections from {cfg_path.name}")
        return config

    def _parse_tom_config(self, text: str) -> dict[str, dict[str, Any]]:
        """Parse T.O.M. config format into nested dictionaries.

        The format is roughly:
            section_name {
                key = value
                subsection {
                    key = value
                }
            }
        """
        sections: dict[str, dict[str, Any]] = {}
        current_section: Optional[str] = None
        current_data: dict[str, Any] = {}
        brace_depth = 0

        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("//"):
                continue

            # Opening brace with section name
            open_match = re.match(r"^(\S+)\s*\{", stripped)
            if open_match and brace_depth == 0:
                current_section = open_match.group(1)
                current_data = {}
                brace_depth = 1
                continue

            if "{" in stripped:
                brace_depth += stripped.count("{")
            if "}" in stripped:
                brace_depth -= stripped.count("}")
                if brace_depth <= 0:
                    if current_section:
                        sections[current_section] = current_data
                    current_section = None
                    current_data = {}
                    brace_depth = 0
                continue

            # Key = value within a section
            if current_section and brace_depth == 1:
                kv_match = re.match(r"^(\S+)\s*=\s*(.*)$", stripped)
                if kv_match:
                    key = kv_match.group(1)
                    value = kv_match.group(2).strip().strip('"').strip("'")
                    current_data[key] = value

        return sections
