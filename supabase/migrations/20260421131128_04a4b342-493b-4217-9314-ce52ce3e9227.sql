ALTER TABLE public.concepts
  ADD COLUMN IF NOT EXISTS carbon_kit_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS carbon_kit_error text,
  ADD COLUMN IF NOT EXISTS carbon_kit_task_id text,
  ADD COLUMN IF NOT EXISTS carbon_kit_glb_url text,
  ADD COLUMN IF NOT EXISTS carbon_kit_stl_url text,
  ADD COLUMN IF NOT EXISTS carbon_kit_scale_m numeric;

-- Extend the library sync trigger to also publish the combined carbon kit mesh
CREATE OR REPLACE FUNCTION public.sync_concept_library_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _angle TEXT;
  _url TEXT;
  _angles TEXT[] := ARRAY[
    'front','front_direct','side','side_opposite','rear34','rear',
    'front_carbon','side_carbon','rear34_carbon','rear_carbon'
  ];
  _urls TEXT[];
BEGIN
  _urls := ARRAY[
    NEW.render_front_url,
    NEW.render_front_direct_url,
    NEW.render_side_url,
    NEW.render_side_opposite_url,
    NEW.render_rear34_url,
    NEW.render_rear_url,
    NEW.render_front_carbon_url,
    NEW.render_side_carbon_url,
    NEW.render_rear34_carbon_url,
    NEW.render_rear_carbon_url
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

  IF NEW.carbon_kit_glb_url IS NOT NULL AND NEW.carbon_kit_status = 'ready' THEN
    INSERT INTO public.library_items
      (user_id, kind, title, thumbnail_url, asset_url, asset_mime, project_id, concept_id, metadata)
    VALUES
      (NEW.user_id, 'aero_kit_mesh',
       COALESCE(NEW.title, 'Concept') || ' — Carbon kit',
       COALESCE(NEW.render_front_carbon_url, NEW.render_front_url),
       NEW.carbon_kit_glb_url, 'model/gltf-binary',
       NEW.project_id, NEW.id,
       jsonb_build_object(
         'kit_kind', 'carbon_kit',
         'stl_url', NEW.carbon_kit_stl_url,
         'scale_m', NEW.carbon_kit_scale_m
       ))
    ON CONFLICT (concept_id)
      WHERE kind = 'aero_kit_mesh' AND concept_id IS NOT NULL
    DO UPDATE SET
      asset_url = EXCLUDED.asset_url,
      thumbnail_url = EXCLUDED.thumbnail_url,
      title = EXCLUDED.title,
      metadata = EXCLUDED.metadata,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;