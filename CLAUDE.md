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
       └─ tessellate.js    BRepMesh → triangle arrays for Three.js
```

**Pipeline:** STEP file → opencascade.js WASM → B-Rep shape → detectors + tessellation → Three.js scene

### Detectors (what's implemented)

| Detector | What it finds | How |
|----------|--------------|-----|
| Sharp corners | Line edges between two Planes, **internal** concave (pocket/recess), no fillet, angle < 135° | `BRepClass3d_SolidClassifier` — test point inside dihedral angle OUTSIDE solid = internal concave; fillet check via adjacent Circle+Cylinder edges |
| Deep holes | Cylindrical faces that are voids (not shafts), with high depth/diameter | `BRepClass3d_SolidClassifier` — axis midpoint outside solid = hole |

### Visualization

Per-face highlighting via Three.js `addGroup()` + multi-material array. Flagged faces (from detector `faceIndex`/`faceA_index`/`faceB_index`) get colored materials:
- Sharp corner faces → red (`0xff3333`)
- Deep hole faces → orange (`0xff8800`)
- All other faces → default steel blue (`0x7a8fa6`)

### Tessellation

Per-face adaptive `BRepMesh_IncrementalMesh` — each face gets deflection settings matched to its surface type:
- Plane: 0.1 linear / 0.3 angular (coarse, flat anyway)
- Cylinder/Cone/Sphere/Torus: 0.01 / 0.05 (fine, prevents faceting)
- BSpline/other: 0.02 / 0.08 (medium)

`faceGroups` entries include `surfaceType` string for material assignment.

Three more rules from `spec.md` are not yet implemented: min wall thickness, pocket aspect ratio, min feature size.

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
- `node_modules/` is not gitignored (contains the WASM binary)
