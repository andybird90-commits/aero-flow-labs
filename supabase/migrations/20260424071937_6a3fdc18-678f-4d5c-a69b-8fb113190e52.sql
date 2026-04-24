ALTER TABLE public.design_briefs
ADD COLUMN IF NOT EXISTS body_swap_mode boolean NOT NULL DEFAULT false;