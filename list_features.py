"""
list_features.py — v1 of the first DFM agent tool.
Reads a STEP file, returns per-face geometric detail the agent can reason about.
"""
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX
from OCC.Core.TopoDS import topods
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import (
    GeomAbs_Plane,
    GeomAbs_Cylinder,
    GeomAbs_Cone,
    GeomAbs_Sphere,
    GeomAbs_Torus,
    GeomAbs_BSplineSurface,
    GeomAbs_BezierSurface,
)
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop


SURFACE_TYPE_NAMES = {
    GeomAbs_Plane: "planar_face",
    GeomAbs_Cylinder: "cylindrical_face",
    GeomAbs_Cone: "conical_face",
    GeomAbs_Sphere: "spherical_face",
    GeomAbs_Torus: "toroidal_face",
    GeomAbs_BSplineSurface: "bspline_face",
    GeomAbs_BezierSurface: "bezier_face",
}


def _count(shape, topo_type):
    explorer = TopExp_Explorer(shape, topo_type)
    n = 0
    while explorer.More():
        n += 1
        explorer.Next()
    return n


def _face_area(face):
    props = GProp_GProps()
    brepgprop.SurfaceProperties(face, props)
    return round(props.Mass(), 3)  # Mass on a surface = area


def _describe_face(face, face_id):
    """Return a dict describing one face's surface type + key geometry."""
    surf = BRepAdaptor_Surface(face)
    surf_type = surf.GetType()
    type_name = SURFACE_TYPE_NAMES.get(surf_type, "unknown_face")

    feature = {
        "id": face_id,
        "type": type_name,
        "area_mm2": _face_area(face),
    }

    if surf_type == GeomAbs_Plane:
        plane = surf.Plane()
        n = plane.Axis().Direction()
        feature["normal"] = [round(n.X(), 4), round(n.Y(), 4), round(n.Z(), 4)]

    elif surf_type == GeomAbs_Cylinder:
        cyl = surf.Cylinder()
        axis_dir = cyl.Axis().Direction()
        feature["diameter_mm"] = round(cyl.Radius() * 2, 3)
        feature["axis"] = [round(axis_dir.X(), 4), round(axis_dir.Y(), 4), round(axis_dir.Z(), 4)]

    elif surf_type == GeomAbs_Cone:
        cone = surf.Cone()
        feature["half_angle_deg"] = round(cone.SemiAngle() * 180 / 3.141592653589793, 3)

    elif surf_type == GeomAbs_Sphere:
        sphere = surf.Sphere()
        feature["radius_mm"] = round(sphere.Radius(), 3)

    elif surf_type == GeomAbs_Torus:
        torus = surf.Torus()
        feature["major_radius_mm"] = round(torus.MajorRadius(), 3)
        feature["minor_radius_mm"] = round(torus.MinorRadius(), 3)

    return feature


def list_features(step_path: str) -> dict:
    """Read a STEP file and return per-face geometric detail."""
    reader = STEPControl_Reader()
    status = reader.ReadFile(step_path)
    if status != 1:  # 1 = IFSelect_RetDone (success)
        return {"error": f"Failed to read {step_path}"}

    reader.TransferRoots()
    shape = reader.OneShape()

    summary = {
        "faces": _count(shape, TopAbs_FACE),
        "edges": _count(shape, TopAbs_EDGE),
        "vertices": _count(shape, TopAbs_VERTEX),
    }

    features = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    i = 1
    while explorer.More():
        face = topods.Face(explorer.Current())
        features.append(_describe_face(face, f"f_{i:03d}"))
        i += 1
        explorer.Next()

    return {
        "file": step_path,
        "summary": summary,
        "features": features,
    }


if __name__ == "__main__":
    import json
    result = list_features("samples/part1.step")
    print(json.dumps(result, indent=2))