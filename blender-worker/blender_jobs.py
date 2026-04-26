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

# AI supervisor lives next to this script. Import is best-effort: if it
# fails (missing requests etc.) the bake still runs with the bbox heuristic.
sys.path.insert(0, str(Path(__file__).parent.resolve()))
try:
    import ai_supervisor  # type: ignore
    _AI_OK = True
except Exception as _ai_err:  # pragma: no cover
    print(f"[blender_jobs] ai_supervisor unavailable: {_ai_err}", file=sys.stderr)
    ai_supervisor = None  # type: ignore
    _AI_OK = False


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


def _detect_car_axes(donor_bbox) -> dict:
    """Auto-detect which axis is length / width / up from the donor bbox.

    Cars are roughly 4-5m long, 1.7-2m wide, 1.3-1.6m tall. The longest axis
    is length, the shortest is up. This works regardless of whether the STL
    uses +Y forward / +Z up (Blender convention) or +Y up / -Z forward
    (Three.js convention).

    Returns:
      { "length_axis": int, "width_axis": int, "up_axis": int,
        "front_sign": int }  # +1 if positive end is front, -1 if negative.
    Heuristic for front_sign: most car STLs in this project face -Z; we can't
    know without fiducials, so default to -1 along the length axis. The
    classifier mirrors L/R based on the absolute width-axis value, so a wrong
    front/back guess only swaps front_↔ rear_ slots — still much better than
    everything-is-canard.
    """
    dmin, dmax = donor_bbox
    spans = [dmax[i] - dmin[i] for i in range(3)]
    length_axis = max(range(3), key=lambda i: spans[i])
    up_axis = min(range(3), key=lambda i: spans[i])
    width_axis = 3 - length_axis - up_axis
    return {
        "length_axis": length_axis,
        "width_axis": width_axis,
        "up_axis": up_axis,
        "front_sign": -1,  # assume -length is front (Three.js convention)
    }


def _classify_aero_slot(part_bbox, donor_bbox, axes: dict) -> tuple[str, float]:
    """Classify a panel by its position relative to the donor car bbox.

    Uses auto-detected axes so it works whether the donor STL is +Y up or
    +Z up.

    Slots: front_splitter, rear_wing, rear_diffuser, side_skirt_l/r,
    front_canard_l/r, hood_scoop, roof_scoop, front_lip, rear_bumper_addon,
    unknown.
    """
    pmin, pmax = part_bbox
    dmin, dmax = donor_bbox

    la = axes["length_axis"]
    wa = axes["width_axis"]
    ua = axes["up_axis"]
    fs = axes["front_sign"]

    cl = (pmin[la] + pmax[la]) / 2  # centroid along length
    cw = (pmin[wa] + pmax[wa]) / 2  # centroid along width
    cu = (pmin[ua] + pmax[ua]) / 2  # centroid along up

    car_len = max(dmax[la] - dmin[la], 1.0)
    car_wid = max(dmax[wa] - dmin[wa], 1.0)
    car_hgt = max(dmax[ua] - dmin[ua], 1.0)

    # Normalise: nl=0 at rear, 1 at front; nu=0 at bottom, 1 at top.
    raw_l = (cl - dmin[la]) / car_len  # 0 at -length end, 1 at +length end
    nl = raw_l if fs > 0 else (1.0 - raw_l)
    nu = (cu - dmin[ua]) / car_hgt
    width_centre = (dmin[wa] + dmax[wa]) / 2
    nw_signed = (cw - width_centre) / (car_wid / 2)  # -1..+1
    nw_abs = abs(nw_signed)

    # Rear region (back third)
    if nl < 0.25:
        if nu > 0.7:
            return "rear_wing", 0.85
        if nu < 0.35:
            return "rear_diffuser", 0.8
        return "rear_bumper_addon", 0.6
    # Front region (front third)
    if nl > 0.75:
        if nu < 0.35:
            return "front_splitter", 0.85
        if nw_abs > 0.55:
            return ("front_canard_r" if nw_signed > 0 else "front_canard_l"), 0.7
        return "front_lip", 0.6
    # Mid region
    if nw_abs > 0.55 and nu < 0.5:
        return ("side_skirt_r" if nw_signed > 0 else "side_skirt_l"), 0.8
    if nu > 0.75 and nw_abs < 0.4:
        return ("hood_scoop" if nl > 0.55 else "roof_scoop"), 0.55
    return "unknown", 0.3


def _mesh_area_mm2(obj) -> float:
    """Sum polygon areas in Blender's local mm units."""
    total = 0.0
    for poly in obj.data.polygons:
        total += float(poly.area)
    return total


# ────────────────────────────────────────────────────────────────────────────
# op: bake_bodykit
# ────────────────────────────────────────────────────────────────────────────

