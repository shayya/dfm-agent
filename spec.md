# DFM Agent — v1 Specification

**Status:** In progress · **Date:** April 13, 2026 · **Owner:** Shaya Nirenberg
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

The browser UI shows issues in a sidebar list with severity coloring and 3D overlay geometry on the part.

---

## 3. DFM rules in scope for v1

Start with a small, well-documented rule set. Each rule must be (a) measurable from STEP geometry, (b) widely agreed-upon in CNC practice, (c) something the agent can explain.

**v1 rule set:**
1. ~~**Minimum wall thickness**~~ — flag walls thinner than 0.8mm (aluminum) / 0.5mm (steel) — *not yet implemented*
2. **Hole depth-to-diameter ratio** — flag holes where depth/diameter > 10:1 (standard end mill reach) — *implemented*
3. **Internal corner radii** — flag sharp internal corners (radius = 0); CNC cannot produce zero-radius internal corners — *implemented*
4. ~~**Deep pocket aspect ratio**~~ — flag pockets where depth exceeds 4× the smallest width — *not yet implemented*
5. ~~**Minimum feature size**~~ — flag any feature smaller than 1mm (tool access limits) — *not yet implemented*

**Additionally implemented:**
- **Small internal fillets** — flag fillet radii < 1.0 mm that are too small to effectively relieve stress concentration

---

## 4. Implementation architecture

Browser-based app using opencascade.js (OpenCASCADE compiled to WASM) for STEP parsing and B-Rep analysis, Three.js for 3D visualization. No LLM in the loop for v1 — purely geometric detectors run directly on the B-Rep topology.

**Pipeline:** STEP file → opencascade.js WASM → B-Rep shape → detectors + tessellation → Three.js scene

**Detectors:**
- `detectSharpCorners` — finds concave line edges between planar faces with interior angle < 135° and no adjacent fillet. Uses `BRepClass3d_SolidClassifier` to determine outward normals and test concavity via the (material-side of A, void-side of B) quadrant.
- `detectDeepHoles` — finds cylindrical void faces with high depth-to-diameter ratio. Uses classifier to distinguish holes (axis outside solid) from shafts (axis inside).
- `detectSmallFillets` — finds cylindrical fillet faces with radius < 1.0 mm. Checks partial sweep (< 300°) and axis inside solid to distinguish internal fillets from external rounds and full holes.

**Visualization:**
- Light gray mesh with black B-Rep edge lines
- Blue wedge overlays for sharp corners (showing leftover material a tool can't reach)
- Blue axis lines for deep holes
- Sidebar list with severity-colored issues
- Toolbar: transparency, preset views, highlight toggle, scale bar, axis gizmo

---

## 5. Tech stack

- **CAD parsing:** opencascade.js v1.1.1 (OCCT V7_4_0p1 compiled to WASM)
- **3D rendering:** Three.js 0.160.0 (CDN via import map)
- **Language:** JavaScript (ES modules)
- **Runtime:** browser + Node.js (headless test)
- **No build step, no bundler, no framework**

The original Python agent (Claude Agent SDK + pythonOCC) lives on the `main` branch. This is the JS B-Rep proof-of-concept on the `occt-brep-analysis` branch.

---

## 6. Explicitly OUT of scope for v1

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

---

## 7. Success criteria (how do I know v1 works?)

v1 ships when all of the following are true:

1. **End-to-end runs:** Given a STEP file, the analyzer produces an issue report without crashing.
2. **Finds known violations:** A test STEP file with intentional violations → analyzer catches them.
3. **No egregious false positives:** A test STEP file of a well-designed part → analyzer flags ≤1 false positive.
4. **Explainable:** Every flagged issue includes the measurement and the rule. No "this looks bad" without numbers.
5. **Public:** Repo is public, README explains the project, example STEP files committed.

---

## 8. Build plan

- **Week 1 (Apr 13–19):** Spec done. Stand up opencascade.js, STEP loading, first detector (sharp corners).
- **Week 2 (Apr 20–26):** Deep holes, small fillets, 3D visualization with overlay geometry. ✅
- **Week 3 (Apr 27–May 3):** Remaining rules (wall thickness, pocket ratio, feature size). Eval suite with test parts.
- **Week 4 (May 4):** Ship. Public announcement post. Phase 1 retro.

---

## 9. Open questions (revisit as we build)

1. How to measure wall thickness from B-Rep? (ray-based approach? mesh-based?)
2. How does the agent handle STEP files that fail to parse? (graceful error path)
3. Should severity be agent-judged or rule-defined? (lean: rule-defined for v1, agent-judged for v2)
4. How do we get realistic test STEP files? (download free ones from GrabCAD? model simple ones in onshape?)
