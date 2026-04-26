ALTER TABLE public.body_kit_parts
  ADD COLUMN IF NOT EXISTS ai_label text,
  ADD COLUMN IF NOT EXISTS ai_confidence real,
  ADD COLUMN IF NOT EXISTS ai_reasoning text;

ALTER TABLE public.body_kits
  ADD COLUMN IF NOT EXISTS ai_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_notes text;