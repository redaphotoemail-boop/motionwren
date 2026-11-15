import { jsonError, requireAdmin } from "../../_lib/account";
import { editorBuild } from "../../_lib/composer";

/* Manager only, read-only: which editor code a brand-new editing container is running (its build marker and ffmpeg).
   Used to confirm a deploy actually reached the editor, which a film's output alone cannot show. */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return Response.json(await editorBuild(env));
  } catch (error) { return jsonError(error); }
}
