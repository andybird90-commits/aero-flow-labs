"""
ai_supervisor.py — vision-driven validator + classifier for the Blender worker.

Runs INSIDE Blender (`bpy` available). Renders quad views of objects with
Eevee, base64-encodes them, and asks Anthropic Claude (Opus 4.5) to either:

  • validate a step in the bake pipeline (accept / retry / fail)
  • classify a single panel into a fixed aero-slot enum

The AI never writes Blender code — it only returns structured JSON via
Claude tool-use calls. If the API is unreachable or the response
is malformed, callers fall back to safe defaults (accept + bbox heuristic),
so the bake pipeline never hard-fails because of the AI layer.

Env:
  ANTHROPIC_API_KEY — bearer token for https://api.anthropic.com (preferred)
  LOVABLE_API_KEY   — legacy fallback to https://ai.gateway.lovable.dev
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

import urllib.request
import urllib.error

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
# Top-tier Claude for both validator and classifier — vision + reasoning matter
# more here than per-call cost. Override per-call by passing `model=...`.
DEFAULT_MODEL = "claude-opus-4-5"
CLASSIFIER_MODEL = "claude-opus-4-5"

# Legacy gateway kept as a fallback only if ANTHROPIC_API_KEY is missing.
GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions"
GATEWAY_FALLBACK_MODEL = "google/gemini-2.5-pro"

SLOT_ENUM = [
    "front_splitter", "front_lip", "front_canard_l", "front_canard_r",
    "side_skirt_l", "side_skirt_r",
    "rear_diffuser", "rear_wing", "rear_bumper_addon",
    "hood_scoop", "hood_vent", "roof_scoop",
    "fender_flare_fl", "fender_flare_fr", "fender_flare_rl", "fender_flare_rr",
    "intake_duct_l", "intake_duct_r",
    "unknown",
]


# ────────────────────────────────────────────────────────────────────────────
# Render helpers
# ────────────────────────────────────────────────────────────────────────────

def _ensure_eevee_scene() -> None:
    """Configure render engine for cheap, fast 512px PNGs."""
    scene = bpy.context.scene
    # Eevee renames between Blender versions; try in order.
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.eevee.taa_render_samples = 8
    except AttributeError:
        pass


def _make_camera(name: str, location, look_at) -> Any:
    cam_data = bpy.data.cameras.new(name=name)
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    direction = (Vector(look_at) - Vector(location)).normalized()
    # rotation_euler from track-to vector
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = direction.to_track_quat("-Z", "Y")
    return cam


def _bbox_of(objs: Iterable[Any]):
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    seen = False
    for obj in objs:
        if obj is None or obj.type != "MESH":
            continue
        for v in obj.bound_box:
            wv = obj.matrix_world @ Vector(v)
            for i in range(3):
                if wv[i] < mn[i]:
                    mn[i] = wv[i]
                if wv[i] > mx[i]:
                    mx[i] = wv[i]
            seen = True
    if not seen:
        return [0, 0, 0], [1, 1, 1]
    return mn, mx


def render_quad_views(objs: list, out_dir: Path, prefix: str) -> list[Path]:
    """Render front / side / top / iso PNGs of `objs`. Returns local paths.

    Cleans up cameras/lights it adds. Other objects in the scene stay visible
    so the AI sees the panel in context."""
    _ensure_eevee_scene()
    bb_min, bb_max = _bbox_of(objs)
    cx = (bb_min[0] + bb_max[0]) / 2
    cy = (bb_min[1] + bb_max[1]) / 2
    cz = (bb_min[2] + bb_max[2]) / 2
    size = max(
        bb_max[0] - bb_min[0],
        bb_max[1] - bb_min[1],
        bb_max[2] - bb_min[2],
        1.0,
    )
    pad = size * 1.6

    # add a light if scene has none
    light_obj = None
    if not any(o.type == "LIGHT" for o in bpy.context.scene.objects):
        light_data = bpy.data.lights.new(name="ai_supervisor_light", type="SUN")
        light_data.energy = 4.0
        light_obj = bpy.data.objects.new("ai_supervisor_light", light_data)
        bpy.context.scene.collection.objects.link(light_obj)
        light_obj.location = (cx + pad, cy + pad, cz + pad)

    views = {
        "front": ((cx, cy + pad, cz),  (cx, cy, cz)),
        "side":  ((cx + pad, cy, cz),  (cx, cy, cz)),
        "top":   ((cx, cy, cz + pad),  (cx, cy, cz)),
        "iso":   ((cx + pad, cy + pad, cz + pad * 0.6), (cx, cy, cz)),
    }

    rendered: list[Path] = []
    cams: list[Any] = []
    try:
        for view_name, (loc, look) in views.items():
            cam = _make_camera(f"ai_cam_{view_name}", loc, look)
            cam.data.ortho_scale = size * 1.4
            cams.append(cam)
            bpy.context.scene.camera = cam
            out_path = out_dir / f"{prefix}_{view_name}.png"
            bpy.context.scene.render.filepath = str(out_path)
            bpy.ops.render.render(write_still=True)
            rendered.append(out_path)
    finally:
        for cam in cams:
            try:
                bpy.data.objects.remove(cam, do_unlink=True)
            except Exception:
                pass
        if light_obj is not None:
            try:
                bpy.data.objects.remove(light_obj, do_unlink=True)
            except Exception:
                pass
    return rendered


# ────────────────────────────────────────────────────────────────────────────
# Metric helpers
# ────────────────────────────────────────────────────────────────────────────

def collect_metrics(objs: list) -> dict:
    total_tris = 0
    counts = []
    for obj in objs:
        if obj is None or obj.type != "MESH":
            continue
        n = len(obj.data.polygons)
        total_tris += n
        counts.append(n)
    bb_min, bb_max = _bbox_of(objs)
    return {
        "object_count": len(counts),
        "triangle_count_total": total_tris,
        "triangle_count_per_object": counts[:32],
        "bbox_min_mm": [round(v, 1) for v in bb_min],
        "bbox_max_mm": [round(v, 1) for v in bb_max],
        "bbox_size_mm": [round(bb_max[i] - bb_min[i], 1) for i in range(3)],
    }


# ────────────────────────────────────────────────────────────────────────────
# Gateway plumbing
# ────────────────────────────────────────────────────────────────────────────

def _gateway_available() -> bool:
    return bool(
        os.environ.get("ANTHROPIC_API_KEY", "").strip()
        or os.environ.get("LOVABLE_API_KEY", "").strip()
    )


def _img_to_data_url(p: Path) -> str:
    b = p.read_bytes()
    return f"data:image/png;base64,{base64.b64encode(b).decode('ascii')}"


def _post_json(url: str, headers: dict, payload: dict, timeout: int) -> dict | None:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:400]
        except Exception:
            err_body = ""
        print(f"[ai_supervisor] HTTP {e.code} from {url}: {err_body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ai_supervisor] request error to {url}: {type(e).__name__}: {e}",
              file=sys.stderr)
        return None


def _img_block_anthropic(p: Path) -> dict:
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": b64},
    }


def _call_ai(
    *,
    system_msg: str,
    user_text: str,
    thumbs: list[Path],
    tool_name: str,
    tool_description: str,
    tool_schema: dict,
    model: str,
    timeout: int = 90,
) -> dict | None:
    """Send a vision + tool-use call to Anthropic, falling back to the
    Lovable gateway (Gemini) if no Anthropic key is configured.

    Returns the tool-call arguments dict, or None on any failure.
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()

    # ── Preferred: Anthropic Claude ───────────────────────────────────────
    if anthropic_key:
        content: list[dict] = [{"type": "text", "text": user_text}]
        for view_name, p in zip(["front", "side", "top", "iso"], thumbs):
            content.append({"type": "text", "text": f"View: {view_name}"})
            content.append(_img_block_anthropic(p))

        payload = {
            "model": model,
            "max_tokens": 1024,
            "system": system_msg,
            "tools": [{
                "name": tool_name,
                "description": tool_description,
                "input_schema": tool_schema,
            }],
            "tool_choice": {"type": "tool", "name": tool_name},
            "messages": [{"role": "user", "content": content}],
        }
        headers = {
            "x-api-key": anthropic_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
        resp = _post_json(ANTHROPIC_URL, headers, payload, timeout)
        if not resp:
            return None
        try:
            for block in resp.get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == tool_name:
                    return block.get("input") or {}
        except Exception as e:
            print(f"[ai_supervisor] could not parse Claude tool_use: {e}",
                  file=sys.stderr)
        return None

    # ── Fallback: Lovable AI Gateway (OpenAI-compatible, Gemini) ─────────
    lovable_key = os.environ.get("LOVABLE_API_KEY", "").strip()
    if not lovable_key:
        print("[ai_supervisor] no ANTHROPIC_API_KEY or LOVABLE_API_KEY — skipping",
              file=sys.stderr)
        return None

    content = [{"type": "text", "text": user_text}]
    for view_name, p in zip(["front", "side", "top", "iso"], thumbs):
        content.append({"type": "text", "text": f"View: {view_name}"})
        content.append({"type": "image_url",
                        "image_url": {"url": _img_to_data_url(p)}})

    payload = {
        "model": GATEWAY_FALLBACK_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": content},
        ],
        "tools": [{
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool_description,
                "parameters": tool_schema,
            },
        }],
        "tool_choice": {"type": "function",
                        "function": {"name": tool_name}},
    }
    headers = {
        "Authorization": f"Bearer {lovable_key}",
        "Content-Type": "application/json",
    }
    resp = _post_json(GATEWAY_URL, headers, payload, timeout)
    if not resp:
        return None
    try:
        msg = resp["choices"][0]["message"]
        for tc in (msg.get("tool_calls") or []):
            fn = tc.get("function") or {}
            if fn.get("name") == tool_name:
                return json.loads(fn.get("arguments") or "{}")
    except Exception as e:
        print(f"[ai_supervisor] could not parse gateway tool_call: {e}",
              file=sys.stderr)
    return None


