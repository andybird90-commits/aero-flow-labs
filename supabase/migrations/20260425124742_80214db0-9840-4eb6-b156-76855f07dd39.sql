-- Create car_panels table
CREATE TABLE public.car_panels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  car_stl_id UUID NOT NULL REFERENCES public.car_stls(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  stl_path TEXT NOT NULL,
  triangle_count INTEGER NOT NULL DEFAULT 0,
  area_m2 REAL NOT NULL DEFAULT 0,
  bbox JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_car_panels_car_stl_id ON public.car_panels(car_stl_id);

ALTER TABLE public.car_panels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view car panels"
  ON public.car_panels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert car panels"
  ON public.car_panels FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update car panels"
  ON public.car_panels FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete car panels"
  ON public.car_panels FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_car_panels_updated_at
  BEFORE UPDATE ON public.car_panels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Link hardpoints back to the panel they came from (nullable for hand-placed)
ALTER TABLE public.car_hardpoints
  ADD COLUMN car_panel_id UUID REFERENCES public.car_panels(id) ON DELETE CASCADE;

CREATE INDEX idx_car_hardpoints_car_panel_id ON public.car_hardpoints(car_panel_id);