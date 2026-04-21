-- Create private bucket for brief reference images
INSERT INTO storage.buckets (id, name, public)
VALUES ('brief-references', 'brief-references', false)
ON CONFLICT (id) DO NOTHING;

-- Users can read their own reference images (folder = user_id)
CREATE POLICY "Users can read own brief references"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'brief-references'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload own brief references"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'brief-references'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own brief references"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'brief-references'
  AND auth.uid()::text = (storage.foldername(name))[1]
);