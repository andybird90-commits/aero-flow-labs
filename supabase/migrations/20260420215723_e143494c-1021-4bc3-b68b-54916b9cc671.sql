-- ============================================================
-- Library items + Marketplace listings
-- ============================================================

CREATE TYPE public.library_item_kind AS ENUM (
  'concept_image',
  'aero_kit_mesh',
  'concept_part_mesh'
);

CREATE TYPE public.library_visibility AS ENUM ('private', 'public');

CREATE TYPE public.marketplace_listing_status AS ENUM ('draft', 'active', 'paused');

CREATE TABLE public.library_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind public.library_item_kind NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  asset_url TEXT,
  asset_mime TEXT,
  visibility public.library_visibility NOT NULL DEFAULT 'private',
  project_id UUID,
  concept_id UUID,
  concept_part_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_library_items_user ON public.library_items(user_id);
CREATE INDEX idx_library_items_visibility ON public.library_items(visibility);
CREATE INDEX idx_library_items_concept ON public.library_items(concept_id);
CREATE INDEX idx_library_items_part ON public.library_items(concept_part_id);
CREATE UNIQUE INDEX uniq_library_concept_image
  ON public.library_items(concept_id, (metadata->>'angle'))
  WHERE kind = 'concept_image' AND concept_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_library_aero_kit
  ON public.library_items(concept_id)
  WHERE kind = 'aero_kit_mesh' AND concept_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_library_part_mesh
  ON public.library_items(concept_part_id)
  WHERE kind = 'concept_part_mesh' AND concept_part_id IS NOT NULL;

ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access to own library items"
  ON public.library_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public can view public library items"
  ON public.library_items FOR SELECT
  USING (visibility = 'public');

CREATE TRIGGER trg_library_items_updated_at
  BEFORE UPDATE ON public.library_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.marketplace_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  library_item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status public.marketplace_listing_status NOT NULL DEFAULT 'active',
  title TEXT,
  description TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketplace_user ON public.marketplace_listings(user_id);
CREATE INDEX idx_marketplace_status ON public.marketplace_listings(status);
CREATE UNIQUE INDEX uniq_marketplace_library_item
  ON public.marketplace_listings(library_item_id);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access to own listings"
  ON public.marketplace_listings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public can view active listings"
  ON public.marketplace_listings FOR SELECT
  USING (status = 'active');

CREATE TRIGGER trg_marketplace_listings_updated_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Auto-index triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_concept_library_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _angle TEXT;
  _url TEXT;
  _angles TEXT[] := ARRAY['front','front_direct','side','side_opposite','rear34','rear'];
  _urls TEXT[];
