-- Studio Ads: ElevenLabs sound is optional, default off. Apply in the
-- Cloudflare D1 console: motionwren D1 database (site-creator-d1) ->
-- Console -> paste and run. One new column on `ad_projects`; the
-- voiceover script, voice and music mood stay stored either way, so
-- turning the toggle back on restores them.
-- NOTE: SQLite has no IF NOT EXISTS for ADD COLUMN, so this is a
-- one-time add — re-running it errors on the duplicate column, which is
-- harmless because the column already exists.
ALTER TABLE ad_projects ADD COLUMN elevenlabs_on INTEGER NOT NULL DEFAULT 0;
