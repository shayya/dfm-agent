/**
 * Detect sharp internal corners in a B-Rep shape.
 *
 * A sharp internal corner is:
 *   - A straight (Line) edge
 *   - Shared by exactly two planar faces
 *   - Where the junction is concave (material on the inside of the angle)
 *   - No adjacent cylindrical face bridging the vertices (i.e. no fillet)
 *   - Interior angle < 135°
 *
 * The concavity test:
 *   Take the outward normals N_A, N_B of the two planes and a point P_A
 *   on face A's interior (not on the shared edge).  The edge is concave
 *   when dot(N_B, P_A − edgeMidpoint) < 0 — P_A lies on the negative side
 *   of face B's outward half-space, meaning material fills the interior.
 *
 * Interior angle = π − acos(N_A · N_B).
 */

const RAD_TO_DEG = 180 / Math.PI;

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
 * Get the outward unit normal of a planar face.
 * OCCT stores the geometric normal in the gp_Ax1 of the underlying gp_Plane.
 * For REVERSED-oriented faces the effective outward normal is flipped.
 */
function planeOutwardNormal(oc, face, adaptor) {
  const gpDir = adaptor.Plane().Axis().Direction();
  let n = { x: gpDir.X(), y: gpDir.Y(), z: gpDir.Z() };
  if (face.Orientation().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value) {
    n = { x: -n.x, y: -n.y, z: -n.z };
  }
  return n;
}

/**
 * Sample an interior point on a face at its UV midpoint.
 */
function faceInteriorPoint(oc, face, adaptor) {
  const uMin = { current: 0 }, uMax = { current: 0 };
  const vMin = { current: 0 }, vMax = { current: 0 };
  oc.BRepTools.UVBounds_1(face, uMin, uMax, vMin, vMax);
  const uMid = (uMin.current + uMax.current) / 2;
  const vMid = (vMin.current + vMax.current) / 2;
  const pt = adaptor.Value(uMid, vMid);
  return { x: pt.X(), y: pt.Y(), z: pt.Z() };
}

/**
 * Evaluate an edge's curve at its parameter midpoint.
 */
function edgeMidpoint(curveAdaptor) {
  const t = (curveAdaptor.FirstParameter() + curveAdaptor.LastParameter()) / 2;
  const pt = curveAdaptor.Value(t);
  return { x: pt.X(), y: pt.Y(), z: pt.Z() };
}

// ---------- topology maps ----------

/**
 * Collect all faces with their surface adaptors.
 * Returns array of { face, adaptor, surfaceType }.
 */
function collectFaces(oc, shape) {
  const faces = [];
  const exp = new oc.TopExp_Explorer_1();
  exp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  while (exp.More()) {
    const face = oc.TopoDS.Face_1(exp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    faces.push({ face, adaptor, surfaceType: adaptor.GetType().value });
    exp.Next();
  }
  exp.delete();
  return faces;
}

/**
 * Build edge-hash → [faceIndex] adjacency.
 * Iterates each face's wires → edges.
 */
function buildEdgeToFacesMap(oc, faces) {
  const map = new Map();
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
        if (!map.has(hash)) map.set(hash, []);
        const list = map.get(hash);
        if (!list.includes(i)) list.push(i);
        edgeExp.Next();
      }
      edgeExp.delete();
      wireExp.Next();
    }
    wireExp.delete();
  }
  return map;
}

/**
 * Build vertex-hash → Set(edge-hash) incidence.
 */
function buildVertexToEdgesMap(oc, shape) {
  const map = new Map();
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
      if (!map.has(vHash)) map.set(vHash, new Set());
      map.get(vHash).add(eHash);
      vtxExp.Next();
    }
    vtxExp.delete();
    edgeExp.Next();
  }
  edgeExp.delete();
  return map;
}

/**
 * Collect all unique edges (deduplicated by hash) with curve adaptors.
 */
function collectEdges(oc, shape) {
  const map = new Map();
  const exp = new oc.TopExp_Explorer_1();
  exp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
  while (exp.More()) {
    const edge = oc.TopoDS.Edge_1(exp.Current());
    const hash = edge.HashCode(2147483647);
    if (!map.has(hash)) {
      map.set(hash, { edge, curveAdaptor: new oc.BRepAdaptor_Curve_2(edge) });
    }
    exp.Next();
  }
  exp.delete();
  return map;
}

// ---------- main detector ----------

/**
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - TopoDS_Shape
 * @returns {Array<{edgeIndex, startPoint, endPoint, faceA_index, faceB_index,
 *                    interiorAngleDeg, severity}>}
 */
