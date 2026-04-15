"""
agent.py — DFM analysis agent for CNC machined parts.

Usage:
    python agent.py <file.step> [--material aluminum|steel]

The agent calls pythonOCC measurement tools to analyze the STEP file and
streams a markdown DFM report to stdout. Tool call logs go to stderr.
"""
import argparse
import json
import sys

import anthropic
from dotenv import load_dotenv

from list_features import list_features
from measure import (
    get_bounding_box,
    measure_corner_radius,
    measure_hole,
    measure_pocket,
    measure_wall_thickness,
)

load_dotenv()

# --- DFM thresholds ---

WALL_THRESHOLDS = {"aluminum": 0.8, "steel": 0.5}

# --- Tool schemas ---

TOOLS = [
    {
        "name": "list_features",
        "description": (
            "List all faces in the loaded STEP part with geometry details: "
            "face type (planar, cylindrical, conical, etc.), area_mm2, "
            "diameter_mm for cylinders, normal vector for planes, axis for cylinders. "
            "Call this first to inventory the part."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_bounding_box",
        "description": "Return the overall bounding box of the part (x, y, z extents in mm).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "measure_hole",
        "description": (
            "Measure a cylindrical hole face. Returns diameter_mm, depth_mm, "
            "and depth_to_diameter_ratio. Only works on cylindrical faces."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "feature_id": {
                    "type": "string",
                    "description": "Face ID from list_features, e.g. 'f_003'",
                }
            },
            "required": ["feature_id"],
        },
    },
    {
        "name": "measure_corner_radius",
        "description": (
            "Measure edge radii on a face. Returns min_radius_mm, "
            "has_sharp_corners (bool), and a list of all edge radii. "
            "Use on planar faces that form pocket walls or internal features."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "feature_id": {
                    "type": "string",
                    "description": "Face ID from list_features",
                }
            },
            "required": ["feature_id"],
        },
    },
    {
        "name": "measure_wall_thickness",
        "description": (
            "Measure wall thickness at a planar face by ray-casting through the part. "
            "Returns thickness_mm. Only works on planar faces."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "feature_id": {
                    "type": "string",
                    "description": "Face ID from list_features",
                }
            },
            "required": ["feature_id"],
        },
    },
    {
        "name": "measure_pocket",
        "description": (
            "Measure a planar face as a pocket floor. Returns depth_mm, "
            "min_width_mm, and aspect_ratio (depth/min_width). "
            "Use on small interior planar faces, not outer walls."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "feature_id": {
                    "type": "string",
                    "description": "Face ID from list_features",
                }
            },
            "required": ["feature_id"],
        },
    },
]


# --- System prompt ---

def build_system_prompt(material: str) -> str:
    threshold = WALL_THRESHOLDS[material]
    return f"""\
You are a DFM (Design for Manufacturability) analysis agent for CNC-machined parts.
A STEP file has been loaded. Target material: {material}.

Your goal: analyze this part for CNC manufacturability issues and write a markdown DFM report.

Workflow:
1. Call list_features() to inventory all faces. Note face types, areas, and IDs.
2. Call get_bounding_box() for the part envelope.
3. For each cylindrical face → call measure_hole(feature_id) to get depth/diameter ratio.
4. For planar faces that look like pocket floors (interior, smaller area, not the main outer faces) → call measure_pocket(feature_id).
5. For planar faces forming pocket walls or interior features → call measure_corner_radius(feature_id).
6. For planar outer wall faces (exterior, large area) → call measure_wall_thickness(feature_id) on a sample of them.
7. Collect all measurements, apply DFM rules, then write the final report.

DFM rules to enforce for {material}:
- Wall thickness < {threshold}mm → CRITICAL
- Hole depth/diameter > 10 → CRITICAL
- Internal corner radius = 0 on a pocket wall → WARNING
- Pocket aspect ratio (depth/min_width) > 4 → WARNING
- Any feature dimension < 1mm → WARNING

Output a markdown DFM report in this format:

## DFM Analysis Report

**Part:** <filename>
**Material:** {material}
**Date:** <today>

### Executive Summary
<1–2 sentence overall assessment>

### Issues

| Severity | Rule | Feature | Measured | Threshold | Suggested Fix |
|----------|------|---------|----------|-----------|---------------|
<one row per violation>

### Measurements Appendix

<table of all raw measurements gathered>

If no issues are found, say so clearly in the executive summary and leave the issues table empty.\
"""


# --- Tool dispatch ---

_cached_features: dict = {}


def dispatch_tool(name: str, inputs: dict) -> str:
    try:
        if name == "list_features":
            result = _cached_features
        elif name == "get_bounding_box":
            result = get_bounding_box()
        elif name == "measure_hole":
            result = measure_hole(inputs["feature_id"])
        elif name == "measure_corner_radius":
            result = measure_corner_radius(inputs["feature_id"])
        elif name == "measure_wall_thickness":
            result = measure_wall_thickness(inputs["feature_id"])
        elif name == "measure_pocket":
            result = measure_pocket(inputs["feature_id"])
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:
        result = {"error": str(e)}
    return json.dumps(result)


# --- Agent loop ---

def run_agent(args: argparse.Namespace) -> None:
    global _cached_features

    print(f"Loading {args.step_file} ...", file=sys.stderr)
    _cached_features = list_features(args.step_file)
    if "error" in _cached_features:
        print(f"ERROR: {_cached_features['error']}", file=sys.stderr)
        sys.exit(1)
    summary = _cached_features["summary"]
    print(
        f"Loaded: {summary['faces']} faces, {summary['edges']} edges, "
        f"{summary['vertices']} vertices",
        file=sys.stderr,
    )

    client = anthropic.Anthropic()
    messages = [
        {
            "role": "user",
            "content": (
                f"Please analyze the STEP file '{args.step_file}' for DFM issues. "
                f"Target material: {args.material}."
            ),
        }
    ]

    while True:
        print("\n[Agent thinking...]", file=sys.stderr)
        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=8096,
            system=build_system_prompt(args.material),
            tools=TOOLS,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            response = stream.get_final_message()

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            print()  # trailing newline after streamed output
            break

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    inputs_display = json.dumps(block.input) if block.input else "{}"
                    print(
                        f"\n[Tool: {block.name}({inputs_display})]",
                        file=sys.stderr,
                    )
                    result_str = dispatch_tool(block.name, block.input)
                    # Truncate long results in the log
                    log_preview = result_str if len(result_str) < 300 else result_str[:300] + "..."
                    print(f"[Result: {log_preview}]", file=sys.stderr)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result_str,
                        }
                    )
            messages.append({"role": "user", "content": tool_results})
            continue

        print(f"\n[Unexpected stop_reason: {response.stop_reason}]", file=sys.stderr)
        break


# --- CLI entry point ---

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="DFM analysis agent for CNC machined parts"
    )
    p.add_argument("step_file", help="Path to .step or .stp file")
    p.add_argument(
        "--material",
        choices=["aluminum", "steel"],
        default="aluminum",
        help="Target material (affects wall thickness threshold). Default: aluminum",
    )
    return p.parse_args()


if __name__ == "__main__":
    run_agent(parse_args())
