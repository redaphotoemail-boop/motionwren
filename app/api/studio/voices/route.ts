import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { ElevenLabsMissingKey, listVoices } from "../../_lib/elevenlabs";

/* The voices a film can be narrated in, each with ElevenLabs' own sample so it
   can be heard before choosing (the preview is a free sample, nothing is made). */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const voices = await listVoices();
    const usable = voices.filter((voice) => voice.previewUrl).slice(0, 40).map((voice) => ({
      id: voice.voiceId, name: voice.name,
      note: [voice.labels.gender, voice.labels.accent, voice.labels.age, voice.labels.descriptive || voice.labels.use_case].filter(Boolean).join(" · ") || voice.description.slice(0, 60),
      previewUrl: `/api/studio/voices/${voice.voiceId}/preview`,
    }));
    return NextResponse.json({ voices: usable });
  } catch (error) {
    if (error instanceof ElevenLabsMissingKey) return NextResponse.json({ error: "The ElevenLabs key is not added yet.", fix: "elevenlabs" }, { status: 503 });
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
