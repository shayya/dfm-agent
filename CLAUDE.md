# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DFM Agent — an AI agent that analyzes CAD STEP files for CNC manufacturability issues. This branch (`occt-brep-analysis`) is the JS B-Rep analyzer: a browser-based 3D visualization proof-of-concept using opencascade.js WASM.

The Python agent (Claude Agent SDK + pythonOCC) lives on `main`.

## Running

```bash
# Browser (3D viewer)
npx serve .
# open http://localhost:<port>/src/brep/testHarness.html

# Node.js (headless test)
node src/brep/testNode.mjs
```

## Architecture

### JS B-Rep (`src/brep/`)
- `stepLoader.js` — fetches 65MB WASM binary, parses STEP into TopoDS_Shape
- `detectSharpCorners.js` — Line edges between Planes, concave, no fillet, angle < 135°
- `detectDeepHoles.js` — Cylindrical faces classified hole-vs-shaft via `BRepClass3d_SolidClassifier`
- `tessellate.js` — `BRepMesh_IncrementalMesh_2` → triangle arrays for Three.js
- `main.js` — orchestrates loader → detectors → tessellation → Three.js viewer
- `testHarness.html` — sidebar + 3D viewer split layout, Three.js + OrbitControls from CDN

## opencascade.js API Quirks

These are critical when working with the `src/brep/` code:

- **VFS paths must be relative** — `oc.FS.writeFile('model.step', data)` works; `/model.step` causes `ReadFile` to return `IFSelect_RetError`
- **`face.Orientation()` is not exposed** in opencascade.js 1.1.1 — use `BRepClass3d_SolidClassifier_2` instead to test inside/outside
- **`TopExp_Explorer.Init` requires 3 args**: `(shape, TopAbs_FACE, TopAbs_SHAPE)` — not 2
- **`BRep_Tool.Triangulation(face, loc)`** returns a handle — call `.get()` to get the `Poly_Triangulation` object
- **`Message_ProgressRange` is not constructable** — call `reader.TransferRoots()` with no args
- **`BRepTools.UVBounds` incompatible** — use `adaptor.FirstUParameter()` etc. instead
- **WASM binary is 65MB** — must be fetched explicitly via `fetch()` and passed as `wasmBinary` to the factory (Emscripten's internal fetch fails)
- **Enum comparisons use `.value`** — e.g., `adaptor.GetType().value === PLANE`

## DFM Rules (v1 scope)

From `spec.md` — ship target May 4, 2026:

| # | Rule | Threshold |
|---|------|-----------|
| 1 | Min wall thickness | 0.8mm (Al), 0.5mm (steel) |
| 2 | Hole depth/diameter ratio | > 10:1 |
| 3 | Sharp internal corners | radius = 0 |
| 4 | Deep pocket aspect ratio | depth > 4× width |
| 5 | Min feature size | < 1mm |

Rules 2 and 3 are implemented in the JS B-Rep analyzer. All 5 are targeted for the Python agent.

## Environment

- `node_modules/` is not gitignored (contains opencascade.js WASM)
- JS dependencies: `opencascade.js@^1.1.1` (no bundler — uses browser import maps + CDN for Three.js)
- Three.js loaded from jsDelivr CDN (`three@0.160.0`) — not a local dependency
