ALTER TABLE public.prototypes
  ADD COLUMN IF NOT EXISTS source_mask_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_source_index integer NOT NULL DEFAULT 0;