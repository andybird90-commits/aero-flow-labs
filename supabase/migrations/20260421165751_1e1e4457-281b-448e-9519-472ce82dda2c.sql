-- Frozen parts table for the new Prototyper workflow
CREATE TABLE public.frozen_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  prototype_id UUID NOT NULL REFERENCES public.prototypes(id) ON DELETE CASCADE,
  garage_car_id UUID REFERENCES public.garage_cars(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Untitled part',
  category TEXT NOT NULL DEFAULT 'other',
  mount_zone TEXT NOT NULL DEFAULT 'front_bumper',
  side TEXT NOT NULL DEFAULT 'center',
  symmetry_allowed BOOLEAN NOT NULL DEFAULT true,
  silhouette_locked BOOLEAN NOT NULL DEFAULT true,
  source_image_url TEXT,
  mask_url TEXT,
  silhouette_url TEXT,
  preview_url TEXT,
  bbox JSONB NOT NULL DEFAULT '{}'::jsonb,
  anchor_points JSONB NOT NULL DEFAULT '{}'::jsonb,
  view_angle TEXT NOT NULL DEFAULT 'front34',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_frozen_parts_user ON public.frozen_parts(user_id);
CREATE INDEX idx_frozen_parts_prototype ON public.frozen_parts(prototype_id);
CREATE INDEX idx_frozen_parts_garage_car ON public.frozen_parts(garage_car_id);

ALTER TABLE public.frozen_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own frozen parts"
  ON public.frozen_parts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own frozen parts"
  ON public.frozen_parts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own frozen parts"
  ON public.frozen_parts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own frozen parts"
  ON public.frozen_parts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER frozen_parts_updated_at
  BEFORE UPDATE ON public.frozen_parts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Placement manifest column on prototypes for Approve Overlay handoff
ALTER TABLE public.prototypes
  ADD COLUMN IF NOT EXISTS placement_manifest JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Public storage bucket for frozen part assets (mask / silhouette / preview)
INSERT INTO storage.buckets (id, name, public)
VALUES ('frozen-parts', 'frozen-parts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Frozen parts assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'frozen-parts');

CREATE POLICY "Users upload own frozen part assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'frozen-parts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users update own frozen part assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'frozen-parts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own frozen part assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'frozen-parts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );