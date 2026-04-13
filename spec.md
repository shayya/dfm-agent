# DFM Agent — v1 Specification

**Status:** Draft · **Date:** April 13, 2026 · **Owner:** Shaya Nirenberg
**Phase:** 1 (Foundations & First Ship) · **Ship target:** May 4, 2026

---

## 1. Problem statement

Mechanical engineers designing parts for CNC machining routinely submit CAD files that violate manufacturability rules — thin walls, deep narrow pockets, sharp internal corners, hole depth-to-diameter ratios that no end mill can reach. These issues get caught late, by suppliers, after quoting. The result: redesign cycles, cost overruns, schedule slips.

**The DFM Agent automates first-pass DFM review for CNC-machined parts.** It ingests a STEP file, analyzes the geometry against established CNC DFM rules, and produces a prioritized report of manufacturability issues with specific measurements and suggested fixes.

**Who it's for (v1):** A design engineer reviewing their own part before sending it to a machine shop. Not a supplier, not a procurement team — one engineer, one part, one review.

---

## 2. Input / output contract

### Input
- **One STEP file** (`.step` or `.stp`), representing a single part (not an assembly) for v1.
- **Optional:** a target material (e.g., "6061 aluminum", "304 stainless"). If omitted, agent uses generic CNC rules.

### Output
A structured report containing:
- **Summary:** one-paragraph assessment (is this part CNC-friendly overall?)
- **Issue list**, each issue containing:
  - Severity (critical / warning / info)
  - Rule violated (e.g., "Hole depth-to-diameter ratio exceeds 10:1")
  - Location in the part (feature ID or coordinates)
  - Measured value vs. rule threshold
  - Suggested fix in plain English
- **Measurements appendix:** the raw geometric measurements the agent gathered

Output format: Markdown for v1. (JSON is a v2 nice-to-have for programmatic consumers.)

---

## 3. DFM rules in scope for v1

Start with a small, well-documented rule set. Each rule must be (a) measurable from STEP geometry, (b) widely agreed-upon in CNC practice, (c) something the agent can explain.

**v1 rule set:**
1. **Minimum wall thickness** — flag walls thinner than 0.8mm (aluminum) / 0.5mm (steel)
2. **Hole depth-to-diameter ratio** — flag holes where depth/diameter > 10:1 (standard end mill reach)
3. **Internal corner radii** — flag sharp internal corners (radius = 0); CNC cannot produce zero-radius internal corners
4. **Deep pocket aspect ratio** — flag pockets where depth exceeds 4× the smallest width
5. **Minimum feature size** — flag any feature smaller than 1mm (tool access limits)

Five rules is enough to make the agent non-trivial and demo-worthy without drowning v1 in edge cases.

---

## 4. Agent architecture sketch

The agent is a tool-using loop. Claude is the reasoner; Python functions are the measurement tools.

**Tools the agent can call:**
- `list_features(step_file)` → returns all holes, pockets, walls, fillets in the part with IDs
- `measure_wall_thickness(feature_id)` → returns min wall thickness near that feature
- `measure_hole(feature_id)` → returns diameter, depth, depth/diameter ratio
- `measure_corner_radius(feature_id)` → returns internal corner radii
- `measure_pocket(feature_id)` → returns depth, min width, aspect ratio
- `get_bounding_box(step_file)` → overall part envelope

**Happy-path loop:**
1. Agent calls `list_features` to inventory the part
2. Agent reasons: "I see 3 holes, 2 pockets, 8 walls. Let me check each against v1 rules."
3. Agent calls measurement tools on each feature
4. Agent collects violations, ranks by severity
5. Agent writes the markdown report

**Why this is an agent, not a script:**
- The agent decides *which* features to investigate more deeply based on what it finds
- The agent reasons about edge cases ("this wall is thin but it's a non-structural flange — still flag it? yes, because v1 rule doesn't know context")
- The agent explains its findings in natural language, tying measurements to DFM principles

---

## 5. Tech stack

- **LLM:** Claude (via Claude Agent SDK)
- **STEP parsing:** `pythonOCC-core` (OpenCascade bindings) — industry standard, free, handles STEP robustly
- **Language:** Python 3.11+
- **Environment:** already set up in `~/dev/dfm-agent/`

**Open question for Session 2 / Day 4:** `pythonOCC-core` has a steep learning curve. Fallback is `cadquery` (higher-level, built on OCC, friendlier API). Decide after a 30-min evaluation spike.

---

## 6. Explicitly OUT of scope for v1

Naming these so scope creep gets caught early:

- ❌ Assemblies (single parts only)
- ❌ Native CAD formats (SolidWorks, Fusion, etc.) — STEP only
- ❌ 2D drawings / PDFs
- ❌ Tolerance analysis / GD&T
- ❌ Thread callouts / threading feasibility
- ❌ Surface finish recommendations
- ❌ Material selection advice
- ❌ Cost estimation
- ❌ Multi-setup machining strategy
- ❌ 5-axis vs 3-axis tool access reasoning
- ❌ Web UI — v1 is a CLI tool

---

## 7. Success criteria (how do I know v1 works?)

v1 ships when all of the following are true:

1. **End-to-end runs:** Given a STEP file, the agent produces a markdown report without crashing.
2. **Finds known violations:** A test STEP file with 3 intentional violations → agent catches all 3.
3. **No egregious false positives:** A test STEP file of a well-designed part → agent flags ≤1 false positive.
4. **Explainable:** Every flagged issue includes the measurement and the rule. No "this looks bad" without numbers.
5. **Public:** Repo is public, README explains the project, one example STEP file + example report committed.

Items 2 and 3 form the seed of the Phase 1 eval suite. Build ~5 test STEP files (3 violating, 2 clean) and automate the check.

---

## 8. Build plan (Day 3 → May 4)

Rough sketch — to be refined daily:

- **Week 1 (Apr 13–19):** Spec done (today). Stand up `pythonOCC` or `cadquery`, write `list_features` + 1 measurement tool. Agent loop wrapping those tools.
- **Week 2 (Apr 20–26):** Remaining measurement tools. All 5 rules implemented. First end-to-end report on a real STEP file.
- **Week 3 (Apr 27–May 3):** Eval suite (5 test parts). Iterate on report quality. Write README + architecture diagram.
- **Week 4 (May 4):** Ship. Public announcement post. Phase 1 retro.

---

## 9. Open questions (revisit as we build)

1. `pythonOCC` vs `cadquery` — decide Day 4
2. How does the agent handle STEP files that fail to parse? (graceful error path)
3. Should severity be agent-judged or rule-defined? (lean: rule-defined for v1, agent-judged for v2)
4. How do we get realistic test STEP files? (download free ones from GrabCAD? model simple ones in onshape?)