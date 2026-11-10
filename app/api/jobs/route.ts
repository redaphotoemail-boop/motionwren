import { NextResponse } from "next/server";
import { isOwnerRequest } from "../../owner-auth";

/* The old public intake (photos sent by link, no account) is retired: it let
   anyone create jobs and store photos without signing in. Customers now
   order through the create-video flow with an account. Owner reads remain. */
export async function POST() {
  return NextResponse.json({ error: "This order form has moved. Create your video at motionwren.com." }, { status: 410 });
}

export async function GET() {
  const { env } = await import("cloudflare:workers");
  if (!(await isOwnerRequest(env))) return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  try {
    const jobs = await env.DB.prepare(`SELECT id, client_name AS clientName, client_email AS clientEmail, business_name AS businessName, project_name AS projectName, package_seconds AS packageSeconds, style, notes, status, photo_count AS photoCount, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM client_jobs ORDER BY created_at DESC LIMIT 200`).all();
    return NextResponse.json({ jobs: jobs.results });
  } catch {
    return NextResponse.json({ error: "The production queue could not be loaded." }, { status: 500 });
  }
}
