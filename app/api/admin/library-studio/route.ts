/* Library Studio: which recorded video templates show as a choice when
   producing a Studio Ad. Admin only. The on/off map lives in
   platform_settings under 'library_templates_enabled' — the key/value
   store is the established pattern (same as defaultEngine), so no new
   table and no migration. */
import { jsonError, requireAdmin } from "../../_lib/account";
import { LIBRARY_TEMPLATES, isLibraryTemplateVisible, parseLibraryEnabled } from "../../../library-templates";

const SETTINGS_KEY = "library_templates_enabled";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(SETTINGS_KEY).first<{ value?: string }>().catch(() => null);
    return Response.json({ templates: LIBRARY_TEMPLATES, enabled: parseLibraryEnabled(row?.value ?? "") });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    const template = LIBRARY_TEMPLATES.find((item) => item.id === id);
    if (!template) return Response.json({ error: "Unknown library template." }, { status: 400 });
    if (typeof body.enabled !== "boolean") return Response.json({ error: "Enabled must be true or false." }, { status: 400 });
    const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(SETTINGS_KEY).first<{ value?: string }>().catch(() => null);
    const enabled = parseLibraryEnabled(row?.value ?? "");
    enabled[template.id] = body.enabled;
    await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(SETTINGS_KEY, JSON.stringify(enabled), Date.now()).run();
    return Response.json({ templates: LIBRARY_TEMPLATES, enabled, visible: isLibraryTemplateVisible(template.id, enabled) });
  } catch (error) { return jsonError(error); }
}
