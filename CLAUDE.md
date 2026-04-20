# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser-based DFM (Design for Manufacturability) analyzer for CNC-machined parts. Loads a STEP file, parses it into full B-Rep topology via opencascade.js WASM, runs geometric detectors, and renders the part in 3D with flagged issues highlighted.

This is the JS B-Rep proof-of-concept on the `occt-brep-analysis` branch. The original Python agent (Claude Agent SDK + pythonOCC) lives on `main`.

## Running

```bash
npm install                 # opencascade.js (includes 65MB WASM binary)
npx serve .                 # then open /src/brep/testHarness.html
node src/brep/testNode.mjs  # headless test against samples/part1.step
```

No build step — uses browser import maps and Three.js from CDN.

## Architecture

```
testHarness.html
  └─ main.js              entry point: file picker → orchestrator → Three.js viewer
       ├─ stepLoader.js    fetch WASM, parse STEP → TopoDS_Shape + topology stats
       ├─ detectSharpCorners.js
       ├─ detectDeepHoles.js
       ├─ detectSmallFillets.js
       └─ tessellate.js    BRepMesh → triangle arrays for Three.js
```

**Pipeline:** STEP file → opencascade.js WASM → B-Rep shape → detectors + tessellation → Three.js scene

### Detectors (what's implemented)

| Detector | What it finds | How |
|----------|--------------|-----|
| Sharp corners | Line edges between two Planes, **internal** concave (pocket/recess), no fillet, angle < 135° | `BRepClass3d_SolidClassifier` — determine each face's outward normal via classifier, then test point in the (material-side of A, void-side of B) quadrant using direction `outB − outA`; fillet check via adjacent Circle+Cylinder edges |
| Deep holes | Cylindrical faces that are voids (not shafts), with high depth/diameter | `BRepClass3d_SolidClassifier` — axis midpoint outside solid = hole |
| Small fillets | Cylindrical fillet faces (axis inside solid, partial sweep < 300°) with radius < 1.0 mm | `BRepClass3d_SolidClassifier` — axis midpoint inside solid = internal fillet |

### Visualization

Single light gray mesh with black B-Rep edge lines (`EdgesGeometry`, 20° feature angle). Issue overlays are drawn on top as separate geometry:

- **Sharp corners** — blue wedge (cusp) geometry showing the material a tool can't reach, computed from edge endpoints, face normals, and interior directions
- **Deep holes** — bright blue axis lines through the hole center
- **Small fillets** — listed in results but no 3D overlay yet

Toolbar controls: transparency slider, six preset views (top/front/bottom/back/left/right), home (fit camera), highlight toggle on/off, scale bar (1 inch reference), axis gizmo (lower-left).

### Tessellation

Per-face adaptive `BRepMesh_IncrementalMesh` — each face gets deflection settings matched to its surface type:
- Plane: 0.1 linear / 0.3 angular (coarse, flat anyway)
- Cylinder/Cone/Sphere/Torus: 0.01 / 0.05 (fine, prevents faceting)
- BSpline/other: 0.02 / 0.08 (medium)

`faceGroups` entries include `surfaceType` string for material assignment.

Two more rules from `spec.md` are not yet implemented: min wall thickness, pocket aspect ratio, min feature size.

## opencascade.js API quirks

These are non-obvious and cost significant debugging time. All apply to opencascade.js v1.1.1 (OCCT V7_4_0p1):

- **VFS paths must be relative** — `'model.step'` works, `'/model.step'` causes `ReadFile` to return `IFSelect_RetError`
- **`face.Orientation()` is not exposed** — use `BRepClass3d_SolidClassifier_2(shape)` then `.Perform(point, tol)` and check `.State().value` (0=IN, 1=OUT) to determine inside/outside
- **`TopExp_Explorer.Init` takes 3 args** — `(shape, TopAbs_FACE, TopAbs_SHAPE)` not 2
- **`BRep_Tool.Triangulation(face, loc)`** returns a Handle — call `.get()` to get the `Poly_Triangulation` with `.NbNodes()`, `.Node(i)`, `.Triangle(i)`
- **`Message_ProgressRange` not constructable** — call `reader.TransferRoots()` with no args
- **`BRepTools.UVBounds` incompatible** — use `adaptor.FirstUParameter()` / `.LastUParameter()` instead
- **WASM is 65MB** — fetch explicitly via `fetch()` and pass `wasmBinary` to the factory; Emscripten's internal fetch fails
- **Enum comparisons use `.value`** — `adaptor.GetType().value === PLANE` not `adaptor.GetType() === PLANE`
- **`BRepMesh_IncrementalMesh_2`** is the correct constructor — takes `(shape, deflection, false, angle, false)`

## Key dependencies

| Package | Version | Notes |
|---------|---------|-------|
| opencascade.js | ^1.1.1 | Full OCCT WASM — not occt-import-js (that only gives meshes) |
| three | 0.160.0 | Loaded from jsDelivr CDN, not npm — must use `three.module.min.js` and `examples/jsm/` paths |

## Project context

- `spec.md` — full v1 specification (5 DFM rules, ship target May 4, 2026)
- `samples/part1.step` — test part (15 faces: 11 Plane + 4 Cylinder, 72 edges)
- `samples/din.step` — DIN rail test part (266 faces, 1588 edges)
- `node_modules/` is not gitignored (contains the WASM binary)