export function detectSharpCorners(oc, shape) {
  const PLANE = oc.GeomAbs_SurfaceType.GeomAbs_Plane.value;
  const LINE  = oc.GeomAbs_CurveType.GeomAbs_Line.value;
  const CIRCLE = oc.GeomAbs_CurveType.GeomAbs_Circle.value;
  const ELLIPSE = oc.GeomAbs_CurveType.GeomAbs_Ellipse.value;
  const CYLINDER = oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value;

  const faces = collectFaces(oc, shape);
  const edgeToFaces = buildEdgeToFacesMap(oc, faces);
  const vtxToEdges = buildVertexToEdgesMap(oc, shape);
  const edgeMap = collectEdges(oc, shape);

  const results = [];
  let edgeIndex = 0;

  for (const [hash, { edge, curveAdaptor }] of edgeMap) {
    // 1. Must be a straight line
    if (curveAdaptor.GetType().value !== LINE) { edgeIndex++; continue; }

    // 2. Must be shared by exactly two faces
    const adjFaceIndices = edgeToFaces.get(hash);
    if (!adjFaceIndices || adjFaceIndices.length !== 2) { edgeIndex++; continue; }

    const idxA = adjFaceIndices[0];
    const idxB = adjFaceIndices[1];

    // 3. Both adjacent faces must be planar
    if (faces[idxA].surfaceType !== PLANE || faces[idxB].surfaceType !== PLANE) {
      edgeIndex++; continue;
    }

    const faceA = faces[idxA];
    const faceB = faces[idxB];

    // 4. Concavity test
    const N_A = planeOutwardNormal(oc, faceA.face, faceA.adaptor);
    const N_B = planeOutwardNormal(oc, faceB.face, faceB.adaptor);
    const midPt = edgeMidpoint(curveAdaptor);
    const P_A = faceInteriorPoint(oc, faceA.face, faceA.adaptor);
    const vecToPA = sub3(P_A, midPt);
    // If P_A is on the negative side of face B's outward half-space → concave
    if (dot3(N_B, vecToPA) >= 0) { edgeIndex++; continue; }

    // 5. Fillet check — any vertex-neighbour edge that is circular/elliptical
    //    AND adjacent to a cylindrical face means a fillet is present.
    let isFilleted = false;
    {
      const vtxExp = new oc.TopExp_Explorer_1();
      vtxExp.Init(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
      while (vtxExp.More()) {
        const vtx = oc.TopoDS.Vertex_1(vtxExp.Current());
        const vHash = vtx.HashCode(2147483647);
        const incidentEdges = vtxToEdges.get(vHash);
        if (incidentEdges) {
          for (const adjHash of incidentEdges) {
            if (adjHash === hash) continue;
            const adjInfo = edgeMap.get(adjHash);
            if (!adjInfo) continue;
            const adjType = adjInfo.curveAdaptor.GetType().value;
            if (adjType === CIRCLE || adjType === ELLIPSE) {
              const circFaces = edgeToFaces.get(adjHash);
              if (circFaces && circFaces.some(fi =>
                faces[fi].surfaceType === CYLINDER)) {
                isFilleted = true;
                break;
              }
            }
          }
        }
        if (isFilleted) break;
        vtxExp.Next();
      }
      vtxExp.delete();
    }
    if (isFilleted) { edgeIndex++; continue; }

    // 6. Compute interior angle = π − acos(N_A · N_B)
    const cosAngle = dot3(N_A, N_B);
    const normalAngleRad = safeAcos(cosAngle);
    const interiorAngleDeg = (Math.PI - normalAngleRad) * RAD_TO_DEG;

    if (interiorAngleDeg >= 135) { edgeIndex++; continue; }

    // 7. Record result
    const t0 = curveAdaptor.FirstParameter();
    const t1 = curveAdaptor.LastParameter();
    const p0 = curveAdaptor.Value(t0);
    const p1 = curveAdaptor.Value(t1);

    const severity = interiorAngleDeg < 100 ? 'critical' : 'warning';

    results.push({
      edgeIndex,
      startPoint: { x: p0.X(), y: p0.Y(), z: p0.Z() },
      endPoint:   { x: p1.X(), y: p1.Y(), z: p1.Z() },
      faceA_index: idxA,
      faceB_index: idxB,
      interiorAngleDeg: Math.round(interiorAngleDeg * 10) / 10,
      severity,
    });

    edgeIndex++;
  }

  // Cleanup adaptors
  for (const { adaptor } of faces) adaptor.delete();
  for (const { curveAdaptor } of edgeMap.values()) curveAdaptor.delete();

  return results;
}
