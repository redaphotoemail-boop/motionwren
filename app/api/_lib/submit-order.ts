/* Submitting a customer's draft order: one place for the rules, used by the
   customer's own submit (projects/[id] PATCH) and by the Stripe webhook once
   a film has been paid for (so a paid order never waits on the browser).

   With billing connected, a customer order needs a credit plus anything
   above the 20 seconds a credit covers. Paid in full: one credit is
   reserved and the order becomes "submitted". Not yet paid: the quote is
   returned so the caller can send the customer to one checkout. */

import { audit } from "./account";
import { filmQuote, type FilmQuote } from "./film-checkout";
import { holdForApproval, loadOrder, needsApproval, startOrder } from "./customer-production";

type Env = { DB: D1Database; BUCKET: R2Bucket };

export type SubmitResult =
  | { ok: true; status: string; updatedAt: number }
  | { ok: false; reason: "photos" | "payment" | "credit"; quote?: FilmQuote; photos?: number };

export async function submitOrder(env: Env, account: { id: string; role: string }, projectId: string): Promise<SubmitResult> {
  const project = await env.DB.prepare(`SELECT status, target_duration AS targetDuration, updated_at AS updatedAt FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(projectId, account.id).first<{ status: string; targetDuration: number; updatedAt: number }>();
  if (!project) return { ok: false, reason: "photos", photos: 0 };
  if (project.status !== "draft") return { ok: true, status: project.status, updatedAt: project.updatedAt };
  const assets = await env.DB.prepare(`SELECT COUNT(*) AS count FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(projectId, account.id).first<{ count: number }>();
  const photos = assets?.count || 0;
  if (photos < 2) return { ok: false, reason: "photos", photos };
  if (process.env.STRIPE_SECRET_KEY && account.role !== "admin") {
    const balance = await env.DB.prepare(`SELECT credit_balance AS balance FROM users WHERE id = ?`).bind(account.id).first<{ balance: number }>();
    const quote = await filmQuote(env, { id: projectId, targetDuration: Number(project.targetDuration) || 0 }, photos, (balance?.balance || 0) > 0);
    if (quote.payNow > 0) return { ok: false, reason: "payment", quote, photos };
    // The credit and its ledger row change together, and only while the order is still a draft.
    const now = Date.now();
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET credit_balance = credit_balance - 1, updated_at = ? WHERE id = ? AND credit_balance > 0 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND status = 'draft') AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key = ?)`).bind(now, account.id, projectId, account.id, `project:${projectId}:reservation`),
      env.DB.prepare(`INSERT INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) SELECT ?, ?, ?, NULL, -1, 'project_reservation', ?, 'Reserved when project entered production', ? WHERE changes() > 0`).bind(crypto.randomUUID(), account.id, projectId, `project:${projectId}:reservation`, now),
    ]);
    const reserved = (results[0]?.meta?.changes || 0) > 0;
    if (!reserved) {
      const already = await env.DB.prepare(`SELECT 1 AS x FROM credit_ledger WHERE idempotency_key = ? LIMIT 1`).bind(`project:${projectId}:reservation`).first();
      if (!already) return { ok: false, reason: "credit", photos };
    }
  }
  const now = Date.now();
  // Photos are locked from here on (assets routes accept changes on drafts only), so the length paid for is the length made.
  await env.DB.prepare(`UPDATE projects SET status = 'submitted', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'draft'`).bind(now, projectId, account.id).run();
  await audit(env, account.id, "project.submitted", "project", projectId, { assetCount: photos });
  return { ok: true, status: "submitted", updatedAt: now };
}

/* Heartbeat step: paid customer orders that are submitted but not started
   (paid on Stripe, or the customer closed the page before production
   began) are started here, a few per minute, oldest first. Only with
   billing connected, and only orders that hold a reserved credit. */
export async function startPaidOrders(env: Env, origin: string, limit = 3): Promise<number> {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.REPLICATE_API_TOKEN) return 0;
  const rows = await env.DB.prepare(`SELECT p.id, p.owner_id AS ownerId, u.role FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.status = 'submitted' AND p.updated_at < ? AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.project_id = p.id AND l.type = 'project_reservation') ORDER BY p.updated_at ASC LIMIT ?`).bind(Date.now() - 45 * 1000, limit).all<{ id: string; ownerId: string; role: string }>();
  for (const row of rows.results) await startPaidOrder(env, row.ownerId, row.role, row.id, origin);
  return rows.results.length;
}

/* After a paid submit: start production, or wait for the manager's OK when
   that is the setting. Never throws; the order stays submitted for the
   manager to start if anything goes wrong. */
export async function startPaidOrder(env: Env, ownerId: string, role: string, projectId: string, origin: string): Promise<string> {
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    const project = await loadOrder(env, projectId, ownerId);
    if (!project) return "missing";
    if (!["submitted", "failed"].includes(project.status)) return project.status;
    if (!token || await needsApproval(env, role)) return (await holdForApproval(env, project, ownerId)).status;
    return (await startOrder(env, project, ownerId, origin, token)).status;
  } catch {
    return "held";
  }
}
