ALTER TABLE public.body_skins
  ADD COLUMN IF NOT EXISTS source_skin_id uuid
  REFERENCES public.body_skins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS body_skins_source_skin_id_idx
  ON public.body_skins(source_skin_id);