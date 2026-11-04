import { jsonError, enforceRateLimit, requireAdmin } from "../../_lib/account";
import { checkMusic, composerBinding, recordEditorState } from "../../_lib/composer";

/* Manager only: makes a 5-second ElevenLabs track (no backup) to confirm the
   music key, plan and format work. A few cents of ElevenLabs credit. */
export async function POST() {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "music-check", 6, 60 * 60 * 1000);
    if (!process.env.ELEVENLABS_API_KEY) return Response.json({ ok: false, error: "The ElevenLabs key is not added yet." });
    if (!composerBinding(env)) return Response.json({ ok: false, error: "The editing service is not set up." });
    const result = await checkMusic(env);
    if (result.ok) await recordEditorState(env, { musicSource: "elevenlabs", musicNote: "" });
    else await recordEditorState(env, { musicNote: String(result.error || "").slice(0, 300) });
    return Response.json(result);
  } catch (error) { return jsonError(error); }
}
