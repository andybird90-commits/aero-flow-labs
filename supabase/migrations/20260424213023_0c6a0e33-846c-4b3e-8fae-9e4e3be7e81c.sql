-- =========================================================
-- Phase 2 — APEX NEXT data model
-- =========================================================

-- ----- ENUMS -----
CREATE TYPE public.body_skin_fit_status AS ENUM ('raw', 'aligned', 'panelised', 'printable');

CREATE TYPE public.snap_zone_type AS ENUM (
  'front_left_arch','front_right_arch','rear_left_arch','rear_right_arch',
  'front_splitter','left_sill','right_sill','rear_diffuser','rear_wing',
  'roof','bonnet','left_door','right_door','left_quarter','right_quarter'
);

CREATE TYPE public.car_hardpoint_type AS ENUM (
  'front_wheel_centre','rear_wheel_centre','centreline',
  'sill_line','windscreen_base','windscreen_top','roof_peak','door_corner'
);

CREATE TYPE public.blender_job_type AS ENUM (
  'trim_part_to_car','conform_edge_to_body','thicken_shell','add_return_lip',
  'add_mounting_tabs','mirror_part','split_for_print_bed','repair_watertight',
  'decimate_mesh','cut_wheel_arches','cut_window_openings','panelise_body_skin',
  'export_stl','export_glb_preview'
);

CREATE TYPE public.blender_job_status AS ENUM ('queued','running','complete','failed');

CREATE TYPE public.meshy_generation_type AS ENUM ('part','body_skin');
CREATE TYPE public.meshy_generation_status AS ENUM ('queued','running','complete','failed');

-- ----- BODY SKINS -----
CREATE TABLE public.body_skins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  donor_car_template_id uuid REFERENCES public.car_templates(id) ON DELETE SET NULL,
  concept_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  file_url_glb text,
  file_url_stl text,
  preview_url text,
  source_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_prompt text,
  style_tags text[] NOT NULL DEFAULT '{}',
  fit_status public.body_skin_fit_status NOT NULL DEFAULT 'raw',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.body_skins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage body skins" ON public.body_skins
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users view body skins" ON public.body_skins
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_body_skins_updated_at
  BEFORE UPDATE ON public.body_skins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- CAR HARDPOINTS -----
CREATE TABLE public.car_hardpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_template_id uuid NOT NULL REFERENCES public.car_templates(id) ON DELETE CASCADE,
  point_type public.car_hardpoint_type NOT NULL,
  label text,
  position jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_car_hardpoints_template ON public.car_hardpoints(car_template_id);
ALTER TABLE public.car_hardpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage hardpoints" ON public.car_hardpoints
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users view hardpoints" ON public.car_hardpoints
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_car_hardpoints_updated_at
  BEFORE UPDATE ON public.car_hardpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- SNAP ZONES -----
