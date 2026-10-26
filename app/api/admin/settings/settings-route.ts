import { jsonError, requireAdmin } from "../../_lib/account";
import { isEngineKey } from "../../../engine-providers";

const DEFAULT_SECONDS = 5;
const allowed = new Set([3, 5, "auto"]);

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind("multi_shot_seconds_per_image").first<{ value?: string }>();
    const raw = row?.value === "auto" ? "auto" : Number(row?.value);
    const engineRow = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind("defaultEngine").first<{ value?: string }>();
    return Response.json({ multiShotSecondsPerImage: allowed.has(raw) ? raw : DEFAULT_SECONDS, defaultEngine: isEngineKey(engineRow?.value) ? engineRow.value : "wan3" });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json() as { multiShotSecondsPerImage?: unknown; defaultEngine?: unknown };
    let seconds: 3 | 5 | "auto" | null = null;
    if (body.multiShotSecondsPerImage !== undefined) {
      const value = body.multiShotSecondsPerImage === "auto" ? "auto" : Number(body.multiShotSecondsPerImage);
      if (!allowed.has(value)) return Response.json({ error: "Choose 3 or 5 seconds per image." }, { status: 400 });
      seconds = value;
    }
    let engine: string | null = null;
    if (body.defaultEngine !== undefined) {
      if (!isEngineKey(body.defaultEngine)) return Response.json({ error: "Choose a valid production engine." }, { status: 400 });
      engine = body.defaultEngine;
    }
    const now = Date.now();
    if (seconds !== null) await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("multi_shot_seconds_per_image", String(seconds), now).run();
    if (engine !== null) await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("defaultEngine", engine, now).run();
    const secondsRow = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind("multi_shot_seconds_per_image").first<{ value?: string }>();
    const secondsRaw = secondsRow?.value === "auto" ? "auto" : Number(secondsRow?.value);
    const engineRow = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind("defaultEngine").first<{ value?: string }>();
    return Response.json({ multiShotSecondsPerImage: allowed.has(secondsRaw) ? secondsRaw : DEFAULT_SECONDS, defaultEngine: isEngineKey(engineRow?.value) ? engineRow.value : "wan3", updatedBy: admin.email });
  } catch (error) { return jsonError(error); }
}
