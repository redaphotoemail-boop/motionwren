import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { isOwnerRequest } from "../../../../owner-auth";

function safeName(value: string) {
  return value.replace(/[^a-z0-9._ -]+/gi, "").replace(/\s+/g, "-").slice(0, 80) || "project";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isOwnerRequest())) return Response.json({ error: "Owner access required." }, { status: 401 });
  const { env } = await import("cloudflare:workers");
  const { id } = await context.params;
  const job = await env.DB.prepare(`SELECT id, client_name AS clientName, client_email AS clientEmail, business_name AS businessName, project_name AS projectName, package_seconds AS packageSeconds, style, notes, status, photo_count AS photoCount, created_at AS createdAt FROM client_jobs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!job) return Response.json({ error: "Project not found." }, { status: 404 });
  const assets = await env.DB.prepare(`SELECT r2_key AS r2Key, file_name AS fileName, position FROM job_assets WHERE job_id = ? ORDER BY position`).bind(id).all<{ r2Key: string; fileName: string; position: number }>();
  const brief = [
    "MOTIONWREN — CLIENT PROJECT", "",
    `Project reference: ${String(job.id).slice(0, 8).toUpperCase()}`,
    `Submitted: ${new Date(Number(job.createdAt)).toISOString()}`,
    `Status: ${job.status}`, "", "CLIENT",
    `Name: ${job.clientName}`,
    `Email: ${job.clientEmail}`,
    `Business / agency: ${job.businessName}`, "", "VIDEO",
    `Property / project: ${job.projectName}`,
    `Length: ${job.packageSeconds} seconds`,
    `Direction: ${job.style}`,
    `Photos: ${job.photoCount}`, "", "NOTES / LINKS",
    String(job.notes || "None provided"), "",
  ].join("\n");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      void (async () => {
        try {
          const briefFile = new ZipPassThrough("PROJECT-BRIEF.txt");
          zip.add(briefFile);
          briefFile.push(strToU8(brief), true);
          for (const asset of assets.results) {
            const object = await env.BUCKET.get(asset.r2Key);
            if (!object) throw new Error(`Missing source photo ${asset.position + 1}`);
            const originalExtension = asset.fileName.includes(".") ? asset.fileName.split(".").pop() : "jpg";
            const file = new ZipPassThrough(`${String(asset.position + 1).padStart(2, "0")}-${safeName(asset.fileName.replace(/\.[^.]+$/, ""))}.${safeName(originalExtension || "jpg")}`);
            zip.add(file);
            file.push(new Uint8Array(await new Response(object.body).arrayBuffer()), true);
          }
          zip.end();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
  });
  const archiveName = `${safeName(String(job.projectName))}-${String(job.id).slice(0, 8)}.zip`;
  return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${archiveName}"`, "Cache-Control": "private, no-store" } });
}
