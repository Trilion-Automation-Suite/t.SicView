"""Execution trace system for recording what each parser did.

Records timing, files searched/found/parsed, success/failure status,
and any notes or errors. The trace is included in reports when the
user enables the debug/advanced panel.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import datetime
from typing import Generator

from ..models import DebugTrace, ParserStatus, ParserTrace


class TraceRecorder:
    """Records execution traces for a single parse run."""

    def __init__(self, archive_filename: str = ""):
        self._trace = DebugTrace(
            started_at=datetime.now(),
            archive_filename=archive_filename,
        )
        self._start_time = time.monotonic()

    @contextmanager
    def parser(self, parser_name: str) -> Generator[ParserTraceContext, None, None]:
        """Context manager for tracing a single parser execution.

        Usage:
            with recorder.parser("system_info") as ctx:
                ctx.file_searched("msinfo32.log")
                ctx.file_found("msinfo32.log")
                # ... do parsing ...
                ctx.file_parsed("msinfo32.log")
                ctx.note("Detected UTF-16 LE encoding")
        """
        ctx = ParserTraceContext(parser_name)
        try:
            yield ctx
            if ctx._trace.status == ParserStatus.SUCCESS:
                pass  # Already set by caller or default
        except Exception as e:
            ctx.fail(str(e))
            raise
        finally:
            ctx._finalize()
            self._trace.parser_traces.append(ctx._trace)

    def warn(self, message: str) -> None:
        """Add a top-level warning to the trace."""
        self._trace.warnings.append(message)

    def finalize(self) -> DebugTrace:
        """Finalize the trace and return it."""
        self._trace.finished_at = datetime.now()
        self._trace.total_duration_ms = (time.monotonic() - self._start_time) * 1000
        return self._trace


class ParserTraceContext:
    """Context for recording a single parser's execution."""

    def __init__(self, parser_name: str):
        self._trace = ParserTrace(
            parser_name=parser_name,
            status=ParserStatus.SUCCESS,
        )
        self._start_time = time.monotonic()

    def file_searched(self, path: str) -> None:
        self._trace.files_searched.append(path)

    def file_found(self, path: str) -> None:
        self._trace.files_found.append(path)

    def file_parsed(self, path: str) -> None:
        self._trace.files_parsed.append(path)

    def note(self, message: str) -> None:
        self._trace.notes.append(message)

    def skip(self, reason: str = "") -> None:
        self._trace.status = ParserStatus.SKIPPED
        if reason:
            self._trace.notes.append(f"Skipped: {reason}")

    def partial(self, reason: str = "") -> None:
        self._trace.status = ParserStatus.PARTIAL
        if reason:
            self._trace.notes.append(f"Partial: {reason}")

    def fail(self, error: str) -> None:
        self._trace.status = ParserStatus.FAILED
        self._trace.error_message = error

    def _finalize(self) -> None:
        self._trace.duration_ms = (time.monotonic() - self._start_time) * 1000
