ALTER TABLE public.concept_parts
  ADD COLUMN IF NOT EXISTS fidelity_score smallint,
  ADD COLUMN IF NOT EXISTS fidelity_breakdown jsonb;