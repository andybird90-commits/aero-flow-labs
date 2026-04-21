ALTER TABLE public.prototypes
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'exact_photo',
  ADD COLUMN IF NOT EXISTS placement_hint text,
  ADD COLUMN IF NOT EXISTS isolated_ref_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS reference_error text;

ALTER TABLE public.prototypes
  ADD CONSTRAINT prototypes_generation_mode_check
  CHECK (generation_mode IN ('exact_photo', 'text_design', 'inspired_photo'));