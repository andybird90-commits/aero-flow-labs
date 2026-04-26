# start.ps1 — BodyKit Blender worker
# Run from PowerShell:  .\start.ps1

# >>> PASTE YOUR EXISTING WORKER TOKEN HERE (same value Lovable dispatches with) <<<
$env:BLENDER_WORKER_TOKEN  = "PASTE_YOUR_BLENDER_WORKER_TOKEN_HERE"

# >>> PASTE YOUR LOVABLE_API_KEY HERE — required for the AI supervisor (panel
#     classification + bake validation). Without it the worker falls back to
#     the bbox heuristic and will not catch broken bakes. Find it in Lovable
#     Cloud -> Settings -> Secrets, or generate one in Workspace settings. <<<
$env:LOVABLE_API_KEY       = "PASTE_YOUR_LOVABLE_API_KEY_HERE"

$env:BLENDER_EXE           = "E:\blender.exe"
$env:PORT                  = "8000"

# Lovable Cloud functions endpoint — public, no key needed
$env:LOVABLE_FUNCTIONS_URL = "https://zaauawyzokeraqlszktf.supabase.co/functions/v1"

python -m pip install --quiet requests fastapi uvicorn
python worker.py
