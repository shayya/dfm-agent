/**
 * opencascade.js loader — works in both browser (via import map) and Node.js.
 *
 * Browser: import map resolves "opencascade.js" to the WASM JS module.
 * Node.js: createRequire is used in testNode.mjs; this module expects the
 *          browser path.
 */

import opencascadeFactory from 'opencascade.js';

let _oc = null;

/**
 * Initialize (or return cached) opencascade.js instance.
 * Fetches the WASM binary explicitly (avoids Emscripten's internal fetch
 * which can fail with large files on some servers).
 */
async function getOC() {
  if (!_oc) {
    const wasmUrl = '/node_modules/opencascade.js/dist/opencascade.wasm.wasm';
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }
    const wasmBinary = await response.arrayBuffer();
    _oc = await opencascadeFactory({ wasmBinary });
  }
  return _oc;
}

/**
 * Load a STEP file into a B-Rep shape.
 *
 * @param {ArrayBuffer} arrayBuffer - raw bytes of a .step / .stp file
 * @returns {{ oc: object, shape: object, stats: object }}
 */
export async function loadStep(arrayBuffer) {
  const oc = await getOC();
  const data = new Uint8Array(arrayBuffer);

  // Write into Emscripten virtual filesystem.
  // NOTE: use a relative path (no leading /) — absolute paths cause
  // ReadFile to return IFSelect_RetError in this WASM build.
  oc.FS.writeFile('model.step', data);

  const reader = new oc.STEPControl_Reader_1();
  const readStatus = reader.ReadFile('model.step');
  try { oc.FS.unlink('model.step'); } catch (_) {}

  // readStatus may be an OCCT enum object (.value) or a plain number
  const doneVal = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
  const statusVal = readStatus.value !== undefined ? readStatus.value : readStatus;
  if (statusVal !== doneVal) {
    throw new Error(`STEPControl_Reader failed with status ${statusVal}`);
  }

  reader.TransferRoots();
  const shape = reader.OneShape();

  const stats = collectStats(oc, shape);
  console.log('[stepLoader] B-Rep structure:', stats);

  return { oc, shape, stats };
}

function collectStats(oc, shape) {
  const surfaceTypeNames = {
    [oc.GeomAbs_SurfaceType.GeomAbs_Plane.value]: 'Plane',
    [oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value]: 'Cylinder',
    [oc.GeomAbs_SurfaceType.GeomAbs_Cone.value]: 'Cone',
    [oc.GeomAbs_SurfaceType.GeomAbs_Sphere.value]: 'Sphere',
    [oc.GeomAbs_SurfaceType.GeomAbs_Torus.value]: 'Torus',
    [oc.GeomAbs_SurfaceType.GeomAbs_BezierSurface.value]: 'Bezier',
    [oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface.value]: 'BSpline',
    [oc.GeomAbs_SurfaceType.GeomAbs_SurfaceOfRevolution.value]: 'Revolution',
    [oc.GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion.value]: 'Extrusion',
    [oc.GeomAbs_SurfaceType.GeomAbs_OtherSurface.value]: 'Other',
  };

  const curveTypeNames = {
    [oc.GeomAbs_CurveType.GeomAbs_Line.value]: 'Line',
    [oc.GeomAbs_CurveType.GeomAbs_Circle.value]: 'Circle',
    [oc.GeomAbs_CurveType.GeomAbs_Ellipse.value]: 'Ellipse',
    [oc.GeomAbs_CurveType.GeomAbs_Hyperbola.value]: 'Hyperbola',
    [oc.GeomAbs_CurveType.GeomAbs_Parabola.value]: 'Parabola',
    [oc.GeomAbs_CurveType.GeomAbs_BezierCurve.value]: 'BezierCurve',
    [oc.GeomAbs_CurveType.GeomAbs_BSplineCurve.value]: 'BSplineCurve',
    [oc.GeomAbs_CurveType.GeomAbs_OtherCurve.value]: 'OtherCurve',
  };

  const faceCounts = {};
  const faceExplorer = new oc.TopExp_Explorer_1();
  faceExplorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let faceTotal = 0;
  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    const t = adaptor.GetType().value;
    const name = surfaceTypeNames[t] ?? `Unknown(${t})`;
    faceCounts[name] = (faceCounts[name] ?? 0) + 1;
    faceTotal++;
    adaptor.delete();
    faceExplorer.Next();
  }
  faceExplorer.delete();

  const edgeCounts = {};
  const edgeExplorer = new oc.TopExp_Explorer_1();
  edgeExplorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let edgeTotal = 0;
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    const adaptor = new oc.BRepAdaptor_Curve_2(edge);
    const t = adaptor.GetType().value;
    const name = curveTypeNames[t] ?? `Unknown(${t})`;
    edgeCounts[name] = (edgeCounts[name] ?? 0) + 1;
    edgeTotal++;
    adaptor.delete();
    edgeExplorer.Next();
  }
  edgeExplorer.delete();

  return { faceTotal, faceCounts, edgeTotal, edgeCounts };
}
