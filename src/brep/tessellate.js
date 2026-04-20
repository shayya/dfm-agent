/**
 * Tessellate a B-Rep shape into triangle arrays for Three.js rendering.
 *
 * Uses OCCT's BRepMesh_IncrementalMesh per face with adaptive deflection:
 *   - Plane:      0.1  linear, 0.3  angular
 *   - Cylinder/Cone/Sphere/Torus: 0.01 linear, 0.05 angular
 *   - BSpline/other: 0.02 linear, 0.08 angular
 *
 * Returns faceGroups with surfaceType for per-face material assignment.
 *
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - TopoDS_Shape
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array, faceGroups: Array }}
 */

const SURFACE_TYPE_NAMES = {
  0: 'Plane',
  1: 'Cylinder',
  2: 'Cone',
  3: 'Sphere',
  4: 'Torus',
  5: 'BezierSurface',
  6: 'BSplineSurface',
  7: 'Revolution',
  8: 'Extrusion',
  9: 'OtherSurface',
};

// Deflection presets keyed by surface type enum value
const DEFLECTION_PRESETS = {
  0: { linear: 0.1,  angular: 0.3  }, // Plane
  1: { linear: 0.01, angular: 0.05 }, // Cylinder
  2: { linear: 0.01, angular: 0.05 }, // Cone
  3: { linear: 0.01, angular: 0.05 }, // Sphere
  4: { linear: 0.01, angular: 0.05 }, // Torus
  5: { linear: 0.02, angular: 0.08 }, // BezierSurface
  6: { linear: 0.02, angular: 0.08 }, // BSplineSurface
  7: { linear: 0.02, angular: 0.08 }, // Revolution
  8: { linear: 0.02, angular: 0.08 }, // Extrusion
  9: { linear: 0.02, angular: 0.08 }, // OtherSurface
};

const DEFAULT_DEFLECTION = { linear: 0.02, angular: 0.08 };

export function tessellateShape(oc, shape) {
  // First pass: mesh each face with adaptive deflection
  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    const typeVal = adaptor.GetType().value;
    adaptor.delete();

    const preset = DEFLECTION_PRESETS[typeVal] || DEFAULT_DEFLECTION;
    new oc.BRepMesh_IncrementalMesh_2(face, preset.linear, false, preset.angular, false);

    faceExp.Next();
  }
  faceExp.delete();

  // Second pass: extract triangulation data
  const positions = [];
  const normals = [];
  const indices = [];
  const faceGroups = [];

  const extractExp = new oc.TopExp_Explorer_1();
  extractExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let faceIndex = 0;

  while (extractExp.More()) {
    const face = oc.TopoDS.Face_1(extractExp.Current());

    // Classify surface type for the faceGroup entry
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    const surfaceType = SURFACE_TYPE_NAMES[adaptor.GetType().value] || 'OtherSurface';
    adaptor.delete();

    // Get triangulation for this face
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location);
    if (triangulation.IsNull()) {
      faceIndex++;
      extractExp.Next();
      continue;
    }

    const tr = triangulation.get();
    const nbNodes = tr.NbNodes();
    const nbTriangles = tr.NbTriangles();

    // Get the transformation from location
    const trsf = location.Transformation();
    const trsfScale = trsf.ScaleFactor();
    const isIdentity = trsfScale === 1.0;

    // Extract nodes (vertices)
    const baseVertex = positions.length / 3;
    for (let i = 1; i <= nbNodes; i++) {
      const p = tr.Node(i);
      if (!isIdentity) {
        p.Transform(trsf);
      }
      positions.push(p.X(), p.Y(), p.Z());
    }

    // Extract normals (if available)
    const hasNormals = tr.HasNormals();
    if (hasNormals) {
      for (let i = 1; i <= nbNodes; i++) {
        const n = tr.Normal(i);
        normals.push(n.X(), n.Y(), n.Z());
      }
    } else {
      for (let i = 0; i < nbNodes; i++) {
        normals.push(0, 1, 0);
      }
    }

    // Extract triangles (indices — OCCT uses 1-based)
    const indexStart = indices.length;
    for (let i = 1; i <= nbTriangles; i++) {
      const tri = tr.Triangle(i);
      indices.push(
        baseVertex + tri.Value(1) - 1,
        baseVertex + tri.Value(2) - 1,
        baseVertex + tri.Value(3) - 1,
      );
    }

    faceGroups.push({
      faceIndex,
      start: indexStart,
      count: indices.length - indexStart,
      surfaceType,
    });

    faceIndex++;
    extractExp.Next();
  }

  extractExp.delete();

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceGroups,
  };
}
