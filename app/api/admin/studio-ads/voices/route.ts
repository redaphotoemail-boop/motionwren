/* Studio Ads: ElevenLabs voices, live when the key is set. Without the key
   the picker stays disabled and this answers 503 — the same honest pattern
   as the password-reset routes. Admin only. */
import { jsonError, requireAdmin } from "../../../_lib/account";
import { ElevenLabsMissingKey, listVoices } from "../../../_lib/elevenlabs";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const voices = await listVoices();
    return Response.json({ voices, keyed: true });
  } catch (error) {
    if (error instanceof ElevenLabsMissingKey) return Response.json({ error: error.message, keyed: false, voices: [] }, { status: 503 });
    return jsonError(error);
  }
}
