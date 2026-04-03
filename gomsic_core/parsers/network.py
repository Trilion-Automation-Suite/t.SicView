"""Parser for network adapter configuration from nics.log.

nics.log contains THREE concatenated command outputs, each preceded by a
header line and a ``---`` delimiter:

1. ``ipconfig /all`` -- standard Windows IP configuration
2. ``netsh interface ipv4 show interfaces`` -- MTU / interface state table
3. PowerShell ``get-netadapteradvancedproperty`` -- advanced NIC properties

Sections are separated by headers matching::

    starting '<command>' with arguments '<args>'
    ---

Each section ends with::

    ---
    Exit code: <N>

Encoding varies across archives: the ZIP fixture uses plain UTF-8 while
older .tgz fixtures may use UTF-16 LE.  The parser tries UTF-16 first and
falls back to UTF-8.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import NetworkAdapter, NetworkInfo
from .base import BaseParser

logger = logging.getLogger(__name__)

# Pattern to split nics.log into command sections
_COMMAND_HEADER = re.compile(
    r"^starting\s+'(.+?)'\s+with\s+arguments\s+'(.*?)'",
    re.MULTILINE,
)

# Matches an ipconfig adapter header, e.g.:
#   Ethernet adapter Ethernet 2:
#   Wireless LAN adapter Wi-Fi:
_ADAPTER_HEADER = re.compile(
    r"^(\S.*?(?:adapter|Adapter)\s+.+?):\s*$",
    re.MULTILINE,
)

# Key : Value lines inside ipconfig sections (dots used as filler).
# e.g.: "   Description . . . . . . . . . . . : Mellanox ConnectX-5 Adapter"
# The key capture ends at a non-space/non-dot char, then dot-space filler
# runs until the colon.  Uses [ .] (not \s) to avoid spanning newlines.
_KV_LINE = re.compile(r"^[ \t]+(.+?[^ .])[ .]+: (.+)$", re.MULTILINE)

# Netsh table data row (fixed-width columns):
#   Idx   Met        MTU         State               Name
_NETSH_ROW = re.compile(
    r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$",
    re.MULTILINE,
)


class NetworkParser(BaseParser):
    name = "network"

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[NetworkInfo]:
        if layout.gomsic_dir is None:
            ctx.skip("gomsic directory not found")
            return None

        nics_path = layout.gomsic_dir / "nics.log"
        ctx.file_searched(str(nics_path))

        if not nics_path.is_file():
            ctx.skip("nics.log not found")
            return None

        ctx.file_found(str(nics_path))

        text = self._read_nics_file(nics_path)
        if text is None:
            ctx.fail("Could not read nics.log")
            return None

        # Normalize line endings -- Windows \r\n and stray \r cause regex issues
        text = text.replace("\r\n", "\n").replace("\r", "\n")

        ctx.note("Read nics.log successfully")
        ctx.file_parsed(str(nics_path))

        info = NetworkInfo()

        # Split into command sections
        sections = self._split_command_sections(text)
        ctx.note(f"Found {len(sections)} command sections in nics.log")

        # 1. Parse ipconfig /all
        ipconfig_text = sections.get("ipconfig", "")
        if ipconfig_text:
            self._parse_ipconfig(ipconfig_text, info)
            ctx.note(f"Parsed ipconfig: {len(info.adapters)} adapters")

        # 2. Parse netsh interface table for MTU and connection state
        netsh_text = sections.get("netsh", "")
        if netsh_text:
            netsh_map = self._parse_netsh(netsh_text)
            self._apply_netsh_data(netsh_map, info)
            ctx.note(f"Parsed netsh: {len(netsh_map)} interfaces with MTU/state")

        # 3. Parse PowerShell advanced properties
        ps_text = sections.get("powershell", "")
        if ps_text:
            self._parse_advanced_properties(ps_text, info)
            ctx.note("Parsed PowerShell advanced properties")

        return info if info.adapters else None

    # ------------------------------------------------------------------
    # File reading with encoding detection
    # ------------------------------------------------------------------

    def _read_nics_file(self, path: Path) -> Optional[str]:
        """Read nics.log with automatic encoding detection.

        Checks for a UTF-16 BOM first.  If none is found, reads as UTF-8.
        This avoids the pitfall where ``read_utf16_file`` silently mis-decodes
        plain UTF-8 data as UTF-16 when the file has an even byte count.
        """
        raw = path.read_bytes()
        if not raw:
            return None

        # UTF-16 LE BOM
        if raw[:2] == b"\xff\xfe":
            try:
                return raw.decode("utf-16-le")
            except UnicodeDecodeError:
                pass

        # UTF-16 BE BOM
        if raw[:2] == b"\xfe\xff":
            try:
                return raw.decode("utf-16-be")
            except UnicodeDecodeError:
                pass

        # No BOM -- treat as UTF-8 (the common case for nics.log)
        return raw.decode("utf-8", errors="replace")

    # ------------------------------------------------------------------
    # Section splitting
    # ------------------------------------------------------------------

    def _split_command_sections(self, text: str) -> dict[str, str]:
        """Split nics.log into named command sections.

        Each section starts with a ``starting '...' with arguments '...'``
        header followed by a ``---`` delimiter.  The section body runs until
        the next header (or end of file).  Trailing ``---\\nExit code: N``
        footers are stripped from each body.
        """
        sections: dict[str, str] = {}
        matches = list(_COMMAND_HEADER.finditer(text))

        if not matches:
            # No command headers found; treat entire text as ipconfig
            sections["ipconfig"] = text
            return sections

        for i, match in enumerate(matches):
            cmd = match.group(1).lower()
            args = match.group(2).lower()
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            section_text = text[start:end].strip()

            # Strip the leading '---' delimiter right after the header
            if section_text.startswith("---"):
                section_text = section_text[3:].strip()

            # Strip trailing '---\nExit code: N' footer
            section_text = re.sub(
                r"\n---\s*\nExit code:\s*\d+\s*$", "", section_text
            ).strip()

            if "ipconfig" in cmd:
                sections["ipconfig"] = section_text
            elif "netsh" in cmd:
                sections["netsh"] = section_text
            elif "powershell" in cmd or "get-netadapter" in args:
                sections["powershell"] = section_text
            else:
                sections[cmd] = section_text

        return sections

    # ------------------------------------------------------------------
    # ipconfig /all parsing
    # ------------------------------------------------------------------

    def _parse_ipconfig(self, text: str, info: NetworkInfo) -> None:
        """Parse ``ipconfig /all`` output into :class:`NetworkAdapter` objects."""
        parts = _ADAPTER_HEADER.split(text)

        # First element is the global/header section (hostname, etc.)
        if parts:
            self._parse_global_section(parts[0], info)

        # Remaining parts are (adapter_header, adapter_body) pairs
        for i in range(1, len(parts), 2):
            adapter_name = parts[i].strip()
            adapter_body = parts[i + 1] if i + 1 < len(parts) else ""
            adapter = self._parse_adapter_section(adapter_name, adapter_body)
            info.adapters.append(adapter)

    def _parse_global_section(self, text: str, info: NetworkInfo) -> None:
        """Extract hostname and domain from the global ipconfig header."""
        host_match = re.search(
            r"Host\s*Name[ .]+: (.+)", text, re.IGNORECASE
        )
        if host_match:
            info.hostname = host_match.group(1).strip()

        domain_match = re.search(
            r"Primary\s*Dns\s*Suffix[ .]+: (.+)", text, re.IGNORECASE
        )
        if domain_match:
            val = domain_match.group(1).strip()
            if val:
                info.domain = val

    def _parse_adapter_section(self, name: str, body: str) -> NetworkAdapter:
        """Parse a single ipconfig adapter section into a :class:`NetworkAdapter`."""
        adapter = NetworkAdapter(name=name)

        # Parse per-line to handle empty values correctly
        for line in body.splitlines():
            match = _KV_LINE.match(line.rstrip())
            if not match:
                continue
            key = match.group(1).strip().rstrip(".")
            value = match.group(2).strip()
            key_lower = key.lower()

            if "description" in key_lower:
                adapter.description = value
            elif "physical address" in key_lower or "physische adresse" in key_lower:
                adapter.mac_address = value
            elif "ipv4 address" in key_lower or key_lower == "ip address":
                addr = re.sub(r"\(.*?\)", "", value).strip()
                if addr:
                    adapter.ip_addresses.append(addr)
            elif "subnet mask" in key_lower:
                if value:
                    adapter.subnet_masks.append(value)
            elif "default gateway" in key_lower and value:
                adapter.default_gateway = value
            elif "dhcp enabled" in key_lower:
                adapter.dhcp_enabled = value.lower() in ("yes", "ja", "true")
            elif "dns server" in key_lower and value:
                adapter.dns_servers = [s.strip() for s in value.split(",") if s.strip()]

        return adapter

    # ------------------------------------------------------------------
    # netsh interface ipv4 show interfaces parsing
    # ------------------------------------------------------------------

    def _parse_netsh(self, text: str) -> dict[str, dict[str, str]]:
        """Parse the netsh table and return ``{adapter_name: {mtu, state}}``."""
        netsh_map: dict[str, dict[str, str]] = {}
        for match in _NETSH_ROW.finditer(text):
            # Groups: idx, met, mtu, state, name
            name = match.group(5).strip()
            mtu = match.group(3).strip()
            state = match.group(4).strip()
            netsh_map[name] = {"mtu": mtu, "state": state}
        return netsh_map

    def _apply_netsh_data(self, netsh_map: dict[str, dict[str, str]], info: NetworkInfo) -> None:
        """Store MTU and connection state on matching adapters."""
        for adapter in info.adapters:
            short_name = self._extract_short_name(adapter.name)
            if short_name in netsh_map:
                data = netsh_map[short_name]
                adapter.advanced_properties["MTU"] = data["mtu"]
                if data.get("state"):
                    adapter.advanced_properties["_ConnectionState"] = data["state"]

    # ------------------------------------------------------------------
    # PowerShell advanced properties parsing
    # ------------------------------------------------------------------

    def _parse_advanced_properties(self, text: str, info: NetworkInfo) -> None:
        """Parse PowerShell ``Get-NetAdapterAdvancedProperty`` table output.

        The table is space-aligned with columns detected from the header /
        dash underline rows.  We extract ``(ValueName, ValueData, ifAlias,
        ifDesc)`` for each data row, strip the ``*`` prefix from property
        names and ``{...}`` braces from values, then merge into matching
        adapters by ``ifAlias``.
        """
        lines = text.splitlines()

        # Locate the header and dash lines
        header_idx: Optional[int] = None
        for i, line in enumerate(lines):
            stripped = line.rstrip()
            if stripped.startswith("ValueName") and "ifAlias" in stripped:
                header_idx = i
                break

        if header_idx is None or header_idx + 1 >= len(lines):
            return

        header_line = lines[header_idx]
        dash_line = lines[header_idx + 1]

        # Determine column positions from the dash line
        col_positions = self._detect_column_positions(dash_line)
        if len(col_positions) < 6:
            logger.warning(
                "PowerShell table has fewer than 6 columns (%d detected)",
                len(col_positions),
            )
            return

        # Map column names to positions
        col_names = self._extract_column_names(header_line, col_positions)

        # Find indices for the columns we need
        idx_valuename = self._find_col_index(col_names, "valuename")
        idx_valuedata = self._find_col_index(col_names, "valuedata")
        idx_ifalias = self._find_col_index(col_names, "ifalias")
        idx_ifdesc = self._find_col_index(col_names, "ifdesc")

        if any(
            idx is None
            for idx in (idx_valuename, idx_valuedata, idx_ifalias, idx_ifdesc)
        ):
            logger.warning("Could not locate required columns in PS table")
            return

        # Collect properties per ifAlias
        # {ifAlias: {prop_name: prop_value}}
        alias_props: dict[str, dict[str, str]] = {}

        for line in lines[header_idx + 2 :]:
            stripped = line.rstrip()
            if not stripped:
                continue
            # Skip footer lines like "---" or "Exit code: ..."
            if stripped.startswith("---") or stripped.startswith("Exit code"):
                continue

            fields = self._extract_fields(stripped, col_positions)
            if len(fields) <= max(idx_valuename, idx_valuedata, idx_ifalias, idx_ifdesc):  # type: ignore[arg-type]
                continue

            raw_name = fields[idx_valuename].strip()  # type: ignore[index]
            raw_value = fields[idx_valuedata].strip()  # type: ignore[index]
            alias = fields[idx_ifalias].strip()  # type: ignore[index]

            if not raw_name or not alias:
                continue

            # Strip leading '*' from property names
            prop_name = raw_name.lstrip("*")

            # Strip curly braces from values: {3} -> 3, {0, 1, 2, 3} -> 0, 1, 2, 3
            prop_value = self._strip_braces(raw_value)

            if alias not in alias_props:
                alias_props[alias] = {}
            alias_props[alias][prop_name] = prop_value

        # Match ifAlias to existing adapters by short name
        for adapter in info.adapters:
            short_name = self._extract_short_name(adapter.name)
            if short_name in alias_props:
                adapter.advanced_properties.update(alias_props[short_name])

    def _detect_column_positions(self, dash_line: str) -> list[tuple[int, int]]:
        """Return ``[(start, end), ...]`` for each column from the dash underline.

        The dash line looks like::

            ---------                           --------- -------- ...

        Each contiguous run of ``-`` characters marks a column.
        """
        positions: list[tuple[int, int]] = []
        i = 0
        n = len(dash_line)
        while i < n:
            if dash_line[i] == "-":
                start = i
                while i < n and dash_line[i] == "-":
                    i += 1
                positions.append((start, i))
            else:
                i += 1
        return positions

    def _extract_column_names(
        self, header_line: str, col_positions: list[tuple[int, int]]
    ) -> list[str]:
        """Extract column names from the header using detected positions."""
        names: list[str] = []
        for start, end in col_positions:
            name = header_line[start:end].strip() if start < len(header_line) else ""
            names.append(name.lower())
        return names

    def _extract_fields(
        self, line: str, col_positions: list[tuple[int, int]]
    ) -> list[str]:
        """Extract field values from a data row using column positions.

        For all columns except the last, the field runs from this column's
        start to the next column's start.  For the last column the field
        runs to end-of-line.
        """
        fields: list[str] = []
        for i, (start, _end) in enumerate(col_positions):
            if i + 1 < len(col_positions):
                field_end = col_positions[i + 1][0]
            else:
                field_end = len(line)
            field = line[start:field_end] if start < len(line) else ""
            fields.append(field.rstrip())
        return fields

    @staticmethod
    def _find_col_index(col_names: list[str], target: str) -> Optional[int]:
        """Find the index of *target* in *col_names* (case-insensitive)."""
        for i, name in enumerate(col_names):
            if name == target:
                return i
        return None

    @staticmethod
    def _strip_braces(value: str) -> str:
        """Strip ``{...}`` braces from a PowerShell value string."""
        if value.startswith("{") and value.endswith("}"):
            return value[1:-1]
        return value

    @staticmethod
    def _extract_short_name(adapter_header: str) -> str:
        """Extract the short adapter name from an ipconfig adapter header.

        ``Ethernet adapter Ethernet 2`` -> ``Ethernet 2``
        ``Wireless LAN adapter Wi-Fi``  -> ``Wi-Fi``
        """
        match = re.match(
            r"(?:Ethernet|Wireless\s+LAN|PPP|Unknown)\s+adapter\s+(.+)",
            adapter_header,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()
        return adapter_header.strip()
