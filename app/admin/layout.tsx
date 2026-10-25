import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon } from "../ui-icon";
import { requireAdmin } from "../api/_lib/account";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
  } catch {
    redirect("/dashboard");
  }
  return <div className="admin-layout"><div className="admin-nav-shell"><Link className="admin-nav-brand" href="/"><span className="brand-mark">MW</span><span>MotionWren Manager</span></Link><nav aria-label="Manager navigation"><Link href="/admin"><Icon name="dashboard" size={15}/>Dashboard</Link><Link href="/admin/customers"><Icon name="user" size={15}/>Customers</Link><Link href="/admin#orders"><Icon name="orders" size={15}/>Projects</Link><Link href="/studio"><Icon name="studio" size={15}/>Studio</Link><Link href="/admin/replicates"><Icon name="motion" size={15}/>Replicates</Link></nav><a className="admin-google-logout" href="/api/auth/logout">Sign out</a></div>{children}</div>;
}