def _do_boolean_subtract(shell, donor, tol_mm: float, solver: str) -> None:
    """Inflate donor by `tol_mm` and subtract it from shell. Mutates the scene."""
    # Reset donor scale to a fresh copy: we apply solidify each call, so the
    # caller is responsible for re-importing donor between attempts.
    bpy.ops.object.select_all(action="DESELECT")
    donor.select_set(True)
    bpy.context.view_layer.objects.active = donor
    sld = donor.modifiers.new("inflate", "SOLIDIFY")
    sld.thickness = tol_mm * 2.0
    sld.offset = 1.0
    bpy.ops.object.modifier_apply(modifier=sld.name)

    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bm = shell.modifiers.new("subtract", "BOOLEAN")
    bm.operation = "DIFFERENCE"
    bm.object = donor
    bm.solver = solver
    try:
        bpy.ops.object.modifier_apply(modifier=bm.name)
    except RuntimeError as e:
        # primary solver failed → swap and retry once
        alt = "EXACT" if solver == "FAST" else "FAST"
        print(f"[bake_bodykit] {solver} boolean failed ({e}); retrying {alt}")
        shell.modifiers.remove(bm)
        bm2 = shell.modifiers.new("subtract", "BOOLEAN")
        bm2.operation = "DIFFERENCE"
        bm2.object = donor
        bm2.solver = alt
        bpy.ops.object.modifier_apply(modifier=bm2.name)


