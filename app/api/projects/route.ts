import { audit, jsonError, requireAccount } from "../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    const result = await env.DB.prepare(`SELECT p.id, p.title, p.status, p.listing_url AS listingUrl, p.listing_address AS listingAddress, p.beds, p.baths, p.square_feet AS squareFeet, p.price, p.short_message AS shortMessage, p.aspect, p.resolution, p.generation_engine AS generationEngine, p.target_duration AS targetDuration, p.created_at AS createdAt, p.updated_at AS updatedAt, p.final_history_id AS finalHistoryId, COUNT(a.id) AS assetCount FROM projects p LEFT JOIN project_assets a ON a.project_id = p.id WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 100`).bind(account.id).all();
    return Response.json({ projects: result.results });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    const body = await request.json() as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (title.length < 2) return Response.json({ error: "Add a project or property name." }, { status: 400 });
    const id = crypto.randomUUID(); const now = Date.now();
    const value = (key: string, max = 160) => typeof body[key] === "string" ? String(body[key]).trim().slice(0, max) || null : null;
    const aspect = ["horizontal", "vertical", "cinematic"].includes(String(body.aspect)) ? String(body.aspect) : "horizontal";
    const generationEngine = body.generationEngine === "fast" ? "fast" : "studio";
    const resolution = generationEngine === "fast" ? "720p" : "1080p";
    const targetDuration = [20, 30, 50].includes(Number(body.targetDuration)) ? Number(body.targetDuration) : 20;
    await env.DB.prepare(`INSERT INTO projects (id, owner_id, title, status, listing_url, listing_address, beds, baths, square_feet, price, short_message, aspect, resolution, generation_engine, target_duration, agent_name, agent_email, agent_phone, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, account.id, title, value("listingUrl", 1000), value("listingAddress", 240), value("beds", 12), value("baths", 12), value("squareFeet", 20), value("price", 30), value("shortMessage", 280), aspect, resolution, generationEngine, targetDuration, value("agentName"), value("agentEmail"), value("agentPhone"), now, now).run();
    await audit(env, account.id, "project.created", "project", id, { title, generationEngine, resolution, targetDuration });
    return Response.json({ project: { id, title, status: "draft", assetCount: 0, aspect, resolution, generationEngine, targetDuration, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
