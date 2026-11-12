/* The film's own sound, made at the final edit: a voiceover (written from what
   the scenes show, then spoken) and smart sound effects (water, fire, wind, a
   street — whatever the scene actually has). The wording comes from
   Cloudflare Workers AI: a vision model reads each photo, a text model writes
   the lines. The voice and the effects come from ElevenLabs (a paid plan).
   Nothing here edits a scene or its prompt. */

import { cloudflareRun } from "./film-review";
import { ElevenLabsMissingKey, generateSoundEffect, synthesizeVoiceover } from "./elevenlabs";

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<{ response?: string } | string> };
/* Tried in order: the first that answers with usable JSON is used. */
const TEXT_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.1-8b-instruct-fast"];
const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;

export type SceneSound = { voice: string; sfx: string };
export type SoundSuggestion = { scenes: SceneSound[]; film: string; source: "ai" | "basic"; detail?: string };

/* Words a voice can say in `seconds` at a calm real-estate pace. */
export const wordsFor = (seconds: number) => Math.max(4, Math.floor(seconds * 2.2));

const trimWords = (text: string, max: number) => text.replace(/\s+/g, " ").trim().split(" ").slice(0, max).join(" ").replace(/[,;:\s]+$/, "");
const clean = (text: unknown, max = 400) => typeof text === "string" ? text.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

