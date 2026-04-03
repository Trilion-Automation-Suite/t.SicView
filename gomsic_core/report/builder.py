"""Report builder -- orchestrates parsed data + findings into report output.

Stub for Phase 4 implementation.
"""

from __future__ import annotations

from ..models import ParseResult


def build_html_report(result: ParseResult) -> str:
    """Generate a self-contained HTML report. Stub."""
    raise NotImplementedError("HTML report generation not yet implemented (Phase 4)")


def build_markdown_report(result: ParseResult) -> str:
    """Generate a Markdown report suitable for support tickets. Stub."""
    raise NotImplementedError("Markdown report generation not yet implemented (Phase 4)")


def build_pdf_report(result: ParseResult) -> bytes:
    """Generate a PDF report. Stub."""
    raise NotImplementedError("PDF report generation not yet implemented (Phase 4)")
