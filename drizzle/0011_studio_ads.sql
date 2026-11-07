-- Studio Ads (admin-only commercials). Apply in the Cloudflare D1 console:
-- motionwren D1 database (site-creator-d1) -> Console -> paste and run.
-- Own tables on purpose: the customer `projects` table is real-estate-shaped
-- (listing_url, beds, baths, price, agent_*); ads share none of it.
-- Generation itself reuses the existing `render_jobs` table (kind 'ad-series').
CREATE TABLE IF NOT EXISTS ad_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  hook TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  scene_prompts TEXT NOT NULL DEFAULT '[]',
  scene_images TEXT NOT NULL DEFAULT '[]',
  engine TEXT NOT NULL DEFAULT 'wan3',
  resolution TEXT NOT NULL DEFAULT '1080p',
  aspect TEXT NOT NULL DEFAULT 'vertical',
  target_duration INTEGER NOT NULL DEFAULT 10,
  subtitles TEXT NOT NULL DEFAULT '{}',
  voiceover_script TEXT NOT NULL DEFAULT '',
  voice_id TEXT,
  music_mood TEXT,
  draft INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  render_job_id TEXT,
  final_history_id TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_projects_owner_created ON ad_projects (owner_id, created_at);

CREATE TABLE IF NOT EXISTS ad_assets (
  id TEXT PRIMARY KEY,
  ad_project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'source',
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  provider_token TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_assets_project_order ON ad_assets (ad_project_id, sort_order);

-- Saved actors: uploaded once, picked for many ads. Photos never expire;
-- they are deleted with the actor.
CREATE TABLE IF NOT EXISTS ad_actors (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_actors_owner_created ON ad_actors (owner_id, created_at);

CREATE TABLE IF NOT EXISTS ad_actor_photos (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  angle TEXT NOT NULL DEFAULT 'front',
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  provider_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_actor_photos_actor_order ON ad_actor_photos (actor_id, sort_order);

CREATE TABLE IF NOT EXISTS ad_project_actors (
  ad_project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ad_project_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_project_actors_actor ON ad_project_actors (actor_id);
