# DFM Agent

Browser-based **Design for Manufacturability (DFM)** analyzer for CNC-machined parts. Loads a STEP file, parses it into full B-Rep topology via [opencascade.js](https://opencascade.js.org/) (OpenCASCADE compiled to WASM), runs geometric detectors, and renders the part in 3D with flagged issues highlighted per-face.

The original Python agent (Claude Agent SDK + pythonOCC) lives on `main`. This is the JS B-Rep proof-of-concept on the `occt-brep-analysis` branch.

## Why

Manufacturing engineers spend hours reviewing parts for DFM problems that are often obvious once you see them — sharp internal corners that need custom tooling, holes too deep for their diameter, fillets so small they don't relieve stress concentration. This tool catches those issues at the design stage when they're cheap to fix.

## Status

Working end-to-end: STEP file in, 3D visualization with highlighted DFM issues out.

**Implemented detectors:**

| Detector | What it flags | Severity |
|----------|--------------|----------|
| Sharp internal corners | Concave line edges between planar faces with interior angle < 135° and no fillet | Critical (< 100°), Warning (100–135°) |
| Deep small holes | Cylindrical void faces (axis outside solid) with high depth-to-diameter ratio | Critical (dia < 3 mm, ratio > 6:1), Warning (varies) |
| Small internal fillets | Cylindrical fillet faces (axis inside solid, partial sweep < 300°) with radius < 1.0 mm | Critical (< 0.5 mm), Warning (0.5–1.0 mm) |

**Not yet implemented** (from `spec.md`): min wall thickness, pocket aspect ratio, min feature size.

**Visualization colors:**
- Default faces — steel blue
- Deep holes — orange
- Small fillets — yellow
- Sharp corner edges — red line overlay

## Running

Requires Node.js (for the WASM binary). No build step.

```bash
npm install                 # opencascade.js (includes 65MB WASM binary)
npx serve .                 # then open http://localhost:3000/src/brep/testHarness.html
node src/brep/testNode.mjs  # headless test against samples/part1.step
```

Loads Three.js from CDN via import map — no bundler needed.

## Architecture

```
src/brep/
  testHarness.html          browser UI: file picker, 3D viewer, issue list
    └─ main.js              entry point: file picker → orchestrator → Three.js viewer
         ├─ stepLoader.js   load WASM, parse STEP → TopoDS_Shape + topology stats
         ├─ detectSharpCorners.js
         ├─ detectDeepHoles.js
         ├─ detectSmallFillets.js
         ├─ tessellate.js   BRepMesh → per-face triangle arrays for Three.js
         └─ testNode.mjs    headless Node.js test runner
```

**Pipeline:** STEP file → opencascade.js WASM → B-Rep shape → detectors + tessellation → Three.js scene

All detectors use `BRepClass3d_SolidClassifier` for inside/outside tests instead of `face.Orientation()` (not exposed in this opencascade.js build).

## Stack

- **CAD parsing:** opencascade.js v1.1.1 (OCCT V7_4_0p1 compiled to WASM)
- **3D rendering:** Three.js 0.160.0 (CDN)
- **Runtime:** browser (import maps) + Node.js (headless test)
- **No build step, no bundler, no framework**

## Building in public

Documenting this build day-by-day as part of a 6-month transition into AI agent engineering. Follow along:

- **LinkedIn:** linkedin.com/in/snirenberg
- **GitHub:** [@shayya](https://github.com/shayya)

## License

MIT