async function aiText(env: unknown, model: string, prompt: string, maxTokens = 900): Promise<string> {
  const input = { messages: [{ role: "system", content: "You reply with a single JSON object and nothing else." }, { role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.4 };
  const binding = (env as { AI?: AiBinding } | null)?.AI;
  const pick = (out: unknown) => {
    if (typeof out === "string") return out;
    const value = out as { response?: unknown; result?: { response?: unknown } } | null;
    const response = value?.response ?? value?.result?.response;
    return typeof response === "string" ? response : response ? JSON.stringify(response) : "";
  };
  if (binding) return pick(await binding.run(model, input));
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${secret("CF_ACCOUNT_ID")}/ai/run/${model}`, { method: "POST", headers: { Authorization: `Bearer ${secret("CF_AI_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json().catch(() => null) as { result?: { response?: unknown }; errors?: { message?: string }[] } | null;
  if (!response.ok) throw new Error(data?.errors?.[0]?.message || `Workers AI answered HTTP ${response.status}.`);
  return pick(data?.result);
}

/* The first {...} in the answer, forgiving of code fences and trailing commas. */
function readJson(text: string): { scenes?: { voice?: unknown; sfx?: unknown }[]; film?: unknown } | null {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const raw = body.slice(start, end + 1);
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1")]) { try { return JSON.parse(candidate); } catch { /* try the next form */ } }
  return null;
}

export const aiAvailable = (env: unknown) => Boolean((env as { AI?: AiBinding } | null)?.AI) || Boolean(secret("CF_ACCOUNT_ID") && secret("CF_AI_TOKEN"));

const DESCRIBE = `You are a real-estate photographer's assistant. Describe this property photograph for a narrator in about 55 words. Name the room or area, the specific materials and finishes you can see (stone, oak, marble, brass, tile), the light (morning sun, warm evening glow, floor-to-ceiling windows), the layout and view, the two or three most appealing features, and any natural sound sources visible (running water, a fire, trees or wind, a pool, a street, birds, a kitchen). Only what is visible. No guessing.`;

const NARRATOR = `You are an award-winning luxury real-estate narrator. You tell a story, not a list: you make the viewer feel what it is like to stand in each space — the morning light, the quiet, the way one room opens into the next. Use concrete, specific details from the scene descriptions (materials, light, views, layout), vivid but credible verbs, and a calm, confident pace. Never invent facts that are not described: no prices, no square footage, no neighbourhood names, no exclamation marks, no clichés like "dream home" or "must see".`;

/* Reads the photos four at a time (one after another was slow enough to time out on a long film). A photo that cannot be read gets a plain stand-in. */
async function describeAll(env: unknown, images: Uint8Array[]): Promise<string[]> {
  const notes: string[] = new Array(images.length).fill("");
  let next = 0, failed = 0, lastError: unknown = null;
  const worker = async () => {
    while (next < images.length) {
      const index = next++;
      notes[index] = clean(await cloudflareRun(env, images[index], DESCRIBE, 110).catch((error) => { failed += 1; lastError = error; return ""; }), 420) || "an interior view of the property";
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, worker));
  if (images.length && failed === images.length) throw new Error(`The photos could not be read: ${lastError instanceof Error ? lastError.message : "the scene reader did not answer"}`.slice(0, 220));
  return notes;
}

/* Reads each photo, then writes one line per scene, one script for the whole film, and the sounds each scene would really have. */
export async function suggestSound(env: unknown, images: Uint8Array[], sceneSeconds: number, totalSeconds: number): Promise<SoundSuggestion> {
  if (!aiAvailable(env)) throw new Error("The scene reader (Cloudflare AI) is not connected.");
  const notes = await describeAll(env, images);
  const perScene = wordsFor(sceneSeconds), perFilm = wordsFor(totalSeconds);
  const list = notes.map((note, index) => `Scene ${index + 1}: ${note}`).join("\n");
  const prompt = `${NARRATOR}\n\nHere is what each scene shows, in order:\n${list}\n\nReturn JSON only, no other text, in exactly this shape:\n{"scenes":[{"voice":"...","sfx":"..."}],"film":"..."}\n- "scenes" has exactly ${notes.length} items, one per scene, in order.\n- "voice": narration for that scene using as much of the time as it has, between ${Math.max(4, perScene - 4)} and ${perScene} words, built from the most distinctive detail in that scene. Each scene continues the story from the one before; never repeat an opening or an adjective.\n- "sfx": a short description of the natural sounds that scene would really have (for example "soft water running over stone"), or "" when nothing in it makes a sound. Never music, never voices.\n- "film": one flowing narration for the whole film, at most ${perFilm} words, that moves smoothly from scene to scene as a single story with a beginning, a middle and an ending, opening with a welcome and closing with a short invitation. Use nearly all ${perFilm} words.`;
  let parsed: ReturnType<typeof readJson> = null; let detail = "";
  for (const model of TEXT_MODELS) {
    try {
      const found = readJson(await aiText(env, model, prompt, 1400));
      if (found?.scenes?.length) { parsed = found; break; }
      detail = `${model.split("/").pop()} did not return the lines in a usable form.`;
    } catch (error) { detail = `${model.split("/").pop()}: ${error instanceof Error ? error.message : "no answer"}`.slice(0, 200); }
  }
  const scenes: SceneSound[] = notes.map((note, index) => {
    const item = parsed?.scenes?.[index];
    const voice = trimWords(clean(item?.voice, 300), perScene);
    return { voice: voice || trimWords(note, perScene), sfx: clean(item?.sfx, 140) };
  });
  const film = trimWords(clean(parsed?.film, 2000), perFilm) || scenes.map((scene) => scene.voice).join(" ");
  return { scenes, film, source: parsed ? "ai" : "basic", ...(parsed ? {} : { detail }) };
}

/* ---- more options for one line (or the whole script) ---- */

export type OptionRequest = { target: "scene" | "film"; index?: number; current: string; lines: string[]; instruction: string };
const INSTRUCTIONS: Record<string, string> = {
  more: "Say more: richer and more detailed than the current text, using every word the time allows.",
  shorter: "Shorter and punchier, keeping the single best detail.",
  specific: "More specific to what the photo actually shows: name the exact materials, light, layout and view.",
  story: "More storytelling: make the viewer feel what it is like to be in the space, with a sense of moment and movement.",
  different: "A completely different angle from the current text, on the same scene.",
};
export const OPTION_KEYS = Object.keys(INSTRUCTIONS);

function readOptions(text: string): string[] {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  const raw = body.slice(start, end + 1);
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1")]) {
    try { const value = JSON.parse(candidate) as { options?: unknown }; if (Array.isArray(value.options)) return value.options.filter((item): item is string => typeof item === "string"); } catch { /* next */ }
  }
  return [];
}

/* Three fresh versions of one scene's line, or of the whole script. */
export async function writeOptions(env: unknown, images: Uint8Array[], request: OptionRequest, sceneSeconds: number, totalSeconds: number): Promise<{ options: string[] }> {
  if (!aiAvailable(env)) throw new Error("The scene reader (Cloudflare AI) is not connected.");
  const film = request.target === "film";
  const wanted = film ? images : [images[request.index ?? 0] || images[0]];
  const notes = await describeAll(env, wanted);
  const limit = film ? wordsFor(totalSeconds) : wordsFor(sceneSeconds);
  const instruction = INSTRUCTIONS[request.instruction] || clean(request.instruction, 200) || INSTRUCTIONS.different;
  const around = film ? "" : request.lines.map((line, index) => line.trim() ? `Scene ${index + 1} line: ${line.trim()}` : "").filter(Boolean).join("\n");
  const scene = film ? notes.map((note, index) => `Scene ${index + 1}: ${note}`).join("\n") : `This scene shows: ${notes[0]}`;
  const prompt = `${NARRATOR}\n\n${scene}\n${around ? `\nThe other lines in the film, for continuity (do not repeat them):\n${around}\n` : ""}\nCurrent text: ${request.current.trim() || "(none yet)"}\n\nRewrite it. ${instruction}\nReturn JSON only: {"options":["...","...","..."]}\nThree genuinely different versions, each at most ${limit} words${film ? ", flowing as one story across all scenes" : ", fitting the story around it"}.`;
  let options: string[] = []; let detail = "";
  for (const model of TEXT_MODELS) {
    try { options = readOptions(await aiText(env, model, prompt, 1200)); if (options.length) break; detail = `${model.split("/").pop()} did not return options.`; }
    catch (error) { detail = `${model.split("/").pop()}: ${error instanceof Error ? error.message : "no answer"}`.slice(0, 200); }
  }
  const cleaned = options.map((text) => trimWords(clean(text, 2000), limit)).filter(Boolean).slice(0, 3);
  if (!cleaned.length) throw new Error(`The writer could not make new versions. ${detail}`.trim());
  return { options: cleaned };
}

/* ---- making the audio ---- */

type SoundEnv = { BUCKET: R2Bucket };
const trackName = (kind: "voice" | "sfx", index: number) => `${kind}-${String(index + 1).padStart(2, "0")}.mp3`;
const trackKey = (jobId: string, name: string) => `render-jobs/${jobId}/${name}`;
export { trackKey };

export type VoicePlan = { mode: "scene" | "film"; voiceId: string; lines: string[]; film: string };

/* Speaks the film's lines and stores them. Returns what the manifest keeps. */
export async function makeVoice(env: SoundEnv, jobId: string, plan: VoicePlan, count: number) {
  const tracks: string[] = Array.from({ length: count }, () => "");
  const lines: string[] = Array.from({ length: count }, () => "");
  if (plan.mode === "film") {
    const text = clean(plan.film, 4000);
    if (!text) throw new Error("Write the voiceover script first.");
    await env.BUCKET.put(trackKey(jobId, trackName("voice", 0)), await synthesizeVoiceover({ voiceId: plan.voiceId, text }), { httpMetadata: { contentType: "audio/mpeg" } });
    tracks[0] = trackName("voice", 0); lines[0] = text;
    return { mode: "film" as const, voiceId: plan.voiceId, lines, tracks };
  }
  let made = 0;
  for (let index = 0; index < count; index += 1) {
    const text = clean(plan.lines[index], 400);
    if (!text) continue;
    await env.BUCKET.put(trackKey(jobId, trackName("voice", index)), await synthesizeVoiceover({ voiceId: plan.voiceId, text }), { httpMetadata: { contentType: "audio/mpeg" } });
    tracks[index] = trackName("voice", index); lines[index] = text; made += 1;
  }
  if (!made) throw new Error("Write at least one voiceover line first.");
  return { mode: "scene" as const, voiceId: plan.voiceId, lines, tracks };
}

/* One effect per scene that has one, as long as the scene's share of the film. */
export async function makeSfx(env: SoundEnv, jobId: string, prompts: string[], sceneSeconds: number) {
  const tracks: string[] = prompts.map(() => "");
  const used: string[] = prompts.map(() => "");
  let made = 0;
  for (const [index, prompt] of prompts.entries()) {
    const text = clean(prompt, 140);
    if (!text) continue;
    await env.BUCKET.put(trackKey(jobId, trackName("sfx", index)), await generateSoundEffect({ text: `${text}, natural ambience, no music, no voices`, seconds: sceneSeconds }), { httpMetadata: { contentType: "audio/mpeg" } });
    tracks[index] = trackName("sfx", index); used[index] = text; made += 1;
  }
  if (!made) return undefined;
  return { prompts: used, tracks };
}

export { ElevenLabsMissingKey };

/* The sound layers the composer places: voice lines at their scene (or the
   whole script from the start), effects under their scene at a low level. */
export function soundLayers(sound: NonNullable<import("./production").ProductionManifest["edit"]>["sound"], link: (file: string) => string, share: number, crossfade: number, duration: number) {
  const layers: { url: string; at: number; gain: number; kind: "voice" | "sfx" }[] = [];
  const start = (index: number) => Math.max(0, index * (share - crossfade));
  if (sound?.voice) {
    sound.voice.tracks.forEach((file, index) => {
      if (!file) return;
      const at = sound.voice!.mode === "film" ? 0.8 : start(index) + 0.5;
      if (at < duration - 0.5) layers.push({ url: link(file), at: Math.round(at * 1000) / 1000, gain: 1, kind: "voice" });
    });
  }
  sound?.sfx?.tracks.forEach((file, index) => {
    if (!file) return;
    const at = start(index);
    if (at < duration - 0.5) layers.push({ url: link(file), at: Math.round(at * 1000) / 1000, gain: 0.35, kind: "sfx" });
  });
  for (const hit of sound?.cutfx?.hits || []) {
    if (hit.at < duration - 0.3) layers.push({ url: link(hit.file), at: Math.round(hit.at * 1000) / 1000, gain: 0.5, kind: "sfx" });
  }
  return layers;
}

/* A WrenCut template's effects: one sound per kind (at most three), placed on its joins. A failure here never stops a film. */
export async function makeCutEffects(env: SoundEnv, jobId: string, audio: NonNullable<import("../../wrencut").WrenRecipe["audio"]>, times: number[]) {
  const effects = (audio.sfx || []).filter((item) => times[item.join] !== undefined);
  const kinds = [...new Set(effects.map((item) => item.kind))].slice(0, 3);
  const files: Record<string, string> = {};
  for (const kind of kinds) {
    const prompt = effects.find((item) => item.kind === kind)!.prompt;
    const name = `cutfx-${kind}.mp3`;
    await env.BUCKET.put(trackKey(jobId, name), await generateSoundEffect({ text: prompt, seconds: 1.5 }), { httpMetadata: { contentType: "audio/mpeg" } });
    files[kind] = name;
  }
  const hits = effects.filter((item) => files[item.kind]).map((item) => ({ file: files[item.kind], at: Math.max(0, times[item.join] - item.lead) }));
  return hits.length ? { files, hits } : undefined;
}
