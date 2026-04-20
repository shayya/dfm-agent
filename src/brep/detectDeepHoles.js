/**
 * Detect deep small holes in a B-Rep shape.
 *
 * A hole is a cylindrical face whose outward surface normal points TOWARD
 * the cylinder axis (i.e. the face is the interior wall of a drilled hole),
 * as opposed to an external boss/shaft whose normal points away from the axis.
 *
 * Hole-vs-shaft test:
 *   Sample a point on the surface, compute the vector from the nearest axis
 *   point to the surface point (V_out).  Then get the face's outward normal
 *   at that UV (analytically: V_out direction, flipped for REVERSED faces).
 *   If dot(faceNormal, V_out) < 0 the normal points toward the axis → hole.
 */

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
 * Project point P onto the line (origin O, unit direction D).
 */
function projectOnAxis(P, O, D) {
  const t = (P.x - O.x) * D.x + (P.y - O.y) * D.y + (P.z - O.z) * D.z;
  return { x: O.x + t * D.x, y: O.y + t * D.y, z: O.z + t * D.z };
}

/**
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - TopoDS_Shape
 * @returns {Array<{faceIndex, diameter, depth, aspectRatio, axisStart, axisEnd, severity}>}
 */
export function detectDeepHoles(oc, shape) {
  const CYLINDER = oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value;
  const REVERSED = oc.TopAbs_Orientation.TopAbs_REVERSED.value;

  const results = [];
  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  let faceIndex = 0;

  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);

    // Only cylindrical faces
    if (adaptor.GetType().value !== CYLINDER) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

    // Extract cylinder geometry
    const cyl = adaptor.Cylinder();
    const radius = cyl.Radius();
    const axisLoc = cyl.Axis().Location();
    const axisDir = cyl.Axis().Direction();

    const O = { x: axisLoc.X(), y: axisLoc.Y(), z: axisLoc.Z() };
    const D = norm3({ x: axisDir.X(), y: axisDir.Y(), z: axisDir.Z() });

    // Depth from V-parameter range (V is along the axis for OCCT cylinders)
    const vMin = adaptor.FirstVParameter();
    const vMax = adaptor.LastVParameter();
    const depth = Math.abs(vMax - vMin);

    const axisStart = { x: O.x + vMin * D.x, y: O.y + vMin * D.y, z: O.z + vMin * D.z };
    const axisEnd   = { x: O.x + vMax * D.x, y: O.y + vMax * D.y, z: O.z + vMax * D.z };

    // Hole-vs-shaft test:
    // Sample a point on the cylinder surface at UV midpoint.
    const uMid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
    const vMid = (vMin + vMax) / 2;
    const surfPtRaw = adaptor.Value(uMid, vMid);
    const surfPt = { x: surfPtRaw.X(), y: surfPtRaw.Y(), z: surfPtRaw.Z() };

    // Vector from nearest axis point to surface point (points AWAY from axis)
    const axisProj = projectOnAxis(surfPt, O, D);
    const V_out = sub3(surfPt, axisProj);

    // Analytical outward normal for a cylinder = direction away from axis
    const outwardDir = norm3(V_out);

    // Account for face orientation: REVERSED faces flip the effective normal
    const sign = (face.Orientation().value === REVERSED) ? -1 : 1;
    const faceNormal = {
      x: outwardDir.x * sign,
      y: outwardDir.y * sign,
      z: outwardDir.z * sign,
    };

    // dot(faceNormal, V_out) > 0 → normal points away from axis → shaft → skip
    // dot(faceNormal, V_out) < 0 → normal points toward axis → hole
    if (dot3(faceNormal, V_out) >= 0) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

    // Classify severity
    const diameter = 2 * radius;
    const aspectRatio = depth / diameter;

    let severity = null;
    if (diameter < 3.0) {
      if (aspectRatio > 6) severity = 'critical';
      else if (aspectRatio > 4) severity = 'warning';
    } else {
      if (aspectRatio > 8) severity = 'warning';
    }

    if (severity !== null) {
      results.push({
        faceIndex,
        diameter: Math.round(diameter * 1000) / 1000,
        depth: Math.round(depth * 1000) / 1000,
        aspectRatio: Math.round(aspectRatio * 100) / 100,
        axisStart,
        axisEnd,
        severity,
      });
    }

    adaptor.delete();
    faceIndex++;
    faceExp.Next();
  }

  faceExp.delete();
  return results;
}
