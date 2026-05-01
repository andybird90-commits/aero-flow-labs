UPDATE storage.buckets SET public = true WHERE id = 'car-stls';

-- Public read access on car-stls (idempotent: drop & recreate)
DROP POLICY IF EXISTS "Public can read car-stls" ON storage.objects;
CREATE POLICY "Public can read car-stls"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'car-stls');