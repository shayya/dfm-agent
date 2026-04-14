"""
list_features.py — v0 of the first DFM agent tool.
Takes a STEP file path, returns a summary of geometric features.
"""
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX


def list_features(step_path: str) -> dict:
    """Read a STEP file and return counts of basic topology."""
    reader = STEPControl_Reader()
    status = reader.ReadFile(step_path)
    if status != 1:  # 1 = IFSelect_RetDone (success)
        return {"error": f"Failed to read {step_path}"}

    reader.TransferRoots()
    shape = reader.OneShape()

    def count(topo_type):
        explorer = TopExp_Explorer(shape, topo_type)
        n = 0
        while explorer.More():
            n += 1
            explorer.Next()
        return n

    return {
        "file": step_path,
        "faces": count(TopAbs_FACE),
        "edges": count(TopAbs_EDGE),
        "vertices": count(TopAbs_VERTEX),
    }


if __name__ == "__main__":
    result = list_features("samples/part1.step")
    print(result)