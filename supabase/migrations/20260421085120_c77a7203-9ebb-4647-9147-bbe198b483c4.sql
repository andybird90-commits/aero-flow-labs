ALTER TABLE public.prototypes
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS replicate_exact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS garage_car_id uuid REFERENCES public.garage_cars(id) ON DELETE SET NULL;