-- Add new library_item_kind enum value for AI-generated parts
ALTER TYPE library_item_kind ADD VALUE IF NOT EXISTS 'generated_part_mesh';

-- Status enum for the curation pipeline
DO $$ BEGIN
  CREATE TYPE generated_part_status AS ENUM ('pending_review', 'approved', 'rejected', 'retry', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.generated_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_kind text NOT NULL,
  style_tag text,
  prompt text NOT NULL DEFAULT '',
  glb_url text,
  thumbnail_url text,
  bbox_mm jsonb NOT NULL DEFAULT '{}'::jsonb,
  tri_count integer NOT NULL DEFAULT 0,
  blender_job_id uuid,
  status generated_part_status NOT NULL DEFAULT 'pending_review',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generated_parts_kind_status_idx
  ON public.generated_parts (part_kind, status);
CREATE INDEX IF NOT EXISTS generated_parts_blender_job_idx
  ON public.generated_parts (blender_job_id);

ALTER TABLE public.generated_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view approved generated parts" ON public.generated_parts;
CREATE POLICY "Authenticated view approved generated parts"
  ON public.generated_parts
  FOR SELECT
  TO authenticated
  USING (status = 'approved' OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage generated parts" ON public.generated_parts;
CREATE POLICY "Admins manage generated parts"
  ON public.generated_parts
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS generated_parts_set_updated_at ON public.generated_parts;
CREATE TRIGGER generated_parts_set_updated_at
  BEFORE UPDATE ON public.generated_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sync approved parts into library_items so the existing rail picks them up.
CREATE OR REPLACE FUNCTION public.sync_generated_part_library_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'approved' OR NEW.glb_url IS NULL OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Avoid duplicates: only insert if no library_item already references this generated part.
  IF EXISTS (
    SELECT 1 FROM public.library_items
    WHERE kind = 'generated_part_mesh'
      AND metadata->>'generated_part_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.library_items
    (user_id, kind, title, thumbnail_url, asset_url, asset_mime, metadata)
  VALUES
    (NEW.created_by, 'generated_part_mesh',
     COALESCE(NEW.style_tag, NEW.part_kind) || ' — AI generated',
     NEW.thumbnail_url, NEW.glb_url, 'model/gltf-binary',
     jsonb_build_object(
       'generated_part_id', NEW.id,
       'part_kind', NEW.part_kind,
       'style_tag', NEW.style_tag,
       'source', 'claude_blender_actor'
     ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generated_parts_sync_library ON public.generated_parts;
CREATE TRIGGER generated_parts_sync_library
  AFTER INSERT OR UPDATE OF status ON public.generated_parts
  FOR EACH ROW EXECUTE FUNCTION public.sync_generated_part_library_items();
