-- Style presets: reusable styling DNA (Pandem-style, Liberty-style, RWB-style, custom)
CREATE TABLE public.style_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  style_tags TEXT[] NOT NULL DEFAULT '{}',
  constraints TEXT[] NOT NULL DEFAULT '{}',
  build_type TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  cover_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

ALTER TABLE public.style_presets ENABLE ROW LEVEL SECURITY;

-- Anyone can view their own styles + any public ones
CREATE POLICY "View own or public style presets"
ON public.style_presets
FOR SELECT
USING (auth.uid() = user_id OR is_public = true);

CREATE POLICY "Users insert own style presets"
ON public.style_presets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own style presets"
ON public.style_presets
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own style presets"
ON public.style_presets
FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_style_presets_updated_at
BEFORE UPDATE ON public.style_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_style_presets_user ON public.style_presets(user_id);
CREATE INDEX idx_style_presets_public ON public.style_presets(is_public) WHERE is_public = true;

-- Optional link from a brief to a preset
ALTER TABLE public.design_briefs
ADD COLUMN style_preset_id UUID REFERENCES public.style_presets(id) ON DELETE SET NULL;

CREATE INDEX idx_design_briefs_style_preset ON public.design_briefs(style_preset_id);