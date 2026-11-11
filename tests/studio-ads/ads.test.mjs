/* Studio Ads unit tests: the prompt theme, per-scene prompts, subtitle
   timing + .ass text, duration planning, cost estimates, ad music moods,
   and the ElevenLabs voiceover client (against a localhost stand-in).
   Plain node, no database, no provider. The lib is bundled with esbuild
   first, the way tests/scene-queue does it. */
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

/* 7. ElevenLabs voiceover client, against a localhost stand-in — the stub
   has to listen first: the client reads ELEVENLABS_API_BASE at import. */
const calls = [];
const eleven = http.createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  calls.push({ url: req.url, key: req.headers["xi-api-key"], body });
  if (req.url === "/v1/voices") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ voices: [{ voice_id: "v-rachel", name: "Rachel", category: "premade", description: "Calm" }, { voice_id: "v-antoni", name: "Antoni", category: "premade" }] })); }
  if (req.url.startsWith("/v1/text-to-speech/v-rachel")) { res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(Buffer.alloc(2400, 7)); }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => eleven.listen(0, "127.0.0.1", resolve));
process.env.ELEVENLABS_API_KEY = "test-eleven-key";
process.env.ELEVENLABS_API_BASE = `http://127.0.0.1:${eleven.address().port}`;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(mkdtempSync(join(tmpdir(), "mw-ads-")), "lib.mjs");
await build({ entryPoints: [join(HERE, "entry.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, logLevel: "warning" });
const lib = await import(pathToFileURL(OUT).href);
const { ADS_THEME, ADS_NEGATIVE, adAspectRatio, adPlan, buildAdScenePrompt, buildAssText, estimateAdCost, splitScriptToSubtitles, AD_MUSIC_MOODS, adMusicMood, defaultAdMusicMood, ElevenLabsMissingKey, listVoices, synthesizeVoiceover, AD_TEMPLATES, MASTER_PROMPT_DURATION, MASTER_PROMPT_FIELD_DEFS, MASTER_PROMPT_TEMPLATE, buildMasterPromptPrompt, cleanMasterPromptFields, emptyMasterPromptFields, parseMasterPromptFields, resolveAdTemplate, resolveTemplateDuration, LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_FIELD_DEFS, LIBRARY_TEMPLATE_THEME, cleanLibraryTemplateFields, emptyRestaurantInteriorFields, engineCost, isLibraryTemplateVisible, libraryTemplateEstimate, libraryTemplateOverlayLines, libraryTemplatePlan, mergeTemplateFields, parseLibraryEnabled, parseLibraryTemplateFields, resolveLibraryTemplate } = lib;

/* 1. The theme: premium and realistic, nothing real-estate. */
{
  check("1a theme promises premium cinematic realism", /premium/i.test(ADS_THEME) && /cinematic/i.test(ADS_THEME) && /true to the supplied images/i.test(ADS_THEME), ADS_THEME.slice(0, 80));
  check("1b theme forbids the cheap looks", /never childish/i.test(ADS_THEME) && /never cheesy/i.test(ADS_THEME) && /no warping/i.test(ADS_THEME), "");
  check("1c theme has no real-estate language", !/real estate|listing|property|architecture|STATIC_LOCK|camera-only/i.test(ADS_THEME), "");
  check("1d negative prompt has no real-estate lock", !/real estate|furniture|walls/i.test(ADS_NEGATIVE), "");
}

/* 2. Scene prompts: hook on scene 0 only, scene prompt wins per scene. */
{
  const base = { userPrompt: "A watch ad on a city rooftop at dusk.", sceneIndex: 0, hook: "The watch that outlasts the city.", actors: [{ name: "Maya", angles: ["front", "three-quarter"] }] };
  const first = buildAdScenePrompt(base);
  check("2a scene 0 carries the hook", first.includes("The watch that outlasts the city"), "");
  check("2b scene 0 carries the user prompt and the actor block", first.includes("A watch ad on a city rooftop") && first.includes("Featuring Maya") && first.includes("front, three-quarter"), "");
  const second = buildAdScenePrompt({ ...base, sceneIndex: 1, scenePrompt: "Close on the watch face as the light changes." });
  check("2c later scenes drop the hook and use their own prompt", !second.includes("outlasts the city") && second.includes("Close on the watch face"), "");
  check("2d every scene starts from the theme", first.startsWith(ADS_THEME) && second.startsWith(ADS_THEME), "");
}

/* 3. Aspect mapping. */
{
  check("3a vertical is 9:16 for every engine", adAspectRatio("wan3", "vertical") === "9:16" && adAspectRatio("kling3", "vertical") === "9:16", "");
  check("3b square is native on Wan and Kling", adAspectRatio("wan3", "square") === "1:1" && adAspectRatio("kling3", "square") === "1:1", "");
  check("3c square falls back to 16:9 on Veo and Gemini", adAspectRatio("veo31Lite", "square") === "16:9" && adAspectRatio("geminiOmni", "square") === "16:9", "");
}

/* 4. Duration plan + cost (same numbers the design doc promises). */
{
  const ten = adPlan("wan3", "1080p", 10, 12);
  check("4a 10 s is 4 scenes of 3 s", ten.count === 4 && ten.sceneSeconds === 3 && ten.totalSeconds === 10, JSON.stringify(ten));
  const sixty = adPlan("wan3", "1080p", 60, 12);
  check("4b 60 s is 12 scenes of 6 s", sixty.count === 12 && sixty.sceneSeconds === 6 && sixty.totalSeconds === 60, JSON.stringify(sixty));
  const draft = adPlan("wan3", "1080p", 60, 12, true);
  check("4c a draft is 480p and at most 10 s", draft.resolution === "480p" && draft.duration === 10, JSON.stringify(draft));
  const cost10 = estimateAdCost("wan3", "1080p", 10, 12);
  check("4d 10 s on Wan 3.0 costs about $1.06", Math.abs(cost10 - 1.06) < 0.02, `$${cost10.toFixed(2)}`);
  const cost60kling = estimateAdCost("kling3", "1080p", 60, 12);
  check("4e 60 s on Kling 3.0 costs about $16.13", Math.abs(cost60kling - 16.13) < 0.02, `$${cost60kling.toFixed(2)}`);
  const draftCost = estimateAdCost("wan3", "1080p", 60, 12, true);
  check("4f the draft costs less than the full render", draftCost < estimateAdCost("wan3", "1080p", 60, 12), `$${draftCost.toFixed(2)}`);
}

/* 5. Subtitles: split a script, build the .ass. */
{
  const lines = splitScriptToSubtitles("The city never sleeps. Neither does this watch. Built for the ones who stay up.", 10);
  check("5a a script splits into timed lines in order", lines.length >= 2 && lines[0].start === 0 && lines.every((line, i) => i === 0 || line.start >= lines[i - 1].end) && lines.at(-1).end <= 10, JSON.stringify(lines));
  check("5b the words survive the split", lines.map((line) => line.text).join(" ").includes("Neither does this watch"), "");
  const ass = buildAssText([{ start: 1, end: 3.5, text: "First line" }, { start: 5, end: 7, text: "Second, with a comma" }], { position: "bottom", size: "medium" }, 1080);
  check("5c the .ass carries both lines with times", ass.includes("0:00:01.00,0:00:03.50") && ass.includes("First line") && ass.includes("Second, with a comma"), "");
  check("5d bottom is alignment 2, medium is 48 pt at 1080p", ass.includes("Alignment, MarginL") && ass.includes("Liberation Sans,48,") && /,2,20,20,40,1/.test(ass), "");
  const top = buildAssText([{ start: 0, end: 2, text: "Top" }], { position: "top", size: "small" }, 720);
  check("5e top is alignment 8 and the size scales with height", /,8,20,20,40,1/.test(top) && top.includes("Liberation Sans,24,"), "");
}

/* 6. Ad music moods. */
{
  check("6a six moods, all instrumental", AD_MUSIC_MOODS.length === 6 && AD_MUSIC_MOODS.every((mood) => /No vocals/.test(mood.prompt)), "");
  check("6b no mood is written for real estate", AD_MUSIC_MOODS.every((mood) => !/real estate|home tour|property/i.test(mood.prompt)), "");
  check("6c the bold mood resolves and vertical defaults to upbeat", adMusicMood("bold")?.name === "Bold & confident" && defaultAdMusicMood("vertical", 10) === "upbeat" && defaultAdMusicMood("horizontal", 60) === "cinematic", "");
}

/* 7. ElevenLabs voiceover client, against the localhost stand-in. */
{
  const voices = await listVoices();
  check("7a voices come from ElevenLabs, key sent", voices.length === 2 && voices[0].name === "Rachel" && calls[0].key === "test-eleven-key" && calls[0].url === "/v1/voices", JSON.stringify(voices));
  const audio = await synthesizeVoiceover({ voiceId: "v-rachel", text: "The city never sleeps." });
  check("7b a voiceover is MP3 bytes from the TTS endpoint", audio.byteLength === 2400 && /text-to-speech\/v-rachel/.test(calls[1].url) && JSON.parse(calls[1].body).text === "The city never sleeps.", calls[1].url);
  delete process.env.ELEVENLABS_API_KEY;
  let missing = null;
  try { await listVoices(); } catch (error) { missing = error; }
  check("7c without a key the client fails honestly, before any call", missing instanceof ElevenLabsMissingKey && calls.length === 2, missing?.message || "");
}

/* 8. The ElevenLabs toggle in startAd: off means no music key, no
   voiceover attempt and no ElevenLabs call at all (even with a script
   stored); on keeps today's behavior. startAd is bundled separately —
   ads-production pulls render-jobs, which needs next/* shims — and run
   on a real in-memory SQLite seeded with the repo migrations plus an
   in-memory R2 that captures the saved manifest. The queue-begin step
   is faked to "not begun" so no provider call is made; the manifest is
   saved before that step, so the assertions are unaffected. */
{
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  process.env.ELEVENLABS_API_BASE = `http://127.0.0.1:${eleven.address().port}`;
  const PROD_OUT = join(mkdtempSync(join(tmpdir(), "mw-ads-prod-")), "prod.mjs");
  await build({ entryPoints: [join(HERE, "..", "..", "app", "api", "_lib", "ads-production.ts")], bundle: true, platform: "node", format: "esm", outfile: PROD_OUT, alias: { "next/headers": join(HERE, "shim-headers.ts"), "next/navigation": join(HERE, "shim-headers.ts") }, logLevel: "warning" });
  const prod = await import(pathToFileURL(PROD_OUT).href);
  const { startAd, loadAd } = prod;

  const makeTestDb = () => {
    const db = new DatabaseSync(":memory:");
    for (const file of readdirSync(join(HERE, "..", "..", "drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(join(HERE, "..", "..", "drizzle", file), "utf8").split("--> statement-breakpoint")) {
        const sql = statement.trim(); if (!sql) continue;
        try { db.exec(sql); } catch (error) { if (!/already exists|duplicate column/i.test(error.message)) throw new Error(`${file}: ${error.message}`); }
      }
    }
    const wrap = (sql, values = []) => ({
      bind: (...next) => wrap(sql, next),
      first: async () => db.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...values) }),
      run: async () => {
        if (/^UPDATE render_jobs SET status = 'generating'/.test(sql)) return { meta: { changes: 0 }, results: [] };
        const r = db.prepare(sql).run(...values);
        return { meta: { changes: Number(r.changes) }, results: [] };
      },
    });
    return { raw: db, prepare: (sql) => wrap(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
  };
  const makeTestBucket = () => {
    const store = new Map();
    return {
      store,
      get: async (key) => store.has(key) ? { text: async () => String(store.get(key).value) } : null,
      head: async (key) => store.has(key) ? { size: store.get(key).value.length } : null,
      put: async (key, value, options = {}) => { let v = value; if (value && typeof value.getReader === "function") v = Buffer.from(await new Response(value).arrayBuffer()); else if (value instanceof ArrayBuffer) v = Buffer.from(value); store.set(key, { value: typeof v === "string" ? v : Buffer.from(v), meta: options.httpMetadata }); },
      delete: async (key) => { store.delete(key); },
    };
  };
  let seedCount = 0;
  const seedAd = (db, elevenlabsOn) => {
    seedCount += 1;
    const id = `ad-toggle-${seedCount}`;
    const now = Date.now();
    db.raw.prepare(`INSERT INTO ad_projects (id, owner_id, title, hook, prompt, scene_prompts, scene_images, engine, resolution, aspect, target_duration, subtitles, voiceover_script, voice_id, music_mood, elevenlabs_on, draft, status, render_job_id, final_history_id, cost_cents, created_at, updated_at) VALUES (?, 'owner-1', 'Toggle test ad', '', 'A watch ad on a city rooftop at dusk.', '[]', '[]', 'wan3', '1080p', 'vertical', 10, ?, 'The city never sleeps. Neither does this watch.', 'v-rachel', 'bold', ?, 0, 'draft', NULL, NULL, 0, ?, ?)`).run(id, JSON.stringify({ on: true, position: "bottom", size: "medium", lines: [] }), elevenlabsOn, now, now);
    db.raw.prepare(`INSERT INTO ad_assets (id, ad_project_id, owner_id, kind, r2_key, file_name, content_type, size_bytes, sort_order, created_at) VALUES (?, ?, 'owner-1', 'source', 'ads/test.jpg', 'test.jpg', 'image/jpeg', 1000, 0, ?)`).run(`asset-toggle-${seedCount}`, id, now);
    return id;
  };
  const manifestFor = (bucket, jobId) => JSON.parse(String(bucket.store.get(`render-jobs/${jobId}/manifest.json`).value));

  // 8a. Toggle OFF, script + voice + mood stored: no music, no voiceover,
  // no ElevenLabs call — but subtitles still come from the script.
  {
    const db = makeTestDb(); const bucket = makeTestBucket();
    const env = { DB: db, BUCKET: bucket };
    const adId = seedAd(db, 0);
    const ad = await loadAd(env, adId, "owner-1");
    check("8a loadAd reads the toggle off", ad && ad.elevenlabsOn === 0, JSON.stringify(ad?.elevenlabsOn));
    const callsBefore = calls.length;
    const result = await startAd(env, ad, "owner-1", "https://example.test", "provider-token");
    const manifest = manifestFor(bucket, result.jobId);
    check("8b toggle OFF manifest has no music key", !("music" in (manifest.edit || {})), JSON.stringify(Object.keys(manifest.edit || {})));
    check("8c toggle OFF manifest has no voiceover key", !("voiceover" in (manifest.edit || {})), JSON.stringify(Object.keys(manifest.edit || {})));
    check("8d toggle OFF subtitles still come from the stored script", Array.isArray(manifest.edit?.subtitles?.lines) && manifest.edit.subtitles.lines.length >= 1 && manifest.edit.subtitles.lines.map((line) => line.text).join(" ").includes("Neither does this watch"), JSON.stringify(manifest.edit?.subtitles?.lines));
    check("8e toggle OFF never calls ElevenLabs, even with a script stored", calls.length === callsBefore, `${callsBefore} -> ${calls.length}`);
    check("8f toggle OFF stores no voiceover audio", !bucket.store.has(`render-jobs/${result.jobId}/voiceover.mp3`), "");
  }

  // 8g. Toggle ON: today's behavior — music present, voiceover synthesized.
  {
    const db = makeTestDb(); const bucket = makeTestBucket();
    const env = { DB: db, BUCKET: bucket };
    const adId = seedAd(db, 1);
    const ad = await loadAd(env, adId, "owner-1");
    check("8g loadAd reads the toggle on", ad && ad.elevenlabsOn === 1, JSON.stringify(ad?.elevenlabsOn));
    const callsBefore = calls.length;
    const result = await startAd(env, ad, "owner-1", "https://example.test", "provider-token");
    const manifest = manifestFor(bucket, result.jobId);
    check("8h toggle ON manifest carries the music mood", typeof manifest.edit?.music?.prompt === "string" && manifest.edit.music.prompt.length > 0, JSON.stringify(manifest.edit?.music));
    check("8i toggle ON manifest carries the voiceover", manifest.edit?.voiceover?.saved === "voiceover.mp3", JSON.stringify(manifest.edit?.voiceover));
    check("8j toggle ON synthesizes the voiceover through ElevenLabs", calls.length === callsBefore + 1 && /text-to-speech\/v-rachel/.test(calls.at(-1).url), calls.at(-1)?.url || "");
    check("8k toggle ON stores the voiceover audio", bucket.store.has(`render-jobs/${result.jobId}/voiceover.mp3`), "");
  }

  // 8l. Toggle OFF with the key removed entirely: still succeeds, no call,
  // no 503 — the generate does not depend on ElevenLabs at all when off.
  {
    delete process.env.ELEVENLABS_API_KEY;
    const db = makeTestDb(); const bucket = makeTestBucket();
    const env = { DB: db, BUCKET: bucket };
    const adId = seedAd(db, 0);
    const ad = await loadAd(env, adId, "owner-1");
    const callsBefore = calls.length;
    let result = null, error = null;
    try { result = await startAd(env, ad, "owner-1", "https://example.test", "provider-token"); } catch (e) { error = e; }
    check("8l toggle OFF works with no ElevenLabs key at all", result !== null && error === null, error?.message || "");
    if (result) {
      const manifest = manifestFor(bucket, result.jobId);
      check("8m toggle OFF with no key still has no music or voiceover", !("music" in (manifest.edit || {})) && !("voiceover" in (manifest.edit || {})), JSON.stringify(Object.keys(manifest.edit || {})));
    }
    check("8n toggle OFF with no key makes no ElevenLabs call", calls.length === callsBefore, `${callsBefore} -> ${calls.length}`);
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  }

  // 8o. Template ad (10 s stored on purpose — startAd must coerce it to
  // 30 s): the filled master prompt is the job prompt and the scene theme.
  const seedTemplateAd = (db) => {
    seedCount += 1;
    const id = `ad-template-${seedCount}`;
    const now = Date.now();
    const fields = { product: "AI tracking gimbal", problem: "Filming alone means shaky shots and missed moments.", whoFor: "creators filming alone with a phone", proof: "Holds the shot steady for a full 30-second take", price: "$29.99", honestDownside: "Needs a flat surface to stand on.", callToAction: "Tap the orange cart" };
    db.raw.prepare(`INSERT INTO ad_projects (id, owner_id, title, hook, prompt, scene_prompts, scene_images, template, template_fields, engine, resolution, aspect, target_duration, subtitles, voiceover_script, voice_id, music_mood, elevenlabs_on, draft, status, render_job_id, final_history_id, cost_cents, created_at, updated_at) VALUES (?, 'owner-1', 'Template test ad', '', 'A gimbal demo.', '[]', '[]', 'fix-it-20', ?, 'wan3', '1080p', 'vertical', 10, '{}', '', NULL, NULL, 0, 0, 'draft', NULL, NULL, 0, ?, ?)`).run(id, JSON.stringify(fields), now, now);
    // Six source images: a 30 s plan needs more than one photo (one photo
    // caps at the longest single scene, 15 s on Wan 3.0).
    for (let i = 0; i < 6; i += 1) {
      db.raw.prepare(`INSERT INTO ad_assets (id, ad_project_id, owner_id, kind, r2_key, file_name, content_type, size_bytes, sort_order, created_at) VALUES (?, ?, 'owner-1', 'source', ?, ?, 'image/jpeg', 1000, ?, ?)`).run(`asset-template-${seedCount}-${i}`, id, `ads/test-${i}.jpg`, `test-${i}.jpg`, i, now);
    }
    return id;
  };
  {
    const db = makeTestDb(); const bucket = makeTestBucket();
    const env = { DB: db, BUCKET: bucket };
    const adId = seedTemplateAd(db);
    const ad = await loadAd(env, adId, "owner-1");
    check("10a loadAd reads the template and its fields", ad && ad.template === "fix-it-20" && JSON.parse(ad.templateFields).product === "AI tracking gimbal", JSON.stringify(ad?.template));
    const result = await startAd(env, ad, "owner-1", "https://example.test", "provider-token");
    const job = db.raw.prepare(`SELECT prompt, duration FROM render_jobs WHERE id = ?`).get(result.jobId);
    check("10b template ad stores the filled master prompt as the job prompt", typeof job?.prompt === "string" && job.prompt.includes("AI tracking gimbal") && job.prompt.includes("$29.99") && job.prompt.includes("16 CFR Part 465") && job.prompt.includes("Fix It In 20 Seconds"), String(job?.prompt || "").slice(0, 120));
    check("10c template ad coerces its stored 10 s to the 30 s the prompt needs", job?.duration === 30, `duration=${job?.duration}`);
    const manifest = manifestFor(bucket, result.jobId);
    check("10d template scenes carry the master prompt, not the cinematic theme", JSON.stringify(manifest).includes("AI tracking gimbal") && !JSON.stringify(manifest).includes(ADS_THEME), "");
  }

  // 10e. Cinematic control: the job prompt is still ADS_THEME, duration kept.
  {
    const db = makeTestDb(); const bucket = makeTestBucket();
    const env = { DB: db, BUCKET: bucket };
    const adId = seedAd(db, 0);
    const ad = await loadAd(env, adId, "owner-1");
    const result = await startAd(env, ad, "owner-1", "https://example.test", "provider-token");
    const job = db.raw.prepare(`SELECT prompt, duration FROM render_jobs WHERE id = ?`).get(result.jobId);
    check("10e cinematic ad still stores ADS_THEME and keeps its 10 s", job?.prompt === ADS_THEME && job?.duration === 10, `duration=${job?.duration}`);
  }

  eleven.close();
}

/* 9. "Fix It In 20 Seconds" master-prompt template: the picker, the
   7 fill-ins, the structure, the rules and the legal DO / DON'T, copied
   from the master prompt file in its own words — and nothing from the
   file's starting slate baked in. */
{
  const filled = {
    product: "AI tracking gimbal",
    problem: "Filming alone means shaky shots and missed moments.",
    whoFor: "creators filming alone with a phone",
    proof: "Holds the shot steady for a full 30-second take",
    price: "$29.99",
    honestDownside: "Needs a flat surface to stand on.",
    callToAction: "Tap the orange cart",
  };
  const text = buildMasterPromptPrompt(filled);
  check("9a the picker offers cinematic and Fix It In 20 Seconds", AD_TEMPLATES.length === 2 && AD_TEMPLATES[0].id === "cinematic" && AD_TEMPLATES[0].label === "Cinematic premium" && AD_TEMPLATES[1].id === "fix-it-20" && AD_TEMPLATES[1].label === "Fix It In 20 Seconds", JSON.stringify(AD_TEMPLATES.map((t) => t.id)));
  check("9b unknown templates fall back to cinematic", resolveAdTemplate(undefined) === "cinematic" && resolveAdTemplate("nope") === "cinematic" && resolveAdTemplate("fix-it-20") === "fix-it-20", "");
  check("9c the template is 30 s: 10 s and 60 s both coerce to 30, cinematic keeps its length", MASTER_PROMPT_DURATION === 30 && resolveTemplateDuration("fix-it-20", 10) === 30 && resolveTemplateDuration("fix-it-20", 60) === 30 && resolveTemplateDuration("cinematic", 10) === 10 && resolveTemplateDuration("cinematic", 60) === 60 && resolveTemplateDuration("cinematic", 99) === 10, "");
  check("9d exactly the 7 fill-in fields, in order", MASTER_PROMPT_FIELD_DEFS.map((d) => d.key).join(",") === "product,problem,whoFor,proof,price,honestDownside,callToAction", JSON.stringify(MASTER_PROMPT_FIELD_DEFS.map((d) => d.key)));
  check("9e the filled prompt carries all 7 values", Object.values(filled).every((v) => text.includes(v)), "");
  const idx = (s) => text.indexOf(s);
  check("9f the structure is present in the file's fixed order", idx("0–3s HOOK") > -1 && idx("0–3s HOOK") < idx("3–8s PROBLEM") && idx("3–8s PROBLEM") < idx("8–20s DEMO") && idx("8–20s DEMO") < idx("20–25s PROOF") && idx("20–25s PROOF") < idx("25–30s CALL TO ACTION"), "");
  check("9g the structure keeps the file's wording", text.includes("already moving") && text.includes("change something on screen every 2–4 seconds") && text.includes("Last frame should match the first frame so the video loops seamlessly") && text.includes('Never start with a logo, a greeting, or "hey guys."'), "");
  check("9h rules 1–9 are present verbatim", text.includes("Hook in the first 3 seconds or the video fails") && text.includes("Show, don't tell") && text.includes("never stretch one video past 30 seconds") && text.includes("End on the payoff, then stop") && text.includes("21–30 seconds"), "");
  check("9i the legal DO / DON'T are present verbatim", text.includes("Disclose the affiliate link ON SCREEN in the video") && text.includes("#ad") && text.includes("I earn a commission if you buy") && text.includes("16 CFR Part 465") && text.includes("$53,088") && text.includes("NEVER let an AI person/avatar claim it used, tried, or liked the product") && text.includes("NEVER fake what the product does") && text.includes("NEVER imply a brand sponsors or endorses you") && text.includes("NEVER hide the affiliate relationship") && text.includes("NEVER buy followers or views") && text.includes("NEVER build for TikTok Creator Rewards with fully AI videos") && text.includes("NEVER make earnings or income claims") && text.includes("Label any AI-generated realistic person, voice, or scene"), "");
  check("9j the series rule names Fix It In 20 Seconds", text.includes('Every video belongs to the same repeatable series: "Fix It In 20 Seconds."') && text.includes("Same opening pattern, same promise"), "");
  check("9k no starting-slate product or price is baked into the template", !/gimbal|lav mic|ring light|Ulanzi|Lamicall|tripod|\$29\.99|\$39\.99|\$23\.99|\$29\.95|\$34\.99/i.test(MASTER_PROMPT_TEMPLATE), "");
  const empty = buildMasterPromptPrompt(emptyMasterPromptFields());
  check("9l an empty field keeps its bracket hint, so the structure stays complete", empty.includes("PRODUCT: [product name]") && empty.includes("PRICE: [price]") && empty.includes('CALL TO ACTION: [one action only, e.g. "tap the orange cart"]'), "");
  check("9m cleaning trims, caps and drops unknown keys; bad JSON parses empty", cleanMasterPromptFields({ product: "  Gimbal  ", price: "x".repeat(100), nope: 1 }).product === "Gimbal" && cleanMasterPromptFields({ price: "x".repeat(100) }).price.length === 40 && !("nope" in cleanMasterPromptFields({ nope: 1 })) && parseMasterPromptFields("not json").product === "" && parseMasterPromptFields(JSON.stringify(filled)).proof === filled.proof, "");
  const themed = buildAdScenePrompt({ userPrompt: "A gimbal demo.", sceneIndex: 0, hook: "Steady shots, solo.", theme: text });
  const plain = buildAdScenePrompt({ userPrompt: "A gimbal demo.", sceneIndex: 0, hook: "Steady shots, solo." });
  check("9n the template theme replaces ADS_THEME in scene 0, cinematic stays untouched", themed.startsWith(text) && themed.includes("Steady shots, solo.") && plain.startsWith(ADS_THEME) && !text.includes(ADS_THEME), "");
}

/* 11. Library Studio templates: Restaurant Interior, rebuilt from the
   CapCut template by Treztive — 17 s vertical, 8 photos, hard cuts. */
{
  const fields = { brandName: "Treztive", titleLine1: "Restaurant", titleLine2: "INTERIOR", location: "Street name, City", website: "www.example.com" };
  check("11a unknown and empty ids resolve to none", resolveLibraryTemplate(undefined) === "none" && resolveLibraryTemplate("") === "none" && resolveLibraryTemplate("nope") === "none" && resolveLibraryTemplate("restaurant-interior") === "restaurant-interior", "");
  check("11b the recorded template is 17 s vertical with 8 photo slots and Luxe & warm music", LIBRARY_TEMPLATES.length === 1 && LIBRARY_TEMPLATES[0].id === "restaurant-interior" && LIBRARY_TEMPLATES[0].durationSeconds === 17 && LIBRARY_TEMPLATES[0].aspect === "vertical" && LIBRARY_TEMPLATES[0].photoSlots === 8 && LIBRARY_TEMPLATES[0].musicMood === "luxe" && LIBRARY_TEMPLATES[0].source === "CapCut template by Treztive", JSON.stringify(LIBRARY_TEMPLATES[0]));
  check("11c exactly the 5 fill-in fields, in order", LIBRARY_TEMPLATE_FIELD_DEFS.map((d) => d.key).join(",") === "brandName,titleLine1,titleLine2,location,website", JSON.stringify(LIBRARY_TEMPLATE_FIELD_DEFS.map((d) => d.key)));
  check("11d cleaning trims, caps and drops unknown keys; bad input parses empty", cleanLibraryTemplateFields({ libraryTemplate: "restaurant-interior", brandName: "  Treztive  ", location: "x".repeat(200), nope: 1 }).fields.brandName === "Treztive" && cleanLibraryTemplateFields({ libraryTemplate: "restaurant-interior", location: "x".repeat(200) }).fields.location.length === 120 && !("nope" in cleanLibraryTemplateFields({ nope: 1 }).fields) && cleanLibraryTemplateFields(null).libraryTemplate === "none" && cleanLibraryTemplateFields("nope").libraryTemplate === "none" && parseLibraryTemplateFields("not json").libraryTemplate === "none" && parseLibraryTemplateFields(JSON.stringify({ libraryTemplate: "restaurant-interior", ...fields })).fields.website === fields.website, "");
  const merged = mergeTemplateFields(emptyMasterPromptFields(), { libraryTemplate: "restaurant-interior", fields });
  check("11e the merged template_fields column round-trips through both parsers", parseLibraryTemplateFields(JSON.stringify(merged)).libraryTemplate === "restaurant-interior" && parseLibraryTemplateFields(JSON.stringify(merged)).fields.brandName === "Treztive" && parseMasterPromptFields(JSON.stringify(merged)).product === "" && merged.libraryTemplate === "restaurant-interior", JSON.stringify(merged));
  const full8 = libraryTemplatePlan("wan3", "1080p", 8);
  check("11f full render with 8 photos is 8 scenes of 3 s sharing 2.125 s over 17 s", full8.count === 8 && full8.sceneSeconds === 3 && full8.shareSeconds === 2.125 && full8.totalSeconds === 17 && full8.resolution === "1080p", JSON.stringify(full8));
  const full4 = libraryTemplatePlan("wan3", "1080p", 4);
  check("11g full render with 4 photos shares 4.25 s in 5 s scenes", full4.count === 4 && full4.shareSeconds === 4.25 && full4.sceneSeconds === 5 && full4.totalSeconds === 17, JSON.stringify(full4));
  const draft8 = libraryTemplatePlan("wan3", "1080p", 8, true);
  check("11h a draft with 8 photos is the first 4 scenes only, 10 s at 480p", draft8.count === 4 && draft8.shareSeconds === 2.5 && draft8.totalSeconds === 10 && draft8.resolution === "480p", JSON.stringify(draft8));
  const overlays = libraryTemplateOverlayLines("restaurant-interior", fields, 17, 2.125);
  check("11i the brand runs the whole film, top, small", overlays[0].text === "Treztive" && overlays[0].start === 0 && overlays[0].end === 17 && overlays[0].position === "top" && overlays[0].size === "small", JSON.stringify(overlays[0]));
  check("11j the title lines run the first two scenes, centre, large", overlays[1].text === "Restaurant" && overlays[1].end === 4.25 && overlays[1].position === "center" && overlays[1].size === "large" && overlays[2].text === "INTERIOR" && overlays[2].end === 4.25 && overlays[3].text === "Street name, City" && overlays[3].size === "medium", JSON.stringify(overlays[1]));
  check("11k the website runs the last scene, centre, medium", overlays[4].text === "www.example.com" && overlays[4].start === 14.875 && overlays[4].end === 17 && overlays[4].position === "center" && overlays[4].size === "medium", JSON.stringify(overlays[4]));
  check("11l empty fields are skipped — no placeholder text in the video", libraryTemplateOverlayLines("restaurant-interior", { ...emptyRestaurantInteriorFields(), brandName: "Treztive" }, 17, 2.125).length === 1 && libraryTemplateOverlayLines("none", fields, 17, 2.125).length === 0, "");
  check("11m the full 8-photo estimate is 24 s at the catalog's Wan 3.0 1080p price", libraryTemplateEstimate("wan3", 8, false) === engineCost("wan3", "1080p", 24), `$${libraryTemplateEstimate("wan3", 8, false).toFixed(4)} vs $${engineCost("wan3", "1080p", 24).toFixed(4)}`);
  check("11n a template with nothing stored shows; off stays hidden", isLibraryTemplateVisible("restaurant-interior", {}) === true && isLibraryTemplateVisible("restaurant-interior", { "restaurant-interior": false }) === false && isLibraryTemplateVisible("restaurant-interior", { "restaurant-interior": true }) === true && JSON.stringify(parseLibraryEnabled('{"restaurant-interior":false}')) === '{"restaurant-interior":false}' && JSON.stringify(parseLibraryEnabled("not json")) === "{}" && JSON.stringify(parseLibraryEnabled(null)) === "{}", "");
  check("11o the theme is static-camera, warm and golden, with no real-estate language", /static camera/i.test(LIBRARY_TEMPLATE_THEME) && /warm and golden/i.test(LIBRARY_TEMPLATE_THEME) && /true to the supplied photos/i.test(LIBRARY_TEMPLATE_THEME) && !/real estate|listing|property|architecture|STATIC_LOCK|camera-only/i.test(LIBRARY_TEMPLATE_THEME), LIBRARY_TEMPLATE_THEME.slice(0, 80));
  const styled = buildAssText([
    { start: 0, end: 17, text: "Treztive", position: "top", size: "small" },
    { start: 0, end: 4.25, text: "Restaurant", position: "center", size: "large" },
    { start: 5, end: 7, text: "Plain line" },
  ], { position: "bottom", size: "medium" }, 1080);
  check("11p per-line styles get their own Style lines — top 8, centre 5, bottom 2", (styled.match(/^Style:/gm) || []).length === 3 && /,8,20,20,40,1/.test(styled) && /,5,20,20,0,1/.test(styled) && /,2,20,20,40,1/.test(styled), styled.split("\n").filter((line) => line.startsWith("Style:")).join(" | "));
  check("11q the dialogues reference their own styles", styled.includes("AdTopSmall") && styled.includes("AdCenterLarge") && styled.includes("AdDefault") && styled.includes("Treztive") && styled.includes("Restaurant"), "");
  const plain = buildAssText([{ start: 1, end: 3.5, text: "First line" }, { start: 5, end: 7, text: "Second line" }], { position: "bottom", size: "medium" }, 1080);
  check("11r with no per-line styles there is exactly one Style line and every dialogue is AdDefault", (plain.match(/^Style:/gm) || []).length === 1 && plain.split("\n").filter((line) => line.startsWith("Dialogue:")).every((line) => line.includes(",AdDefault,")) && plain.includes("Liberation Sans,48,") && /,2,20,20,40,1/.test(plain), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
