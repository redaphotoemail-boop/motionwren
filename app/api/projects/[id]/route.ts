import { createFilmCheckout } from "../../_lib/film-checkout";
import { submitOrder } from "../../_lib/submit-order";
import { audit, jsonError, requireAccount } from "../../_lib/account";
import { dropMusicChoiceStatement } from "../../_lib/customer-production";
import { deleteJobFiles } from "../../_lib/production";

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
    const project = await ownedProject(env, id, account.id) as { status?: string; finalHistoryId?: string | null } | null; if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const job = await env.DB.prepare(`SELECT render_job_id AS jobId FROM projects WHERE id = ? AND owner_id = ?`).bind(id, account.id).first<{ jobId: string | null }>();
    // While a video is being made the engines are still reading its photos and
    // the finished film would land nowhere; deleting then only wasted the spend.
    if (["queued", "generating", "stitching", "saving"].includes(String(project.status))) return Response.json({ error: "This video is being made right now. You can delete it once it is finished." }, { status: 409 });
    const assets = await env.DB.prepare(`SELECT r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id).all<{ r2Key: string }>();
    // "Delete" removes the finished video too, not only the photos.
    const video = project.finalHistoryId ? await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id = ?`).bind(project.finalHistoryId, account.id).first<{ r2Key: string }>() : null;
    // Earlier versions of the film (a re-made scene) and the job's working files go too.
    const versions = job?.jobId ? await env.DB.prepare(`SELECT id, r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id = ?`).bind(job.jobId, account.id).all<{ id: string; r2Key: string }>() : { results: [] as { id: string; r2Key: string }[] };
    await Promise.all([...assets.results.map((asset) => env.BUCKET.delete(asset.r2Key)), ...(video ? [env.BUCKET.delete(video.r2Key)] : []), ...versions.results.map((version) => env.BUCKET.delete(version.r2Key))]);
    if (job?.jobId) await deleteJobFiles(env, job.jobId).catch(() => undefined);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id),
      ...(project.finalHistoryId ? [env.DB.prepare(`DELETE FROM generation_history WHERE id = ? AND owner_id = ?`).bind(project.finalHistoryId, account.id)] : []),
      ...(job?.jobId ? [env.DB.prepare(`DELETE FROM generation_history WHERE id = ? AND owner_id = ?`).bind(job.jobId, account.id), env.DB.prepare(`DELETE FROM render_jobs WHERE id = ? AND owner_id = ?`).bind(job.jobId, account.id)] : []),
      env.DB.prepare(`DELETE FROM projects WHERE id = ? AND owner_id = ?`).bind(id, account.id),
      dropMusicChoiceStatement(env, id),
    ]);
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
    const result = await submitOrder(env, account, id);
    if (result.ok) return Response.json(result);
    if (result.reason === "photos") return Response.json({ error: "Upload at least two ordered photographs before submitting." }, { status: 409 });
    if (result.reason === "payment" && result.quote) {
      // Longer than 20 seconds (or no credit yet): one checkout for the part above the credit, so nobody is left at a dead end.
      const quote = result.quote;
      const url = await createFilmCheckout({ secret: process.env.STRIPE_SECRET_KEY as string, origin: new URL(request.url).origin, ownerId: account.id, email: account.email, projectId: id, title: String((project as { title?: string }).title || "Film"), quote });
      const message = url ? `This ${quote.seconds}-second film is $${(quote.cents / 100).toFixed(0)}. Pay $${(quote.payNow / 100).toFixed(0)} to start it.` : "We couldn't open checkout just now. Your order is saved; please try again in a moment.";
      return Response.json({ error: message, billingRequired: true, checkoutUrl: url, quote }, { status: 402 });
    }
    return Response.json({ error: "A video credit is required before this project can enter production.", billingRequired: true }, { status: 402 });
  } catch (error) { return jsonError(error); }
}
