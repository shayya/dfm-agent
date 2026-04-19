/**
 * Detect sharp internal corners in a B-Rep shape.
 *
 * A sharp internal corner is a straight edge shared by exactly two planar
 * faces where the junction is concave (material on the inside) and no
 * adjacent fillet (circular edge + cylindrical face) bridges the vertices.
 */

const RAD_TO_DEG = 180 / Math.PI;

/** Clamp x to [-1, 1] before acos to avoid NaN from floating-point drift. */
function safeAcos(x) {
  return Math.acos(Math.max(-1, Math.min(1, x)));
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len3(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function norm3(v) {
  const l = len3(v);
  if (l < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Return the outward unit normal of a planar face at UV parameter (u, v).
 * Reverses sign for REVERSED-oriented faces.
 */
function planeNormal(oc, face, adaptor) {
  const gpDir = adaptor.Plane().Axis().Direction();
  let n = { x: gpDir.X(), y: gpDir.Y(), z: gpDir.Z() };
  // OpenCASCADE reverses the normal for REVERSED faces
  if (face.Orientation().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value) {
    n = { x: -n.x, y: -n.y, z: -n.z };
  }
  return n;
}

/**
 * Sample an interior point on a face at its UV midpoint.
 * Returns a gp_Pnt-like {x,y,z}.
 */
function faceMidPoint(oc, face, adaptor) {
  const uMin = { current: 0 }, uMax = { current: 0 }, vMin = { current: 0 }, vMax = { current: 0 };
  oc.BRepTools.UVBounds_1(face, uMin, uMax, vMin, vMax);
  const uMid = (uMin.current + uMax.current) / 2;
  const vMid = (vMin.current + vMax.current) / 2;
  const pt = adaptor.Value(uMid, vMid);
  return { x: pt.X(), y: pt.Y(), z: pt.Z() };
}

/**
 * Build a map from edge hash → array of {face, faceIndex} for all faces in shape.
 */
function buildEdgeToFacesMap(oc, shape, faces) {
  const edgeToFaces = new Map();

  for (let i = 0; i < faces.length; i++) {
    const { face } = faces[i];
    const wireExp = new oc.TopExp_Explorer_1();
    wireExp.Init(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    while (wireExp.More()) {
      const edgeExp = new oc.TopExp_Explorer_1();
      edgeExp.Init(wireExp.Current(), oc.TopAbs_ShapeEnum.TopAbs_EDGE);
      while (edgeExp.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExp.Current());
        const hash = edge.HashCode(2147483647);
        if (!edgeToFaces.has(hash)) edgeToFaces.set(hash, []);
        const list = edgeToFaces.get(hash);
        // Deduplicate: a face can appear more than once via different wires
        if (!list.some(e => e.faceIndex === i)) {
          list.push({ face, faceIndex: i, edge });
        }
        edgeExp.Next();
      }
      edgeExp.delete();
      wireExp.Next();
    }
    wireExp.delete();
  }

  return edgeToFaces;
}

/**
 * Build a map from vertex hash → array of edge hashes incident on that vertex.
 */
function buildVertexToEdgesMap(oc, shape) {
  const vtxToEdges = new Map();
  const edgeExp = new oc.TopExp_Explorer_1();
  edgeExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
  while (edgeExp.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExp.Current());
    const eHash = edge.HashCode(2147483647);
    const vtxExp = new oc.TopExp_Explorer_1();
    vtxExp.Init(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
    while (vtxExp.More()) {
      const vtx = oc.TopoDS.Vertex_1(vtxExp.Current());
      const vHash = vtx.HashCode(2147483647);
      if (!vtxToEdges.has(vHash)) vtxToEdges.set(vHash, new Set());
      vtxToEdges.get(vHash).add(eHash);
      vtxExp.Next();
    }
    vtxExp.delete();
    edgeExp.Next();
  }
  edgeExp.delete();
  return vtxToEdges;
}

/**
 * Return all edge hashes adjacent (sharing a vertex) to the given edge.
 */
function adjacentEdgeHashes(oc, edge, vtxToEdges) {
  const result = new Set();
  const eHash = edge.HashCode(2147483647);
  const vtxExp = new oc.TopExp_Explorer_1();
  vtxExp.Init(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
  while (vtxExp.More()) {
    const vtx = oc.TopoDS.Vertex_1(vtxExp.Current());
    const vHash = vtx.HashCode(2147483647);
    const edges = vtxToEdges.get(vHash);
    if (edges) {
      for (const h of edges) {
        if (h !== eHash) result.add(h);
      }
    }
    vtxExp.Next();
  }
  vtxExp.delete();
  return result;
}

/**
 * Return the midpoint of an edge by evaluating its curve at the parameter midpoint.
 */
function edgeMidpoint(oc, edge) {
  const adaptor = new oc.BRepAdaptor_Curve_2(edge);
  const t = (adaptor.FirstParameter() + adaptor.LastParameter()) / 2;
  const pt = adaptor.Value(t);
  const result = { x: pt.X(), y: pt.Y(), z: pt.Z() };
  adaptor.delete();
  return result;
}

/**
 * Detect sharp internal corners in `shape`.
 *
 * @param {object} oc  - opencascade.js instance
 * @param {object} shape - parsed TopoDS_Shape
 * @returns {Array<{edgeIndex, startPoint, endPoint, faceA_index, faceB_index, interiorAngleDeg, severity}>}
 */
export function detectSharpCorners(oc, shape) {
  // 1. Collect all faces with their surface adaptors
  const faces = [];
  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    faces.push({ face, adaptor });
    faceExp.Next();
  }
  faceExp.delete();

  // 2. Build edge → faces map and vertex → edges map
  const edgeToFaces = buildEdgeToFacesMap(oc, shape, faces);
  const vtxToEdges = buildVertexToEdgesMap(oc, shape);

  // 3. Collect all edges (deduplicated) with their adaptors
  const edgeMap = new Map(); // hash → {edge, adaptor}
  const edgeExp = new oc.TopExp_Explorer_1();
  edgeExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
  while (edgeExp.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExp.Current());
    const hash = edge.HashCode(2147483647);
    if (!edgeMap.has(hash)) {
      const curveAdaptor = new oc.BRepAdaptor_Curve_2(edge);
      edgeMap.set(hash, { edge, adaptor: curveAdaptor });
    }
    edgeExp.Next();
  }
  edgeExp.delete();

  // 4. For each edge, apply all filters
  const results = [];
  let edgeIndex = 0;

  for (const [hash, { edge, adaptor: curveAdaptor }] of edgeMap) {
    // Filter: must be a straight line
    if (curveAdaptor.GetType().value !== oc.GeomAbs_CurveType.GeomAbs_Line.value) {
      edgeIndex++;
      continue;
    }

    // Filter: must have exactly 2 adjacent faces
    const adjFaces = edgeToFaces.get(hash);
    if (!adjFaces || adjFaces.length !== 2) {
      edgeIndex++;
      continue;
    }

    const fA = adjFaces[0];
    const fB = adjFaces[1];

    // Filter: both faces must be planar
    if (fA.face.Orientation === undefined ||
        fA.adaptor?.GetType === undefined) {
      // Re-fetch adaptors from our faces array
    }
    const adaptorA = faces[fA.faceIndex].adaptor;
    const adaptorB = faces[fB.faceIndex].adaptor;

    if (adaptorA.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Plane.value ||
        adaptorB.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Plane.value) {
      edgeIndex++;
      continue;
    }

    // Get plane normals (orientation-corrected)
    const N_A = planeNormal(oc, faces[fA.faceIndex].face, adaptorA);
    const N_B = planeNormal(oc, faces[fB.faceIndex].face, adaptorB);

    // Concavity test: sample a point on face A's interior
    // If dot(N_B, P_A - edgeMid) < 0 → P_A is on the negative side of face B's plane → concave
    const midPt = edgeMidpoint(oc, edge);
    const P_A = faceMidPoint(oc, faces[fA.faceIndex].face, adaptorA);
    const vecToP_A = sub3(P_A, midPt);
    const concavityDot = dot3(N_B, vecToP_A);
    if (concavityDot >= 0) {
      // Convex (external) edge — skip
      edgeIndex++;
      continue;
    }

    // Fillet check: look at edges sharing the endpoint vertices
    // If any adjacent edge is a circle/arc AND adjacent to a cylindrical face → filleted
    const adjEdgeHashes = adjacentEdgeHashes(oc, edge, vtxToEdges);
    let isFilleted = false;
    for (const adjHash of adjEdgeHashes) {
      const adjEdgeInfo = edgeMap.get(adjHash);
      if (!adjEdgeInfo) continue;
      const adjType = adjEdgeInfo.adaptor.GetType().value;
      if (adjType === oc.GeomAbs_CurveType.GeomAbs_Circle.value ||
          adjType === oc.GeomAbs_CurveType.GeomAbs_Ellipse.value) {
        // Check if this circular edge is adjacent to a cylindrical face
        const circFaces = edgeToFaces.get(adjHash);
        if (circFaces && circFaces.some(cf => {
          const cfAdaptor = faces[cf.faceIndex].adaptor;
          return cfAdaptor.GetType().value === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value;
        })) {
          isFilleted = true;
          break;
        }
      }
    }
    if (isFilleted) {
      edgeIndex++;
      continue;
    }

    // Compute interior angle: π - acos(N_A · N_B)
    // For a concave corner with outward normals, this gives the material-side angle.
    const cosAngle = dot3(N_A, N_B);
    const normalAngleRad = safeAcos(cosAngle);
    const interiorAngleDeg = (Math.PI - normalAngleRad) * RAD_TO_DEG;

    if (interiorAngleDeg >= 135) {
      edgeIndex++;
      continue;
    }

    // Compute start/end points
    const t0 = curveAdaptor.FirstParameter();
    const t1 = curveAdaptor.LastParameter();
    const p0 = curveAdaptor.Value(t0);
    const p1 = curveAdaptor.Value(t1);

    const severity = interiorAngleDeg < 100 ? 'critical' : 'warning';

    results.push({
      edgeIndex,
      startPoint: { x: p0.X(), y: p0.Y(), z: p0.Z() },
      endPoint: { x: p1.X(), y: p1.Y(), z: p1.Z() },
      faceA_index: fA.faceIndex,
      faceB_index: fB.faceIndex,
      interiorAngleDeg: Math.round(interiorAngleDeg * 10) / 10,
      severity,
    });

    edgeIndex++;
  }

  // Cleanup adaptors
  for (const { adaptor } of faces) adaptor.delete();
  for (const { adaptor } of edgeMap.values()) adaptor.delete();

  return results;
}
