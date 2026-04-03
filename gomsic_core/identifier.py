"""System type detection from archive contents.

Attempts to identify the ZEISS measurement system (ATOS Q, ARAMIS 24M, etc.)
by examining license manifests, installed software, acquisition logs, and
hardware configuration files.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

from .extractor import ArchiveLayout
from .models import ProductType

logger = logging.getLogger(__name__)

# Maps keywords found in license/product data to product types.
# Checked in order; first match wins. More specific patterns first.
_PRODUCT_PATTERNS: list[tuple[re.Pattern, ProductType]] = [
    (re.compile(r"aramis.?24\s*m", re.IGNORECASE), ProductType.ARAMIS_24M),
    (re.compile(r"aramis.?12\s*m", re.IGNORECASE), ProductType.ARAMIS_12M),
    (re.compile(r"aramis.?4\s*m", re.IGNORECASE), ProductType.ARAMIS_4M),
    (re.compile(r"aramis.?srx", re.IGNORECASE), ProductType.ARAMIS_SRX),
    (re.compile(r"atos.?q.?awk", re.IGNORECASE), ProductType.ATOS_Q_AWK),
    (re.compile(r"atos.?q(?!\s*awk)", re.IGNORECASE), ProductType.ATOS_Q),
    (re.compile(r"gom.?scan.?ports", re.IGNORECASE), ProductType.GOM_SCAN_PORTS),
    (re.compile(r"gom.?scan.?1", re.IGNORECASE), ProductType.GOM_SCAN_1),
    (re.compile(r"t.?scan", re.IGNORECASE), ProductType.T_SCAN),
    (re.compile(r"argus", re.IGNORECASE), ProductType.ARGUS),
]


def identify_system(layout: ArchiveLayout) -> Optional[ProductType]:
    """Attempt to identify the ZEISS system type from archive contents.

    Checks multiple sources in priority order:
    1. License manifest JSON (ZEISS-INSPECT_*.json) -- most reliable
    2. licenses.csv product column
    3. Acquisition log references (zi_acq_*.log)
    4. Installed programs list

    Returns:
        Detected ProductType, or None if identification fails.
    """
    # Source 1: License manifest JSON
    product = _check_license_manifest(layout)
    if product:
        logger.info("System identified from license manifest: %s", product.value)
        return product

    # Source 2: licenses.csv
    product = _check_licenses_csv(layout)
    if product:
        logger.info("System identified from licenses.csv: %s", product.value)
        return product

    # Source 3: Acquisition logs
    product = _check_acquisition_logs(layout)
    if product:
        logger.info("System identified from acquisition logs: %s", product.value)
        return product

    # Source 4: Installed programs
    product = _check_installed_programs(layout)
    if product:
        logger.info("System identified from installed programs: %s", product.value)
        return product

    logger.warning("Could not identify system type from archive contents")
    return None


def _match_product(text: str) -> Optional[ProductType]:
    """Match text against known product patterns."""
    for pattern, product_type in _PRODUCT_PATTERNS:
        if pattern.search(text):
            return product_type
    return None


def _check_license_manifest(layout: ArchiveLayout) -> Optional[ProductType]:
    """Check ZEISS-INSPECT_*.json license manifest for sensor/product info."""
    if not layout.zqs_installed_software_dir:
        return None

    for json_file in layout.zqs_installed_software_dir.glob("ZEISS-INSPECT_*.json"):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            text = json.dumps(data)
            product = _match_product(text)
            if product:
                return product
        except (json.JSONDecodeError, OSError) as e:
            logger.debug("Failed to read %s: %s", json_file, e)

    return None


def _check_licenses_csv(layout: ArchiveLayout) -> Optional[ProductType]:
    """Check licenses.csv for product references."""
    if not layout.zqs_license_dir:
        return None

    licenses_csv = layout.zqs_license_dir / "licenses.csv"
    if not licenses_csv.is_file():
        return None

    try:
        text = licenses_csv.read_text(encoding="utf-8")
        return _match_product(text)
    except OSError as e:
        logger.debug("Failed to read licenses.csv: %s", e)
        return None


def _check_acquisition_logs(layout: ArchiveLayout) -> Optional[ProductType]:
    """Check acquisition logs for sensor/system references."""
    log_dirs = []
    if layout.gomsic_log_dir:
        log_dirs.append(layout.gomsic_log_dir)
    if layout.zqs_gom_log_dir:
        log_dirs.append(layout.zqs_gom_log_dir)

    for log_dir in log_dirs:
        for log_file in log_dir.glob("zi_acq_*.log"):
            try:
                # Read first 50KB -- enough for system identification
                text = log_file.read_text(encoding="utf-8", errors="replace")[:50000]
                product = _match_product(text)
                if product:
                    return product
            except OSError:
                continue

    return None


def _check_installed_programs(layout: ArchiveLayout) -> Optional[ProductType]:
    """Check InstalledPrograms.log for ZEISS sensor software."""
    if not layout.gomsic_dir:
        return None

    programs_log = layout.gomsic_dir / "InstalledPrograms.log"
    if not programs_log.is_file():
        return None

    try:
        text = programs_log.read_text(encoding="utf-8", errors="replace")
        return _match_product(text)
    except OSError:
        return None
