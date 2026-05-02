-- Add a new library item kind for user-uploaded mesh parts
ALTER TYPE public.library_item_kind ADD VALUE IF NOT EXISTS 'uploaded_part_mesh';

-- Create a private storage bucket for user-uploaded library parts (STL/OBJ/GLB)
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-uploads', 'library-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (bucket is public so anyone with URL can fetch the mesh)
CREATE POLICY "Library uploads are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'library-uploads');

-- Authenticated users can upload to their own folder (first path segment = user id)
CREATE POLICY "Users can upload to their own library folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'library-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own library uploads"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'library-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own library uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'library-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);