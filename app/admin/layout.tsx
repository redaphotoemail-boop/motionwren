import { redirect } from "next/navigation";
import { requireAdmin } from "../api/_lib/account";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
  } catch {
    redirect("/dashboard");
  }
  return children;
}
