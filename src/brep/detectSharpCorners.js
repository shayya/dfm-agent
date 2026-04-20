/**
 * Detect sharp internal corners in a B-Rep shape.
 *
 * A sharp internal corner is:
 *   - A straight (Line) edge
 *   - Shared by exactly two planar faces
 *   - Where the junction is concave (material on the inside of the angle)
 *   - No adjacent cylindrical face bridging the vertices (i.e. no fillet)
 *   - Interior angle < 135 degrees
 *
 * Concavity test (no face.Orientation() needed):
 *   Determine each face's outward normal via solid classifier, then test
 *   a point in the quadrant (material-side of face A, void-side of face B)
 *   using direction outB − outA.  For a concave internal corner, material
 *   wraps around through this quadrant → INSIDE.  For an external convex
 *   corner, this quadrant is void → OUTSIDE.
 */

const RAD_TO_DEG = 180 / Math.PI;
const MIN_TOOL_RADIUS_MM = 0.794; // 1/32" end mill

function safeAcos(x) {
  return Math.acos(Math.max(-1, Math.min(1, x)));
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale3(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function len3(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function norm3(v) {
  const l = len3(v);
  if (l < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Get the geometric unit normal of a planar face.
 * Returns the axis direction of the underlying gp_Plane.
 */
function planeGeometricNormal(oc, adaptor) {
  const gpDir = adaptor.Plane().Axis().Direction();
  return { x: gpDir.X(), y: gpDir.Y(), z: gpDir.Z() };
}

/**
 * Sample an interior point on a face at its UV midpoint.
 */
function faceInteriorPoint(adaptor) {
  const uMid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
  const vMid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
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

/**
 * Project a direction vector onto a plane (remove normal component).
 */
function projectOntoPlane(v, normal) {
  const d = dot3(v, normal);
  return norm3(sub3(v, scale3(normal, d)));
}

/**
 * Compute how far the cusp leg may extend along a face before hitting
 * another edge of that face.  Samples ~8 points on each non-shared edge
 * and returns the minimum positive projection onto tangentDir.
 */
function computeMaxLegAlongTangent(oc, face, sharedEdgeHash, tangentDir, originPoint, edgeEndpoints) {
  let minProj = Infinity;
  const VERT_TOL_SQ = 0.01; // 0.1mm squared — skip samples near shared-edge vertices

  const wireExp = new oc.TopExp_Explorer_1();
  wireExp.Init(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (wireExp.More()) {
    const edgeExp = new oc.TopExp_Explorer_1();
    edgeExp.Init(wireExp.Current(), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (edgeExp.More()) {
      const edge = oc.TopoDS.Edge_1(edgeExp.Current());
      const hash = edge.HashCode(2147483647);

      if (hash === sharedEdgeHash) { edgeExp.Next(); continue; }

      const curve = new oc.BRepAdaptor_Curve_2(edge);
      const t0 = curve.FirstParameter();
      const t1 = curve.LastParameter();
      const N_SAMPLES = 8;

      for (let s = 0; s <= N_SAMPLES; s++) {
        const t = t0 + (t1 - t0) * s / N_SAMPLES;
        const pt = curve.Value(t);
        const px = pt.X(), py = pt.Y(), pz = pt.Z();

        // Skip points near shared-edge endpoints (their projection ≈ 0 is an artifact)
        let nearVertex = false;
        for (const ep of edgeEndpoints) {
          if ((px - ep.x) ** 2 + (py - ep.y) ** 2 + (pz - ep.z) ** 2 < VERT_TOL_SQ) {
            nearVertex = true;
            break;
          }
        }
        if (nearVertex) continue;

        const proj = (px - originPoint.x) * tangentDir.x +
                     (py - originPoint.y) * tangentDir.y +
                     (pz - originPoint.z) * tangentDir.z;
        if (proj > 0 && proj < minProj) minProj = proj;
      }

      curve.delete();
      edgeExp.Next();
    }
    edgeExp.delete();
    wireExp.Next();
  }
  wireExp.delete();

  return minProj === Infinity ? 1000 : minProj;
}

// ---------- topology maps ----------

function collectFaces(oc, shape) {
  const faces = [];
  const exp = new oc.TopExp_Explorer_1();
  exp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (exp.More()) {
    const face = oc.TopoDS.Face_1(exp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    faces.push({ face, adaptor, surfaceType: adaptor.GetType().value });
    exp.Next();
  }
  exp.delete();
  return faces;
}

function buildEdgeToFacesMap(oc, faces) {
  const map = new Map();
  for (let i = 0; i < faces.length; i++) {
    const { face } = faces[i];
    const wireExp = new oc.TopExp_Explorer_1();
    wireExp.Init(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (wireExp.More()) {
      const edgeExp = new oc.TopExp_Explorer_1();
      edgeExp.Init(wireExp.Current(), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
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

function buildVertexToEdgesMap(oc, shape) {
  const map = new Map();
  const edgeExp = new oc.TopExp_Explorer_1();
  edgeExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (edgeExp.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExp.Current());
    const eHash = edge.HashCode(2147483647);
    const vtxExp = new oc.TopExp_Explorer_1();
    vtxExp.Init(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
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

function collectEdges(oc, shape) {
  const map = new Map();
  const exp = new oc.TopExp_Explorer_1();
  exp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
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
  const TOPABS_OUT = 1; // TopAbs_State.TopAbs_OUT

  const faces = collectFaces(oc, shape);
  const edgeToFaces = buildEdgeToFacesMap(oc, faces);
  const vtxToEdges = buildVertexToEdgesMap(oc, shape);
  const edgeMap = collectEdges(oc, shape);

  // Build solid classifier for concavity test
  const classifier = new oc.BRepClass3d_SolidClassifier_2(shape);

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

    // 4. Compute geometric normals for both planes
    const N_A = planeGeometricNormal(oc, faceA.adaptor);
    const N_B = planeGeometricNormal(oc, faceB.adaptor);

    // 5. Fillet check — any vertex-neighbour edge that is circular/elliptical
    //    AND adjacent to a cylindrical face means a fillet is present.
    let isFilleted = false;
    {
      const vtxExp = new oc.TopExp_Explorer_1();
      vtxExp.Init(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
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

    // 6. Concavity test using solid classifier:
    //    Determine each face's outward normal, then test a point in the
    //    quadrant that's on the material-side of face A and void-side of
    //    face B (direction = outB − outA).  For a concave internal corner,
    //    material wraps around through this quadrant → INSIDE.  For an
    //    external convex corner, this quadrant is void → OUTSIDE.
    const midPt = edgeMidpoint(curveAdaptor);
    const eps = 0.01;

    // Determine outward normal for each face
    const pA = add3(midPt, scale3(N_A, eps));
    classifier.Perform(new oc.gp_Pnt_3(pA.x, pA.y, pA.z), 1e-7);
    const outA = classifier.State().value === TOPABS_OUT ? N_A : scale3(N_A, -1);

    const pB = add3(midPt, scale3(N_B, eps));
    classifier.Perform(new oc.gp_Pnt_3(pB.x, pB.y, pB.z), 1e-7);
    const outB = classifier.State().value === TOPABS_OUT ? N_B : scale3(N_B, -1);

    // Test point in the (material-side of A, void-side of B) quadrant
    const testDir = norm3(sub3(outB, outA));
    const testPoint = add3(midPt, scale3(testDir, eps));

    const testPt = new oc.gp_Pnt_3(testPoint.x, testPoint.y, testPoint.z);
    classifier.Perform(testPt, 1e-7);
    const state = classifier.State().value;

    // If test point is OUTSIDE the solid → convex external corner → skip
    if (state === TOPABS_OUT) { edgeIndex++; continue; }

    // 7. Compute interior angle
    //    Use the geometric normals. The angle between the planes is
    //    acos(|N_A . N_B|). For a concave junction, the interior angle
    //    (material side) is pi - acos(N_A . N_B).
    const cosAngle = dot3(N_A, N_B);
    const normalAngleRad = safeAcos(cosAngle);
    const interiorAngleDeg = (Math.PI - normalAngleRad) * RAD_TO_DEG;

    if (interiorAngleDeg >= 135) { edgeIndex++; continue; }

    // 8. Record result
    const t0 = curveAdaptor.FirstParameter();
    const t1 = curveAdaptor.LastParameter();
    const p0 = curveAdaptor.Value(t0);
    const p1 = curveAdaptor.Value(t1);

    const severity = interiorAngleDeg < 100 ? 'critical' : 'warning';

    // 9. Compute face-interior directions for cusp geometry
    //    Use UV midpoints to get directions from the edge toward each face's
    //    interior.  These are tangential to the face and reliably point from
    //    the edge into the pocket void for the cusp visualization.
    const P_A = faceInteriorPoint(faceA.adaptor);
    const P_B = faceInteriorPoint(faceB.adaptor);
    const dirA = norm3(sub3(P_A, midPt));
    const dirB = norm3(sub3(P_B, midPt));

    const tanA = projectOntoPlane(dirA, N_A);
    const tanB = projectOntoPlane(dirB, N_B);
    const thetaRad = interiorAngleDeg / RAD_TO_DEG;
    const aPhysical = MIN_TOOL_RADIUS_MM / Math.tan(thetaRad / 2);
    const edgeEndpoints = [
      { x: p0.X(), y: p0.Y(), z: p0.Z() },
      { x: p1.X(), y: p1.Y(), z: p1.Z() },
    ];
    const maxLegA = computeMaxLegAlongTangent(oc, faceA.face, hash, tanA, midPt, edgeEndpoints);
    const maxLegB = computeMaxLegAlongTangent(oc, faceB.face, hash, tanB, midPt, edgeEndpoints);

    results.push({
      edgeIndex,
      startPoint: { x: p0.X(), y: p0.Y(), z: p0.Z() },
      endPoint:   { x: p1.X(), y: p1.Y(), z: p1.Z() },
      faceA_index: idxA,
      faceB_index: idxB,
      interiorAngleDeg: Math.round(interiorAngleDeg * 10) / 10,
      severity,
      faceA_normal: { x: N_A.x, y: N_A.y, z: N_A.z },
      faceB_normal: { x: N_B.x, y: N_B.y, z: N_B.z },
      faceA_interiorDir: { x: dirA.x, y: dirA.y, z: dirA.z },
      faceB_interiorDir: { x: dirB.x, y: dirB.y, z: dirB.z },
      maxLegA_mm: maxLegA,
      maxLegB_mm: maxLegB,
      clamped: (aPhysical > maxLegA) || (aPhysical > maxLegB),
    });

    edgeIndex++;
  }

  // Cleanup adaptors
  for (const { adaptor } of faces) adaptor.delete();
  for (const { curveAdaptor } of edgeMap.values()) curveAdaptor.delete();
  classifier.delete();

  return results;
}
