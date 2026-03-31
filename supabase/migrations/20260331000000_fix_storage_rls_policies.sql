-- Migration: Fix storage RLS policies to scope by campaign ownership
-- Previous policies allowed any authenticated user to access any file in the resumes bucket.
-- New policies restrict access to files under campaigns the user owns.

BEGIN;

-- Drop the old overly-permissive storage policies
DROP POLICY IF EXISTS "Authenticated users can upload resumes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read resumes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete resumes" ON storage.objects;

-- New scoped policies: the first folder segment of the path is the campaign_id.
-- Only the campaign owner can upload/read/delete files under that campaign folder.

CREATE POLICY "Campaign owners can upload resumes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'resumes'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

CREATE POLICY "Campaign owners can read resumes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'resumes'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

CREATE POLICY "Campaign owners can delete resumes"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'resumes'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

COMMIT;
