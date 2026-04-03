"""Parser for user activity timeline from ZEISS INSPECT application logs.

Extracts a chronological timeline of user actions from ZEISS_INSPECT-*.log
files. The log format records every GOM scripting command executed:

  executing sys.show_stage (stage=gom.app.project.stages['Stage 270']) at Tue Mar  3 09:46:07 2026
  result '' at Tue Mar  3 09:46:07 2026
  save working copy started at Tue Mar  3 09:47:20 2026
  recovered from application hang #4
  executing sys.save_project from menu at Tue Mar  3 09:58:04 2026
  Exit-code: 0
  End time: 2026-03-03 09:58:45  (elapsed: 586125 s)
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from pathlib import Path
from typing import Optional

from ..debug_log.trace import ParserTraceContext
from ..extractor import ArchiveLayout
from ..models import ActivityEvent, ActivityTimeline
from .base import BaseParser

logger = logging.getLogger(__name__)

# Main pattern: "executing module.command (args...) at DayOfWeek Mon DD HH:MM:SS YYYY"
# Also matches: "executing module.command from menu at ..."
_EXECUTING_RE = re.compile(
    r"^executing\s+(\S+)\s+"           # module.command
    r"(?:\(([^)]*(?:\([^)]*\))*[^)]*)\)\s+)?"  # optional (args) with nested parens
    r"(?:from menu\s+)?"               # optional "from menu"
    r"at\s+(.+\d{4})$",               # timestamp
    re.MULTILINE,
)

# Result pattern
_RESULT_RE = re.compile(r"^result\s+'?([^']*)'?\s+at\s+(.+\d{4})$", re.MULTILINE)
_RESULT_MENU_RE = re.compile(r"^result for menu command:\s+(\S+)\s+at\s+(.+\d{4})$", re.MULTILINE)

# Save working copy
_SAVE_WC_RE = re.compile(r"^save working copy started at\s+(.+\d{4})$", re.MULTILINE)

# Application hang
_HANG_RE = re.compile(r"^recovered from application hang #(\d+)", re.MULTILINE)

# Exit
_EXIT_RE = re.compile(r"^Exit-code:\s*(\d+)", re.MULTILINE)
_END_TIME_RE = re.compile(r"^End time:\s*(.+?)\s+\(elapsed:\s*(\d+)\s*s\)", re.MULTILINE)

# Categorize GOM commands into user-facing categories
_COMMAND_CATEGORIES = {
    # Project lifecycle
    "sys.save_project": ("project", "Project saved"),
    "sys.exit_program": ("app", "Application closed"),
    "sys.close_project": ("project", "Project closed"),
    "sys.open_project": ("project", "Project opened"),
    "sys.new_project": ("project", "New project created"),
    "sys.import_project": ("project", "Project imported"),
    "sys.export_project": ("project", "Project exported"),
    "sys.recalculate_project": ("project", "Project recalculated"),

    # Stage navigation
    "sys.show_stage": ("navigation", "Stage changed"),
    "sys.open_stage_range": ("navigation", "Stage range opened"),
    "sys.close_stage_range": ("navigation", "Stage range closed"),

    # Inspection
    "inspection.inspect_by_deviation_label": ("inspection", "Deviation inspection"),
    "inspection.create_inspection_element": ("inspection", "Inspection created"),

    # Alignment
    "manage_alignment.set_alignment_active": ("alignment", "Alignment activated"),
    "sys.recalculate_alignment": ("alignment", "Alignment recalculated"),

    # View
    "view.set_view_direction_and_up_direction": ("view", "View direction changed"),

    # Legend
    "legend.edit_legend_properties": ("view", "Legend properties edited"),

    # Diagram
    "diagram.set_diagram_axis_value_manually": ("view", "Diagram axis adjusted"),

    # Element editing
    "sys.edit_creation_parameters": ("element", "Element parameters edited"),
    "sys.edit_element": ("element", "Element edited"),
    "transform_element.tack_element_to_component": ("element", "Element tacked to component"),
    "sys.restore_point_selection": ("element", "Point selection restored"),

    # Acquisition
    "sys.start_acquisition": ("acquisition", "Acquisition started"),
    "sys.stop_acquisition": ("acquisition", "Acquisition stopped"),
    "acquisition.start": ("acquisition", "Acquisition started"),
    "acquisition.stop": ("acquisition", "Acquisition stopped"),

    # Mesh/surface
    "mesh.create_mesh": ("component", "Mesh created"),
    "mesh.create_surface_component": ("component", "Surface component created"),

    # Import/export
    "sys.import_file": ("import", "File imported"),
    "sys.export_file": ("export", "File exported"),

    # Reports
    "report.create_report_page": ("report", "Report page created"),
    "report.export_report": ("report", "Report exported"),

    # Script execution
    "script.run_script": ("script", "Script executed"),

    # Calibration
    "calibration.start_calibration": ("calibration", "Calibration started"),
}

# Prefix-based fallback categories
_PREFIX_CATEGORIES = {
    "sys.": ("system", None),
    "inspection.": ("inspection", None),
    "manage_alignment.": ("alignment", None),
    "view.": ("view", None),
    "legend.": ("view", None),
    "diagram.": ("view", None),
    "transform_element.": ("element", None),
    "mesh.": ("component", None),
    "acquisition.": ("acquisition", None),
    "report.": ("report", None),
    "calibration.": ("calibration", None),
    "script.": ("script", None),
    "import.": ("import", None),
    "export.": ("export", None),
}


class ActivityTimelineParser(BaseParser):
    name = "activity_timeline"

    def parse(self, layout: ArchiveLayout, ctx: ParserTraceContext) -> Optional[ActivityTimeline]:
        log_files: list[Path] = []

        if layout.gomsic_log_dir:
            log_files.extend(self.find_files(layout.gomsic_log_dir, "ZEISS_INSPECT-*.log"))
            log_files.extend(self.find_files(layout.gomsic_log_dir, "GOMSoftware-*.log"))

        if not log_files:
            ctx.skip("No application logs found")
            return None

        timeline = ActivityTimeline()
        hang_count = 0
        stage_names: set[str] = set()
        project_name: Optional[str] = None
        command_counts: Counter = Counter()

        for log_file in log_files:
            ctx.file_searched(str(log_file))
            text = self.read_text_file(log_file)
            if not text:
                continue
            ctx.file_found(str(log_file))

            # Parse executing commands
            for m in _EXECUTING_RE.finditer(text):
                command = m.group(1)
                args_str = m.group(2) or ""
                timestamp = m.group(3).strip()

                # Categorize
                cat, action = self._categorize(command)
                if action is None:
                    action = command.split(".")[-1].replace("_", " ").title()

                # Extract meaningful detail from args
                detail = self._extract_detail(command, args_str)

                # Track stages
                stage_m = re.search(r"stages\['([^']+)'\]", args_str)
                if stage_m:
                    stage_names.add(stage_m.group(1))

                # Track project name from args
                proj_m = re.search(r"project\s*=\s*['\"]([^'\"]+)['\"]", args_str)
                if proj_m:
                    project_name = proj_m.group(1)

                # Skip noisy navigation events in detail view but count them
                command_counts[command] += 1
                if command == "sys.show_stage":
                    # Only record stage changes as a summary, not each one
                    continue

                event = ActivityEvent(
                    timestamp=timestamp,
                    category=cat,
                    action=action,
                    detail=detail,
                    source_file=log_file.name,
                )
                timeline.events.append(event)

            # Parse save working copy events
            for m in _SAVE_WC_RE.finditer(text):
                timeline.events.append(ActivityEvent(
                    timestamp=m.group(1).strip(),
                    category="project",
                    action="Working copy saved",
                    source_file=log_file.name,
                ))

            # Parse application hangs
            for m in _HANG_RE.finditer(text):
                hang_count = max(hang_count, int(m.group(1)))
                timeline.events.append(ActivityEvent(
                    timestamp="",
                    category="error",
                    action=f"Application hang #{m.group(1)}",
                    detail="Application became unresponsive and recovered",
                    source_file=log_file.name,
                ))

            # Parse exit
            exit_m = _EXIT_RE.search(text)
            end_m = _END_TIME_RE.search(text)
            if exit_m:
                exit_code = exit_m.group(1)
                elapsed = ""
                end_ts = ""
                if end_m:
                    end_ts = end_m.group(1).strip()
                    elapsed_s = int(end_m.group(2))
                    hours = elapsed_s // 3600
                    mins = (elapsed_s % 3600) // 60
                    elapsed = f" (session: {hours}h {mins}m)"
                timeline.events.append(ActivityEvent(
                    timestamp=end_ts,
                    category="app",
                    action=f"Application exited (code {exit_code}){elapsed}",
                    source_file=log_file.name,
                ))

            ctx.file_parsed(str(log_file))

        if not timeline.events:
            ctx.skip("No activity events found")
            return None

        # Add stage navigation summary as a single event
        if stage_names:
            stage_count = command_counts.get("sys.show_stage", 0)
            timeline.stage_count = len(stage_names)
            timeline.events.append(ActivityEvent(
                timestamp="",
                category="navigation",
                action=f"Stage navigation ({stage_count} changes across {len(stage_names)} stages)",
                detail=f"Stages visited: {', '.join(sorted(stage_names)[:10])}{'...' if len(stage_names) > 10 else ''}",
            ))

        # Sort by timestamp (most recent first), empty timestamps last
        timeline.events.sort(
            key=lambda e: e.timestamp or "0000",
            reverse=True,
        )

        # Summary fields
        timeline.hang_count = hang_count
        if timeline.events:
            # Last real action (skip empty timestamps)
            for e in timeline.events:
                if e.timestamp and e.category not in ("navigation",):
                    timeline.last_action = e.action
                    if e.detail:
                        timeline.last_action += f": {e.detail}"
                    break

        # Project info
        if project_name:
            timeline.last_project = project_name

        # Check if project was open at end (look for save/exit sequence)
        save_count = command_counts.get("sys.save_project", 0)
        if save_count > 0:
            timeline.project_open = False  # saved and exited
        elif command_counts.get("sys.exit_program", 0) > 0:
            timeline.project_open = False

        # Command frequency summary
        timeline.command_summary = {
            cmd: count for cmd, count in command_counts.most_common(20)
        }
        timeline.total_commands = sum(command_counts.values())

        ctx.note(f"Found {len(timeline.events)} events, {timeline.total_commands} total commands, "
                 f"{hang_count} hangs, {len(stage_names)} stages")
        return timeline

    @staticmethod
    def _categorize(command: str) -> tuple[str, Optional[str]]:
        """Categorize a GOM command into a user-facing category and action."""
        if command in _COMMAND_CATEGORIES:
            return _COMMAND_CATEGORIES[command]
        for prefix, (cat, action) in _PREFIX_CATEGORIES.items():
            if command.startswith(prefix):
                return cat, action
        return "other", None

    @staticmethod
    def _extract_detail(command: str, args_str: str) -> str:
        """Extract meaningful detail from command arguments."""
        if not args_str:
            return ""

        # Project name
        if "project" in command.lower():
            m = re.search(r"['\"]([^'\"]+)['\"]", args_str)
            if m:
                return m.group(1)

        # Element/inspection names from gom.app.project paths
        m = re.search(r"project\.(\w+)\['([^']+)'\]", args_str)
        if m:
            obj_type = m.group(1)  # e.g., "inspection", "actual_elements", "alignments"
            obj_name = m.group(2)
            type_label = obj_type.replace("_", " ").replace("actual elements", "element")
            return f"{type_label}: {obj_name}"

        # Stage marker names
        m = re.search(r"stage_markers\['([^']+)'\]", args_str)
        if m:
            return f"marker: {m.group(1)}"

        # Legend values
        if "legend" in command:
            vals = re.findall(r"legend_(\w+)=([\d.\-]+)", args_str)
            if vals:
                return ", ".join(f"{k}={v}" for k, v in vals)

        # Alignment name
        m = re.search(r"alignments\['([^']+)'\]", args_str)
        if m:
            return f"alignment: {m.group(1)}"

        return ""
