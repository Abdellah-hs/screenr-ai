-- ============================================================================
-- Backfill apply slugs for campaigns that were created without one
-- ============================================================================
-- `20260629000000_campaign_public_slug.sql` backfilled every campaign that
-- existed when the column was added, and `insertCampaignTx` has minted one for
-- every campaign created through the wizard since. `cloneCampaignTx` did not:
-- it inserted the copy directly, leaving `public_slug` NULL.
--
-- The consequence was silent and total. A cloned campaign had no `/apply/<slug>`
-- page, so it could never receive an application through the only intake the
-- product has — while the campaign page rendered nothing where the apply-link
-- card belongs, and the social generator drafted "we're hiring" posts with no
-- link in them.
--
-- The code path is fixed (both inserts now share `insertCampaignWithSlug`).
-- This gives the already-cloned campaigns their link back.
--
-- The column stays nullable: "no public apply link" remains a legal state, and
-- the UI says so rather than hiding it.

WITH slugified AS (
  SELECT
    id,
    -- Same shape as `slugifyTitle` in src/lib/utils.ts: lower-cased, runs of
    -- non-alphanumerics collapsed to one hyphen, edge hyphens trimmed, capped
    -- at 60 characters — and re-trimmed after the cap, in case it landed on a
    -- hyphen. An empty result (a punctuation-only title) falls back.
    COALESCE(
      NULLIF(
        trim(both '-' from left(
          trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')),
          60
        )),
        ''
      ),
      'campaign'
    ) AS base
  FROM campaigns
  WHERE public_slug IS NULL
),
resolved AS (
  SELECT
    s.id,
    s.base,
    -- A clone's title is "<source> (Copy)", so its base cannot collide with the
    -- source — but it collides with EVERY other copy of the same campaign, and
    -- a recruiter may since have created a campaign that slugifies to the same
    -- thing. Both cases are checked.
    EXISTS (
      SELECT 1 FROM campaigns taken
      WHERE taken.public_slug = s.base
    ) AS base_taken,
    row_number() OVER (PARTITION BY s.base ORDER BY s.id) AS rn
  FROM slugified s
)
UPDATE campaigns c
SET public_slug = CASE
      -- The first campaign to claim a free base keeps the clean slug; anything
      -- contended takes a suffix from its own id, which is distinct per row and
      -- so cannot collide with the others being written in this same statement.
      WHEN r.base_taken OR r.rn > 1
        THEN r.base || '-' || substr(replace(c.id::text, '-', ''), 1, 8)
      ELSE r.base
    END
FROM resolved r
WHERE c.id = r.id;
