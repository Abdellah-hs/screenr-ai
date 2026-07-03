-- ============================================================================
-- Campaign public slug — shareable per-campaign apply links
-- ============================================================================
-- Each campaign gets a human-friendly, URL-safe slug used by the public apply
-- page (`/apply/<slug>`) where a candidate uploads their CV directly. The slug
-- is derived from the title once at creation and stays stable thereafter, so a
-- shared link never breaks when the title is later edited.
--
-- Nullable: a campaign with no slug simply has no public apply link yet. Writes
-- on the apply page go through the service-role client, so no RLS change is
-- needed here (candidate-facing tables stay owner-only RLS).

ALTER TABLE campaigns ADD COLUMN public_slug text;

-- Backfill every existing campaign with a unique slug derived from its title.
-- The base is the lower-cased title with runs of non-alphanumerics collapsed to
-- a single hyphen and edge hyphens trimmed; empty results fall back to
-- 'campaign'. Duplicate bases are disambiguated with a -2, -3, … suffix
-- (the first occurrence keeps the clean slug) so the unique index below holds.
WITH slugified AS (
  SELECT
    id,
    COALESCE(
      NULLIF(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''),
      'campaign'
    ) AS base
  FROM campaigns
  WHERE public_slug IS NULL
),
ranked AS (
  SELECT
    id,
    base,
    row_number() OVER (PARTITION BY base ORDER BY id) AS rn
  FROM slugified
)
UPDATE campaigns c
SET public_slug = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM ranked r
WHERE c.id = r.id;

-- One slug globally identifies one campaign's public apply page. Partial (NULLs
-- excluded) so campaigns without a slug don't collide.
CREATE UNIQUE INDEX idx_campaigns_public_slug
  ON campaigns (public_slug)
  WHERE public_slug IS NOT NULL;
