-- ─── Storage buckets ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('geometries', 'geometries', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- Per-user folder policies (folder name = auth.uid())
CREATE POLICY "Users read own geometries"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'geometries' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own geometries"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'geometries' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own geometries"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'geometries' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own geometries"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'geometries' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own exports"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own exports"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own exports"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own exports"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ─── duplicate_variant ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.duplicate_variant(_variant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_id uuid;
  _user uuid := auth.uid();
  _src record;
BEGIN
  SELECT * INTO _src FROM public.variants WHERE id = _variant_id AND user_id = _user;
  IF _src IS NULL THEN RAISE EXCEPTION 'Variant not found or not owned by user'; END IF;

  INSERT INTO public.variants (user_id, build_id, geometry_id, name, tag, status, is_baseline, notes)
  VALUES (_user, _src.build_id, _src.geometry_id,
          _src.name || ' (copy)', _src.tag, 'draft', false, _src.notes)
  RETURNING id INTO _new_id;

  INSERT INTO public.aero_components (user_id, variant_id, kind, params, enabled)
  SELECT _user, _new_id, kind, params, enabled
  FROM public.aero_components WHERE variant_id = _variant_id;

  RETURN _new_id;
END;
$$;

-- ─── duplicate_build ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.duplicate_build(_build_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_build uuid;
  _new_geo uuid;
  _user uuid := auth.uid();
  _src_build record;
  _src_geo record;
  _v record;
  _new_v uuid;
BEGIN
  SELECT * INTO _src_build FROM public.builds WHERE id = _build_id AND user_id = _user;
  IF _src_build IS NULL THEN RAISE EXCEPTION 'Build not found or not owned by user'; END IF;

  INSERT INTO public.builds (user_id, car_id, name, objective, status, notes, starred)
  VALUES (_user, _src_build.car_id, _src_build.name || ' (copy)',
          _src_build.objective, 'draft', _src_build.notes, false)
  RETURNING id INTO _new_build;

  -- Copy geometry (1 per build, take latest)
  SELECT * INTO _src_geo FROM public.geometries
    WHERE build_id = _build_id ORDER BY created_at DESC LIMIT 1;
  IF _src_geo IS NOT NULL THEN
    INSERT INTO public.geometries (user_id, build_id, source, ride_height_front_mm, ride_height_rear_mm,
                                    underbody_model, wheel_rotation, steady_state, stl_path, metadata)
    VALUES (_user, _new_build, _src_geo.source, _src_geo.ride_height_front_mm, _src_geo.ride_height_rear_mm,
            _src_geo.underbody_model, _src_geo.wheel_rotation, _src_geo.steady_state,
            _src_geo.stl_path, _src_geo.metadata)
    RETURNING id INTO _new_geo;
  END IF;

  -- Copy variants + components
  FOR _v IN SELECT * FROM public.variants WHERE build_id = _build_id LOOP
    INSERT INTO public.variants (user_id, build_id, geometry_id, name, tag, status, is_baseline, notes)
    VALUES (_user, _new_build, _new_geo, _v.name, _v.tag, 'draft', _v.is_baseline, _v.notes)
    RETURNING id INTO _new_v;

    INSERT INTO public.aero_components (user_id, variant_id, kind, params, enabled)
    SELECT _user, _new_v, kind, params, enabled
    FROM public.aero_components WHERE variant_id = _v.id;
  END LOOP;

  RETURN _new_build;
END;
$$;

-- ─── decrement_credits (atomic) ──────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_credits(_user_id uuid, _amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance integer;
BEGIN
  UPDATE public.profiles
    SET credits = credits - _amount, updated_at = now()
    WHERE id = _user_id AND credits >= _amount
    RETURNING credits INTO _new_balance;
  IF _new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;
  RETURN _new_balance;
END;
$$;

-- ─── Realtime ────────────────────────────────────────────
ALTER TABLE public.simulation_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.optimization_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.simulation_results REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.simulation_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.optimization_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.simulation_results;