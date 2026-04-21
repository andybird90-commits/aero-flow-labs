ALTER TABLE public.prototypes
  ADD COLUMN IF NOT EXISTS fit_preview_url text,
  ADD COLUMN IF NOT EXISTS fit_preview_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS fit_preview_error text;