def op_bake_bodykit(inputs: dict, out_dir: Path) -> dict:
    """
    Inputs:
      donor_stl_url:   str   public/signed STL URL (donor car, in mm)
      shell_stl_url:   str   public/signed STL URL (body skin, mm or m)
      baked_transform: dict  { position:{x,y,z} (metres), rotation:{x,y,z} (rad), scale:{x,y,z} }
      tolerance_mm:    float donor inflation distance (default 4)
      min_panel_tris:  int   drop islands smaller than this (default 80)

    The op_bake_bodykit is now an AI-supervised loop:
      1. boolean subtract → AI validates the combined kit
         (retry up to 2x with different tol/solver if AI says retry)
      2. split into islands
      3. per-panel AI classification (with bbox heuristic as fallback)

    Output keys:
      combined_stl
      panel_<n>_stl
      panel_manifest_json
    """
    donor_url = inputs["donor_stl_url"]
    shell_url = inputs["shell_stl_url"]
    transform = inputs.get("baked_transform") or {}
    initial_tol_mm = float(inputs.get("tolerance_mm", 4.0))
    min_tris = int(inputs.get("min_panel_tris", 80))

    donor_path = _download(donor_url, out_dir / "donor.stl")
    shell_path = _download(shell_url, out_dir / "shell.stl")

    # Capture donor bbox once (from the un-inflated mesh) for slot context.
    _reset_scene()
    donor_ref = _import_stl(donor_path, "donor_ref")
    donor_bbox = _bbox_world(donor_ref)
    bpy.ops.object.select_all(action="DESELECT")
    donor_ref.select_set(True)
    bpy.ops.object.delete()

    # ── attempt loop ──────────────────────────────────────────────────────
    attempt_log: list[dict] = []
    max_attempts = 3 if _AI_OK else 1
    tol_mm = initial_tol_mm
    solver = "FAST"
    shell = None
    accepted = False

    for attempt in range(1, max_attempts + 1):
        _reset_scene()
        donor = _import_stl(donor_path, "donor")
        shell = _import_stl(shell_path, "shell")

        # If shell looks like metres (max dim < 50), scale to mm.
        sb_min, sb_max = _bbox_world(shell)
        shell_max_dim = max(sb_max[i] - sb_min[i] for i in range(3))
        if shell_max_dim < 50:
            shell.scale = (1000.0, 1000.0, 1000.0)
            bpy.context.view_layer.update()
            bpy.ops.object.select_all(action="DESELECT")
            shell.select_set(True)
            bpy.context.view_layer.objects.active = shell
            bpy.ops.object.transform_apply(scale=True)

        # Bake user alignment transform onto the shell mesh.
        pos = transform.get("position") or {}
        rot = transform.get("rotation") or {}
        scl = transform.get("scale") or {}
        _apply_xyz_euler(
            shell,
            (float(pos.get("x", 0)), float(pos.get("y", 0)), float(pos.get("z", 0))),
            (float(rot.get("x", 0)), float(rot.get("y", 0)), float(rot.get("z", 0))),
            (float(scl.get("x", 1)), float(scl.get("y", 1)), float(scl.get("z", 1))),
        )

        try:
            _do_boolean_subtract(shell, donor, tol_mm, solver)
        except Exception as e:
            attempt_log.append({"attempt": attempt, "tol_mm": tol_mm, "solver": solver,
                                "verdict": "fail", "reason": f"boolean threw: {e}"})
            if attempt == max_attempts:
                raise RuntimeError(f"Boolean subtraction failed on all attempts: {e}")
            tol_mm = min(tol_mm * 2.0, 16.0)
            solver = "EXACT"
            continue

        # Drop the inflated donor — only shell remains.
        bpy.ops.object.select_all(action="DESELECT")
        donor.select_set(True)
        bpy.ops.object.delete()

        combined_tris = len(shell.data.polygons)
        if combined_tris == 0:
            attempt_log.append({"attempt": attempt, "tol_mm": tol_mm, "solver": solver,
                                "verdict": "fail", "reason": "boolean produced empty mesh"})
            if attempt == max_attempts:
                raise RuntimeError(
                    "Boolean produced an empty mesh on all attempts — the shell may "
                    "sit entirely inside the donor. Re-check alignment in Build Studio."
                )
            tol_mm = max(tol_mm / 2.0, 1.0)  # smaller tolerance might help
            continue

        # ── AI validation of the combined kit ────────────────────────────
        if _AI_OK and ai_supervisor is not None:
            verdict = ai_supervisor.ask_validator(
                step_name="boolean_subtract",
                objs=[shell],
                out_dir=out_dir,
                attempt=attempt,
                context=f"tol_mm={tol_mm} solver={solver} tris={combined_tris}",
            )
        else:
            verdict = {"verdict": "accept", "reason": "AI disabled.", "suggested_params": {}}

        attempt_log.append({"attempt": attempt, "tol_mm": tol_mm, "solver": solver,
                            "tris": combined_tris, **verdict})

        if verdict["verdict"] == "accept":
            accepted = True
            break
        if verdict["verdict"] == "fail" or attempt == max_attempts:
            if attempt == max_attempts and verdict["verdict"] == "retry":
                # ran out of retries, take what we have
                accepted = True
                break
            raise RuntimeError(
                f"Bake rejected by AI supervisor: {verdict.get('reason', '(no reason)')}"
            )

        # AI said retry → apply suggested params and loop
        sp = verdict.get("suggested_params") or {}
        if isinstance(sp.get("tolerance_mm"), (int, float)):
            tol_mm = float(sp["tolerance_mm"])
        else:
            tol_mm = min(tol_mm * 1.5, 16.0)
        if sp.get("solver") in {"FAST", "EXACT"}:
            solver = sp["solver"]
        elif solver == "FAST":
            solver = "EXACT"

    if shell is None or not accepted:
        raise RuntimeError("Bake exited loop without an accepted result.")

    # ── export combined kit ──────────────────────────────────────────────
    combined_path = out_dir / "combined.stl"
    _export_stl(shell, combined_path)
    combined_tris = len(shell.data.polygons)

    # ── split into loose parts ───────────────────────────────────────────
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

        # Bbox heuristic as baseline / fallback.
        heur_slot, heur_conf = _classify_aero_slot(bb, donor_bbox)

        # AI classifier (if available).
        ai_result = None
        if _AI_OK and ai_supervisor is not None:
            try:
                ai_result = ai_supervisor.ask_classifier(
                    panel_obj=obj,
                    donor_bbox=donor_bbox,
                    panel_bbox=bb,
                    out_dir=out_dir,
                    idx=panel_index,
                )
            except Exception as e:
                print(f"[bake_bodykit] classifier threw: {e}", file=sys.stderr)

        if ai_result and ai_result.get("slot") and ai_result["slot"] != "unknown":
            slot = ai_result["slot"]
            conf = float(ai_result.get("confidence", heur_conf))
            ai_label = slot
            ai_conf = conf
            ai_reason = ai_result.get("reason", "")
        else:
            slot = heur_slot
            conf = heur_conf
            ai_label = ai_result.get("slot") if ai_result else None
            ai_conf = float(ai_result.get("confidence", 0)) if ai_result else None
            ai_reason = ai_result.get("reason") if ai_result else None

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
            "ai_label": ai_label,
            "ai_confidence": ai_conf,
            "ai_reasoning": ai_reason,
        })
        panel_index += 1

    # Compose human-readable AI notes for the kit row.
    ai_notes_lines = []
    for entry in attempt_log:
        ai_notes_lines.append(
            f"attempt {entry['attempt']} tol={entry.get('tol_mm')} "
            f"solver={entry.get('solver')} → {entry.get('verdict')}: "
            f"{entry.get('reason', '')[:240]}"
        )
    ai_notes = "\n".join(ai_notes_lines)

    manifest_path = out_dir / "panel_manifest.json"
    manifest_path.write_text(json.dumps({
        "panels": manifest,
        "donor_bbox": {"min": list(donor_bbox[0]), "max": list(donor_bbox[1])},
        "combined_triangle_count": combined_tris,
        "ai_attempts": len(attempt_log),
        "ai_notes": ai_notes,
        "ai_enabled": _AI_OK,
    }), encoding="utf-8")
    outputs["panel_manifest_json"] = "panel_manifest.json"

    return {"outputs": outputs}


if __name__ == "__main__":
    main()
