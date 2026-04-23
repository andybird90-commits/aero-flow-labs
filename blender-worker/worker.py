r"""
BodyKit Studio - local Blender worker.

Outputs are POSTed back to the Lovable Cloud edge function
`upload-blender-output`, which holds the service-role key and stores files
in the `geometries` bucket. The worker only needs BLENDER_WORKER_TOKEN +
LOVABLE_FUNCTIONS_URL.

Run:
    .\start.ps1
Env:
    BLENDER_WORKER_TOKEN     bearer token (same one Lovable dispatches with)
    LOVABLE_FUNCTIONS_URL    e.g. https://zaauawyzokeraqlszktf.supabase.co/functions/v1
    BLENDER_EXE              path to blender.exe (default E:\blender.exe)
    PORT                     default 8000
"""
from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
import uvicorn

TOKEN = os.environ.get("BLENDER_WORKER_TOKEN", "").strip()
BLENDER_EXE = os.environ.get("BLENDER_EXE", r"E:\blender.exe")
PORT = int(os.environ.get("PORT", "8000"))
LOVABLE_FUNCTIONS_URL = os.environ.get("LOVABLE_FUNCTIONS_URL", "").rstrip("/")

ROOT = Path(__file__).parent.resolve()
OUTPUT_ROOT = ROOT / "output"
OUTPUT_ROOT.mkdir(exist_ok=True)
JOBS_SCRIPT = ROOT / "blender_jobs.py"

if not TOKEN:
    print("WARNING: BLENDER_WORKER_TOKEN is not set.", file=sys.stderr)
if not LOVABLE_FUNCTIONS_URL:
    print("WARNING: LOVABLE_FUNCTIONS_URL is not set — uploads will fail.", file=sys.stderr)
if not Path(BLENDER_EXE).exists():
    print(f"WARNING: Blender not found at {BLENDER_EXE}", file=sys.stderr)

JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

_MIME_OVERRIDES = {
    ".stl": "model/stl",
    ".glb": "model/gltf-binary",
    ".png": "image/png",
}


def _set(task_id: str, **kw):
    with JOBS_LOCK:
        JOBS[task_id].update(kw)


def _content_type(path: Path) -> str:
    return (
        _MIME_OVERRIDES.get(path.suffix.lower())
        or mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )


def _upload_via_edge(task_id: str, local: Path) -> str | None:
    """POST file bytes to the upload-blender-output edge function.
    Returns the signed URL on success, None on failure."""
    if not LOVABLE_FUNCTIONS_URL or not TOKEN:
        return None
    url = f"{LOVABLE_FUNCTIONS_URL}/upload-blender-output"
    try:
        with local.open("rb") as f:
            resp = requests.post(
                url,
                params={"task_id": task_id, "filename": local.name},
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": _content_type(local),
                },
                data=f,
                timeout=180,
            )
        if resp.status_code >= 300:
            print(f"[upload] {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
            return None
        return resp.json().get("url")
    except Exception as e:
        print(f"[upload] threw {type(e).__name__}: {e}", file=sys.stderr)
        return None


def _run_job(task_id: str, job_type: str, inputs: dict[str, Any]) -> None:
    job_dir = OUTPUT_ROOT / task_id
    job_dir.mkdir(parents=True, exist_ok=True)

    payload = {"job_type": job_type, "inputs": inputs, "out_dir": str(job_dir)}
    payload_path = job_dir / "payload.json"
    payload_path.write_text(json.dumps(payload), encoding="utf-8")

    cmd = [
        BLENDER_EXE, "--background", "--factory-startup",
        "--python-exit-code", "1", "--python", str(JOBS_SCRIPT),
        "--", str(payload_path),
    ]
    print(f"[{task_id}] launching: {' '.join(cmd)}")
    _set(task_id, status="running", progress=0.05)

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 20)
        log = (proc.stdout or "") + "\n---STDERR---\n" + (proc.stderr or "")
        (job_dir / "blender.log").write_text(log, encoding="utf-8")

        if proc.returncode != 0:
            tail = log.strip().splitlines()[-30:]
            _set(task_id, status="failed",
                 error=f"Blender exited {proc.returncode}: " + " | ".join(tail)[:480])
            return

        result_path = job_dir / "result.json"
        if not result_path.exists():
            _set(task_id, status="failed", error="Blender finished but wrote no result.json")
            return
        result = json.loads(result_path.read_text(encoding="utf-8"))

        outputs: dict[str, str] = {}
        for key, rel in (result.get("outputs") or {}).items():
            local = job_dir / rel
            if not local.exists():
                print(f"[{task_id}] output {key} missing: {local}", file=sys.stderr)
                continue
            uploaded = _upload_via_edge(task_id, local)
            if uploaded:
                outputs[key] = uploaded
            else:
                _set(task_id, status="failed",
                     error=f"Failed to upload {key} to Lovable Cloud (see worker log).")
                return

        _set(task_id, status="succeeded", progress=1.0, outputs=outputs)
        print(f"[{task_id}] succeeded with outputs: {list(outputs)}")

    except subprocess.TimeoutExpired:
        _set(task_id, status="failed", error="Blender job timed out (20m)")
    except Exception as e:
        _set(task_id, status="failed", error=f"{type(e).__name__}: {e}")


app = FastAPI(title="BodyKit Blender Worker", version="0.3.0")


def _require_auth(authorization: str | None) -> None:
    if not TOKEN:
        raise HTTPException(503, "Worker not configured (no BLENDER_WORKER_TOKEN)")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    if authorization.split(" ", 1)[1].strip() != TOKEN:
        raise HTTPException(401, "Bad token")


@app.get("/")
def root():
    return {
        "ok": True,
        "blender": BLENDER_EXE,
        "blender_exists": Path(BLENDER_EXE).exists(),
        "lovable_functions_url": LOVABLE_FUNCTIONS_URL or "(not set)",
        "upload_mode": "edge-function-callback",
        "jobs_in_memory": len(JOBS),
    }


@app.post("/jobs")
async def create_job(request: Request, authorization: str | None = Header(default=None)):
    _require_auth(authorization)
    body = await request.json()
    job_type = body.get("job_type")
    inputs = body.get("inputs") or {}
    if job_type not in {"prepare_base_mesh", "fit_part_to_zone", "mirror_part", "export_stl"}:
        raise HTTPException(400, f"Unknown job_type: {job_type}")

    task_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[task_id] = {
            "status": "queued", "progress": 0.0,
            "job_type": job_type, "inputs": inputs,
            "created_at": time.time(),
            "outputs": None, "error": None,
        }

    threading.Thread(target=_run_job, args=(task_id, job_type, inputs), daemon=True).start()
    return {"task_id": task_id}


@app.get("/jobs/{task_id}")
def get_job(task_id: str, authorization: str | None = Header(default=None)):
    _require_auth(authorization)
    with JOBS_LOCK:
        job = JOBS.get(task_id)
    if not job:
        raise HTTPException(404, "Unknown task_id")
    return JSONResponse({
        "status": job["status"],
        "progress": job["progress"],
        "outputs": job["outputs"],
        "error": job["error"],
    })


if __name__ == "__main__":
    print(f"Blender: {BLENDER_EXE}")
    print(f"Output:  {OUTPUT_ROOT}")
    print(f"Token:   {'set' if TOKEN else 'NOT SET'}")
    print(f"Lovable: {LOVABLE_FUNCTIONS_URL or 'NOT SET'}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
