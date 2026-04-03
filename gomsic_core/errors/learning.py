"""CLI tool for adding new error patterns to the knowledge base.

Usage:
    python -m gomsic_core.errors.learning add-pattern

Prompts for pattern details and appends to knowledge_base/patterns.yaml.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml


def add_pattern(kb_dir: Path | None = None) -> None:
    """Interactive CLI to add a new pattern to patterns.yaml."""
    if kb_dir is None:
        kb_dir = Path(__file__).parent.parent.parent / "knowledge_base"

    patterns_file = kb_dir / "patterns.yaml"
    if not patterns_file.is_file():
        print(f"Error: {patterns_file} not found")
        sys.exit(1)

    print("=== Add New Error Pattern ===\n")
    pattern_id = input("Pattern ID (unique, e.g. 'mellanox_flow_control'): ").strip()
    regex = input("Regex pattern to match: ").strip()
    severity = input("Severity (CRITICAL/WARNING/INFO) [WARNING]: ").strip() or "WARNING"
    title = input("Title (human-readable): ").strip()
    description = input("Description: ").strip()
    recommendation = input("Recommendation: ").strip()
    category = input("Category (network/driver/license/log/system): ").strip()

    new_pattern = {
        "id": pattern_id,
        "regex": regex,
        "severity": severity,
        "title": title,
        "description": description,
        "recommendation": recommendation,
        "category": category,
    }

    with open(patterns_file, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if "patterns" not in data:
        data["patterns"] = []

    data["patterns"].append(new_pattern)

    with open(patterns_file, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    print(f"\nPattern '{pattern_id}' added to {patterns_file}")


if __name__ == "__main__":
    add_pattern()
