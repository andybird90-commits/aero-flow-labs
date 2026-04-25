DROP POLICY IF EXISTS "Public can read project thumbnails" ON storage.objects;

CREATE POLICY "Public can fetch project thumbnails by path"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'project-thumbnails'
    AND name IS NOT NULL
    AND length(name) > 0
  );