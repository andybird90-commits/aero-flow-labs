-- Material maps cache the per-triangle material tag for a car STL.
-- Tags: 0=body, 1=glass, 2=wheel, 3=tyre (uint8 each)
CREATE TABLE public.car_material_maps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  car_stl_id UUID NOT NULL UNIQUE REFERENCES public.car_stls(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'geometric' CHECK (method IN ('geometric','ai','hybrid')),
  triangle_count INTEGER NOT NULL,
  -- Base64-encoded Uint8Array of length triangle_count; one tag per triangle.
  tag_blob_b64 TEXT NOT NULL,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_car_material_maps_stl ON public.car_material_maps(car_stl_id);

ALTER TABLE public.car_material_maps ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read shared material maps for hero cars.
CREATE POLICY "Authenticated users can view car material maps"
  ON public.car_material_maps FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can write (edge fn uses service role and bypasses RLS).
CREATE POLICY "Admins can insert car material maps"
  ON public.car_material_maps FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update car material maps"
  ON public.car_material_maps FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete car material maps"
  ON public.car_material_maps FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_car_material_maps_updated_at
  BEFORE UPDATE ON public.car_material_maps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();