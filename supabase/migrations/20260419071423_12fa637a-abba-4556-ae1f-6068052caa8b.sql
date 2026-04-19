ALTER TABLE public.concepts
  ADD COLUMN IF NOT EXISTS preview_mesh_url text,
  ADD COLUMN IF NOT EXISTS preview_mesh_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS preview_mesh_error text;

-- status values: 'idle' | 'generating' | 'ready' | 'failed'
CREATE INDEX IF NOT EXISTS idx_concepts_preview_mesh_status ON public.concepts(preview_mesh_status);