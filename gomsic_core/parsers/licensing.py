"""Parser for licensing information.

Sources:
- ZQS/License/licenses.csv (semicolon-delimited)
- ZQS/License/dongles.csv (key=value format)
- ZQS/InstalledSoftware/ZEISS-INSPECT_*.json (license manifest)
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import DongleInfo, LicenseEntry, LicenseInfo
from .base import BaseParser

logger = logging.getLogger(__name__)


class LicensingParser(BaseParser):
    name = "licensing"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[LicenseInfo]:
        info = LicenseInfo()
        found_any = False

        # licenses.csv
        if layout.zqs_license_dir:
            licenses_csv = layout.zqs_license_dir / "licenses.csv"
            ctx.file_searched(str(licenses_csv))
            if licenses_csv.is_file():
                ctx.file_found(str(licenses_csv))
                self._parse_licenses_csv(licenses_csv, info, ctx)
                found_any = True

        # dongles.csv
        if layout.zqs_license_dir:
            dongles_csv = layout.zqs_license_dir / "dongles.csv"
            ctx.file_searched(str(dongles_csv))
            if dongles_csv.is_file():
                ctx.file_found(str(dongles_csv))
                self._parse_dongles_csv(dongles_csv, info, ctx)
                found_any = True

        # Gomsic-level fallback for licenses.csv / dongles.csv (raw .tgz)
        if not found_any and layout.gomsic_dir:
            for csv_name in ["licenses.csv", "dongles.csv"]:
                csv_path = layout.gomsic_dir / csv_name
                ctx.file_searched(str(csv_path))
                if csv_path.is_file():
                    ctx.file_found(str(csv_path))
                    if csv_name == "licenses.csv":
                        self._parse_licenses_csv(csv_path, info, ctx)
                    else:
                        self._parse_dongles_csv(csv_path, info, ctx)
                    found_any = True

        # License manifest JSON
        if layout.zqs_installed_software_dir:
            for mf in self.find_files(layout.zqs_installed_software_dir, "ZEISS-INSPECT_*.json"):
                ctx.file_searched(str(mf))
                try:
                    data = json.loads(mf.read_text(encoding="utf-8"))
                    ctx.file_found(str(mf))
                    ctx.file_parsed(str(mf))
                    info.license_manifest = data
                    self._extract_licensed_products(data, info)
                    found_any = True
                except (json.JSONDecodeError, OSError) as e:
                    ctx.note(f"Failed to parse manifest: {e}")

        # Fallback: license_info.log (search gomsic root, log dir, all-config, and recursively)
        if not found_any and layout.gomsic_dir:
            # Try common locations first
            search_dirs = [layout.gomsic_dir, layout.gomsic_log_dir]
            # Also check all-config and local-config
            for sub in ("all-config", "local-config", "config"):
                p = layout.gomsic_dir / sub
                if p.is_dir():
                    search_dirs.append(p)

            found_lic_log = False
            for search_dir in search_dirs:
                if search_dir is None:
                    continue
                lic_info_path = search_dir / "license_info.log"
                ctx.file_searched(str(lic_info_path))
                if lic_info_path.is_file():
                    ctx.file_found(str(lic_info_path))
                    self._parse_license_info_log(lic_info_path, info, ctx)
                    if info.licenses or info.dongles:
                        found_any = True
                    found_lic_log = True
                    break

            # Recursive search if not found in common locations
            if not found_lic_log:
                for lic_path in self.find_files(layout.gomsic_dir, "**/license_info.log"):
                    ctx.file_searched(str(lic_path))
                    ctx.file_found(str(lic_path))
                    self._parse_license_info_log(lic_path, info, ctx)
                    if info.licenses or info.dongles:
                        found_any = True
                    break

        # Fallback: extract license info from ZEISS_INSPECT application logs
        if not found_any and layout.gomsic_log_dir:
            self._parse_app_log_licenses(layout, info, ctx)
            if info.licenses or info.dongles:
                found_any = True

        # Last resort: scan ALL .log files in gomsic dir for license patterns
        if not found_any and layout.gomsic_dir:
            for log_path in self.find_files(layout.gomsic_dir, "*.log"):
                text = self.read_text_file(log_path)
                if text and re.search(r"found dongle|license.*package|consuming license", text, re.IGNORECASE):
                    ctx.file_searched(str(log_path))
                    ctx.file_found(str(log_path))
                    self._parse_license_info_log(log_path, info, ctx)
                    if info.licenses or info.dongles:
                        found_any = True
                        break

        return info if found_any else None

    def _parse_license_info_log(self, path, info: LicenseInfo, ctx: ParserTraceContext) -> None:
        """Parse license_info.log for dongle and license package data.

        Format:
            15:33:59 found dongle '3-6724224' (fc=100473, cmact=1000)
            15:33:59   dongle is locally connected
            15:33:59   dongle has 2 packages:
            15:33:59     ZEISS INSPECT Correlate - Pro (1, never expires)
            15:33:59     ZEISS INSPECT Correlate - Pro Line (1, never expires)
        """
        text = self.read_text_file(path)
        if not text:
            return

        # Dongle serial
        m = re.search(r"found dongle '([^']+)'", text)
        if m and not info.dongles:
            serial = m.group(1)
            info.dongles.append(DongleInfo(dongle_type="WIBU", serial=serial))

        # License packages: "15:33:59     ZEISS INSPECT Correlate - Pro (1, never expires)"
        # Format: timestamp + spaces + product name + (quantity, expiry)
        for pm in re.finditer(r"^\d{2}:\d{2}:\d{2}\s{4,}(.+?)\s+\((\d+),\s*([^)]+)\)", text, re.MULTILINE):
            product_name = pm.group(1).strip()
            quantity = pm.group(2)
            expiry = pm.group(3).strip()
            entry = LicenseEntry(
                product=product_name,
                expiry=expiry if expiry != "never expires" else "Permanent",
                license_type="CodeMeter",
                raw_fields={"quantity": quantity, "expiry_raw": pm.group(3).strip()},
            )
            info.licenses.append(entry)
            if product_name not in info.licensed_products:
                info.licensed_products.append(product_name)

        ctx.file_parsed(str(path))
        ctx.note(f"license_info.log: {len(info.dongles)} dongles, {len(info.licenses)} packages")

    def _parse_app_log_licenses(self, layout: ArchiveLayout, info: LicenseInfo, ctx: ParserTraceContext) -> None:
        """Extract license data from ZEISS_INSPECT-*.log application logs.

        Parses lines like:
          [license] Dongles changed event: [WIBU=3-7335918]
          [license] Successfully consumed Z_INSPECT_correlate (2026) from no-net.
          [license] Active licenses (5): correlate,inspect-pro,adv-correlate,...
          [license] On demand licenses (2): sensor-aramis,sensor-aramis-24m
          [license] Use license file: C:\\ProgramData\\Zeiss\\License\\ZeissLicenseFile.zlic
        """
        patterns = ["ZEISS_INSPECT-*.log", "gomsoftware-current.log", "gomsoftware*.log"]
        seen = set()
        candidates = []
        for pat in patterns:
            for f in self.find_files(layout.gomsic_log_dir, pat):
                if f not in seen:
                    seen.add(f)
                    candidates.append(f)
        for log_file in candidates:
            ctx.file_searched(str(log_file))
            text = self.read_text_file(log_file)
            if not text:
                continue
            ctx.file_found(str(log_file))

            # Dongle
            m = re.search(r'\[license\] Dongles changed event: \[(\w+)=([^\]]+)\]', text)
            if m and not info.dongles:
                info.dongles.append(DongleInfo(dongle_type=m.group(1), serial=m.group(2)))

            # Consumed licenses
            consumed = re.findall(
                r'\[license\] Successfully consumed (\S+) \((\d+)\) from (\S+)', text
            )
            for feat, year, server in consumed:
                # Z_INSPECT_correlate -> correlate
                name = feat.replace("Z_INSPECT_", "").replace("_", " ").title()
                entry = LicenseEntry(
                    product=f"ZEISS INSPECT {name}",
                    version=year,
                    license_type=f"Thales RMS ({server})",
                    raw_fields={"feature": feat, "server": server},
                )
                info.licenses.append(entry)
                if name not in info.licensed_products:
                    info.licensed_products.append(name)

            # Active licenses summary
            m = re.search(r'\[license\] Active licenses \((\d+)\): (.+)', text)
            if m:
                ctx.note(f"Active licenses from app log: {m.group(2)}")

            # On demand licenses
            m = re.search(r'\[license\] On demand licenses \((\d+)\): (.+)', text)
            if m:
                for feat in m.group(2).split(","):
                    feat = feat.strip().replace("-", " ").title()
                    if feat not in info.licensed_products:
                        info.licensed_products.append(f"{feat} (on demand)")

            ctx.file_parsed(str(log_file))
            ctx.note(f"Extracted {len(info.licenses)} licenses, {len(info.dongles)} dongles from app log")
            break  # only need one log file

    def _parse_licenses_csv(self, path, info: LicenseInfo, ctx: ParserTraceContext) -> None:
        """Parse semicolon-delimited licenses.csv.

        Real headers: Product Name;License Name;Product Key;EntitlementId;
        License Version;Expiration Date;Quantity;Lock Type;License Technology
        """
        try:
            text = path.read_text(encoding="utf-8")
            reader = csv.DictReader(io.StringIO(text), delimiter=";")
            for row in reader:
                entry = LicenseEntry(
                    product=row.get("Product Name", row.get("Product")),
                    key=row.get("Product Key", row.get("Key")),
                    expiry=row.get("Expiration Date", row.get("Expiry", row.get("ExpiryDate"))),
                    license_type=row.get("License Technology", row.get("Lock Type", row.get("Type"))),
                    version=row.get("License Version", row.get("Version")),
                    raw_fields={k: v for k, v in row.items() if v},
                )
                # Build licensed_products from License Name
                license_name = row.get("License Name", "")
                if license_name and license_name not in info.licensed_products:
                    info.licensed_products.append(license_name)
                info.licenses.append(entry)
            ctx.file_parsed(str(path))
            ctx.note(f"Parsed {len(info.licenses)} license entries")
        except Exception as e:
            ctx.note(f"Error parsing licenses.csv: {e}")

    def _parse_dongles_csv(self, path, info: LicenseInfo, ctx: ParserTraceContext) -> None:
        """Parse dongles.csv (key=value format, e.g. WIBU=3-7335918)."""
        try:
            text = path.read_text(encoding="utf-8")
            for line in text.splitlines():
                line = line.strip()
                if "=" in line:
                    dtype, serial = line.split("=", 1)
                    info.dongles.append(DongleInfo(
                        dongle_type=dtype.strip(),
                        serial=serial.strip(),
                    ))
            ctx.file_parsed(str(path))
            ctx.note(f"Parsed {len(info.dongles)} dongle entries")
        except Exception as e:
            ctx.note(f"Error parsing dongles.csv: {e}")

    def _extract_licensed_products(self, manifest: dict, info: LicenseInfo) -> None:
        """Extract licensed product names from the ZEISS license manifest JSON."""
        # The manifest structure varies; look for solution/license entries
        if isinstance(manifest, dict):
            for key in ("solutions", "Solutions", "licenses", "Licenses"):
                items = manifest.get(key, [])
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            name = item.get("name", item.get("Name", ""))
                            if name and name not in info.licensed_products:
                                info.licensed_products.append(name)
