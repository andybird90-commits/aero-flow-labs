"""
ai_actor.py — Claude-as-actor loop for procedural part generation in Blender.

Unlike `ai_supervisor.py` (which only judges), the actor *proposes the next
bpy operator* on every step. The worker executes that op via a strict
allowlist, renders four orthographic views, and feeds them back to Claude so
it can decide the next move (or call `finish` when satisfied).

Why allowlist (not freeform `exec`):
  * sandboxes the model away from `bpy.ops.wm.read_factory_settings`,
    `os.system`, infinite loops in raw Python, etc.
  * gives Claude a tractable, well-typed action space — it's much better at
    JSON tool-use than at writing valid bpy code from scratch
  * makes every step diffable and replayable for QA

Hard caps:
  * MAX_STEPS  — 40 ops including `finish`
  * MAX_TRIS   — 50_000 across the active part collection
  * BBOX_MM    — caller-provided envelope (mm); excursions trigger a verdict
  * WALL_CLOCK — 5 min total, enforced by caller

The actor outputs a single GLB file plus a thumbnail PNG and returns the path
pair via `run_actor()`.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

import bpy  # type: ignore
import bmesh  # type: ignore
from mathutils import Vector  # type: ignore

# ai_supervisor sits alongside; reuse its AI plumbing for the call.
sys.path.insert(0, str(Path(__file__).parent.resolve()))
import ai_supervisor  # type: ignore

DEFAULT_MAX_STEPS = 40
DEFAULT_MAX_TRIS = 50_000


# ────────────────────────────────────────────────────────────────────────────
# Allowlisted bpy operations
# ────────────────────────────────────────────────────────────────────────────

def _ensure_object_mode() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass


def _select_only(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _get_part_objects(state: dict) -> list:
    coll = state["collection"]
    return [o for o in coll.objects if o.type == "MESH"]


def _total_tris(state: dict) -> int:
    return sum(len(o.data.polygons) for o in _get_part_objects(state))


def _bbox_mm(state: dict) -> tuple[list[float], list[float]]:
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    seen = False
    for obj in _get_part_objects(state):
        for v in obj.bound_box:
            wv = obj.matrix_world @ Vector(v)
            for i in range(3):
                if wv[i] < mn[i]:
                    mn[i] = wv[i]
                if wv[i] > mx[i]:
                    mx[i] = wv[i]
                seen = True
    if not seen:
        return [0, 0, 0], [0, 0, 0]
    return mn, mx


# ── operator handlers ───────────────────────────────────────────────────────

def op_add_primitive(state: dict, args: dict) -> dict:
    """args: { kind: 'cube'|'cylinder'|'uv_sphere'|'plane', size_mm, location_mm: [x,y,z], rotation_deg: [x,y,z] }"""
    kind = args.get("kind", "cube")
    size = float(args.get("size_mm", 100.0))
    loc = args.get("location_mm", [0, 0, 0])
    rot_deg = args.get("rotation_deg", [0, 0, 0])
    rot = [r * 3.14159265 / 180.0 for r in rot_deg]
    _ensure_object_mode()
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=size, location=loc, rotation=rot)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(radius=size / 2, depth=size, location=loc, rotation=rot)
    elif kind == "uv_sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size / 2, location=loc, rotation=rot)
    elif kind == "plane":
        bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    else:
        return {"ok": False, "error": f"unknown primitive kind {kind}"}
    obj = bpy.context.active_object
    # link into part collection, unlink from default scene collection if present
    state["collection"].objects.link(obj)
    try:
        bpy.context.scene.collection.objects.unlink(obj)
    except RuntimeError:
        pass
    return {"ok": True, "added_object": obj.name}


def op_translate(state: dict, args: dict) -> dict:
    """args: { object_name, delta_mm: [x,y,z] }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    d = args.get("delta_mm", [0, 0, 0])
    obj.location = (obj.location[0] + d[0], obj.location[1] + d[1], obj.location[2] + d[2])
    return {"ok": True}


def op_rotate(state: dict, args: dict) -> dict:
    """args: { object_name, euler_deg: [x,y,z] }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    d = args.get("euler_deg", [0, 0, 0])
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = [r * 3.14159265 / 180.0 for r in d]
    return {"ok": True}


def op_scale(state: dict, args: dict) -> dict:
    """args: { object_name, scale: [x,y,z] }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    s = args.get("scale", [1, 1, 1])
    obj.scale = (s[0], s[1], s[2])
    return {"ok": True}


def op_apply_transforms(state: dict, args: dict) -> dict:
    """args: { object_name }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    _ensure_object_mode()
    _select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return {"ok": True}


def op_extrude(state: dict, args: dict) -> dict:
    """Bulk-extrude all faces of an object along its local normal.
    args: { object_name, distance_mm }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    dist = float(args.get("distance_mm", 10.0))
    _ensure_object_mode()
    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.extrude_region_shrink_fatten(
        MESH_OT_extrude_region={}, TRANSFORM_OT_shrink_fatten={"value": dist}
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"ok": True}


