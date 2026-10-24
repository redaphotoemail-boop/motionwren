import { jsonError, requireAccount } from "../../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    const [projects, history, subscriptions, payments, credits, notifications] = await Promise.all([
      env.DB.prepare(`SELECT id, title, status, listing_url AS listingUrl, listing_address AS listingAddress, beds, baths, square_feet AS squareFeet, price, short_message AS shortMessage, aspect, resolution, generation_engine AS generationEngine, target_duration AS targetDuration, agent_name AS agentName, agent_email AS agentEmail, agent_phone AS agentPhone, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
      env.DB.prepare(`SELECT id, prompt, engine, category, resolution, aspect, duration, cost_cents AS costCents, size_bytes AS sizeBytes, created_at AS createdAt FROM generation_history WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
      env.DB.prepare(`SELECT plan, status, current_period_end AS currentPeriodEnd, cancel_at_period_end AS cancelAtPeriodEnd, created_at AS createdAt FROM subscriptions WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
      env.DB.prepare(`SELECT plan, amount_cents AS amountCents, currency, status, created_at AS createdAt FROM payments WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
      env.DB.prepare(`SELECT project_id AS projectId, render_job_id AS renderJobId, amount, type, note, created_at AS createdAt FROM credit_ledger WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
      env.DB.prepare(`SELECT type, title, message, read_at AS readAt, created_at AS createdAt FROM notifications WHERE owner_id = ? ORDER BY created_at DESC`).bind(account.id).all(),
    ]);
    return Response.json({ exportedAt: new Date().toISOString(), account, projects: projects.results, history: history.results, subscriptions: subscriptions.results, payments: payments.results, credits: credits.results, notifications: notifications.results }, { headers: { "Content-Disposition": `attachment; filename="frame-motion-data.json"`, "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
