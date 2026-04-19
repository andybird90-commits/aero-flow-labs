ALTER TABLE public.fitted_parts
  ADD COLUMN IF NOT EXISTS ai_mesh_url text,
  ADD COLUMN IF NOT EXISTS ai_mesh_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS ai_mesh_error text;