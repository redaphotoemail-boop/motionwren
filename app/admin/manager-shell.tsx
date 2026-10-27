"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icon, type IconName } from "../ui-icon";
import { WrenMark } from "../components/brand";

const links: Array<{ href: string; label: string; icon: IconName; match: (path: string) => boolean }> = [
  { href: "/admin", label: "Overview", icon: "dashboard", match: (path) => path === "/admin" },
  { href: "/admin/orders", label: "Orders", icon: "orders", match: (path) => path.startsWith("/admin/orders") || path.startsWith("/admin/projects") },
  { href: "/admin/customers", label: "Customers", icon: "user", match: (path) => path.startsWith("/admin/customers") },
  { href: "/admin/engines", label: "Engines", icon: "motion", match: (path) => path.startsWith("/admin/engines") },
  { href: "/admin/replicates", label: "Spend", icon: "money", match: (path) => path.startsWith("/admin/replicates") },
  { href: "/studio", label: "Studio", icon: "studio", match: (path) => path.startsWith("/studio") },
];

/* Owner-only navigation shared by every manager page and the Studio. */
export default function ManagerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/admin";
  useEffect(() => {
    // On phones the nav scrolls sideways; keep the current page's tab in view.
    document.querySelector(".mgr-nav a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  return (
    <div className="mgr">
      <aside className="mgr-side">
        <Link href="/admin" className="mgr-brand" aria-label="MotionWren Manager">
          <WrenMark size={30} />
          <span><strong>MotionWren</strong><small>Manager</small></span>
        </Link>
        <nav className="mgr-nav" aria-label="Manager navigation">
          {links.map((link) => {
            const active = link.match(pathname);
            return <Link key={link.href} href={link.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon name={link.icon} size={17} />{link.label}</Link>;
          })}
        </nav>
        <div className="mgr-side-foot">
          <Link href="/dashboard"><Icon name="projects" size={16} />Customer view</Link>
          <a href="/api/auth/logout"><Icon name="sign-in" size={16} />Sign out</a>
        </div>
      </aside>
      <div className="mgr-main">{children}</div>
    </div>
  );
}