# ────────────────────────────────────────────────────────────────────────────
# Public API: validator + classifier
# ────────────────────────────────────────────────────────────────────────────

def ask_validator(step_name: str, objs: list, out_dir: Path, attempt: int,
                  context: str = "") -> dict:
    """Render the current scene and ask the AI to accept/retry/fail.

    Returns: { verdict, reason, suggested_params? } — defaults to accept on
    any failure so the pipeline keeps going if the AI is unavailable.
    """
    fallback = {"verdict": "accept", "reason": "AI unavailable — accepted by default.", "suggested_params": {}}
    if not _gateway_available():
        return fallback

    try:
        thumbs = render_quad_views(objs, out_dir, prefix=f"validate_{step_name}_a{attempt}")
    except Exception as e:
        print(f"[ai_supervisor] render failed for {step_name}: {e}", file=sys.stderr)
        return fallback
    metrics = collect_metrics(objs)

    system_msg = (
        "You are a senior automotive aero engineer reviewing the output of a "
        "Blender bodykit-baking pipeline. You see four orthographic renders "
        "(front/side/top/iso) of the current state plus mesh metrics. Decide "
        "whether the geometry is sensible enough to ship to the user. "
        "A 'yellow blob', collapsed shell, totally empty mesh, or shell that "
        "ignored the donor car shape should NOT be accepted. "
        "Respond ONLY by calling the validator tool."
    )
    user_text = (
        f"Step: {step_name}\nAttempt: {attempt}\nContext: {context or 'n/a'}\n"
        f"Metrics: {json.dumps(metrics)}"
    )

    args = _call_ai(
        system_msg=system_msg,
        user_text=user_text,
        thumbs=thumbs,
        tool_name="report_verdict",
        tool_description="Report whether the bake step's geometry is acceptable.",
        tool_schema={
            "type": "object",
            "properties": {
                "verdict": {"type": "string", "enum": ["accept", "retry", "fail"]},
                "reason": {"type": "string",
                           "description": "One sentence explaining the call."},
                "suggested_params": {
                    "type": "object",
                    "description": "Optional hints for retry, e.g. {tolerance_mm: 8, solver: 'EXACT'}.",
                    "properties": {
                        "tolerance_mm": {"type": "number"},
                        "solver": {"type": "string",
                                   "enum": ["FAST", "EXACT"]},
                    },
                },
            },
            "required": ["verdict", "reason"],
        },
        model=DEFAULT_MODEL,
        timeout=90,
    )
    if not args or "verdict" not in args:
        return fallback
    args.setdefault("reason", "")
    args.setdefault("suggested_params", {})
    print(f"[ai_supervisor] {step_name} attempt={attempt} -> {args['verdict']}: {args['reason'][:160]}")
    return args


