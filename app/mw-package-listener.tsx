"use client";

import { useEffect } from "react";

type PackageItem = { title?: unknown; price?: unknown };
type PackageDetail = { items?: unknown; answers?: unknown; total?: unknown };

/* Listens for the content-package flow's mw:package event (dispatched on
   window by the studio loader) and creates the order as a project. */
export default function MwPackageListener() {
  useEffect(() => {
    async function onPackage(event: Event) {
      const detail = (event as CustomEvent<PackageDetail>).detail || {};
      const items = Array.isArray(detail.items) ? (detail.items as PackageItem[]) : [];
      const answers = (detail.answers || {}) as { goal?: string; prop?: string; channels?: string[]; vibe?: string };
      const total = typeof detail.total === "number" ? detail.total : items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const summary = [
        ...items.map((item) => String(item.title || "")),
        answers.goal ? `Goal: ${answers.goal}` : "",
        answers.channels?.length ? `Channels: ${answers.channels.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 280);
      try {
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Content package", price: String(total), shortMessage: summary }),
        });
      } catch {
        /* Not signed in or offline — the package stays a demo until the next visit. */
      }
    }
    window.addEventListener("mw:package", onPackage);
    return () => window.removeEventListener("mw:package", onPackage);
  }, []);
  return null;
}
