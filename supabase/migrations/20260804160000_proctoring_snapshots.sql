-- Migration: 20260804160000_proctoring_snapshots.sql
-- Evidence snapshots for camera proctoring findings.
--
-- Removing the interview recording (20260804140000) left a real gap: a
-- recruiter reading "more than one person on camera" had nothing to check it
-- against, and an automated finding nobody can verify is a bad thing to put in
-- front of someone making a hiring decision. This restores verifiability
-- WITHOUT restoring surveillance: instead of the whole call, the worker keeps a
-- single still frame for the moments that actually triggered a finding.
--
-- The footprint difference is the point. A recorded interview was ~30MB of
-- continuous video of a candidate who did nothing wrong. This is a handful of
-- ~50KB stills, and only for candidates where a threshold was crossed — a clean
-- interview stores no image at all.
--
-- Snapshots are pruned at submit: the worker captures while a condition holds,
-- but anything not falling inside a CONFIRMED incident is deleted when the
-- report is finalized. Since a single stray frame never becomes an incident,
-- the frames behind the system's own false positives are the ones that get
-- thrown away rather than kept.

BEGIN;

-- 1. Private bucket. Same owner-scoped convention as `resumes` and the retired
-- recordings bucket: the first path segment is the campaign id, so the storage
-- RLS below can scope every object to the campaign owner.
-- Key layout: <campaign_id>/<application_id>/<epoch_ms>.jpg
INSERT INTO storage.buckets (id, name, public)
VALUES ('proctoring-snapshots', 'proctoring-snapshots', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Campaign owners can read proctoring snapshots"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'proctoring-snapshots'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

CREATE POLICY "Campaign owners can delete proctoring snapshots"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'proctoring-snapshots'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

-- No INSERT policy: uploads happen server-side with the admin client from the
-- AGENT_API_SECRET-guarded route, which bypasses RLS. A recruiter's browser has
-- no business writing into this bucket, so it isn't granted the ability to.

-- 2. Draft snapshot index, written during the call and folded into `proctoring`
-- at submit — the same draft/final split as `proctoring_observations`, and for
-- the same reason: mid-call this column is half-built, and the recruiter UI
-- should only ever read the finalized report.
ALTER TABLE public.interview_sessions
    ADD COLUMN IF NOT EXISTS proctoring_snapshots JSONB;

COMMENT ON COLUMN public.interview_sessions.proctoring_snapshots IS
    'Draft evidence-snapshot index reported by the interview agent worker: [{at, condition, key}]. `key` is an object key in the private proctoring-snapshots bucket. Folded into `proctoring` at submit, at which point snapshots outside a confirmed incident are deleted. Evidence only — never a verdict.';

COMMIT;
