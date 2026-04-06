"""Archive extraction for ZEISS Quality Suite support archives.

Supports two input formats:
  1. Full QSR ZIP: outer ZIP > ZQS/ tree + ZEISS-INSPECT/gomsic.tgz
  2. Raw gomsic .tgz: direct gomsic archive (no ZQS wrapper)

Extracts to a temporary directory and returns an ArchiveLayout describing
where each component ended up on disk.
"""

from __future__ import annotations

import logging
import shutil
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ArchiveLayout:
    """Describes the on-disk layout after extraction."""
    root: Path                          # Top-level temp directory
    zqs_dir: Optional[Path] = None      # ZQS/ directory
    gomsic_dir: Optional[Path] = None   # Extracted gomsic.tgz contents
    zeiss_inspect_dir: Optional[Path] = None  # ZEISS-INSPECT/ directory
    description_txt: Optional[Path] = None    # description.txt
    warnings: list[str] = field(default_factory=list)

    # Convenience accessors for common file locations
    @property
    def gomsic_log_dir(self) -> Optional[Path]:
        if self.gomsic_dir:
            log_dir = self.gomsic_dir / "log"
            return log_dir if log_dir.is_dir() else None
        return None

    @property
    def gomsic_config_dir(self) -> Optional[Path]:
        if self.gomsic_dir:
            for d in ("config", "local-config", "all-config"):
                p = self.gomsic_dir / d
                if p.is_dir():
                    return self.gomsic_dir  # Return parent; caller picks subdir
        return None

    @property
    def zqs_license_dir(self) -> Optional[Path]:
        if self.zqs_dir:
            p = self.zqs_dir / "License"
            return p if p.is_dir() else None
        return None

    @property
    def zqs_installed_software_dir(self) -> Optional[Path]:
        if self.zqs_dir:
            p = self.zqs_dir / "InstalledSoftware"
            return p if p.is_dir() else None
        return None

    @property
    def zqs_gom_log_dir(self) -> Optional[Path]:
        if self.zqs_dir:
            p = self.zqs_dir / "gom" / "log"
            return p if p.is_dir() else None
        return None


def extract_archive(archive_path: str | Path, dest_dir: Optional[str | Path] = None) -> ArchiveLayout:
    """Extract a ZEISS Quality Suite archive to a temporary directory.

    Supports two formats:
    - .zip: Full QSR report (ZIP containing ZQS/ + ZEISS-INSPECT/gomsic.tgz)
    - .tgz/.tar.gz: Raw gomsic archive (direct tgz, no ZQS wrapper)

    Args:
        archive_path: Path to the .zip or .tgz file.
        dest_dir: Optional destination directory. If None, a temp dir is created.
                  Caller is responsible for cleanup.

    Returns:
        ArchiveLayout describing what was found and where.

    Raises:
        FileNotFoundError: If archive_path does not exist.
    """
    archive_path = Path(archive_path)
    if not archive_path.is_file():
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    if dest_dir is None:
        dest_dir = Path(tempfile.mkdtemp(prefix="gomsic_"))
    else:
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)

    layout = ArchiveLayout(root=dest_dir)

    # Detect format by extension and magic bytes
    suffix = archive_path.suffix.lower()
    if suffix == ".zip":
        _extract_qsr_zip(archive_path, dest_dir, layout)
    elif suffix in (".tgz", ".gz"):
        _extract_raw_tgz(archive_path, dest_dir, layout)
    else:
        # Try zip first, fall back to tgz
        if zipfile.is_zipfile(archive_path):
            _extract_qsr_zip(archive_path, dest_dir, layout)
        else:
            _extract_raw_tgz(archive_path, dest_dir, layout)

    return layout


def _extract_tgz_to_dir(tgz_path: Path, dest: Path, layout: ArchiveLayout) -> Optional[Path]:
    """Extract a .tgz and return the gomsic content directory.

    The tgz typically contains a timestamped folder (e.g. "2026-01-16-12-22-42/")
    with all gomsic files inside it. Returns that inner directory.
    """
    dest.mkdir(exist_ok=True)
    try:
        with tarfile.open(tgz_path, "r:gz") as tf:
            safe_members = []
            for member in tf.getmembers():
                member_path = (dest / member.name).resolve()
                if not str(member_path).startswith(str(dest.resolve())):
                    layout.warnings.append(f"Skipped suspicious tar path: {member.name}")
                    continue
                safe_members.append(member)
            tf.extractall(dest, members=safe_members)

        # Find the content directory
        subdirs = [d for d in dest.iterdir() if d.is_dir()]
        if len(subdirs) == 1:
            return subdirs[0]
        elif len(subdirs) > 1:
            for sd in subdirs:
                if (sd / "msinfo32.log").is_file() or (sd / "log").is_dir():
                    return sd
            layout.warnings.append(
                f"Multiple directories in tgz; using {subdirs[0].name}"
            )
            return subdirs[0]
        else:
            # Files directly in dest (no subdirectory wrapper)
            if any(dest.glob("msinfo32.log")):
                return dest
            return dest

    except (tarfile.TarError, OSError) as e:
        layout.warnings.append(f"Failed to extract tgz: {e}")
        logger.error("tgz extraction failed: %s", e)
        return None


def _extract_qsr_zip(zip_path: Path, dest_dir: Path, layout: ArchiveLayout) -> None:
    """Extract a full QSR ZIP archive (contains ZQS/ + ZEISS-INSPECT/gomsic.tgz)."""
    logger.info("Extracting QSR ZIP: %s -> %s", zip_path, dest_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        safe_members = []
        dest_resolved = str(dest_dir.resolve())
        for member in zf.namelist():
            member_path = (dest_dir / member).resolve()
            if not str(member_path).startswith(dest_resolved):
                layout.warnings.append(f"Skipped suspicious path: {member}")
                continue
            safe_members.append(member)
        zf.extractall(dest_dir, members=safe_members)

    # description.txt
    desc_txt = dest_dir / "description.txt"
    if desc_txt.is_file():
        layout.description_txt = desc_txt

    # ZQS/ directory
    zqs_dir = dest_dir / "ZQS"
    if zqs_dir.is_dir():
        layout.zqs_dir = zqs_dir

    # ZEISS-INSPECT/ directory
    zi_dir = dest_dir / "ZEISS-INSPECT"
    if zi_dir.is_dir():
        layout.zeiss_inspect_dir = zi_dir

    # Extract nested gomsic.tgz
    gomsic_tgz = zi_dir / "gomsic.tgz" if zi_dir.is_dir() else None
    if gomsic_tgz and gomsic_tgz.is_file():
        gomsic_dest = dest_dir / "gomsic_extracted"
        layout.gomsic_dir = _extract_tgz_to_dir(gomsic_tgz, gomsic_dest, layout)
    else:
        layout.warnings.append("gomsic.tgz not found in ZEISS-INSPECT/")


def _extract_raw_tgz(tgz_path: Path, dest_dir: Path, layout: ArchiveLayout) -> None:
    """Extract a raw gomsic .tgz archive (no ZQS wrapper)."""
    logger.info("Extracting raw gomsic tgz: %s -> %s", tgz_path, dest_dir)
    gomsic_dest = dest_dir / "gomsic_extracted"
    layout.gomsic_dir = _extract_tgz_to_dir(tgz_path, gomsic_dest, layout)


def cleanup(layout: ArchiveLayout) -> None:
    """Remove the temporary extraction directory."""
    if layout.root and layout.root.is_dir():
        shutil.rmtree(layout.root, ignore_errors=True)
