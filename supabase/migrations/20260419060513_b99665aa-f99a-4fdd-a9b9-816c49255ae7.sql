
-- ============================================================
-- PHASE 1: DROP SIMULATION-ERA TABLES & UNUSED ENUMS
-- ============================================================

DROP TABLE IF EXISTS public.simulation_results CASCADE;
DROP TABLE IF EXISTS public.simulation_jobs CASCADE;
DROP TABLE IF EXISTS public.optimization_jobs CASCADE;

-- Drop enums no longer referenced
DROP TYPE IF EXISTS public.confidence_level CASCADE;
DROP TYPE IF EXISTS public.job_kind CASCADE;

-- ============================================================
-- PHASE 2: RENAME CORE TABLES (DATA PRESERVED)
-- ============================================================

-- builds -> projects
ALTER TABLE public.builds RENAME TO projects;

-- Rename build_status enum -> project_status, expand values
ALTER TYPE public.build_status RENAME TO project_status_old;
CREATE TYPE public.project_status AS ENUM ('draft', 'brief', 'concepts', 'approved', 'parts', 'exported', 'archived');

ALTER TABLE public.projects
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.project_status USING (
    CASE status::text
      WHEN 'ready' THEN 'draft'
      WHEN 'archived' THEN 'archived'
      ELSE 'draft'
    END
  )::public.project_status,
  ALTER COLUMN status SET DEFAULT 'draft'::public.project_status;

DROP TYPE public.project_status_old;

-- Drop objective column (CFD-era)
ALTER TABLE public.projects DROP COLUMN IF EXISTS objective;
DROP TYPE IF EXISTS public.objective_type CASCADE;

-- variants -> concept_sets
ALTER TABLE public.variants RENAME TO concept_sets;

-- variant_status -> concept_set_status
ALTER TYPE public.variant_status RENAME TO concept_set_status_old;
CREATE TYPE public.concept_set_status AS ENUM ('draft', 'generating', 'ready', 'approved', 'failed');

ALTER TABLE public.concept_sets
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.concept_set_status USING (
    CASE status::text
      WHEN 'completed' THEN 'ready'
      WHEN 'simulating' THEN 'generating'
      WHEN 'validating' THEN 'generating'
      WHEN 'ready' THEN 'ready'
      WHEN 'failed' THEN 'failed'
      ELSE 'draft'
    END
  )::public.concept_set_status,
  ALTER COLUMN status SET DEFAULT 'draft'::public.concept_set_status;

DROP TYPE public.concept_set_status_old;

-- Rename build_id columns -> project_id
ALTER TABLE public.concept_sets RENAME COLUMN build_id TO project_id;
ALTER TABLE public.geometries RENAME COLUMN build_id TO project_id;
ALTER TABLE public.exports RENAME COLUMN build_id TO project_id;

-- Drop is_baseline (CFD concept) - replaced by concept approval
ALTER TABLE public.concept_sets DROP COLUMN IF EXISTS is_baseline;

-- aero_components -> fitted_parts
ALTER TABLE public.aero_components RENAME TO fitted_parts;
ALTER TABLE public.fitted_parts RENAME COLUMN variant_id TO concept_set_id;

-- ============================================================
-- PHASE 3: EXPORTS — REPURPOSE FOR STL/OBJ KIT PACKS
-- ============================================================

ALTER TYPE public.export_kind RENAME TO export_kind_old;
CREATE TYPE public.export_kind AS ENUM (
  'kit_stl_pack',
  'kit_obj_pack',
  'single_part_stl',
  'single_part_obj',
  'project_pack'
);

ALTER TABLE public.exports
  ALTER COLUMN kind TYPE public.export_kind USING (
    CASE kind::text
      WHEN 'stl_pack' THEN 'kit_stl_pack'
      ELSE 'kit_stl_pack'
    END
  )::public.export_kind;

DROP TYPE public.export_kind_old;

ALTER TABLE public.exports RENAME COLUMN variant_id TO concept_set_id;

-- ============================================================
-- PHASE 4: NEW TABLES
-- ============================================================

-- Design briefs
CREATE TABLE public.design_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt text NOT NULL DEFAULT '',
  style_tags text[] NOT NULL DEFAULT '{}',
  build_type text,
  constraints text[] NOT NULL DEFAULT '{}',
  reference_image_paths text[] NOT NULL DEFAULT '{}',
  rights_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.design_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own briefs" ON public.design_briefs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own briefs" ON public.design_briefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own briefs" ON public.design_briefs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own briefs" ON public.design_briefs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_design_briefs_updated
  BEFORE UPDATE ON public.design_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_design_briefs_project ON public.design_briefs(project_id);

