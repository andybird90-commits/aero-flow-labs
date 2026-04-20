-- Garage cars: user-owned OEM reference cars with 4 generated views
CREATE TABLE public.garage_cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  trim text,
  color text,
  notes text,
  generation_status text NOT NULL DEFAULT 'idle',  -- idle | generating | ready | failed
  generation_error text,
  ref_front34_url text,
  ref_side_url text,
  ref_rear34_url text,
  ref_rear_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.garage_cars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own garage cars"
  ON public.garage_cars FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own garage cars"
  ON public.garage_cars FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own garage cars"
  ON public.garage_cars FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own garage cars"
  ON public.garage_cars FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_garage_cars_updated_at
  BEFORE UPDATE ON public.garage_cars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_garage_cars_user ON public.garage_cars(user_id, created_at DESC);

-- Optional link from projects -> garage_cars
ALTER TABLE public.projects
  ADD COLUMN garage_car_id uuid REFERENCES public.garage_cars(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_garage_car ON public.projects(garage_car_id);
