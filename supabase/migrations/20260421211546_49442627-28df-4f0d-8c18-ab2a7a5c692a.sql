-- 1. Add new library item kind for geometry-fitted parts
ALTER TYPE public.library_item_kind ADD VALUE IF NOT EXISTS 'geometry_part_mesh';

-- 2. Create geometry_jobs table
CREATE TABLE public.geometry_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  concept_id uuid,
  project_id uuid,
  part_kind text NOT NULL,
  mount_zone text NOT NULL,
  side text NOT NULL DEFAULT 'center',
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  worker_task_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_geometry_jobs_user_id ON public.geometry_jobs(user_id);
CREATE INDEX idx_geometry_jobs_concept_id ON public.geometry_jobs(concept_id);
CREATE INDEX idx_geometry_jobs_status ON public.geometry_jobs(status);

ALTER TABLE public.geometry_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own geometry jobs"
  ON public.geometry_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own geometry jobs"
  ON public.geometry_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own geometry jobs"
  ON public.geometry_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own geometry jobs"
  ON public.geometry_jobs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_geometry_jobs_updated_at
  BEFORE UPDATE ON public.geometry_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Trigger to mirror successful geometry jobs into library_items
CREATE OR REPLACE FUNCTION public.sync_geometry_job_library_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _stl_url text;
  _glb_url text;
  _preview_url text;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  _stl_url := NEW.outputs->>'fitted_stl_url';
  _glb_url := NEW.outputs->>'glb_url';
  _preview_url := NEW.outputs->>'preview_png_url';

  IF _stl_url IS NULL AND _glb_url IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.library_items
    (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
  VALUES
    (NEW.user_id, 'geometry_part_mesh',
     COALESCE(NEW.part_kind, 'Geometry part') || ' — ' || NEW.mount_zone,
     _preview_url,
     COALESCE(_glb_url, _stl_url),
     CASE WHEN _glb_url IS NOT NULL THEN 'model/gltf-binary' ELSE 'model/stl' END,
     NEW.project_id, NEW.concept_id,
     jsonb_build_object(
       'geometry_job_id', NEW.id,
       'part_kind', NEW.part_kind,
       'mount_zone', NEW.mount_zone,
       'side', NEW.side,
       'stl_url', _stl_url,
       'glb_url', _glb_url
     ));
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_geometry_job_library_items_trigger
  AFTER INSERT OR UPDATE OF status ON public.geometry_jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_geometry_job_library_items();