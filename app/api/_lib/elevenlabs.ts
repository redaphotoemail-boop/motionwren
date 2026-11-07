/* ElevenLabs voiceover (text-to-speech) for Studio Ads. Music already uses
   ElevenLabs (composer/server.mjs); this is the voice side, which did not
   exist. The key comes from the Worker's secrets (ELEVENLABS_API_KEY), read
   exactly like the music-check route reads it. Nothing here invents or
   stores a key: when it is absent every call fails honestly and the caller
   turns that into a 503. */

const ELEVEN_BASE = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

export function elevenLabsKey(): string {
  return process.env.ELEVENLABS_API_KEY || "";
}

export class ElevenLabsMissingKey extends Error {
  constructor() { super("The ElevenLabs key is not added yet."); this.name = "ElevenLabsMissingKey"; }
}

export type ElevenVoice = { voiceId: string; name: string; category: string; description: string };

/* The account's voices, live from ElevenLabs. */
export async function listVoices(): Promise<ElevenVoice[]> {
  const key = elevenLabsKey();
  if (!key) throw new ElevenLabsMissingKey();
  const response = await fetch(`${ELEVEN_BASE}/v1/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ElevenLabs could not list voices (HTTP ${response.status}).`);
  const data = (await response.json().catch(() => ({}))) as { voices?: { voice_id?: string; name?: string; category?: string; description?: string }[] };
  return (data.voices || [])
    .filter((voice) => typeof voice.voice_id === "string" && typeof voice.name === "string")
    .map((voice) => ({ voiceId: voice.voice_id as string, name: voice.name as string, category: typeof voice.category === "string" ? voice.category : "", description: typeof voice.description === "string" ? voice.description : "" }));
}

/* One voiceover track: MP3 bytes. Text is capped at 5,000 characters
   (ElevenLabs' per-request limit for this endpoint). */
export async function synthesizeVoiceover({ voiceId, text, modelId }: { voiceId: string; text: string; modelId?: string }): Promise<ArrayBuffer> {
  const key = elevenLabsKey();
  if (!key) throw new ElevenLabsMissingKey();
  const clean = text.trim().slice(0, 5000);
  if (!clean) throw new Error("Write the voiceover script first.");
  const response = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: clean,
      model_id: modelId || "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`The voiceover could not be made (HTTP ${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 100) throw new Error("ElevenLabs returned no usable voiceover.");
  return bytes;
}
