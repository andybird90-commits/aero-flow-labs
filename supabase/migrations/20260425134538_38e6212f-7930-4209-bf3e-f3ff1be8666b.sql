-- ===========================================================================
-- Body kits — the baked output of "shell minus donor body, split into panels"
-- ===========================================================================

CREATE TYPE public.body_kit_bake_status AS ENUM (
  'idle',
  'queued',
  'baking',
  'subtracting',
  'splitting',
  'ready',
  'failed'
);

CREATE TABLE public.body_kits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  body_skin_id UUID NOT NULL REFERENCES public.body_skins(id) ON DELETE CASCADE,
  shell_alignment_id UUID REFERENCES public.shell_alignments(id) ON DELETE SET NULL,
  donor_car_template_id UUID REFERENCES public.car_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Untitled bodykit',
  status public.body_kit_bake_status NOT NULL DEFAULT 'idle',
  error TEXT,
  combined_stl_path TEXT,            -- single STL of the whole kit (pre-split)
  combined_glb_url TEXT,             -- optional GLB for fast 3D preview
  preview_thumbnail_url TEXT,
  -- Snapshot of the transform that produced this bake — so we can re-bake or
  -- audit even if the underlying shell_alignments row drifts later.
  baked_transform JSONB NOT NULL DEFAULT '{}'::jsonb,
  triangle_count INTEGER,
  panel_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_body_kits_project_id ON public.body_kits(project_id);
CREATE INDEX idx_body_kits_user_id ON public.body_kits(user_id);
CREATE INDEX idx_body_kits_body_skin_id ON public.body_kits(body_skin_id);

ALTER TABLE public.body_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own body kits"
  ON public.body_kits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own body kits"
  ON public.body_kits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own body kits"
  ON public.body_kits FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own body kits"
  ON public.body_kits FOR DELETE
  USING (auth.uid() = user_id);

-- Public read for shared projects (mirrors placed_parts policy).
CREATE POLICY "Public can view body kits of shared projects"
  ON public.body_kits FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = body_kits.project_id
      AND p.share_enabled = true
      AND p.share_token IS NOT NULL
  ));

CREATE TRIGGER update_body_kits_updated_at
  BEFORE UPDATE ON public.body_kits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================================================
-- Body kit parts — one row per named panel produced by auto-split
-- ===========================================================================

CREATE TABLE public.body_kit_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  body_kit_id UUID NOT NULL REFERENCES public.body_kits(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,                -- e.g. front_splitter, side_skirt_l, rear_wing
  label TEXT,                        -- nicely-formatted display label
  confidence REAL NOT NULL DEFAULT 0,
  stl_path TEXT NOT NULL,            -- path inside `car-stls` bucket
  glb_url TEXT,                      -- optional cached GLB for the part
  thumbnail_url TEXT,
  triangle_count INTEGER NOT NULL DEFAULT 0,
  area_m2 REAL NOT NULL DEFAULT 0,
  bbox JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Cached anchor position in donor-world space — used as a snap hint when
  -- the part is later dropped onto the same (or a similar) car.
  anchor_position JSONB,
  -- Optional library_items.id linking this part to its marketplace listing.
  library_item_id UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_body_kit_parts_kit_id ON public.body_kit_parts(body_kit_id);
CREATE INDEX idx_body_kit_parts_user_id ON public.body_kit_parts(user_id);
CREATE INDEX idx_body_kit_parts_slot ON public.body_kit_parts(slot);

ALTER TABLE public.body_kit_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own body kit parts"
  ON public.body_kit_parts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own body kit parts"
  ON public.body_kit_parts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own body kit parts"
  ON public.body_kit_parts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own body kit parts"
  ON public.body_kit_parts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Public can view body kit parts of shared projects"
  ON public.body_kit_parts FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.body_kits bk
    JOIN public.projects p ON p.id = bk.project_id
    WHERE bk.id = body_kit_parts.body_kit_id
      AND p.share_enabled = true
      AND p.share_token IS NOT NULL
  ));

CREATE TRIGGER update_body_kit_parts_updated_at
  BEFORE UPDATE ON public.body_kit_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();