BEGIN
  _urls := ARRAY[
    NEW.render_front_url,
    NEW.render_front_direct_url,
    NEW.render_side_url,
    NEW.render_side_opposite_url,
    NEW.render_rear34_url,
    NEW.render_rear_url
  ];
  FOR i IN 1..array_length(_angles, 1) LOOP
    _angle := _angles[i];
    _url := _urls[i];
    IF _url IS NOT NULL THEN
      INSERT INTO public.library_items
        (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
      VALUES
        (NEW.user_id, 'concept_image',
         COALESCE(NEW.title, 'Concept') || ' — ' || _angle,
         _url, _url, 'image/png',
         NEW.project_id, NEW.id,
         jsonb_build_object('angle', _angle))
      ON CONFLICT (concept_id, (metadata->>'angle'))
        WHERE kind = 'concept_image' AND concept_id IS NOT NULL
      DO UPDATE SET
        thumbnail_url = EXCLUDED.thumbnail_url,
        asset_url = EXCLUDED.asset_url,
        title = EXCLUDED.title,
        updated_at = now();
    END IF;
  END LOOP;

  IF NEW.aero_kit_url IS NOT NULL AND NEW.aero_kit_status = 'ready' THEN
    INSERT INTO public.library_items
      (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
    VALUES
      (NEW.user_id, 'aero_kit_mesh',
       COALESCE(NEW.title, 'Concept') || ' — Aero kit',
       COALESCE(NEW.render_front_direct_url, NEW.render_front_url),
       NEW.aero_kit_url, 'model/stl',
       NEW.project_id, NEW.id,
       '{}'::jsonb)
    ON CONFLICT (concept_id)
      WHERE kind = 'aero_kit_mesh' AND concept_id IS NOT NULL
    DO UPDATE SET
      asset_url = EXCLUDED.asset_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      title = EXCLUDED.title,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_concept_library_items
  AFTER INSERT OR UPDATE ON public.concepts
  FOR EACH ROW EXECUTE FUNCTION public.sync_concept_library_items();

CREATE OR REPLACE FUNCTION public.sync_concept_part_library_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hero TEXT;
BEGIN
  IF NEW.glb_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.render_urls) = 'array' AND jsonb_array_length(NEW.render_urls) > 0 THEN
    _hero := NEW.render_urls->0->>'url';
  END IF;

  INSERT INTO public.library_items
    (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, concept_part_id, metadata)
  VALUES
    (NEW.user_id, 'concept_part_mesh',
     COALESCE(NEW.label, NEW.kind),
     _hero, NEW.glb_url, 'model/gltf-binary',
     NEW.project_id, NEW.concept_id, NEW.id,
     jsonb_build_object('kind', NEW.kind, 'source', NEW.source))
  ON CONFLICT (concept_part_id)
    WHERE kind = 'concept_part_mesh' AND concept_part_id IS NOT NULL
  DO UPDATE SET
    asset_url = EXCLUDED.asset_url,
    thumbnail_url = EXCLUDED.thumbnail_url,
    title = EXCLUDED.title,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_concept_part_library_items
  AFTER INSERT OR UPDATE ON public.concept_parts
  FOR EACH ROW EXECUTE FUNCTION public.sync_concept_part_library_items();

-- ============================================================
-- Backfill
-- ============================================================

INSERT INTO public.library_items
  (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
SELECT c.user_id, 'concept_image',
       COALESCE(c.title,'Concept') || ' — ' || v.angle,
       v.url, v.url, 'image/png',
       c.project_id, c.id,
       jsonb_build_object('angle', v.angle)
FROM public.concepts c
CROSS JOIN LATERAL (VALUES
  ('front', c.render_front_url),
  ('front_direct', c.render_front_direct_url),
  ('side', c.render_side_url),
  ('side_opposite', c.render_side_opposite_url),
  ('rear34', c.render_rear34_url),
  ('rear', c.render_rear_url)
) v(angle, url)
WHERE v.url IS NOT NULL
ON CONFLICT (concept_id, (metadata->>'angle'))
  WHERE kind = 'concept_image' AND concept_id IS NOT NULL
DO NOTHING;

INSERT INTO public.library_items
  (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id)
SELECT user_id, 'aero_kit_mesh',
       COALESCE(title,'Concept') || ' — Aero kit',
       COALESCE(render_front_direct_url, render_front_url),
       aero_kit_url, 'model/stl',
       project_id, id
FROM public.concepts
WHERE aero_kit_url IS NOT NULL AND aero_kit_status = 'ready'
ON CONFLICT (concept_id)
  WHERE kind = 'aero_kit_mesh' AND concept_id IS NOT NULL
DO NOTHING;

INSERT INTO public.library_items
  (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, concept_part_id, metadata)
SELECT user_id, 'concept_part_mesh',
       COALESCE(label, kind),
       CASE WHEN jsonb_typeof(render_urls)='array' AND jsonb_array_length(render_urls)>0
            THEN render_urls->0->>'url' END,
       glb_url, 'model/gltf-binary',
       project_id, concept_id, id,
       jsonb_build_object('kind', kind, 'source', source)
FROM public.concept_parts
WHERE glb_url IS NOT NULL
ON CONFLICT (concept_part_id)
  WHERE kind = 'concept_part_mesh' AND concept_part_id IS NOT NULL
DO NOTHING;