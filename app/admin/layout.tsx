import { redirect } from "next/navigation";
import { HttpError, requireAdmin } from "../api/_lib/account";
import ManagerShell from "./manager-shell";

/* Manager pages: /admin, /admin/orders, /admin/customers, /admin/engines,
   /admin/replicates and /admin/projects/*. /studio shares the same shell. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/signin");
    redirect("/dashboard");
  }
  return <ManagerShell>{children}</ManagerShell>;
}
