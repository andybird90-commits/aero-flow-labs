-- 1. car_stls table
CREATE TABLE public.car_stls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_template_id uuid NOT NULL REFERENCES public.car_templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  stl_path text NOT NULL,
  repaired_stl_path text,
  forward_axis text NOT NULL DEFAULT '-z',
  manifold_clean boolean NOT NULL DEFAULT false,
  triangle_count integer,
  bbox_min_mm jsonb,
  bbox_max_mm jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(car_template_id)
);

ALTER TABLE public.car_stls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view car STLs"
  ON public.car_stls FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert car STLs"
  ON public.car_stls FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update car STLs"
  ON public.car_stls FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete car STLs"
  ON public.car_stls FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_car_stls_updated_at
  BEFORE UPDATE ON public.car_stls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_car_stls_car_template ON public.car_stls(car_template_id);

-- 2. private car-stls bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('car-stls', 'car-stls', false);

CREATE POLICY "Authenticated users can read car STL files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'car-stls');

CREATE POLICY "Admins can upload car STL files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'car-stls' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update car STL files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'car-stls' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete car STL files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'car-stls' AND public.has_role(auth.uid(), 'admin'::app_role));

-- 3. concepts: aero kit fields
ALTER TABLE public.concepts
  ADD COLUMN aero_kit_url text,
  ADD COLUMN aero_kit_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN aero_kit_error text;

-- 4. concept_parts: source field
ALTER TABLE public.concept_parts
  ADD COLUMN source text NOT NULL DEFAULT 'extracted'
  CHECK (source IN ('parametric', 'extracted', 'boolean'));