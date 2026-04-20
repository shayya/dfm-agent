/**
 * Detect deep small holes in a B-Rep shape.
 *
 * A hole is a cylindrical face whose interior (axis midpoint) is OUTSIDE
 * the solid (void space), as opposed to a shaft whose axis is inside
 * the material.
 *
 * Uses BRepClass3d_SolidClassifier to test whether a point on the
 * cylinder axis is inside or outside the solid, which avoids relying
 * on face.Orientation() (not exposed in this opencascade.js build).
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
 * @param {object} oc    - opencascade.js instance
 * @param {object} shape - TopoDS_Shape
 * @returns {Array<{faceIndex, diameter, depth, aspectRatio, severity}>}
 */
export function detectDeepHoles(oc, shape) {
  const CYLINDER = oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value;
  const TOPABS_OUT = 1; // TopAbs_State.TopAbs_OUT

  const results = [];
  const classifier = new oc.BRepClass3d_SolidClassifier_2(shape);

  const faceExp = new oc.TopExp_Explorer_1();
  faceExp.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
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
    const vMid = (vMin + vMax) / 2;

    // Point on the axis at midpoint
    const axisMid = {
      x: O.x + vMid * D.x,
      y: O.y + vMid * D.y,
      z: O.z + vMid * D.z,
    };

    // Hole-vs-shaft test using solid classifier:
    // If the axis midpoint is OUTSIDE the solid → void → hole
    // If the axis midpoint is INSIDE the solid → material → shaft
    const testPt = new oc.gp_Pnt_3(axisMid.x, axisMid.y, axisMid.z);
    classifier.Perform(testPt, 1e-7);
    const state = classifier.State().value;

    if (state !== TOPABS_OUT) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

    // It's a hole. Classify severity.
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
        location: axisMid,
        axis: D,
        diameter: Math.round(diameter * 1000) / 1000,
        depth: Math.round(depth * 1000) / 1000,
        aspectRatio: Math.round(aspectRatio * 100) / 100,
        severity,
      });
    }

    adaptor.delete();
    faceIndex++;
    faceExp.Next();
  }

  faceExp.delete();
  classifier.delete();
  return results;
}
