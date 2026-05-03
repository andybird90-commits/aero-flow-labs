
-- Remove concept images from the part library entirely. They will only be
-- shown inside Projects → Concepts going forward.

-- 1) Drop existing concept image library entries.
DELETE FROM public.library_items WHERE kind = 'concept_image';

-- 2) Stop syncing new concept images into the library. Carbon/aero kits and
-- everything else still flows through unchanged.
CREATE OR REPLACE FUNCTION public.sync_concept_library_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