-- Concepts
CREATE TYPE public.concept_status AS ENUM ('pending', 'approved', 'rejected', 'favourited');

CREATE TABLE public.concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  concept_set_id uuid REFERENCES public.concept_sets(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled concept',
  direction text,
  render_front_url text,
  render_rear_url text,
  render_side_url text,
  status public.concept_status NOT NULL DEFAULT 'pending',
  ai_notes text,
  locked_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own concepts" ON public.concepts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own concepts" ON public.concepts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own concepts" ON public.concepts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own concepts" ON public.concepts
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_concepts_updated
  BEFORE UPDATE ON public.concepts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_concepts_project ON public.concepts(project_id);
CREATE INDEX idx_concepts_status ON public.concepts(status);

-- Parts generation jobs
CREATE TYPE public.parts_job_state AS ENUM ('queued', 'analyzing', 'generating', 'completed', 'failed');

CREATE TABLE public.parts_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  state public.parts_job_state NOT NULL DEFAULT 'queued',
  suggested_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parts_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own parts jobs" ON public.parts_generation_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own parts jobs" ON public.parts_generation_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own parts jobs" ON public.parts_generation_jobs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own parts jobs" ON public.parts_generation_jobs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_parts_jobs_updated
  BEFORE UPDATE ON public.parts_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_parts_jobs_project ON public.parts_generation_jobs(project_id);

-- ============================================================
-- PHASE 5: STORAGE BUCKET FOR CONCEPT RENDERS
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('concept-renders', 'concept-renders', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own concept renders"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'concept-renders' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own concept renders"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'concept-renders' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own concept renders"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'concept-renders' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own concept renders"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'concept-renders' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- PHASE 6: UPDATE EXISTING DUPLICATE FUNCTIONS TO MATCH NEW NAMES
-- ============================================================

DROP FUNCTION IF EXISTS public.duplicate_build(uuid);
DROP FUNCTION IF EXISTS public.duplicate_variant(uuid);

CREATE OR REPLACE FUNCTION public.duplicate_project(_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_project uuid;
  _new_geo uuid;
  _user uuid := auth.uid();
  _src_project record;
  _src_geo record;
  _cs record;
  _new_cs uuid;
BEGIN
  SELECT * INTO _src_project FROM public.projects WHERE id = _project_id AND user_id = _user;
  IF _src_project IS NULL THEN RAISE EXCEPTION 'Project not found or not owned by user'; END IF;

  INSERT INTO public.projects (user_id, car_id, name, status, notes, starred)
  VALUES (_user, _src_project.car_id, _src_project.name || ' (copy)',
          'draft', _src_project.notes, false)
  RETURNING id INTO _new_project;

  SELECT * INTO _src_geo FROM public.geometries
    WHERE project_id = _project_id ORDER BY created_at DESC LIMIT 1;
  IF _src_geo IS NOT NULL THEN
    INSERT INTO public.geometries (user_id, project_id, source, ride_height_front_mm, ride_height_rear_mm,
                                    underbody_model, wheel_rotation, steady_state, stl_path, metadata)
    VALUES (_user, _new_project, _src_geo.source, _src_geo.ride_height_front_mm, _src_geo.ride_height_rear_mm,
            _src_geo.underbody_model, _src_geo.wheel_rotation, _src_geo.steady_state,
            _src_geo.stl_path, _src_geo.metadata)
    RETURNING id INTO _new_geo;
  END IF;

  FOR _cs IN SELECT * FROM public.concept_sets WHERE project_id = _project_id LOOP
    INSERT INTO public.concept_sets (user_id, project_id, geometry_id, name, tag, status, notes)
    VALUES (_user, _new_project, _new_geo, _cs.name, _cs.tag, 'draft', _cs.notes)
    RETURNING id INTO _new_cs;

    INSERT INTO public.fitted_parts (user_id, concept_set_id, kind, params, enabled)
    SELECT _user, _new_cs, kind, params, enabled
    FROM public.fitted_parts WHERE concept_set_id = _cs.id;
  END LOOP;

  RETURN _new_project;
END;
$$;
