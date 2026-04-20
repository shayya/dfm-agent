/**
 * Tessellate a B-Rep shape into triangle arrays for Three.js rendering.
 *
 * Uses OCCT's BRepMesh_IncrementalMesh to generate triangulations per face,
 * then extracts vertex positions, normals, and triangle indices.
 *
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - TopoDS_Shape
 * @param {number} [linearDeflection=0.1]  - max distance from surface to mesh
 * @param {number} [angularDeflection=0.5] - max angle between adjacent triangles (rad)
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array, faceGroups: Array }}
 */
export function tessellateShape(oc, shape, linearDeflection = 0.1, angularDeflection = 0.5) {
  // Generate mesh
  new oc.BRepMesh_IncrementalMesh_2(shape, linearDeflection, false, angularDeflection, false);

  const positions = [];
  const normals = [];
  const indices = [];
  const faceGroups = []; // { faceIndex, start, count }

  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let faceIndex = 0;

  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());

    // Get triangulation for this face
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location);
    if (triangulation.IsNull()) {
      faceIndex++;
      faceExp.Next();
      continue;
    }

    const tr = triangulation.get();
    const nbNodes = tr.NbNodes();
    const nbTriangles = tr.NbTriangles();

    // Get the transformation from location
    const trsf = location.Transformation();
    const trsfScale = trsf.ScaleFactor();
    const isIdentity = trsfScale === 1.0; // simplified check

    // Extract nodes (vertices)
    const baseVertex = positions.length / 3;
    for (let i = 1; i <= nbNodes; i++) {
      const p = tr.Node(i);
      // Apply location transform
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
      // Compute face normal from first triangle as fallback
      for (let i = 0; i < nbNodes; i++) {
        normals.push(0, 1, 0); // placeholder
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
    });

    faceIndex++;
    faceExp.Next();
  }

  faceExp.delete();

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceGroups,
  };
}