def ask_classifier(panel_obj, donor_bbox, panel_bbox, out_dir: Path, idx: int) -> dict:
    """Classify a single panel mesh into a SLOT_ENUM value.

    Returns: { slot, confidence, reason }. Falls back to {'slot': 'unknown', ...}
    if the AI is unavailable so callers can apply the bbox heuristic instead.
    """
    fallback = {"slot": "unknown", "confidence": 0.0, "reason": "AI unavailable."}
    if not _gateway_available() or panel_obj is None:
        return fallback

    try:
        thumbs = render_quad_views([panel_obj], out_dir, prefix=f"classify_{idx:02d}")
    except Exception as e:
        print(f"[ai_supervisor] panel render failed: {e}", file=sys.stderr)
        return fallback

    pmin, pmax = panel_bbox
    dmin, dmax = donor_bbox
    metrics = {
        "panel_bbox_mm": {"min": [round(v, 1) for v in pmin], "max": [round(v, 1) for v in pmax]},
        "panel_size_mm": [round(pmax[i] - pmin[i], 1) for i in range(3)],
        "donor_bbox_mm": {"min": [round(v, 1) for v in dmin], "max": [round(v, 1) for v in dmax]},
        "panel_centroid_mm": [round((pmin[i] + pmax[i]) / 2, 1) for i in range(3)],
        "triangle_count": len(panel_obj.data.polygons),
    }

    system_msg = (
        "You are an aero panel classifier. Given four orthographic renders of "
        "a single panel and its position relative to the donor car bounding "
        "box, return the most accurate slot label from the provided enum. "
        "Axis convention: +X=right, +Y=forward (front of car), +Z=up, units=mm. "
        "Use 'unknown' only when truly ambiguous. Be confident and specific — "
        "a low diffuser-like piece behind the rear axle is 'rear_diffuser', a "
        "low blade in front of the front axle is 'front_splitter'."
    )
    user_text = (
        f"Panel #{idx}\nMetrics: {json.dumps(metrics)}\n"
        "Pick exactly one slot from the enum and explain in <=20 words."
    )

    args = _call_ai(
        system_msg=system_msg,
        user_text=user_text,
        thumbs=thumbs,
        tool_name="report_slot",
        tool_description="Report the aero slot for this panel.",
        tool_schema={
            "type": "object",
            "properties": {
                "slot": {"type": "string", "enum": SLOT_ENUM},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "reason": {"type": "string"},
            },
            "required": ["slot", "confidence", "reason"],
        },
        model=CLASSIFIER_MODEL,
        timeout=60,
    )
    if not args or "slot" not in args:
        return fallback
    args.setdefault("confidence", 0.5)
    args.setdefault("reason", "")
    print(f"[ai_supervisor] panel {idx} -> {args['slot']} ({args['confidence']:.2f}): {args['reason'][:120]}")
    return args
