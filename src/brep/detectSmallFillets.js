/**
 * Detect small internal fillets in a B-Rep shape.
 *
 * A small internal fillet is a cylindrical face where:
 *   1. Surface type is Cylinder
 *   2. uSweep < 300° (partial arc — rules out full drilled holes)
 *   3. Cylinder axis midpoint is INSIDE the solid (material wraps around
 *      the fillet — internal concave corner), NOT outside (external round)
 *   4. Radius < FILLET_RADIUS_THRESHOLD (default 1.0 mm)
 *
 * Uses BRepClass3d_SolidClassifier to test inside/outside, same pattern
 * as detectDeepHoles.js but with the state check inverted.
 */

const FILLET_RADIUS_THRESHOLD = 1.0; // mm

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
 * @returns {Array<{faceIndex, radius, axis, location, severity}>}
 */
export function detectSmallFillets(oc, shape) {
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

    // Must be a partial arc (< 300°), not a full drilled hole
    const uSweep = Math.abs(adaptor.LastUParameter() - adaptor.FirstUParameter());
    const MAX_FILLET_SWEEP = (300 * Math.PI) / 180; // ~5.236 rad
    if (uSweep >= MAX_FILLET_SWEEP) {
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

    // Point on the axis at V-midpoint
    const vMin = adaptor.FirstVParameter();
    const vMax = adaptor.LastVParameter();
    const vMid = (vMin + vMax) / 2;

    const axisMid = {
      x: O.x + vMid * D.x,
      y: O.y + vMid * D.y,
      z: O.z + vMid * D.z,
    };

    // Internal-fillet test: axis midpoint must be INSIDE the solid
    // (material wraps around an internal concave fillet).
    // External rounds have their axis in void (OUTSIDE solid) — skip those.
    const testPt = new oc.gp_Pnt_3(axisMid.x, axisMid.y, axisMid.z);
    classifier.Perform(testPt, 1e-7);
    const state = classifier.State().value;

    if (state === TOPABS_OUT) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

    // Radius threshold check
    if (radius >= FILLET_RADIUS_THRESHOLD) {
      adaptor.delete();
      faceIndex++;
      faceExp.Next();
      continue;
    }

    // Classify severity
    const severity = radius < 0.5 ? 'critical' : 'warning';

    results.push({
      faceIndex,
      radius: Math.round(radius * 1000) / 1000,
      axis: D,
      location: axisMid,
      severity,
    });

    adaptor.delete();
    faceIndex++;
    faceExp.Next();
  }

  faceExp.delete();
  classifier.delete();
  return results;
}
