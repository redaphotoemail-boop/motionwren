import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HttpError, requireAccount } from "../api/_lib/account";

export const metadata: Metadata = { title: "Your orders", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAccount(env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/signin");
    throw error;
  }
  return children;
}
