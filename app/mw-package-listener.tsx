"use client";

import { useEffect } from "react";

type PackageItem = { title?: unknown; price?: unknown };
type PackageDetail = { items?: unknown; answers?: unknown; total?: unknown };
type SavedItem = { title: string; price: number };
type SavedAnswers = { goal?: string; prop?: string; channels?: string[]; vibe?: string };
type SavedPackage = { items: SavedItem[]; answers: SavedAnswers; total: number };

/* Login happens at the end, not upfront: a visitor can walk the whole plan
   flow without signing in. Only pressing Create while signed out sends them
   to sign-in — the package is saved first, then created automatically once
   they land back on the dashboard. */
const PENDING_KEY = "mw:pending-package";

function normalize(detail: PackageDetail): SavedPackage {
  const items = Array.isArray(detail.items) ? (detail.items as PackageItem[]) : [];
  const answers = (detail.answers || {}) as SavedAnswers;
  return {
    items: items.map((item) => ({ title: String(item.title || ""), price: Number(item.price) || 0 })),
    answers: {
      goal: answers.goal,
      prop: answers.prop,
      channels: Array.isArray(answers.channels) ? answers.channels.map(String) : [],
      vibe: answers.vibe,
    },
    total: typeof detail.total === "number" ? detail.total : items.reduce((sum, item) => sum + (Number(item.price) || 0), 0),
  };
}

function summarize(pkg: SavedPackage): string {
  return [
    ...pkg.items.map((item) => item.title),
    pkg.answers.goal ? `Goal: ${pkg.answers.goal}` : "",
    pkg.answers.channels?.length ? `Channels: ${pkg.answers.channels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 280);
}

function createOrder(pkg: SavedPackage): Promise<Response> {
  return fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Content package", price: String(pkg.total), shortMessage: summarize(pkg) }),
  });
}

/* Listens for the content-package flow's mw:package event (dispatched on
   window by the studio loader) and creates the order as a project. */
export default function MwPackageListener() {
  useEffect(() => {
    async function flushPending() {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(PENDING_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      let pending: SavedPackage;
      try {
        pending = JSON.parse(raw) as SavedPackage;
      } catch {
        try {
          window.localStorage.removeItem(PENDING_KEY);
        } catch {
          /* Storage unavailable — nothing to clear. */
        }
        return;
      }
      try {
        const res = await createOrder(pending);
        if (!res.ok) return; // Still signed out or failing — keep it for the next visit.
        try {
          window.localStorage.removeItem(PENDING_KEY);
        } catch {
          /* Storage unavailable — the order is already created. */
        }
        if (window.location.pathname === "/dashboard") window.location.reload();
      } catch {
        /* Offline — keep it for the next visit. */
      }
    }

    async function onPackage(event: Event) {
      const detail = (event as CustomEvent<PackageDetail>).detail || {};
      const pkg = normalize(detail);
      try {
        const res = await createOrder(pkg);
        if (res.ok) return;
        if (res.status === 401) {
          // Not signed in yet: save the package, then send them to sign-in.
          // After login they land on the dashboard and the saved package is created.
          try {
            window.localStorage.setItem(PENDING_KEY, JSON.stringify(pkg));
          } catch {
            /* Storage unavailable — the package cannot be carried across sign-in. */
          }
          window.location.assign("/signin");
        }
        // Any other failure: the package stays a demo (existing behavior).
      } catch {
        /* Offline — the package stays a demo. */
      }
    }

    void flushPending();
    window.addEventListener("mw:package", onPackage);
    return () => window.removeEventListener("mw:package", onPackage);
  }, []);
  return null;
}