CREATE TABLE public.snap_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_template_id uuid NOT NULL REFERENCES public.car_templates(id) ON DELETE CASCADE,
  zone_type public.snap_zone_type NOT NULL,
  label text,
  position jsonb NOT NULL DEFAULT '{}'::jsonb,
  rotation jsonb NOT NULL DEFAULT '{}'::jsonb,
  scale jsonb NOT NULL DEFAULT '{"x":1,"y":1,"z":1}'::jsonb,
  normal jsonb NOT NULL DEFAULT '{"x":0,"y":1,"z":0}'::jsonb,
  mirror_zone_id uuid REFERENCES public.snap_zones(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_snap_zones_template ON public.snap_zones(car_template_id);
ALTER TABLE public.snap_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage snap zones" ON public.snap_zones
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users view snap zones" ON public.snap_zones
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_snap_zones_updated_at
  BEFORE UPDATE ON public.snap_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- PLACED PARTS -----
CREATE TABLE public.placed_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  library_item_id uuid REFERENCES public.library_items(id) ON DELETE SET NULL,
  part_name text,
  position jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  rotation jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  scale jsonb NOT NULL DEFAULT '{"x":1,"y":1,"z":1}'::jsonb,
  snap_zone_id uuid REFERENCES public.snap_zones(id) ON DELETE SET NULL,
  mirrored boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_placed_parts_project ON public.placed_parts(project_id);
ALTER TABLE public.placed_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own placed parts" ON public.placed_parts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own placed parts" ON public.placed_parts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own placed parts" ON public.placed_parts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own placed parts" ON public.placed_parts
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_placed_parts_updated_at
  BEFORE UPDATE ON public.placed_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- SHELL ALIGNMENTS -----
CREATE TABLE public.shell_alignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  body_skin_id uuid NOT NULL REFERENCES public.body_skins(id) ON DELETE CASCADE,
  position jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  rotation jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  scale jsonb NOT NULL DEFAULT '{"x":1,"y":1,"z":1}'::jsonb,
  scale_to_wheelbase boolean NOT NULL DEFAULT true,
  locked_hardpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_shell_alignments_project ON public.shell_alignments(project_id);
ALTER TABLE public.shell_alignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own shell alignments" ON public.shell_alignments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own shell alignments" ON public.shell_alignments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own shell alignments" ON public.shell_alignments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own shell alignments" ON public.shell_alignments
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_shell_alignments_updated_at
  BEFORE UPDATE ON public.shell_alignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- BLENDER JOBS -----
CREATE TABLE public.blender_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  donor_car_template_id uuid REFERENCES public.car_templates(id) ON DELETE SET NULL,
  body_skin_id uuid REFERENCES public.body_skins(id) ON DELETE SET NULL,
  operation_type public.blender_job_type NOT NULL,
  status public.blender_job_status NOT NULL DEFAULT 'queued',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_mesh_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_part_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_file_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_file_url text,
  error_log text,
  worker_task_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_blender_jobs_user ON public.blender_jobs(user_id);
CREATE INDEX idx_blender_jobs_status ON public.blender_jobs(status);
ALTER TABLE public.blender_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own blender jobs" ON public.blender_jobs
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own blender jobs" ON public.blender_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own blender jobs" ON public.blender_jobs
  FOR UPDATE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users delete own blender jobs" ON public.blender_jobs
  FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_blender_jobs_updated_at
  BEFORE UPDATE ON public.blender_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- MESHY GENERATIONS -----
CREATE TABLE public.meshy_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generation_type public.meshy_generation_type NOT NULL,
  status public.meshy_generation_status NOT NULL DEFAULT 'queued',
  prompt text NOT NULL DEFAULT '',
  reference_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  donor_car_template_id uuid REFERENCES public.car_templates(id) ON DELETE SET NULL,
  output_glb_url text,
  output_stl_url text,
  preview_url text,
  saved_library_item_id uuid REFERENCES public.library_items(id) ON DELETE SET NULL,
  saved_body_skin_id uuid REFERENCES public.body_skins(id) ON DELETE SET NULL,
  meshy_task_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_meshy_generations_user ON public.meshy_generations(user_id);
ALTER TABLE public.meshy_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage meshy generations" ON public.meshy_generations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_meshy_generations_updated_at
  BEFORE UPDATE ON public.meshy_generations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----- STORAGE BUCKETS -----
INSERT INTO storage.buckets (id, name, public)
  VALUES ('body-skins', 'body-skins', false)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('blender-outputs', 'blender-outputs', false)
  ON CONFLICT (id) DO NOTHING;

-- body-skins: admins write, all authenticated read
CREATE POLICY "Authenticated read body-skins" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'body-skins');
CREATE POLICY "Admins write body-skins" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'body-skins' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update body-skins" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'body-skins' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete body-skins" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'body-skins' AND public.has_role(auth.uid(), 'admin'));

-- blender-outputs: owner-scoped via folder = user_id
CREATE POLICY "Users read own blender-outputs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'blender-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users write own blender-outputs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'blender-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own blender-outputs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'blender-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own blender-outputs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'blender-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);