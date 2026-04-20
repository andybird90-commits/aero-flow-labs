ALTER TABLE public.garage_cars
  ADD COLUMN IF NOT EXISTS ref_front_url text,
  ADD COLUMN IF NOT EXISTS ref_side_opposite_url text;