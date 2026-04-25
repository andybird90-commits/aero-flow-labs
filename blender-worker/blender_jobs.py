"""
Blender-side dispatcher. Loaded with `blender --background --python blender_jobs.py -- payload.json`.

Reads job_type + inputs from a JSON payload, runs the matching op, writes
result.json next to it. Output files go in `out_dir` (passed by the worker).

Currently supported:
    - bake_bodykit: donor STL minus shell STL → split into panel islands.

The other 4 op stubs (prepare_base_mesh, fit_part_to_zone, mirror_part,
export_stl) raise NotImplementedError so we don't ship silently-broken jobs.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

import bpy  # type: ignore
import bmesh  # type: ignore
from mathutils import Vector  # type: ignore


# ────────────────────────────────────────────────────────────────────────────
# entrypoint
# ────────────────────────────────────────────────────────────────────────────

def main() -> None:
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("Expected '-- payload.json' in argv")
    payload_path = Path(argv[argv.index("--") + 1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    job_type = payload["job_type"]
    inputs = payload.get("inputs") or {}
    out_dir = Path(payload["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    handlers = {
        "bake_bodykit": op_bake_bodykit,
    }
    if job_type not in handlers:
        raise SystemExit(f"job_type {job_type!r} not implemented in blender_jobs.py")

    result = handlers[job_type](inputs, out_dir)
    (out_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    print(f"[blender_jobs] {job_type} OK: {result}")


# ────────────────────────────────────────────────────────────────────────────
# helpers
# ────────────────────────────────────────────────────────────────────────────

def _reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _download(url: str, dest: Path) -> Path:
    print(f"[download] {url} -> {dest.name}")
    req = urllib.request.Request(url, headers={"User-Agent": "blender-worker/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        while True:
            chunk = r.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return dest


def _import_stl(path: Path, name: str):
    """Blender 4.x has a fast native STL importer; fall back to legacy if needed."""
    before = set(bpy.context.scene.objects)
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=str(path))
    else:
        bpy.ops.import_mesh.stl(filepath=str(path))
    new = [o for o in bpy.context.scene.objects if o not in before]
    if not new:
        raise RuntimeError(f"STL import produced no objects: {path}")
    obj = new[0]
    obj.name = name
    return obj


def _export_stl(obj, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if hasattr(bpy.ops.wm, "stl_export"):
        bpy.ops.wm.stl_export(filepath=str(path), export_selected_objects=True)
    else:
        bpy.ops.export_mesh.stl(filepath=str(path), use_selection=True)


def _apply_xyz_euler(obj, position_m, rotation_rad, scale_xyz) -> None:
    """Bake a Three.js-style transform into the mesh (translation in metres,
    XYZ-Euler rotation, unit scale)."""
    # mesh is in mm; translation arrives in metres → ×1000.
    obj.location = (position_m[0] * 1000.0, position_m[1] * 1000.0, position_m[2] * 1000.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = rotation_rad
    obj.scale = scale_xyz
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _bbox_world(obj):
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    for v in obj.bound_box:
        wv = obj.matrix_world @ Vector(v)
        for i in range(3):
            if wv[i] < mn[i]:
                mn[i] = wv[i]
            if wv[i] > mx[i]:
                mx[i] = wv[i]
    return mn, mx


def _classify_aero_slot(part_bbox, donor_bbox) -> tuple[str, float]:
    """Classify a panel by its position relative to the donor car bbox.

    Frame from the app: +X right, +Y up, -Z forward (Three.js).
    Slots: front_splitter, rear_wing, rear_diffuser, side_skirt_l/r,
    front_canard_l/r, hood_scoop, roof_scoop, unknown.
    """
    pmin, pmax = part_bbox
    dmin, dmax = donor_bbox
    cx = (pmin[0] + pmax[0]) / 2
    cy = (pmin[1] + pmax[1]) / 2
    cz = (pmin[2] + pmax[2]) / 2

    car_len_z = max(dmax[2] - dmin[2], 1.0)
    car_h_y = max(dmax[1] - dmin[1], 1.0)
    car_w_x = max(dmax[0] - dmin[0], 1.0)
    nz = (cz - dmin[2]) / car_len_z      # 0=front (-Z), 1=rear (+Z)
    ny = (cy - dmin[1]) / car_h_y        # 0=bottom, 1=top
    nx_abs = abs(cx - (dmin[0] + dmax[0]) / 2) / (car_w_x / 2)  # 0=centre, 1=edge

    # Rear region
    if nz > 0.75:
        if ny > 0.7:
            return "rear_wing", 0.85
        if ny < 0.35:
            return "rear_diffuser", 0.8
        return "rear_bumper_addon", 0.6
    # Front region
    if nz < 0.25:
        if ny < 0.35:
            return "front_splitter", 0.85
        if nx_abs > 0.55:
            return ("front_canard_r" if cx > 0 else "front_canard_l"), 0.7
        return "front_lip", 0.6
    # Mid region
    if nx_abs > 0.55 and ny < 0.5:
        return ("side_skirt_r" if cx > 0 else "side_skirt_l"), 0.8
    if ny > 0.75 and nx_abs < 0.4:
        # Top centre
        return ("roof_scoop" if nz > 0.45 else "hood_scoop"), 0.55
    return "unknown", 0.3


# ────────────────────────────────────────────────────────────────────────────
# op: bake_bodykit
# ────────────────────────────────────────────────────────────────────────────

def op_bake_bodykit(inputs: dict, out_dir: Path) -> dict:
    """
    Inputs:
      donor_stl_url:   str   public/signed STL URL (donor car, in mm)
      shell_stl_url:   str   public/signed STL URL (body skin, mm or m)
      baked_transform: dict  { position:{x,y,z} (metres), rotation:{x,y,z} (rad), scale:{x,y,z} }
      tolerance_mm:    float donor inflation distance (default 4)
      min_panel_tris:  int   drop islands smaller than this (default 80)

    Output keys (named so worker uploads them via callback):
      combined_stl
      panel_<n>_stl        (one per panel)
      panel_manifest_json  (slot/bbox/triangle metadata)
    """
    _reset_scene()

    donor_url = inputs["donor_stl_url"]
    shell_url = inputs["shell_stl_url"]
    transform = inputs.get("baked_transform") or {}
    tol_mm = float(inputs.get("tolerance_mm", 4.0))
    min_tris = int(inputs.get("min_panel_tris", 80))

    donor_path = _download(donor_url, out_dir / "donor.stl")
    shell_path = _download(shell_url, out_dir / "shell.stl")

    donor = _import_stl(donor_path, "donor")
    shell = _import_stl(shell_path, "shell")

    # If the shell looks like it was exported in metres, scale to mm.
    sb_min, sb_max = _bbox_world(shell)
    shell_max_dim = max(sb_max[i] - sb_min[i] for i in range(3))
    if shell_max_dim < 50:
        shell.scale = (1000.0, 1000.0, 1000.0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        shell.select_set(True)
        bpy.context.view_layer.objects.active = shell
        bpy.ops.object.transform_apply(scale=True)

    # Bake the alignment transform onto the shell mesh.
    pos = transform.get("position") or {}
    rot = transform.get("rotation") or {}
    scl = transform.get("scale") or {}
    _apply_xyz_euler(
        shell,
        (float(pos.get("x", 0)), float(pos.get("y", 0)), float(pos.get("z", 0))),
        (float(rot.get("x", 0)), float(rot.get("y", 0)), float(rot.get("z", 0))),
        (float(scl.get("x", 1)), float(scl.get("y", 1)), float(scl.get("z", 1))),
    )

    # Inflate the donor slightly so triangles within tol_mm of the donor get
    # subtracted away. We use a Solidify modifier in inflate mode.
    bpy.ops.object.select_all(action="DESELECT")
    donor.select_set(True)
    bpy.context.view_layer.objects.active = donor
    sld = donor.modifiers.new("inflate", "SOLIDIFY")
    sld.thickness = tol_mm * 2.0
    sld.offset = 1.0  # outward only
    bpy.ops.object.modifier_apply(modifier=sld.name)

    # Boolean DIFFERENCE: shell - donor.
    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bm = shell.modifiers.new("subtract", "BOOLEAN")
    bm.operation = "DIFFERENCE"
    bm.object = donor
    bm.solver = "FAST"  # FAST is way more reliable than EXACT on noisy meshes
    try:
        bpy.ops.object.modifier_apply(modifier=bm.name)
    except RuntimeError as e:
        # Boolean failed (non-manifold etc.) — try EXACT as a fallback.
        print(f"[bake_bodykit] FAST boolean failed ({e}); retrying EXACT")
        shell.modifiers.remove(bm)
        bm2 = shell.modifiers.new("subtract", "BOOLEAN")
        bm2.operation = "DIFFERENCE"
        bm2.object = donor
        bm2.solver = "EXACT"
        bpy.ops.object.modifier_apply(modifier=bm2.name)

    # Drop the donor — we don't need it any more.
    bpy.ops.object.select_all(action="DESELECT")
    donor.select_set(True)
    bpy.ops.object.delete()

    # Write the combined kit STL (everything left over after subtraction).
    combined_path = out_dir / "combined.stl"
    _export_stl(shell, combined_path)
    combined_tris = len(shell.data.polygons)
    if combined_tris == 0:
        raise RuntimeError(
            "Boolean produced an empty mesh — the shell may sit entirely inside "
            "the donor. Re-check the alignment in Build Studio."
        )

    # Donor bbox for slot classification (recompute from the original donor file
    # because we already deleted the inflated one — re-import quickly).
    donor2 = _import_stl(donor_path, "donor_ref")
    donor_bbox = _bbox_world(donor2)
    bpy.ops.object.select_all(action="DESELECT")
    donor2.select_set(True)
    bpy.ops.object.delete()

    # Split into loose parts (mesh islands).
    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    islands = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"[bake_bodykit] split into {len(islands)} islands")

    outputs: dict[str, str] = {"combined_stl": "combined.stl"}
    manifest: list[dict] = []

    slot_counter: dict[str, int] = {}
    panel_index = 0
    for obj in islands:
        tri_count = len(obj.data.polygons)
        if tri_count < min_tris:
            continue
        bb = _bbox_world(obj)
        slot, conf = _classify_aero_slot(bb, donor_bbox)
        n = slot_counter.get(slot, 0) + 1
        slot_counter[slot] = n
        slot_name = slot if n == 1 else f"{slot}_{n}"

        rel = f"panel_{panel_index:02d}_{slot_name}.stl"
        _export_stl(obj, out_dir / rel)
        out_key = f"panel_{panel_index}_stl"
        outputs[out_key] = rel
        manifest.append({
            "key": out_key,
            "filename": rel,
            "slot": slot,
            "slot_name": slot_name,
            "confidence": conf,
            "triangle_count": tri_count,
            "bbox": {"min": list(bb[0]), "max": list(bb[1])},
            "centroid": [(bb[0][i] + bb[1][i]) / 2 for i in range(3)],
        })
        panel_index += 1

    manifest_path = out_dir / "panel_manifest.json"
    manifest_path.write_text(json.dumps({
        "panels": manifest,
        "donor_bbox": {"min": list(donor_bbox[0]), "max": list(donor_bbox[1])},
        "combined_triangle_count": combined_tris,
    }), encoding="utf-8")
    outputs["panel_manifest_json"] = "panel_manifest.json"

    return {"outputs": outputs}


if __name__ == "__main__":
    main()
