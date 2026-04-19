ALTER TABLE public.concepts
  ADD COLUMN IF NOT EXISTS hotspots jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.concepts.hotspots IS
  'Cached AI-detected part bounding boxes per view. Shape: { [view: "front"|"side"|"rear34"|"rear"]: { boxes: Array<{kind,label,x,y,w,h}>, detected_at: iso } }';