import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HttpError, requireAdmin } from "../api/_lib/account";
import ManagerShell from "../admin/manager-shell";

export const metadata: Metadata = { title: "Studio", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/signin");
    redirect("/dashboard");
  }
  return <ManagerShell>{children}</ManagerShell>;
}