def op_bevel(state: dict, args: dict) -> dict:
    """args: { object_name, width_mm, segments }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    width = float(args.get("width_mm", 2.0))
    segments = int(args.get("segments", 2))
    _ensure_object_mode()
    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.mesh.bevel(offset=width, segments=segments)
    except Exception as e:
        bpy.ops.object.mode_set(mode="OBJECT")
        return {"ok": False, "error": f"bevel failed: {e}"}
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"ok": True}


def op_subdivide(state: dict, args: dict) -> dict:
    """args: { object_name, cuts }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    cuts = int(args.get("cuts", 1))
    cuts = max(1, min(cuts, 4))
    _ensure_object_mode()
    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"ok": True}


def op_mirror_modifier(state: dict, args: dict) -> dict:
    """args: { object_name, axis: 'X'|'Y'|'Z' }, applies immediately."""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    axis = (args.get("axis") or "X").upper()
    _ensure_object_mode()
    _select_only(obj)
    mod = obj.modifiers.new(name="Mirror", type="MIRROR")
    mod.use_axis = (axis == "X", axis == "Y", axis == "Z")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return {"ok": True}


def op_solidify(state: dict, args: dict) -> dict:
    """args: { object_name, thickness_mm }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    thickness = float(args.get("thickness_mm", 4.0))
    _ensure_object_mode()
    _select_only(obj)
    mod = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    mod.thickness = thickness
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return {"ok": True}


def op_subsurf(state: dict, args: dict) -> dict:
    """args: { object_name, levels }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    levels = int(args.get("levels", 1))
    levels = max(1, min(levels, 3))
    _ensure_object_mode()
    _select_only(obj)
    mod = obj.modifiers.new(name="Subsurf", type="SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return {"ok": True}


def op_boolean(state: dict, args: dict) -> dict:
    """args: { target_name, cutter_name, operation: 'UNION'|'DIFFERENCE'|'INTERSECT', delete_cutter }"""
    target = bpy.data.objects.get(args.get("target_name", ""))
    cutter = bpy.data.objects.get(args.get("cutter_name", ""))
    if not target or not cutter:
        return {"ok": False, "error": "target or cutter not found"}
    op_kind = (args.get("operation") or "UNION").upper()
    delete_cutter = bool(args.get("delete_cutter", True))
    _ensure_object_mode()
    _select_only(target)
    mod = target.modifiers.new(name="Bool", type="BOOLEAN")
    mod.operation = op_kind
    mod.object = cutter
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as e:
        return {"ok": False, "error": f"boolean apply failed: {e}"}
    if delete_cutter:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return {"ok": True}


def op_smooth_shade(state: dict, args: dict) -> dict:
    """args: { object_name }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    _ensure_object_mode()
    _select_only(obj)
    bpy.ops.object.shade_smooth()
    return {"ok": True}


def op_delete_object(state: dict, args: dict) -> dict:
    """args: { object_name }"""
    obj = bpy.data.objects.get(args.get("object_name", ""))
    if not obj:
        return {"ok": False, "error": "object not found"}
    bpy.data.objects.remove(obj, do_unlink=True)
    return {"ok": True}


def op_join(state: dict, args: dict) -> dict:
    """Join all part objects into the first one. args: {}"""
    objs = _get_part_objects(state)
    if len(objs) < 2:
        return {"ok": True, "note": "nothing to join"}
    _ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    return {"ok": True, "joined_into": objs[0].name}


OPERATORS: dict[str, tuple[Callable[[dict, dict], dict], dict]] = {
    "add_primitive":  (op_add_primitive,    {"kind": "cube|cylinder|uv_sphere|plane", "size_mm": "float", "location_mm": "[x,y,z]", "rotation_deg": "[x,y,z]"}),
    "translate":      (op_translate,        {"object_name": "str", "delta_mm": "[x,y,z]"}),
    "rotate":         (op_rotate,           {"object_name": "str", "euler_deg": "[x,y,z]"}),
    "scale":          (op_scale,            {"object_name": "str", "scale": "[x,y,z]"}),
    "apply_transforms": (op_apply_transforms, {"object_name": "str"}),
    "extrude":        (op_extrude,          {"object_name": "str", "distance_mm": "float"}),
    "bevel":          (op_bevel,            {"object_name": "str", "width_mm": "float", "segments": "int"}),
    "subdivide":      (op_subdivide,        {"object_name": "str", "cuts": "int (1-4)"}),
    "mirror_modifier":(op_mirror_modifier,  {"object_name": "str", "axis": "X|Y|Z"}),
    "solidify":       (op_solidify,         {"object_name": "str", "thickness_mm": "float"}),
    "subsurf":        (op_subsurf,          {"object_name": "str", "levels": "int (1-3)"}),
    "boolean":        (op_boolean,          {"target_name": "str", "cutter_name": "str", "operation": "UNION|DIFFERENCE|INTERSECT", "delete_cutter": "bool"}),
    "smooth_shade":   (op_smooth_shade,     {"object_name": "str"}),
    "delete_object":  (op_delete_object,    {"object_name": "str"}),
    "join":           (op_join,             {}),
}


# ────────────────────────────────────────────────────────────────────────────
# Tool schema for Claude
# ────────────────────────────────────────────────────────────────────────────

ACTOR_TOOL_NAME = "next_step"
ACTOR_TOOL_DESCRIPTION = (
    "Decide the next operation in building this aero part. Call with action='op' "
    "and a valid op_name + args, OR call with action='finish' when the part is done, "
    "OR action='abort' if the result cannot be salvaged."
)

ACTOR_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "action":      {"type": "string", "enum": ["op", "finish", "abort"]},
        "op_name":     {"type": "string", "enum": list(OPERATORS.keys())},
        "args":        {"type": "object", "description": "Operator-specific args; see system prompt for schema"},
        "rationale":   {"type": "string", "description": "One-sentence reason for this step (<=30 words)."},
    },
    "required": ["action", "rationale"],
}


def _system_prompt(part_kind: str, style_prompt: str, envelope_mm: list[float], symmetry: str) -> str:
    op_help = "\n".join(
        f"  - {name}({json.dumps(spec)})" for name, spec in
        ((n, s[1]) for n, s in OPERATORS.items())
    )
    return (
        f"You are an automotive aero modeler driving Blender via a strict tool API. "
        f"You see four orthographic renders (front/side/top/iso) after every operation. "
        f"Build a {part_kind!r} matching this style: {style_prompt!r}.\n\n"
        f"Coordinate frame: +X right, +Y forward (front of car), +Z up, units MILLIMETRES. "
        f"Origin (0,0,0) is the part's mount point on the donor car.\n"
        f"Target envelope (mm) the FINAL part must fit inside (centered on origin): "
        f"width<={envelope_mm[0]}, length<={envelope_mm[1]}, height<={envelope_mm[2]}.\n"
        f"Symmetry: {symmetry}. If 'x', model only the right half then call mirror_modifier with axis='X'.\n\n"
        f"Available operators:\n{op_help}\n\n"
        f"Rules:\n"
        f"  * Build incrementally: primitive → transform → extrude/bevel → modifiers → join.\n"
        f"  * Stay under 50000 triangles total.\n"
        f"  * Always apply transforms before booleans/modifiers.\n"
        f"  * Call action='finish' when the part is complete; one final supervisor will judge it.\n"
        f"  * Call action='abort' only if the geometry has gone irrecoverably wrong.\n"
        f"  * Respond ONLY by calling the next_step tool — no plain-text answers."
    )


# ────────────────────────────────────────────────────────────────────────────
# Anthropic call (multi-turn, with images per turn)
# ────────────────────────────────────────────────────────────────────────────

def _img_block_anthropic(p: Path) -> dict:
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}}


def _call_actor(messages: list, system_msg: str, timeout: int = 120) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("[ai_actor] ANTHROPIC_API_KEY missing — cannot run actor", file=sys.stderr)
        return None

    for candidate in [ai_supervisor.DEFAULT_MODEL, *ai_supervisor.ANTHROPIC_FALLBACK_MODELS]:
        payload = {
            "model": candidate,
            "max_tokens": 1024,
            "system": system_msg,
            "tools": [{
                "name": ACTOR_TOOL_NAME,
                "description": ACTOR_TOOL_DESCRIPTION,
                "input_schema": ACTOR_TOOL_SCHEMA,
            }],
            "tool_choice": {"type": "tool", "name": ACTOR_TOOL_NAME},
            "messages": messages,
        }
        resp, status = ai_supervisor._post_anthropic(payload, api_key, timeout)
        if not resp:
            if status in {404, 410}:
                continue
            return None
        for block in resp.get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == ACTOR_TOOL_NAME:
                return block.get("input") or {}
        return None
    return None


# ────────────────────────────────────────────────────────────────────────────
# Public entrypoint
# ────────────────────────────────────────────────────────────────────────────

def run_actor(
    *,
    part_kind: str,
    style_prompt: str,
    envelope_mm: list[float],
    symmetry: str,
    out_dir: Path,
    max_steps: int = DEFAULT_MAX_STEPS,
    max_tris: int = DEFAULT_MAX_TRIS,
) -> dict:
    """Run the actor loop and return { ok, glb_path, thumb_path, tri_count, bbox_mm, steps, reason }."""
    # Fresh empty scene with a dedicated collection for the part.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    coll = bpy.data.collections.new("generated_part")
    bpy.context.scene.collection.children.link(coll)
    state = {"collection": coll}

    system_msg = _system_prompt(part_kind, style_prompt, envelope_mm, symmetry)
    messages: list = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Empty scene. Begin building. Call next_step with action='op'."},
        ],
    }]

    history: list[dict] = []
    finish_reason = "max_steps"

    for step in range(max_steps):
        decision = _call_actor(messages, system_msg)
        if not decision:
            finish_reason = "actor_call_failed"
            break

        action = decision.get("action")
        rationale = decision.get("rationale", "")
        history.append({"step": step, "decision": decision})
        print(f"[ai_actor] step {step}: {action} {decision.get('op_name', '')} — {rationale[:120]}")

        if action == "abort":
            finish_reason = f"actor_aborted: {rationale}"
            break
        if action == "finish":
            finish_reason = "actor_finished"
            break
        if action != "op":
            finish_reason = f"unknown action {action!r}"
            break

        op_name = decision.get("op_name") or ""
        if op_name not in OPERATORS:
            result = {"ok": False, "error": f"unknown op_name {op_name!r}"}
        else:
            handler, _ = OPERATORS[op_name]
            try:
                result = handler(state, decision.get("args") or {})
            except Exception as e:
                tb = traceback.format_exc(limit=3)
                result = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": tb[:300]}

        # Tri-cap check after every successful op
        tris = _total_tris(state)
        if tris > max_tris:
            result = {"ok": False, "error": f"tri cap exceeded: {tris} > {max_tris}"}

        # Render quad views and feed back
        objs = _get_part_objects(state)
        try:
            thumbs = ai_supervisor.render_quad_views(
                objs, out_dir, prefix=f"actor_step{step:02d}",
            ) if objs else []
        except Exception as e:
            print(f"[ai_actor] render failed at step {step}: {e}", file=sys.stderr)
            thumbs = []

        bb_min, bb_max = _bbox_mm(state)
        feedback_text = (
            f"Step {step} result: {json.dumps(result)}\n"
            f"Tris: {tris}, bbox_mm: min={[round(v,1) for v in bb_min]} max={[round(v,1) for v in bb_max]}\n"
            f"Objects: {[o.name for o in objs]}\n"
            f"Continue."
        )

        # Append the assistant tool_use turn (we synthesize the structure Claude expects)
        messages.append({
            "role": "assistant",
            "content": [{"type": "tool_use", "id": f"step_{step}", "name": ACTOR_TOOL_NAME, "input": decision}],
        })
        user_content: list = [
            {"type": "tool_result", "tool_use_id": f"step_{step}", "content": feedback_text},
        ]
        for view, p in zip(["front", "side", "top", "iso"], thumbs):
            user_content.append({"type": "text", "text": f"View: {view}"})
            user_content.append(_img_block_anthropic(p))
        messages.append({"role": "user", "content": user_content})

    # Auto-join everything into a single mesh for export
    try:
        op_join(state, {})
    except Exception as e:
        print(f"[ai_actor] auto-join failed: {e}", file=sys.stderr)

    final_objs = _get_part_objects(state)
    if not final_objs:
        return {"ok": False, "reason": f"no geometry produced ({finish_reason})", "steps": len(history)}

    final_obj = final_objs[0]
    tris = _total_tris(state)
    bb_min, bb_max = _bbox_mm(state)

    # Export GLB
    glb_path = out_dir / "generated_part.glb"
    bpy.ops.object.select_all(action="DESELECT")
    final_obj.select_set(True)
    bpy.context.view_layer.objects.active = final_obj
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
        )
    except Exception as e:
        return {"ok": False, "reason": f"glb export failed: {e}", "steps": len(history)}

    # Final thumbnail (iso)
    thumb_path = out_dir / "generated_part_thumb.png"
    try:
        thumbs = ai_supervisor.render_quad_views(final_objs, out_dir, prefix="final")
        if thumbs:
            # iso is the last one
            thumbs[-1].rename(thumb_path)
    except Exception as e:
        print(f"[ai_actor] thumb render failed: {e}", file=sys.stderr)

    # Final supervisor verdict
    verdict = ai_supervisor.ask_validator(
        f"generate_part_{part_kind}", final_objs, out_dir,
        attempt=1, context=f"style={style_prompt}; finish_reason={finish_reason}",
    )

    return {
        "ok": verdict.get("verdict") in {"accept", "retry"},
        "verdict": verdict,
        "reason": finish_reason,
        "glb_path": str(glb_path),
        "thumb_path": str(thumb_path) if thumb_path.exists() else "",
        "tri_count": tris,
        "bbox_mm": {"min": bb_min, "max": bb_max},
        "steps": len(history),
    }
