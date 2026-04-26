-- Add an optional textured-GLB path to car_stls so admins can upload a
-- fully-textured GLB hero model alongside (or instead of) the plain STL.
-- When present, the Build Studio renders the GLB and preserves the authored
-- PBR materials, giving a true studio/render look.
ALTER TABLE public.car_stls
  ADD COLUMN IF NOT EXISTS glb_path TEXT;

COMMENT ON COLUMN public.car_stls.glb_path IS
  'Optional path in the car-stls bucket to a textured GLB version of this car. When present, Build Studio prefers it over stl_path and preserves embedded PBR materials.';
