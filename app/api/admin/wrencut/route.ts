/* WrenCut admin: the template list, the reading's progress, template switches. Admin only. */
import { isEngineKey } from "../../../engine-providers";
import { studioEngine } from "../../../engine-catalog";
import { jsonError, requireAdmin } from "../../_lib/account";
import { deleteTemplate, listTemplates, readState, renameTemplate, setActive, setEngine } from "../../_lib/wrencut";

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const job = new URL(request.url).searchParams.get("job");
    if (job) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(job)) return Response.json({ error: "Unknown reading." }, { status: 400 });
      return Response.json(await readState(env, job));
    }
    return Response.json({ templates: await listTemplates(env) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { action?: unknown; id?: unknown; active?: unknown; name?: unknown; engine?: unknown };
    const id = typeof body.id === "string" ? body.id.replace(/^wren:/, "") : "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Unknown template." }, { status: 400 });
    if (body.action === "active" && typeof body.active === "boolean") await setActive(env, id, body.active);
    else if (body.action === "engine") {
      if (body.engine === "" || body.engine === null) await setEngine(env, id, null);
      else if (isEngineKey(body.engine) && !studioEngine(body.engine).unavailable && !studioEngine(body.engine).photoMove) await setEngine(env, id, body.engine);
      else return Response.json({ error: "Choose a video engine from the list." }, { status: 400 });
    }
    else if (body.action === "rename" && typeof body.name === "string") await renameTemplate(env, id, body.name);
    else if (body.action === "delete") await deleteTemplate(env, id);
    else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ templates: await listTemplates(env) });
  } catch (error) { return jsonError(error); }
}
