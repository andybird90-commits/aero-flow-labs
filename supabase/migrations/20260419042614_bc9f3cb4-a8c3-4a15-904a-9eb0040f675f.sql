
-- ═══════════════════════════════════════════════════════════════════
-- AeroLab — Full backend schema
-- ═══════════════════════════════════════════════════════════════════

-- ─── ENUMS ────────────────────────────────────────────────────────
CREATE TYPE public.app_role AS ENUM ('admin', 'engineer', 'viewer');
CREATE TYPE public.plan_tier AS ENUM ('free', 'pro', 'team', 'enterprise');
CREATE TYPE public.build_status AS ENUM ('draft', 'ready', 'archived');
CREATE TYPE public.variant_status AS ENUM ('draft', 'validating', 'ready', 'simulating', 'completed', 'failed');
CREATE TYPE public.job_kind AS ENUM ('preview', 'full', 'optimization');
CREATE TYPE public.job_state AS ENUM ('queued', 'preprocessing', 'simulating', 'postprocessing', 'completed', 'failed', 'cancelled');
CREATE TYPE public.confidence_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.objective_type AS ENUM ('top_speed', 'track_use', 'balance', 'high_speed_stability', 'rear_grip', 'custom');
CREATE TYPE public.export_status AS ENUM ('generating', 'ready', 'expired', 'failed');
CREATE TYPE public.export_kind AS ENUM ('pdf_report', 'image_pack', 'comparison_sheet', 'aero_summary', 'stl_pack', 'assumptions_sheet');

-- ─── TIMESTAMP TRIGGER ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ═══════════════════════════════════════════════════════════════════
-- 1. PROFILES
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  org TEXT,
  plan public.plan_tier NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 2. USER ROLES (separate table — security best practice)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ═══════════════════════════════════════════════════════════════════
-- 3. CAR TEMPLATES (system-managed, public read)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.car_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  year_range TEXT,
  drivetrain TEXT,
  mass_kg NUMERIC,
  wheelbase_mm INTEGER,
  track_front_mm INTEGER,
  track_rear_mm INTEGER,
  frontal_area_m2 NUMERIC,
  cd_stock NUMERIC,
  default_tyre TEXT,
  supported BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.car_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Car templates are public"
  ON public.car_templates FOR SELECT USING (true);
CREATE POLICY "Admins manage templates"
  ON public.car_templates FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER car_templates_set_updated_at BEFORE UPDATE ON public.car_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 4. CARS (user-owned vehicles, instantiated from a template)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.cars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.car_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cars_user ON public.cars(user_id);

CREATE POLICY "Users view own cars"   ON public.cars FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cars" ON public.cars FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cars" ON public.cars FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cars" ON public.cars FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER cars_set_updated_at BEFORE UPDATE ON public.cars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 5. BUILDS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  objective public.objective_type NOT NULL DEFAULT 'balance',
  status public.build_status NOT NULL DEFAULT 'draft',
  starred BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.builds ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_builds_user ON public.builds(user_id);
CREATE INDEX idx_builds_car  ON public.builds(car_id);

CREATE POLICY "Users view own builds"   ON public.builds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own builds" ON public.builds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own builds" ON public.builds FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own builds" ON public.builds FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER builds_set_updated_at BEFORE UPDATE ON public.builds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 6. GEOMETRY RECORDS (per build; future STL upload support)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.geometries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  build_id UUID NOT NULL REFERENCES public.builds(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'template',  -- 'template' | 'parametric' | 'stl'
  ride_height_front_mm NUMERIC,
  ride_height_rear_mm NUMERIC,
  underbody_model TEXT NOT NULL DEFAULT 'simplified', -- 'none' | 'simplified' | 'detailed'
  wheel_rotation TEXT NOT NULL DEFAULT 'static',     -- 'static' | 'simplified' | 'mrf'
  steady_state BOOLEAN NOT NULL DEFAULT true,
  stl_path TEXT,        -- storage path when source='stl'
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.geometries ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_geometries_build ON public.geometries(build_id);

