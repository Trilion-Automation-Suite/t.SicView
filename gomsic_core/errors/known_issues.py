"""Load and match known issue patterns from YAML knowledge base files.

Patterns are defined in knowledge_base/*.yaml and matched against parsed data
to produce diagnostic findings.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import yaml

from ..models import Finding, Severity

logger = logging.getLogger(__name__)


def load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file. Returns empty dict on error."""
    if not path.is_file():
        logger.warning("Knowledge base file not found: %s", path)
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
            return data if isinstance(data, dict) else {}
    except yaml.YAMLError as e:
        logger.error("Failed to parse %s: %s", path, e)
        return {}


def load_patterns(kb_dir: Path) -> list[dict[str, Any]]:
    """Load error patterns from patterns.yaml."""
    data = load_yaml(kb_dir / "patterns.yaml")
    return data.get("patterns", [])


def load_nic_rules(kb_dir: Path) -> dict[str, Any]:
    """Load NIC configuration rules from nic_rules.yaml."""
    return load_yaml(kb_dir / "nic_rules.yaml")


def load_driver_rules(kb_dir: Path) -> dict[str, Any]:
    """Load driver version rules from driver_rules.yaml."""
    return load_yaml(kb_dir / "driver_rules.yaml")


def load_license_rules(kb_dir: Path) -> dict[str, Any]:
    """Load license validation rules from license_rules.yaml."""
    return load_yaml(kb_dir / "license_rules.yaml")


def match_pattern(pattern_def: dict[str, Any], text: str) -> Optional[Finding]:
    """Check if a text matches a pattern definition and produce a Finding.

    Pattern definition format (from patterns.yaml):
        id: unique_id
        regex: "pattern to match"
        severity: CRITICAL|WARNING|INFO
        title: "Human-readable title"
        description: "What this means"
        recommendation: "What to do about it"
        category: "network|driver|license|log|system"
    """
    regex_str = pattern_def.get("regex")
    if not regex_str:
        return None

    try:
        if re.search(regex_str, text, re.IGNORECASE | re.MULTILINE):
            return Finding(
                severity=Severity(pattern_def.get("severity", "INFO")),
                title=pattern_def.get("title", "Unknown issue"),
                description=pattern_def.get("description", ""),
                recommendation=pattern_def.get("recommendation"),
                pattern_id=pattern_def.get("id"),
                category=pattern_def.get("category"),
            )
    except re.error as e:
        logger.warning("Invalid regex in pattern %s: %s", pattern_def.get("id"), e)

    return None
