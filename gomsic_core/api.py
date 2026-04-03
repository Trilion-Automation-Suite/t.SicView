"""High-level API for parsing ZEISS Quality Suite archives.

This is the main entry point for the gomsic-parser. It orchestrates:
1. Archive extraction (ZIP + nested gomsic.tgz)
2. System identification
3. All parsers (with debug tracing)
4. Error detection
5. Result assembly

Usage:
    from gomsic_core.api import parse_archive
    result = parse_archive("path/to/archive.zip", product="ARAMIS 24M")
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from .debug_log.trace import TraceRecorder
from .errors.detector import ErrorDetector
from .errors.verifier import run_verifications
from .extractor import ArchiveLayout, cleanup, extract_archive
from .identifier import identify_system
from .models import ParseResult, ProductType

# Import all parsers
from .parsers.cameras import CamerasParser
from .parsers.codemeter import CodeMeterParser
from .parsers.drivers import DriversParser
from .parsers.gomsoftware_cfg import GomSoftwareCfgParser
from .parsers.hardware_service import HardwareServiceParser
from .parsers.licensing import LicensingParser
from .parsers.logs import LogsParser
from .parsers.network import NetworkParser
from .parsers.system_info import SystemInfoParser
from .parsers.usb import USBParser
from .parsers.windows_events import WindowsEventsParser
from .parsers.quality_suite_log import QualitySuiteLogParser
from .parsers.windows_update import WindowsUpdateParser
from .parsers.activity_timeline import ActivityTimelineParser
from .parsers.zeiss_versions import ZeissVersionsParser

logger = logging.getLogger(__name__)

# Knowledge base directory (relative to this file)
_KB_DIR = Path(__file__).parent.parent / "knowledge_base"

# Ordered list of parsers to run
_PARSERS = [
    ("zeiss_versions", ZeissVersionsParser()),
    ("system_info", SystemInfoParser()),
    ("licensing", LicensingParser()),
    ("network", NetworkParser()),
    ("drivers", DriversParser()),
    ("cameras", CamerasParser()),
    ("usb", USBParser()),
    ("hardware_service", HardwareServiceParser()),
    ("logs", LogsParser()),
    ("codemeter", CodeMeterParser()),
    ("windows_events", WindowsEventsParser()),
    ("gomsoftware_config", GomSoftwareCfgParser()),
    ("quality_suite_log", QualitySuiteLogParser()),
    ("windows_updates", WindowsUpdateParser()),
    ("activity_timeline", ActivityTimelineParser()),
]


def parse_archive(
    zip_path: str | Path,
    product: str | ProductType = ProductType.UNKNOWN,
    description: Optional[str] = None,
    knowledge_base_dir: Optional[Path] = None,
    keep_extracted: bool = False,
) -> ParseResult:
    """Parse a ZEISS Quality Suite archive and produce a diagnostic result.

    Args:
        zip_path: Path to the .zip archive file.
        product: User-selected product type (or "Unknown").
        description: User's issue description (optional).
        knowledge_base_dir: Path to knowledge_base/ directory.
            Defaults to the one shipped with the package.
        keep_extracted: If True, don't clean up the extracted temp directory.

    Returns:
        ParseResult with all parsed data, findings, and debug trace.
    """
    zip_path = Path(zip_path)
    kb_dir = knowledge_base_dir or _KB_DIR

    # Normalize product type
    if isinstance(product, str):
        try:
            product_type = ProductType(product)
        except ValueError:
            product_type = ProductType.UNKNOWN
    else:
        product_type = product

    # Initialize trace recorder
    recorder = TraceRecorder(archive_filename=zip_path.name)

    # Initialize result
    result = ParseResult(
        archive_filename=zip_path.name,
        product_type=product_type,
        user_description=description,
    )

    layout: Optional[ArchiveLayout] = None

    try:
        # Step 1: Extract archive
        with recorder.parser("extractor") as ctx:
            layout = extract_archive(zip_path)
            ctx.file_searched(str(zip_path))
            ctx.file_found(str(zip_path))
            ctx.file_parsed(str(zip_path))
            for w in layout.warnings:
                ctx.note(w)

            # Read description.txt if present
            if layout.description_txt:
                result.user_issue_description = layout.description_txt.read_text(
                    encoding="utf-8", errors="replace"
                ).strip()
                ctx.note("Found description.txt")

        # Step 2: Identify system type
        with recorder.parser("identifier") as ctx:
            detected = identify_system(layout)
            if detected:
                result.detected_product = detected
                ctx.note(f"Detected: {detected.value}")
                # Use detected type if user didn't specify
                if product_type == ProductType.UNKNOWN:
                    result.product_type = detected
            else:
                ctx.note("Could not auto-detect system type")

        # Step 3: Run all parsers
        for attr_name, parser in _PARSERS:
            with recorder.parser(parser.name) as ctx:
                parsed_data = parser.safe_parse(layout, ctx)
                if parsed_data is not None:
                    setattr(result, attr_name, parsed_data)
                # Collect log inventory from the logs parser
                if attr_name == "logs" and hasattr(parser, "log_inventory"):
                    result.log_inventory = parser.log_inventory

        # Step 4: Run error detection
        with recorder.parser("error_detector") as ctx:
            try:
                detector = ErrorDetector(kb_dir)
                findings = detector.detect(result)
                result.findings = findings
                ctx.note(f"Produced {len(findings)} findings")
            except Exception as e:
                ctx.fail(str(e))
                logger.error("Error detection failed: %s", e, exc_info=True)

        # Step 5: Run verifications (confirmed-good checks)
        with recorder.parser("verifier") as ctx:
            try:
                checks = run_verifications(result, kb_dir)
                result.verified_checks = [
                    {"category": c.category, "title": c.title, "detail": c.detail, "source": c.source}
                    for c in checks
                ]
                ctx.note(f"Produced {len(checks)} verified checks")
            except Exception as e:
                ctx.fail(str(e))
                logger.error("Verification failed: %s", e, exc_info=True)

    finally:
        # Finalize trace
        result.debug_trace = recorder.finalize()

        # Cleanup extracted files unless requested to keep
        if layout and not keep_extracted:
            cleanup(layout)

    return result
