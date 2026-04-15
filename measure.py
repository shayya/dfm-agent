"""
measure.py — DFM measurement tools using pythonOCC.
All functions operate on the shape/face index loaded by list_features().
"""
from OCC.Core.Bnd import Bnd_Box
from OCC.Core.BRepBndLib import brepbndlib
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
from OCC.Core.GeomAbs import (
    GeomAbs_Plane,
    GeomAbs_Cylinder,
    GeomAbs_Circle,
    GeomAbs_Line,
)
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopoDS import topods
from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCC.Core.gp import gp_Lin, gp_Pnt, gp_Dir

from list_features import get_face, get_shape


def get_bounding_box() -> dict:
    """Return the overall bounding box of the part in mm."""
    bbox = Bnd_Box()
    brepbndlib.Add(get_shape(), bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    return {
        "x_mm": round(xmax - xmin, 3),
        "y_mm": round(ymax - ymin, 3),
        "z_mm": round(zmax - zmin, 3),
        "origin": {
            "x": round(xmin, 3),
            "y": round(ymin, 3),
            "z": round(zmin, 3),
        },
    }


def measure_hole(feature_id: str) -> dict:
    """
    Measure a cylindrical hole face.
    Returns diameter_mm, depth_mm, and depth_to_diameter_ratio.
    Only valid for cylindrical faces (type: cylindrical_face).
    """
    face = get_face(feature_id)
    surf = BRepAdaptor_Surface(face)
    if surf.GetType() != GeomAbs_Cylinder:
        return {"error": f"Feature {feature_id} is not cylindrical"}

    diameter_mm = round(surf.Cylinder().Radius() * 2, 3)
    # V parameter range of a cylinder = axial extent in mm
    depth_mm = round(abs(surf.LastVParameter() - surf.FirstVParameter()), 3)
    ratio = round(depth_mm / diameter_mm, 3) if diameter_mm > 0 else None

    return {
        "diameter_mm": diameter_mm,
        "depth_mm": depth_mm,
        "depth_to_diameter_ratio": ratio,
    }


def measure_corner_radius(feature_id: str) -> dict:
    """
    Measure radii of all edges adjacent to a face.
    Returns min_radius_mm, has_sharp_corners, and a list of edge radii.
    Sharp corners (radius=0) are CNC problem: no end mill can produce them.
    """
    face = get_face(feature_id)
    edge_exp = TopExp_Explorer(face, TopAbs_EDGE)
    edge_radii = []
    has_sharp_corners = False

    while edge_exp.More():
        edge = topods.Edge(edge_exp.Current())
        try:
            curve = BRepAdaptor_Curve(edge)
            ct = curve.GetType()
            if ct == GeomAbs_Circle:
                r = round(curve.Circle().Radius(), 3)
                edge_radii.append(r)
            elif ct == GeomAbs_Line:
                edge_radii.append(0.0)
                has_sharp_corners = True
            else:
                # BSpline, ellipse, etc. — report as unknown
                edge_radii.append(None)
        except Exception:
            edge_radii.append(None)
        edge_exp.Next()

    numeric = [r for r in edge_radii if r is not None]
    return {
        "min_radius_mm": min(numeric) if numeric else None,
        "has_sharp_corners": has_sharp_corners,
        "edge_radii": edge_radii,
    }


def _ray_cast_thickness(face, shape) -> float | None:
    """
    Cast rays from a planar face's centroid in both ±normal directions.
    Returns the shortest distance to the next surface, or None on failure.
    tmin=1e-3 skips the source face itself.
    """
    surf = BRepAdaptor_Surface(face)
    props = GProp_GProps()
    brepgprop.SurfaceProperties(face, props)
    com = props.CentreOfMass()
    n = surf.Plane().Axis().Direction()

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-4)

    pnt = gp_Pnt(com.X(), com.Y(), com.Z())
    thickness = None

    for sign in (+1, -1):
        direction = gp_Dir(sign * n.X(), sign * n.Y(), sign * n.Z())
        line = gp_Lin(pnt, direction)
        intersector.PerformNearest(line, 1e-3, 1e4)
        if intersector.NbPnt() > 0:
            t = intersector.WParameter(1)
            if thickness is None or t < thickness:
                thickness = t

    return thickness


def measure_wall_thickness(feature_id: str) -> dict:
    """
    Measure wall thickness at a planar face by ray-casting through the part.
    Returns thickness_mm. Only works on planar faces.
    """
    face = get_face(feature_id)
    surf = BRepAdaptor_Surface(face)
    if surf.GetType() != GeomAbs_Plane:
        return {"error": f"Feature {feature_id} is not planar; wall thickness requires a planar face"}

    thickness = _ray_cast_thickness(face, get_shape())
    if thickness is None:
        return {"error": "could not measure wall thickness"}
    return {"thickness_mm": round(thickness, 3)}


def measure_pocket(feature_id: str) -> dict:
    """
    Measure a planar face as a pocket floor.
    Returns depth_mm (ray cast to opposite face), min_width_mm (face bounding box),
    and aspect_ratio = depth / min_width.
    """
    face = get_face(feature_id)
    surf = BRepAdaptor_Surface(face)
    if surf.GetType() != GeomAbs_Plane:
        return {"error": f"Feature {feature_id} is not planar; pocket measurement requires a planar floor face"}

    # Min width from the face's own tight bounding box
    bbox = Bnd_Box()
    brepbndlib.AddOptimal(face, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    # One of the three dims will be ~0 (the face has no thickness), filter it out
    dims = sorted([d for d in [xmax - xmin, ymax - ymin, zmax - zmin] if d > 0.01])
    min_width_mm = round(dims[0], 3) if dims else None

    depth_mm = _ray_cast_thickness(face, get_shape())
    if depth_mm is None or min_width_mm is None:
        return {"error": "could not measure pocket dimensions"}

    aspect_ratio = round(depth_mm / min_width_mm, 3) if min_width_mm > 0 else None
    return {
        "depth_mm": round(depth_mm, 3),
        "min_width_mm": min_width_mm,
        "aspect_ratio": aspect_ratio,
    }
