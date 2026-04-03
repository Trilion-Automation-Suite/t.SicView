"""Abstract base class for all parsers.

Every parser inherits from BaseParser and implements the `parse()` method.
The base class provides:
- Automatic debug tracing (timing, files searched/found/parsed)
- Graceful error handling (returns None on failure, never crashes the pipeline)
- UTF-16 file reading helper
- Common file discovery utilities
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional, TypeVar

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout

logger = logging.getLogger(__name__)

T = TypeVar("T")


class BaseParser(ABC):
    """Abstract base for all GOMSic archive parsers.

    Subclasses must implement:
        - name: str class attribute (e.g. "system_info")
        - parse(layout, ctx) -> Optional[T]
    """

    name: str = "base"

    def safe_parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[Any]:
        """Run parse() with error handling. Returns None on failure."""
        try:
            result = self.parse(layout, ctx)
            if result is None:
                ctx.skip("No data found")
            return result
        except Exception as e:
            ctx.fail(str(e))
            logger.error("Parser %s failed: %s", self.name, e, exc_info=True)
            return None

    @abstractmethod
    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[Any]:
        """Parse data from the archive.

        Args:
            layout: Extracted archive layout with paths to all components.
            ctx: Trace context for recording what this parser does.

        Returns:
            A Pydantic model instance with parsed data, or None if the
            required files are missing.
        """
        ...

    # ------------------------------------------------------------------
    # Utility methods available to all parsers
    # ------------------------------------------------------------------

    @staticmethod
    def read_utf16_file(path: Path) -> Optional[str]:
        """Read a UTF-16 LE file (with BOM detection), return as UTF-8 string.

        Handles msinfo32.log, nics.log, and other Windows UTF-16 files.
        Falls back to utf-8 if UTF-16 decoding fails.
        """
        if not path.is_file():
            return None

        # Try reading raw bytes to detect BOM
        raw = path.read_bytes()

        # UTF-16 LE BOM: FF FE
        if raw[:2] == b"\xff\xfe":
            try:
                return raw.decode("utf-16-le")
            except UnicodeDecodeError:
                pass

        # UTF-16 BE BOM: FE FF
        if raw[:2] == b"\xfe\xff":
            try:
                return raw.decode("utf-16-be")
            except UnicodeDecodeError:
                pass

        # UTF-8 BOM: EF BB BF
        if raw[:3] == b"\xef\xbb\xbf":
            try:
                return raw[3:].decode("utf-8")
            except UnicodeDecodeError:
                pass

        # No BOM detected: try UTF-8 first (most common for non-BOM files).
        # Only fall back to UTF-16 if UTF-8 produces decode errors.
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            pass

        # Try utf-16 without BOM as last resort
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass

        # Final fallback: UTF-8 with error replacement
        return raw.decode("utf-8", errors="replace")

    @staticmethod
    def read_text_file(path: Path, encoding: str = "utf-8") -> Optional[str]:
        """Read a text file with specified encoding. Returns None if missing."""
        if not path.is_file():
            return None
        try:
            return path.read_text(encoding=encoding, errors="replace")
        except OSError:
            return None

    @staticmethod
    def find_files(directory: Optional[Path], pattern: str) -> list[Path]:
        """Glob for files in a directory. Returns empty list if dir is None/missing."""
        if directory is None or not directory.is_dir():
            return []
        return sorted(directory.glob(pattern))
