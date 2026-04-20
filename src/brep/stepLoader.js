import initOpenCascade from 'opencascade.js';

let _oc = null;

async function getOC() {
  if (!_oc) {
    _oc = await initOpenCascade();
  }
  return _oc;
}

/**
 * Load a STEP file into a B-Rep shape.
 *
 * Uses opencascade.js (full OpenCASCADE WASM), NOT occt-import-js.
 * occt-import-js only produces tessellated meshes — no face types, no edge
 * types, no topology.  opencascade.js gives us the real B-Rep: Geom_Plane,
 * Geom_CylindricalSurface, TopExp_Explorer, etc.
 *
 * @param {ArrayBuffer} arrayBuffer - raw bytes of a .step / .stp file
 * @returns {{ oc: object, shape: object, stats: object }}
 */
export async function loadStep(arrayBuffer) {
  const oc = await getOC();
  const data = new Uint8Array(arrayBuffer);

  // Write the file into the Emscripten virtual filesystem
  oc.FS.createDataFile('/', 'model.step', data, true, true);

  const reader = new oc.STEPControl_Reader_1();
  const readStatus = reader.ReadFile('/model.step');
  oc.FS.unlink('/model.step');

  if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    throw new Error(`STEPControl_Reader failed with status ${readStatus}`);
  }

  reader.TransferRoots(new oc.Message_ProgressRange_1());
  const shape = reader.OneShape();

  const stats = collectStats(oc, shape);
  console.log('[stepLoader] B-Rep structure:', stats);
  console.log('[stepLoader] Full shape:', shape);

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
  faceExplorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
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
  edgeExplorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
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
