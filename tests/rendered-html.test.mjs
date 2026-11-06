import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the customer-facing business site", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /professional property videos/i);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("keeps the professional multi-shot crossfade workflow visible", async () => {
  const source = await readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  // Studio films are made, joined and saved on the server (it survives a refresh).
  const [route, jobs] = await Promise.all([
    readFile(new URL("../app/api/studio/production/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/_lib/render-jobs.ts", import.meta.url), "utf8"),
  ]);
  // Multi-scene films are edited by our composer: crossfades and one music track.
  assert.match(source, /edited with crossfades and one music track/i);
  assert.match(jobs, /startComposerEdit/);
  assert.match(jobs, /CROSSFADE_KINDS = new Set\(\["customer-series", "studio-series"\]\)/);
  assert.match(jobs, /CROSSFADE_KINDS\.has\(row\.kind\) \? 1 : 0/);
  assert.match(source, /secondsPerImage/);
  assert.match(source, /multiShotSecondsPerImage/);
  assert.match(source, /VIDEO_LENGTHS/);
  assert.match(source, /audioMode: seriesAudioRequested \? "single_master" : "silent"/);
  assert.match(source, /const sceneAudio = soundEnabled && !voiceoverEnabled && shotIndex === 0/);
  assert.match(source, /launch\("series", \{ mode: "series"/);
  assert.match(route, /scenePlan\(engine, resolution, length/);
});

test("keeps the client journey short and the owner dashboard organized", async () => {
  const [landing, dashboard, admin, listingImport, migration, settings] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/listing-import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_late_juggernaut.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/settings/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(landing, /sign-in-link/);
  assert.match(admin, /Scene timing|secondsPerImage/);
  assert.match(settings, /multi_shot_seconds_per_image/);
  assert.match(landing, /Three clear steps/);
  assert.match(dashboard, /type ProjectStep = 1 \| 2/);
  assert.match(dashboard, /Create my video/);
  assert.match(dashboard, /body: JSON\.stringify\(\{ action: "submit" \}\)/);
  assert.match(admin, /Production is running normally/i);
  assert.match(admin, /Platform setup and infrastructure/i);
  assert.match(dashboard, /\/api\/listing-import/);
  assert.match(dashboard, /Video preferences/);
  assert.match(dashboard, /\[20,30,50\]/);
  assert.match(listingImport, /private network address/i);
  assert.match(listingImport, /MAX_HTML_BYTES/);
  assert.match(migration, /generation_engine/);
});

test("exposes real owner engines and protects authenticated workspaces", async () => {
  const [catalog, admin, predictions, history, studio, dashboardLayout, studioLayout, landing] = await Promise.all([
    readFile(new URL("../app/engine-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/predictions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const model of ["Kling Video 3.0", "Google Gemini Omni 1.1", "Google Veo 3.1 Lite", "MiniMax Hailuo 2.3", "Runway Gen-4.5", "Wan 2.2 Fast", "Seedance 1 Pro Fast", "Wan 2.5", "Wan 2.7", "Wan 3.0"]) assert.match(catalog, new RegExp(model.replace(".", "\\.")));
  assert.match(admin, /Every model below uses its connected production endpoint/);
  assert.match(predictions, /models\/alibaba\/wan-3\/predictions/);
  assert.match(predictions, /models\/bytedance\/seedance-1-pro-fast\/predictions/);
  assert.match(predictions, /models\/kwaivgi\/kling-v3-video\/predictions/);
  assert.match(predictions, /models\/google\/gemini-omni-1\.1\/predictions/);
  assert.match(predictions, /models\/google\/veo-3\.1-lite\/predictions/);
  assert.match(predictions, /models\/minimax\/hailuo-2\.3\/predictions/);
  assert.match(predictions, /models\/runwayml\/gen-4\.5\/predictions/);
  assert.match(history, /veo31Lite/);
  assert.match(history, /hailuo23/);
  assert.match(history, /runway45/);
  assert.match(studio, /engine-model-grid/);
  assert.match(predictions, /requireAdmin/);
  assert.match(dashboardLayout, /requireChatGPTUser\("\/dashboard"\)/);
  assert.match(studioLayout, /requireAdmin/);
  assert.match(landing, /chatGPTSignInPath/);
  assert.match(landing, /Create account/);
});

test("keeps paid production durable and idempotent", async () => {
  const [jobs, callback, customerGeneration, billing, schema] = await Promise.all([
    readFile(new URL("../app/api/_lib/render-jobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/replicate/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(jobs, /INSERT OR IGNORE INTO generation_history/);
  assert.match(jobs, /Idempotency-Key/);
  assert.match(jobs, /COMPOSITOR_API_URL/);
  assert.match(jobs, /audio_mode/);
  assert.match(jobs, /audio_crossfade: audioMode === "single_master"/);
  assert.match(jobs, /audio_source: audioMode === "single_master" \? "first_video_track"/);
  assert.match(jobs, /automatic_refund/);
  assert.match(callback, /advanceRenderJob/);
  assert.match(customerGeneration, /You can close this page; processing will continue/);
  assert.match(customerGeneration, /kling-v3-video/);
  assert.match(billing, /stripe-signature/);
  assert.match(billing, /credit_balance = credit_balance \+ \?/);
  assert.match(schema, /rateLimits/);
  assert.match(schema, /payments/);
});

test("keeps provider credentials server-side and exposes owner CRM", async () => {
  const [dashboard, admin, customers, customerApi, accountApi, tokenApi] = await Promise.all([
    readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/customers/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/customers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/token/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dashboard, /REPLICATE_API_TOKEN/);
  assert.doesNotMatch(admin, /REPLICATE_API_TOKEN/);
  assert.doesNotMatch(customers, /REPLICATE_API_TOKEN/);
  assert.match(customerApi, /requireAdmin/);
  assert.match(customerApi, /credit_balance AS creditBalance/);
  assert.match(customers, /Every account in one place/);
  assert.match(admin, /What is happening/);
  assert.match(accountApi, /STRIPE_SECRET_KEY/);
  assert.match(tokenApi, /httpOnly: true/);
  assert.match(tokenApi, /sameSite: "strict"/);
});

test("keeps manager Google authentication server-side and exposes admin navigation", async () => {
  const [account, googleStart, googleCallback, logout, adminLayout, replicatesRoute, replicatesPage, migration, landing] = await Promise.all([
    readFile(new URL("../app/api/_lib/account.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/google/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/replicates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/replicates/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_google_auth_sessions.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(googleStart, /accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  assert.match(googleStart, /openid email profile/);
  assert.match(googleStart, /motionwren_google_state/);
  assert.match(googleStart, /new Response\(null/);
  assert.doesNotMatch(googleStart, /Response\.redirect/);
  assert.match(googleCallback, /oauth2\.googleapis\.com\/token/);
  assert.match(googleCallback, /openidconnect\.googleapis\.com\/v1\/userinfo/);
  assert.match(googleCallback, /configuredAdmins/);
  assert.match(googleCallback, /new Headers/);
  assert.doesNotMatch(googleCallback, /Response\.redirect/);
  assert.match(account, /auth_sessions/);
  assert.match(account, /motionwren_session/);
  assert.match(account, /DELETE FROM auth_sessions/);
  assert.match(logout, /deleteGoogleSession/);
  assert.doesNotMatch(logout, /Response\.redirect/);
  for (const path of ["/admin", "/admin/customers", "/admin#orders", "/studio", "/admin/replicates"]) assert.match(adminLayout, new RegExp(path.replace(/[/?#]/g, "\\$&")));
  assert.match(replicatesRoute, /SUM\(cost_cents\)/);
  assert.match(replicatesRoute, /available: false/);
  assert.match(replicatesRoute, /replicate_low_balance_cents/);
  assert.match(replicatesPage, /No invented balance numbers/);
  assert.match(migration, /token_hash/);
  assert.match(landing, /FRAME MOTION STUDIO/);
  assert.doesNotMatch(googleStart, /GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(landing, /GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|REPLICATE_API_TOKEN/);
});

test("publishes the legal pages and asks for consent before an account is created", async () => {
  const [refund, cookies, privacy, terms, sitemap, layout, banner, settings, emailForm, register, landing] = await Promise.all([
    readFile(new URL("../app/refund/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cookies/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/cookie-banner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/cookie-settings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/signin/email-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  // Refund policy: automatic credit return on a failed generation, no duplicate charges.
  assert.match(refund, /Failed generations are refunded automatically/);
  assert.match(refund, /not charged twice/);
  assert.match(refund, /within 14 days/);
  assert.match(refund, /expire at the end of that month/);
  assert.match(refund, /info@redaphoto\.com/);
  // Cookie policy + banner: essential cookies named, no analytics cookies, accept/reject.
  assert.match(cookies, /motionwren_session/);
  assert.match(cookies, /does not currently use analytics/);
  assert.match(banner, /Reject optional cookies/);
  assert.match(banner, /COOKIE_CONSENT_KEY/);
  assert.match(settings, /mw-cookie-consent/);
  assert.match(layout, /CookieBanner/);
  assert.match(layout, /Skip to content/);
  // Privacy + terms: contact, 18+, processors, no draft language left.
  assert.match(privacy, /18 and over/);
  assert.match(privacy, /Stripe \(payments/);
  assert.match(privacy, /Google \(sign-in and fonts\)/);
  assert.match(privacy, /Resend \(service email\)/);
  assert.match(terms, /at least 18 years old/);
  assert.match(terms, /Refund Policy/);
  assert.doesNotMatch(privacy, /launch draft|must be reviewed with final company/);
  assert.doesNotMatch(terms, /launch draft|require legal review/);
  // Sitemap and footer link the new pages; sign-up requires the age + terms checkbox.
  assert.match(sitemap, /\/refund/);
  assert.match(sitemap, /\/cookies/);
  assert.match(landing, /\/refund/);
  assert.match(landing, /\/cookies/);
  assert.match(landing, /Boston, Massachusetts/);
  assert.match(emailForm, /I am 18 or older/);
  assert.match(register, /ageConfirmed !== true/);
  // The homepage no longer states the AI result as an absolute guarantee.
  assert.doesNotMatch(landing, /Walls stay straight, furniture stays put/);
});
