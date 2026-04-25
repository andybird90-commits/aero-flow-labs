-- 1. Add new columns to projects.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS projects_share_token_idx ON public.projects (share_token) WHERE share_token IS NOT NULL;

-- 2. Public read policies — anonymous visitors can view shared projects + their dependents.
CREATE POLICY "Public can view shared projects"
  ON public.projects
  FOR SELECT
  TO anon, authenticated
  USING (share_enabled = true AND share_token IS NOT NULL);

CREATE POLICY "Public can view placed parts of shared projects"
  ON public.placed_parts
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = placed_parts.project_id
        AND p.share_enabled = true
        AND p.share_token IS NOT NULL
    )
  );

CREATE POLICY "Public can view shell alignment of shared projects"
  ON public.shell_alignments
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = shell_alignments.project_id
        AND p.share_enabled = true
        AND p.share_token IS NOT NULL
    )
  );

-- 3. Public storage bucket for thumbnails.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-thumbnails', 'project-thumbnails', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Public can read project thumbnails"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'project-thumbnails');

CREATE POLICY "Owners can upload project thumbnails"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-thumbnails'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update project thumbnails"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-thumbnails'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete project thumbnails"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-thumbnails'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 4. Helper to auto-generate a 24-char share token.
CREATE OR REPLACE FUNCTION public.generate_share_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT encode(gen_random_bytes(18), 'base64')
$$;