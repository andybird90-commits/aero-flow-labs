
-- 1. Add new library kind
ALTER TYPE public.library_item_kind ADD VALUE IF NOT EXISTS 'prototype_part_mesh';

-- 2. Prototypes table
CREATE TABLE IF NOT EXISTS public.prototypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled prototype',
  car_context text,
  source_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  render_status text NOT NULL DEFAULT 'idle',
  render_error text,
  render_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  mesh_status text NOT NULL DEFAULT 'idle',
  mesh_error text,
  mesh_task_id text,
  glb_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prototypes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own prototypes"
  ON public.prototypes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own prototypes"
  ON public.prototypes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own prototypes"
  ON public.prototypes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own prototypes"
  ON public.prototypes FOR DELETE
  USING (auth.uid() = user_id);

-- Reuse existing public.update_updated_at_column trigger if present, otherwise create.
CREATE OR REPLACE FUNCTION public.set_prototypes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prototypes_set_updated_at ON public.prototypes;
CREATE TRIGGER prototypes_set_updated_at
BEFORE UPDATE ON public.prototypes
FOR EACH ROW EXECUTE FUNCTION public.set_prototypes_updated_at();

-- 3. Storage bucket for prototype source uploads (public so the AI render
--    function and the browser can fetch them via URL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('prototype-uploads', 'prototype-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Prototype uploads are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'prototype-uploads');

-- Owner-scoped writes (path prefix is the user id)
CREATE POLICY "Users upload to own prototype folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'prototype-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users update own prototype uploads"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'prototype-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own prototype uploads"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'prototype-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
