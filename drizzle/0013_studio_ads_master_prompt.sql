-- Studio Ads: "Fix It In 20 Seconds" master-prompt template. Apply in the
-- Cloudflare D1 console: motionwren D1 database (site-creator-d1) ->
-- Console -> paste and run. Two new columns on `ad_projects`: the picked
-- template (default 'cinematic', so old ads are unchanged) and the 7
-- fill-in fields as JSON. The template fields stay stored either way, so
-- switching back to cinematic keeps them for the next template ad.
-- ORDER (same as 0012): merge first, run this migration second, use the
-- template third. Until it runs, the merged code's SELECTs fail with
-- "no such column: template" and the Studio Ads list / detail / create /
-- update calls error — the page is NOT usable pre-migration, by design,
-- the same as 0012 was for elevenlabs_on. Run 0012 first if it is still
-- pending; the two migrations touch different columns, so either order
-- between them works as long as both have run.
-- NOTE: SQLite has no IF NOT EXISTS for ADD COLUMN, so this is a
-- one-time add — re-running it errors on the duplicate column, which is
-- harmless because the column already exists.
ALTER TABLE ad_projects ADD COLUMN template TEXT NOT NULL DEFAULT 'cinematic';
ALTER TABLE ad_projects ADD COLUMN template_fields TEXT NOT NULL DEFAULT '{}';
