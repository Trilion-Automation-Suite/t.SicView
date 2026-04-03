# Knowledge Base

Human-editable YAML files defining known error patterns, NIC configuration rules, driver version requirements, and license validation rules.

## Files

- **patterns.yaml** - Known error signatures matched against log content
- **nic_rules.yaml** - Expected NIC settings per adapter type (Mellanox, Intel)
- **driver_rules.yaml** - Driver version requirements per system type
- **license_rules.yaml** - Required licenses per system type

## Adding New Patterns

Use the CLI tool:
```bash
python -m gomsic_core.errors.learning add-pattern
```

Or edit the YAML files directly. Follow the existing format.

## Format Notes

- `severity`: CRITICAL | WARNING | INFO
- `regex`: Python regular expression syntax
- Property values prefixed with `>=` are minimum thresholds
- `required_for`: list of ProductType values (e.g., "ARAMIS 24M")
