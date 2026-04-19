ALTER TABLE public.fitted_parts
  DROP COLUMN IF EXISTS ai_mesh_url,
  DROP COLUMN IF EXISTS ai_mesh_status,
  DROP COLUMN IF EXISTS ai_mesh_error;