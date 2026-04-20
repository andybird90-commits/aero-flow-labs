ALTER TABLE public.concepts
  ADD COLUMN IF NOT EXISTS render_front_direct_url text,
  ADD COLUMN IF NOT EXISTS render_side_opposite_url text;