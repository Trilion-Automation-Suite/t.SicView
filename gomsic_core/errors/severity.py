"""Severity classification for diagnostic findings.

CRITICAL: System non-functional or at risk of data loss
WARNING:  Degraded performance or configuration risk
INFO:     Noteworthy but not blocking normal operation
"""

from __future__ import annotations

from ..models import Severity

# Re-export for convenience
__all__ = ["Severity", "CRITICAL", "WARNING", "INFO"]

CRITICAL = Severity.CRITICAL
WARNING = Severity.WARNING
INFO = Severity.INFO
