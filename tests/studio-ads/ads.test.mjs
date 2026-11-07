/* Studio Ads unit tests: the prompt theme, per-scene prompts, subtitle
   timing + .ass text, duration planning, cost estimates, ad music moods,
   and the ElevenLabs voiceover client (against a localhost stand-in).
   Plain node, no database, no provider. The lib is bundled with esbuild
   first, the way tests/scene-queue does it. */
import http from "node:http";
import { mkdtempSync } from "node:fs";
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
const { ADS_THEME, ADS_NEGATIVE, adAspectRatio, adPlan, buildAdScenePrompt, buildAssText, estimateAdCost, splitScriptToSubtitles, AD_MUSIC_MOODS, adMusicMood, defaultAdMusicMood, ElevenLabsMissingKey, listVoices, synthesizeVoiceover } = lib;

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
  eleven.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
