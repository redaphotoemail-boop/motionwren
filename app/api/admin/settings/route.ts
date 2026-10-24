import { jsonError, requireAdmin } from "../../_lib/account";

const DEFAULT_SECONDS = 5;
const allowed = new Set([3, 5, "auto"]);

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind("multi_shot_seconds_per_image").first<{ value?: string }>();
    const raw = row?.value === "auto" ? "auto" : Number(row?.value);
    return Response.json({ multiShotSecondsPerImage: allowed.has(raw) ? raw : DEFAULT_SECONDS });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json() as { multiShotSecondsPerImage?: unknown };
    const value = body.multiShotSecondsPerImage === "auto" ? "auto" : Number(body.multiShotSecondsPerImage);
    if (!allowed.has(value)) return Response.json({ error: "Choose 3 or 5 seconds per image." }, { status: 400 });
    await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("multi_shot_seconds_per_image", String(value), Date.now()).run();
    return Response.json({ multiShotSecondsPerImage: value, updatedBy: admin.email });
  } catch (error) { return jsonError(error); }
}
