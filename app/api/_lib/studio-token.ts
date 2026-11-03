import { cookies } from "next/headers";

/* The engine key for the owner's Studio: the server's own key, or the one the
   owner connected in this browser. */
export async function studioToken() {
  const store = await cookies();
  return process.env.REPLICATE_API_TOKEN || store.get("wan_replicate_token")?.value || "";
}