CREATE POLICY "Users view own geometries"   ON public.geometries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own geometries" ON public.geometries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own geometries" ON public.geometries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own geometries" ON public.geometries FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER geometries_set_updated_at BEFORE UPDATE ON public.geometries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 7. VARIANTS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  build_id UUID NOT NULL REFERENCES public.builds(id) ON DELETE CASCADE,
  geometry_id UUID REFERENCES public.geometries(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  tag TEXT,
  status public.variant_status NOT NULL DEFAULT 'draft',
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_variants_build ON public.variants(build_id);
CREATE INDEX idx_variants_user  ON public.variants(user_id);

CREATE POLICY "Users view own variants"   ON public.variants FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own variants" ON public.variants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own variants" ON public.variants FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own variants" ON public.variants FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER variants_set_updated_at BEFORE UPDATE ON public.variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 8. AERO COMPONENT CONFIGS (parts attached to a variant)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.aero_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,        -- 'splitter' | 'canard' | 'wing' | 'diffuser' | 'skirt' | 'ducktail' | 'vent'
  enabled BOOLEAN NOT NULL DEFAULT true,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,  -- chord, AoA, angle, protrusion, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.aero_components ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_aero_components_variant ON public.aero_components(variant_id);

CREATE POLICY "Users view own components"   ON public.aero_components FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own components" ON public.aero_components FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own components" ON public.aero_components FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own components" ON public.aero_components FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER aero_components_set_updated_at BEFORE UPDATE ON public.aero_components
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 9. SIMULATION JOBS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.simulation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  kind public.job_kind NOT NULL DEFAULT 'preview',
  state public.job_state NOT NULL DEFAULT 'queued',
  speed_kmh NUMERIC NOT NULL DEFAULT 200,
  yaw_deg NUMERIC NOT NULL DEFAULT 0,
  air_density NUMERIC NOT NULL DEFAULT 1.225,
  iterations_target INTEGER NOT NULL DEFAULT 2400,
  iterations_done INTEGER NOT NULL DEFAULT 0,
  residual TEXT,
  walltime_s INTEGER,
  solver TEXT NOT NULL DEFAULT 'OpenFOAM 11 · k-omega SST',
  credits_charged INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  assumptions_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.simulation_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_jobs_user    ON public.simulation_jobs(user_id);
CREATE INDEX idx_jobs_variant ON public.simulation_jobs(variant_id);
CREATE INDEX idx_jobs_state   ON public.simulation_jobs(state);

CREATE POLICY "Users view own jobs"   ON public.simulation_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own jobs" ON public.simulation_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own jobs" ON public.simulation_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own jobs" ON public.simulation_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER simulation_jobs_set_updated_at BEFORE UPDATE ON public.simulation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 10. SIMULATION RESULTS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.simulation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL UNIQUE REFERENCES public.simulation_jobs(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  kind public.job_kind NOT NULL,
  is_stale BOOLEAN NOT NULL DEFAULT false,

  -- core metrics
  cd NUMERIC NOT NULL,
  drag_kgf NUMERIC NOT NULL,
  df_front_kgf NUMERIC NOT NULL,
  df_rear_kgf NUMERIC NOT NULL,
  df_total_kgf NUMERIC NOT NULL,
  ld_ratio NUMERIC NOT NULL,
  balance_front_pct NUMERIC NOT NULL,
  top_speed_kmh NUMERIC,
  track_score NUMERIC,
  stability_score NUMERIC,

  -- probes
  cp_stagnation NUMERIC,
  cp_roof NUMERIC,
  cp_wing NUMERIC,
  cp_underfloor NUMERIC,
  v_max_roof NUMERIC,
  v_underfloor NUMERIC,

  confidence public.confidence_level NOT NULL DEFAULT 'medium',
  confidence_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.simulation_results ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_results_variant ON public.simulation_results(variant_id);
CREATE INDEX idx_results_user    ON public.simulation_results(user_id);

CREATE POLICY "Users view own results"   ON public.simulation_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own results" ON public.simulation_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own results" ON public.simulation_results FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own results" ON public.simulation_results FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- 11. OPTIMIZATION JOBS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.optimization_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  build_id UUID NOT NULL REFERENCES public.builds(id) ON DELETE CASCADE,
  baseline_variant_id UUID REFERENCES public.variants(id) ON DELETE SET NULL,
  objective public.objective_type NOT NULL,
  objective_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  state public.job_state NOT NULL DEFAULT 'queued',
  candidates_total INTEGER NOT NULL DEFAULT 0,
  candidates_evaluated INTEGER NOT NULL DEFAULT 0,
  best_candidate JSONB,
  ranked_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning TEXT,
  confidence public.confidence_level NOT NULL DEFAULT 'medium',
  walltime_s INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.optimization_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_optjobs_user  ON public.optimization_jobs(user_id);
CREATE INDEX idx_optjobs_build ON public.optimization_jobs(build_id);

CREATE POLICY "Users view own optjobs"   ON public.optimization_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own optjobs" ON public.optimization_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own optjobs" ON public.optimization_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own optjobs" ON public.optimization_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER optimization_jobs_set_updated_at BEFORE UPDATE ON public.optimization_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 12. EXPORTS / REPORTS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  build_id UUID REFERENCES public.builds(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.variants(id) ON DELETE CASCADE,
  kind public.export_kind NOT NULL,
  status public.export_status NOT NULL DEFAULT 'generating',
  audience TEXT NOT NULL DEFAULT 'internal',  -- 'internal' | 'client' | 'public'
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_path TEXT,
  file_size_bytes BIGINT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_exports_user ON public.exports(user_id);

CREATE POLICY "Users view own exports"   ON public.exports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own exports" ON public.exports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own exports" ON public.exports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own exports" ON public.exports FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER exports_set_updated_at BEFORE UPDATE ON public.exports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════
-- 13. AUTH BOOTSTRAP — auto-create profile + viewer role on signup
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'engineer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════
-- 14. SEED CAR TEMPLATES
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO public.car_templates (slug, make, model, trim, year_range, drivetrain, mass_kg, wheelbase_mm, track_front_mm, track_rear_mm, frontal_area_m2, cd_stock, default_tyre, supported) VALUES
  ('gr86-zn8',     'Toyota',     'GR86',           'ZN8',         '2022–2024', 'RWD', 1275, 2575, 1520, 1550, 2.04, 0.366, 'Michelin PS4S 245/40R18', true),
  ('civic-fk8',    'Honda',      'Civic Type R',   'FK8',         '2017–2021', 'FWD', 1393, 2700, 1551, 1556, 2.31, 0.328, 'Continental SC6 245/30R20', true),
  ('m2-f87',       'BMW',        'M2 Competition', 'F87',         '2018–2021', 'RWD', 1575, 2693, 1579, 1601, 2.20, 0.350, 'Michelin PS4S 245/35R19', true),
  ('cayman-gt4',   'Porsche',    '718 Cayman GT4', '982',         '2019–2024', 'RWD', 1420, 2484, 1535, 1540, 1.99, 0.330, 'Michelin Cup 2 245/35R20', true),
  ('supra-a90',    'Toyota',     'GR Supra',       'A90 3.0',     '2020–2024', 'RWD', 1495, 2470, 1594, 1589, 2.08, 0.340, 'Michelin PS4S 255/35R19', true),
  ('evo-cz4a',     'Mitsubishi', 'Lancer Evo X',   'CZ4A',        '2008–2016', 'AWD', 1545, 2650, 1545, 1545, 2.27, 0.340, 'Yokohama AD08R 245/40R18', false);
