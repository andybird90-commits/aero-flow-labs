ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS paint_finish jsonb NOT NULL DEFAULT jsonb_build_object(
  'color', '#0a1622',
  'metalness', 0.85,
  'roughness', 0.32,
  'clearcoat', 1.0,
  'clearcoat_roughness', 0.18,
  'env_intensity', 1.4,
  'env_preset', 'warehouse'
);