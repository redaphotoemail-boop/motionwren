import { enforceRateLimit, jsonError, requireAdmin } from "../../_lib/account";
import { composerBinding, makeMusicSample, storeResponse } from "../../_lib/composer";
import { MUSIC_TEMPLATES, sampleKey } from "../../../music-catalog";

/* Manager only: the customers' "hear it first" samples, one short clip per
   music template, made once with ElevenLabs and kept in storage (customers
   playing them costs nothing). */

async function status(env: { BUCKET: R2Bucket }) {
  return Promise.all(MUSIC_TEMPLATES.map(async (template) => ({ id: template.id, name: template.name, ready: Boolean(await env.BUCKET.get(sampleKey(template.id))) })));
}

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return Response.json({ samples: await status(env) });
  } catch (error) { return jsonError(error); }
}

/* Makes the missing samples, or all of them again with { force: true }. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "music-samples", 6, 60 * 60 * 1000);
    if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "The ElevenLabs key is not added yet." }, { status: 409 });
    if (!composerBinding(env)) return Response.json({ error: "The editing service is not set up." }, { status: 409 });
    const body = await request.json().catch(() => ({})) as { force?: unknown };
    const have = new Map((await status(env)).map((sample) => [sample.id, sample.ready]));
    const todo = MUSIC_TEMPLATES.filter((template) => body.force === true || !have.get(template.id));
    const results = await Promise.all(todo.map(async (template) => {
      try {
        await storeResponse(env.BUCKET, sampleKey(template.id), await makeMusicSample(env, template.id, template.prompt), "audio/mpeg");
        return { id: template.id, ok: true as const };
      } catch (error) { return { id: template.id, ok: false as const, error: (error instanceof Error ? error.message : "The sample could not be made.").slice(0, 300) }; }
    }));
    return Response.json({ made: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok), samples: await status(env) });
  } catch (error) { return jsonError(error); }
}
