CREATE OR REPLACE FUNCTION public.generate_share_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.gen_random_bytes(18), 'base64')
$$;