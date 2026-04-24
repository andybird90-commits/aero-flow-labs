
ALTER TYPE public.library_item_kind ADD VALUE IF NOT EXISTS 'cad_part_mesh';

CREATE TABLE IF NOT EXISTS public.cad_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  concept_id uuid,
  project_id uuid,
  part_kind text NOT NULL,
  part_label text,
  status text NOT NULL DEFAULT 'queued',
  recipe jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  worker_task_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cad_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own cad jobs" ON public.cad_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cad jobs" ON public.cad_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cad jobs" ON public.cad_jobs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cad jobs" ON public.cad_jobs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_cad_jobs_updated_at
  BEFORE UPDATE ON public.cad_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_cad_job_library_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _step_url text;
  _stl_url text;
  _glb_url text;
  _preview_url text;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  _step_url := NEW.outputs->>'step_url';
  _stl_url := NEW.outputs->>'stl_url';
  _glb_url := NEW.outputs->>'glb_url';
  _preview_url := NEW.outputs->>'preview_png_url';

  IF _stl_url IS NULL AND _glb_url IS NULL AND _step_url IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.library_items
    (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
  VALUES
    (NEW.user_id, 'cad_part_mesh'::library_item_kind,
     COALESCE(NEW.part_label, NEW.part_kind, 'CAD part') || ' - CAD',
     _preview_url,
     COALESCE(_glb_url, _stl_url, _step_url),
     CASE
       WHEN _glb_url IS NOT NULL THEN 'model/gltf-binary'
       WHEN _stl_url IS NOT NULL THEN 'model/stl'
       ELSE 'model/step'
     END,
     NEW.project_id, NEW.concept_id,
     jsonb_build_object(
       'cad_job_id', NEW.id,
       'part_kind', NEW.part_kind,
       'engine', 'cad',
       'step_url', _step_url,
       'stl_url', _stl_url,
       'glb_url', _glb_url
     ));
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sync_cad_job_library_items_trg
  AFTER INSERT OR UPDATE ON public.cad_jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_cad_job_library_items();
