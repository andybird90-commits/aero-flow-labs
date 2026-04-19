CREATE TABLE public.concept_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL,
  concept_id UUID NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  render_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  glb_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (concept_id, kind)
);

ALTER TABLE public.concept_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own concept parts"
  ON public.concept_parts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own concept parts"
  ON public.concept_parts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own concept parts"
  ON public.concept_parts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own concept parts"
  ON public.concept_parts FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_concept_parts_concept_id ON public.concept_parts(concept_id);
CREATE INDEX idx_concept_parts_project_id ON public.concept_parts(project_id);

CREATE TRIGGER update_concept_parts_updated_at
  BEFORE UPDATE ON public.concept_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();