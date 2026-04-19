/**
 * Detect deep small holes in a B-Rep shape.
 *
 * A hole is a cylindrical face whose outward surface normal points TOWARD
 * the cylinder axis (i.e. the face is the interior wall of a drilled hole),
 * as opposed to an external boss/shaft whose normal points away from the axis.
 */

/**
 * Project point P onto the infinite line defined by origin O and direction D (unit vector).
 * Returns the projection point.
 */
function projectPointOnAxis(P, O, D) {
  const t = (P.x - O.x) * D.x + (P.y - O.y) * D.y + (P.z - O.z) * D.z;
  return { x: O.x + t * D.x, y: O.y + t * D.y, z: O.z + t * D.z };
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
 * Detect deep/small holes in `shape`.
 *
 * Severity thresholds:
 *   diameter < 3 mm AND aspect ratio > 6:1  → critical
 *   diameter < 3 mm AND aspect ratio > 4:1  → warning
 *   diameter >= 3 mm AND aspect ratio > 8:1 → warning
 *
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - parsed TopoDS_Shape
 * @returns {Array<{faceIndex, diameter, depth, aspectRatio, axisStart, axisEnd, severity}>}
 */
export function detectDeepHoles(oc, shape) {
  const results = [];

  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  let faceIndex = 0;

  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);

    if (adaptor.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value) {
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

    // Depth along the axis from the face's V parameter bounds
    // For a cylinder in OCCT, V is the coordinate along the axis.
    const vMin = adaptor.FirstVParameter();
    const vMax = adaptor.LastVParameter();
    const depth = Math.abs(vMax - vMin);

    // Axis endpoints
    const axisStart = { x: O.x + vMin * D.x, y: O.y + vMin * D.y, z: O.z + vMin * D.z };
    const axisEnd   = { x: O.x + vMax * D.x, y: O.y + vMax * D.y, z: O.z + vMax * D.z };

    // Hole vs. shaft test:
    // Sample a point on the surface at UV midpoint, compute the vector from
    // the nearest axis point to the surface point (V_out), compare with
    // the face normal at the same UV.
    const uMin = adaptor.FirstUParameter();
    const uMax = adaptor.LastUParameter();
    const uMid = (uMin + uMax) / 2;
    const vMid = (vMin + vMax) / 2;

    const surfPt_raw = adaptor.Value(uMid, vMid);
    const surfPt = { x: surfPt_raw.X(), y: surfPt_raw.Y(), z: surfPt_raw.Z() };

    const axisProjPt = projectPointOnAxis(surfPt, O, D);
    const V_out = sub3(surfPt, axisProjPt); // points away from axis toward surface

    // Get the face normal at (uMid, vMid)
    // For a BRepAdaptor_Surface we can compute the normal via DN(u,v,Nu,Nv)
    // Simpler: use gp_Cylinder to compute the outward normal analytically.
    // For a cylinder, the outward normal at a surface point = norm(surfPt - axisProjPt)
    // corrected for face orientation.
    const normalDir = norm3(V_out); // analytical outward normal (away from axis)
    let normalSign = 1;
    if (face.Orientation().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value) {
      normalSign = -1;
    }
    // The face normal (as OCCT reports it) is normalDir * normalSign
    const faceNormal = { x: normalDir.x * normalSign, y: normalDir.y * normalSign, z: normalDir.z * normalSign };

    // dot(faceNormal, V_out):
    //   > 0  → normal points away from axis → external shaft → skip
    //   < 0  → normal points toward axis → internal surface (hole)
    const holeTest = dot3(faceNormal, V_out);
    if (holeTest >= 0) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

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
