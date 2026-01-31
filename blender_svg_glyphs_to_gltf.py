import bpy
import sys
from pathlib import Path

# ---------- args ----------
def parse_args(argv):
    if "--" not in argv:
        return {}
    args = argv[argv.index("--")+1:]
    out = {}
    i = 0
    while i < len(args):
        if args[i].startswith("--"):
            k = args[i][2:]
            v = args[i+1] if (i+1 < len(args) and not args[i+1].startswith("--")) else True
            out[k] = v
            i += 2 if v is not True else 1
        else:
            i += 1
    return out

# ---------- helpers ----------
def deselect_all():
    bpy.ops.object.select_all(action='DESELECT')

def set_active(obj):
    bpy.context.view_layer.objects.active = obj

def snapshot_names():
    return set(o.name for o in bpy.data.objects)

def new_objects(before):
    return [o for o in bpy.data.objects if o.name not in before]

def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    # purge orphan data (safe in background)
    try:
        bpy.ops.outliner.orphans_purge(do_recursive=True)
    except Exception:
        pass

def join_objects(objs):
    objs = [o for o in objs if o and o.name in bpy.data.objects]
    if not objs:
        return None
    if len(objs) == 1:
        return objs[0]
    deselect_all()
    for o in objs:
        o.select_set(True)
    set_active(objs[0])
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active

def convert_to_mesh(obj):
    deselect_all()
    obj.select_set(True)
    set_active(obj)
    bpy.ops.object.convert(target='MESH')
    m = bpy.context.view_layer.objects.active
    if not m or m.type != "MESH":
        raise RuntimeError("Convert to mesh failed")
    return m

def extrude_mesh(mesh_obj, extrude_m):
    deselect_all()
    mesh_obj.select_set(True)
    set_active(mesh_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.ops.mesh.select_all(action='SELECT')
        # Extrude region along +Z
        bpy.ops.mesh.extrude_region_move(
            TRANSFORM_OT_translate={"value": (0.0, 0.0, float(extrude_m))}
        )
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")

def export_selected(path: Path, fmt: str):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        use_selection=True,
        export_format=("GLB" if fmt.lower() == "glb" else "GLTF_SEPARATE"),
    )

# ---------- import pipelines ----------
def import_svg_as_curve(svg_path: Path):
    before = snapshot_names()
    bpy.ops.import_curve.svg(filepath=str(svg_path))
    return new_objects(before)

def configure_curve_fill(curve_obj):
    """
    For glyphs: make curve 2D and filled so holes/counters survive.
    """
    if curve_obj.type != "CURVE":
        return
    c = curve_obj.data
    c.dimensions = '2D'
    # 'BOTH' fills both sides; good for conversion, avoids missing faces
    c.fill_mode = 'BOTH'
    # Optional: reduce curve bevel artifacts (keep it flat)
    c.bevel_depth = 0.0
    c.extrude = 0.0

def import_svg_as_grease_pencil(svg_path: Path):
    before = snapshot_names()
    if hasattr(bpy.ops.wm, "gpencil_import_svg"):
        bpy.ops.wm.gpencil_import_svg(filepath=str(svg_path))
    else:
        # if GP importer missing, fallback to curves anyway
        bpy.ops.import_curve.svg(filepath=str(svg_path))
    return new_objects(before)

def fill_mesh_if_needed(mesh_obj):
    """
    Usually unnecessary if curve fill worked, but harmless. Best-effort.
    """
    deselect_all()
    mesh_obj.select_set(True)
    set_active(mesh_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.ops.mesh.select_all(action='SELECT')
        # If mesh came in as edges (rare from curve fill), try to make faces.
        try:
            bpy.ops.mesh.edge_face_add()
        except Exception:
            pass
        try:
            bpy.ops.mesh.fill()
        except Exception:
            pass
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")

# ---------- main ----------
def main():
    args = parse_args(sys.argv)
    in_dir = Path(args.get("in", "")).expanduser().resolve()
    out_dir = Path(args.get("out", "")).expanduser().resolve()
    fmt = str(args.get("format", "glb")).lower()
    extrude = float(args.get("extrude", 0.01))
    mode = str(args.get("mode", "curve")).lower()  # curve|gp|auto

    if not in_dir.exists():
        raise FileNotFoundError(f"Input dir does not exist: {in_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    svgs = sorted([p for p in in_dir.iterdir() if p.suffix.lower() == ".svg"])
    if not svgs:
        print(f"No SVGs found in {in_dir}")
        return

    print(f"Processing {len(svgs)} SVG(s) ({mode}) from {in_dir} -> {out_dir} as {fmt}")

    for svg in svgs:
        print(f"\n=== {svg.name} ===")
        reset_scene()

        imported = []
        if mode == "curve":
            imported = import_svg_as_curve(svg)
        elif mode == "gp":
            imported = import_svg_as_grease_pencil(svg)
        else:  # auto: prefer curve for glyphs; try GP only if curve import yields nothing
            imported = import_svg_as_curve(svg)
            if not imported:
                imported = import_svg_as_grease_pencil(svg)

        if not imported:
            print("  ! No objects imported, skipping")
            continue

        # If curves: set fill options per object before joining/converting
        for o in imported:
            if o.type == "CURVE":
                configure_curve_fill(o)

        joined = join_objects(imported)
        if not joined:
            print("  ! Join failed, skipping")
            continue

        mesh = convert_to_mesh(joined)
        fill_mesh_if_needed(mesh)
        extrude_mesh(mesh, extrude)

        # Export
        deselect_all()
        mesh.select_set(True)
        set_active(mesh)

        export_path = out_dir / f"{svg.stem}.{ 'glb' if fmt == 'glb' else 'gltf' }"
        export_selected(export_path, fmt)
        print(f"  ✓ Exported {export_path}")

    print("\nDone.")

if __name__ == "__main__":
    main()
