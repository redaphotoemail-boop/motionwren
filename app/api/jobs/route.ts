import { NextResponse } from "next/server";
import { isOwnerRequest } from "../../owner-auth";

const PACKAGES = new Map([[20, 5], [35, 10], [50, 15]]);
const STYLES = new Set(["classic", "social", "luxury"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const body = await request.json() as Record<string, unknown>;
    const clientName = clean(body.clientName, 100);
    const clientEmail = clean(body.clientEmail, 160).toLowerCase();
    const businessName = clean(body.businessName, 140);
    const projectName = clean(body.projectName, 160);
    const notes = clean(body.notes, 1200);
    const packageSeconds = Number(body.packageSeconds);
    const style = clean(body.style, 20);
    if (!clientName || !clientEmail.includes("@") || !businessName || !projectName || !PACKAGES.has(packageSeconds) || !STYLES.has(style)) {
      return NextResponse.json({ error: "Check your contact, project and video selections." }, { status: 400 });
    }
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO client_jobs (id, upload_token_hash, client_name, client_email, business_name, project_name, package_seconds, style, notes, status, photo_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 0, ?, ?)`)
      .bind(id, await hashToken(token), clientName, clientEmail, businessName, projectName, packageSeconds, style, notes, now, now).run();
    return NextResponse.json({ id, uploadToken: token, requiredPhotos: PACKAGES.get(packageSeconds) });
  } catch {
    return NextResponse.json({ error: "We could not start this project. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  try {
    const { env } = await import("cloudflare:workers");
    const jobs = await env.DB.prepare(`SELECT id, client_name AS clientName, client_email AS clientEmail, business_name AS businessName, project_name AS projectName, package_seconds AS packageSeconds, style, notes, status, photo_count AS photoCount, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM client_jobs ORDER BY created_at DESC LIMIT 200`).all();
    return NextResponse.json({ jobs: jobs.results });
  } catch {
    return NextResponse.json({ error: "The production queue could not be loaded." }, { status: 500 });
  }
}
