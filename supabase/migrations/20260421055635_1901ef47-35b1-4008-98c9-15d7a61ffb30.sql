ALTER TABLE public.concept_parts
  ADD COLUMN IF NOT EXISTS isolated_source_url text;