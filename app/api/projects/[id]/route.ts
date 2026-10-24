import { audit, jsonError, requireAccount } from "../../_lib/account";

async function ownedProject(env: { DB: D1Database }, id: string, ownerId: string) {
  return env.DB.prepare(`SELECT id, title, status, listing_url AS listingUrl, listing_address AS listingAddress, beds, baths, square_feet AS squareFeet, price, short_message AS shortMessage, aspect, resolution, generation_engine AS generationEngine, target_duration AS targetDuration, final_history_id AS finalHistoryId, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, ownerId).first();
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env);
    const project = await ownedProject(env, id, account.id); if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const assets = await env.DB.prepare(`SELECT id, kind, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder, created_at AS createdAt FROM project_assets WHERE project_id = ? AND owner_id = ? ORDER BY sort_order, created_at`).bind(id, account.id).all();
    return Response.json({ project: { ...project, assets: assets.results } });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env);
    const project = await ownedProject(env, id, account.id); if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const assets = await env.DB.prepare(`SELECT r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id).all<{ r2Key: string }>();
    await Promise.all(assets.results.map((asset) => env.BUCKET.delete(asset.r2Key)));
    await env.DB.batch([env.DB.prepare(`DELETE FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id), env.DB.prepare(`DELETE FROM projects WHERE id = ? AND owner_id = ?`).bind(id, account.id)]);
    await audit(env, account.id, "project.deleted", "project", id);
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env);
    const project = await ownedProject(env, id, account.id); if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "submit") return Response.json({ error: "Unsupported project action." }, { status: 400 });
    if (project.status !== "draft") return Response.json({ ok: true, status: project.status, updatedAt: project.updatedAt });
    const assets = await env.DB.prepare(`SELECT COUNT(*) AS count FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id).first<{ count: number }>();
    if ((assets?.count || 0) < 2) return Response.json({ error: "Upload at least two ordered photographs before submitting." }, { status: 409 });
    const billingEnforced = Boolean(process.env.STRIPE_SECRET_KEY);
    if (billingEnforced && account.role !== "admin") {
      const debit = await env.DB.prepare(`UPDATE users SET credit_balance = credit_balance - 1, updated_at = ? WHERE id = ? AND credit_balance > 0`).bind(Date.now(), account.id).run();
      if (!debit.meta.changes) return Response.json({ error: "A video credit is required before this project can enter production.", billingRequired: true }, { status: 402 });
      try {
        await env.DB.prepare(`INSERT INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, NULL, -1, 'project_reservation', ?, 'Reserved when project entered production', ?)`).bind(crypto.randomUUID(), account.id, id, `project:${id}:reservation`, Date.now()).run();
      } catch (error) {
        await env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + 1, updated_at = ? WHERE id = ?`).bind(Date.now(), account.id).run();
        throw error;
      }
    }
    const now = Date.now(); await env.DB.prepare(`UPDATE projects SET status = 'submitted', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, id, account.id).run();
    await audit(env, account.id, "project.submitted", "project", id, { assetCount: assets?.count || 0 });
    return Response.json({ ok: true, status: "submitted", updatedAt: now });
  } catch (error) { return jsonError(error); }
}
