
ALTER TABLE public.design_briefs
  ADD COLUMN IF NOT EXISTS discipline text,
  ADD COLUMN IF NOT EXISTS aggression text,
  ADD COLUMN IF NOT EXISTS must_include text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS must_avoid text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.concepts
  ADD COLUMN IF NOT EXISTS prompt_used text,
  ADD COLUMN IF NOT EXISTS variation_label text,
  ADD COLUMN IF NOT EXISTS variation_seed jsonb NOT NULL DEFAULT '{}'::jsonb;
