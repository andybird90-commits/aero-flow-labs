-- Recover stale bake jobs that died in the edge runtime CPU-time killer.
UPDATE public.body_kits
SET status = 'failed',
    error = 'Stale bake — please retry. (Pipeline moved to Blender worker.)',
    updated_at = now()
WHERE status IN ('queued', 'baking', 'subtracting', 'splitting')
  AND updated_at < now() - interval '5 minutes';