
-- Build Studio annotations: hand-drawn markup layered on the 3D scene.
CREATE TABLE public.studio_annotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('screen', 'surface')),
  label TEXT,
  color TEXT NOT NULL DEFAULT '#fb923c',
  strokes JSONB NOT NULL DEFAULT '[]'::jsonb,
  camera_pose JSONB,
  visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_studio_annotations_project ON public.studio_annotations(project_id);
CREATE INDEX idx_studio_annotations_user ON public.studio_annotations(user_id);

ALTER TABLE public.studio_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their annotations"
  ON public.studio_annotations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users create their annotations"
  ON public.studio_annotations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their annotations"
  ON public.studio_annotations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their annotations"
  ON public.studio_annotations FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_studio_annotations_updated_at
  BEFORE UPDATE ON public.studio_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
