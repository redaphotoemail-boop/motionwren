import { redirect } from "next/navigation";
import { HttpError, requireAdmin } from "../api/_lib/account";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/api/auth/google");
    redirect("/dashboard");
  }
  return children;
}
