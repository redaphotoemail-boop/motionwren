"use client";

import { useEffect, useState } from "react";

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

/* After a package is created, make it visible: on the dashboard reload the
   list, anywhere else go to the dashboard. Creating without showing anything
   looked like nothing happened. */
function showCreated() {
  if (window.location.pathname === "/dashboard") window.location.reload();
  else window.location.assign("/dashboard");
}

/* Listens for the content-package flow's mw:package event (dispatched on
   window by the studio loader) and creates the order as a project. */
export default function MwPackageListener() {
  const [error, setError] = useState<string | null>(null);

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
        showCreated();
      } catch {
        /* Offline — keep it for the next visit. */
      }
    }

    async function onPackage(event: Event) {
      const detail = (event as CustomEvent<PackageDetail>).detail || {};
      const pkg = normalize(detail);
      try {
        const res = await createOrder(pkg);
        if (res.ok) {
          setError(null);
          showCreated();
          return;
        }
        if (res.status === 401) {
          // Not signed in yet: save the package, then send them to sign-in.
          // After login they land on the dashboard and the saved package is created.
          try {
            window.localStorage.setItem(PENDING_KEY, JSON.stringify(pkg));
          } catch {
            /* Storage unavailable — the package cannot be carried across sign-in. */
          }
          window.location.assign("/signin");
          return;
        }
        // Any other failure used to fail silently, which looked like nothing
        // happened. Surface it instead, with a way to try again.
        let message = "Couldn't create your package. Please try again.";
        if (res.status === 429) message = "Too many requests — please wait a bit and try again.";
        else {
          try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data.error === "string" && data.error) message = data.error;
          } catch {
            /* Keep the generic message. */
          }
        }
        setError(message);
      } catch {
        setError("Couldn't reach MotionWren. Check your connection and try again.");
      }
    }

    void flushPending();
    window.addEventListener("mw:package", onPackage);
    return () => window.removeEventListener("mw:package", onPackage);
  }, []);

  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: "calc(100vw - 32px)",
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: "12px 16px",
        boxShadow: "0 8px 30px rgba(0,0,0,.12)",
        fontSize: 14,
        lineHeight: 1.4,
        color: "#111",
      }}
    >
      <span>{error}</span>
      <button
        type="button"
        onClick={() => {
          setError(null);
          const studio = (window as unknown as { MotionWrenStudio?: { open?: (flow: string) => void } }).MotionWrenStudio;
          if (studio?.open) studio.open("plan");
        }}
        style={{ border: 0, background: "none", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}
      >
        Try again
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setError(null)}
        style={{ border: 0, background: "none", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
