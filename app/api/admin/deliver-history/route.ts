import { audit, jsonError, requireAdmin } from "../../_lib/account";
import { sendAccountEmail } from "../../_lib/render-jobs";

/* Manager only: put one of your own saved Studio videos on a customer's
   profile. The file is COPIED into the customer's storage (your copy stays),
   a completed project appears in their dashboard, and they are notified.
   Cost stays with your Studio records: the customer's copy is recorded at $0. */
const DAY = 24 * 60 * 60 * 1000;
const LENGTHS = [10, 20, 30, 50, 60];

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { historyId?: unknown; email?: unknown; title?: unknown };
    const historyId = String(body.historyId || "");
    const email = String(body.email || "").trim().toLowerCase();
    if (!historyId || !email.includes("@")) return Response.json({ error: "Choose a video and enter the customer's email." }, { status: 400 });
    const source = await env.DB.prepare(`SELECT id, r2_key AS r2Key, prompt, resolution, aspect, duration, size_bytes AS sizeBytes FROM generation_history WHERE id = ? AND owner_id = ?`).bind(historyId, admin.id).first<{ id: string; r2Key: string; prompt: string; resolution: string; aspect: string; duration: number; sizeBytes: number }>();
    if (!source) return Response.json({ error: "That video was not found in your history." }, { status: 404 });
    const customer = await env.DB.prepare(`SELECT id, email FROM users WHERE LOWER(email) = ? LIMIT 1`).bind(email).first<{ id: string; email: string }>();
    if (!customer) return Response.json({ error: "No customer has signed up with that email yet." }, { status: 404 });
    if (customer.id === admin.id) return Response.json({ error: "That is your own account." }, { status: 400 });
    const object = await env.BUCKET.get(source.r2Key);
    if (!object) return Response.json({ error: "The video file could not be found." }, { status: 404 });

    const now = Date.now();
    const newHistoryId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const extension = source.r2Key.endsWith(".webm") ? "webm" : "mp4";
    const r2Key = `generation-history/${customer.id}/${newHistoryId}.${extension}`;
    const title = String(body.title || "").trim().slice(0, 120) || "Your MotionWren video";
    const aspect = ["horizontal", "vertical", "cinematic"].includes(source.aspect) ? source.aspect : "horizontal";
    const target = LENGTHS.includes(Math.round(source.duration)) ? Math.round(source.duration) : 30;
    await env.BUCKET.put(r2Key, object.body, { httpMetadata: { contentType: object.httpMetadata?.contentType || "video/mp4" }, customMetadata: { deliveredBy: admin.id } });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, 'delivered', 'real-estate', ?, ?, ?, 0, ?, ?, ?)`).bind(newHistoryId, customer.id, r2Key, `Delivered: ${title}`.slice(0, 500), source.resolution || "1080p", aspect, source.duration || 0, source.sizeBytes || object.size, now + 90 * DAY, now),
        env.DB.prepare(`INSERT INTO projects (id, owner_id, title, status, aspect, resolution, generation_engine, target_duration, final_history_id, created_at, updated_at) VALUES (?, ?, ?, 'completed', ?, ?, 'studio', ?, ?, ?, ?)`).bind(projectId, customer.id, title, aspect, source.resolution || "1080p", target, newHistoryId, now, now),
        env.DB.prepare(`INSERT INTO notifications (id, owner_id, type, title, message, created_at) VALUES (?, ?, 'delivery.ready', ?, ?, ?)`).bind(crypto.randomUUID(), customer.id, "Your video is ready", `${title} is ready to preview and download.`, now),
      ]);
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }
    await sendAccountEmail(env, customer.id, "Your MotionWren video is ready", `${title} is saved in your MotionWren dashboard and ready to download.`);
    await audit(env, admin.id, "history.delivered", "project", projectId, { historyId: newHistoryId, to: customer.id });
    return Response.json({ ok: true, projectId, to: customer.email }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
