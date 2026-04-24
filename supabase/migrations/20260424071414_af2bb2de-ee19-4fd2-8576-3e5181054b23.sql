ALTER TABLE public.design_briefs
ADD COLUMN IF NOT EXISTS variation_count integer NOT NULL DEFAULT 4;

ALTER TABLE public.design_briefs
ADD CONSTRAINT design_briefs_variation_count_range
CHECK (variation_count BETWEEN 1 AND 5);