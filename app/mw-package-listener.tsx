"use client";

import { useEffect, useState } from "react";

/* Seamless production: pressing Create in the plan flow starts everything.
   The plan sends its photos (data URLs, display order) with the event, and
   this listener creates one project per VIDEO deliverable, uploads the same
   photos to each, then submits and generates — no second click from the
   customer. Graphic pieces (Feed post set, announcement graphics, cover
   image) have no production endpoint, so they are listed in each video
   project's summary as included pieces for manual delivery, never
   auto-generated.

   Signed-out visitors: localStorage (~5MB) cannot hold photos, so the
   pending package lives in IndexedDB instead. It survives sign-in, and the
   pipeline resumes from its recorded stage — a retry never re-creates a
   project that already exists. */

type PackageItem = { title?: unknown; price?: unknown; icon?: unknown; kind?: unknown };
type PackageDetail = { items?: unknown; answers?: unknown; total?: unknown; photos?: unknown };
type SavedItem = { title: string; price: number; icon: string; kind: "video" | "graphic" };
type SavedAnswers = { goal?: string; prop?: string; channels?: string[]; vibe?: string };
type VideoStage = "new" | "created" | "uploaded" | "submitted" | "generating";
type VideoEntry = { title: string; price: number; icon: string; aspect: "horizontal" | "vertical"; targetDuration: number; projectId: string | null; stage: VideoStage; error?: string };
type SavedPackage = { items: SavedItem[]; answers: SavedAnswers; total: number; photos: string[]; video: VideoEntry[]; graphics: string[]; attempted: boolean };

const PENDING_KEY = "mw:pending-package";
const IDB_NAME = "motionwren";
const IDB_STORE = "pendingPackages";
const IDB_KEY = "current";
const VIDEO_ICONS = new Set(["video", "reel", "story"]);

function classify(item: PackageItem): "video" | "graphic" {
  if (item.kind === "video" || item.kind === "graphic") return item.kind;
  return VIDEO_ICONS.has(String(item.icon || "")) ? "video" : "graphic";
}

function normalize(detail: PackageDetail): SavedPackage {
  const items = Array.isArray(detail.items) ? (detail.items as PackageItem[]) : [];
  const answers = (detail.answers || {}) as SavedAnswers;
  const saved: SavedItem[] = items.map((item) => ({ title: String(item.title || ""), price: Number(item.price) || 0, icon: String(item.icon || ""), kind: classify(item) }));
  const photos = Array.isArray(detail.photos) ? (detail.photos as unknown[]).filter((src): src is string => typeof src === "string" && src.startsWith("data:image/")).slice(0, 20) : [];
  const video: VideoEntry[] = saved.filter((item) => item.kind === "video").map((item) => ({
    title: item.title,
    price: item.price,
    icon: item.icon,
    aspect: item.icon === "reel" || item.icon === "story" ? "vertical" : "horizontal",
    targetDuration: item.icon === "reel" || item.icon === "story" ? 20 : answers.prop === "estate" ? 50 : 30,
    projectId: null,
    stage: "new" as VideoStage,
  }));
  return {
    items: saved,
    answers: {
      goal: answers.goal,
      prop: answers.prop,
      channels: Array.isArray(answers.channels) ? answers.channels.map(String) : [],
      vibe: answers.vibe,
    },
    total: typeof detail.total === "number" ? detail.total : saved.reduce((sum, item) => sum + item.price, 0),
    photos,
    video,
    graphics: saved.filter((item) => item.kind === "graphic").map((item) => item.title).filter(Boolean),
    attempted: false,
  };
}

function summarizeItem(pkg: SavedPackage, title: string): string {
  return [
    title,
    pkg.graphics.length ? `Includes: ${pkg.graphics.join(", ")}` : "",
    pkg.answers.goal ? `Goal: ${pkg.answers.goal}` : "",
    pkg.answers.channels?.length ? `Channels: ${pkg.answers.channels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 280);
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

async function errorText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    /* Fall through to the status-based message. */
  }
  if (res.status === 429) return "Too many requests — please wait a bit and try again.";
  return "Couldn't create your package. Please try again.";
}

function dataUrlToFile(src: string, name: string): File | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(src);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
    return new File([bytes], `${name}.${extension}`, { type: match[1] });
  } catch {
    return null;
  }
}

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(): Promise<SavedPackage | null> {
  const db = await openIdb();
  if (!db) return null;
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = value as (SavedPackage & { id?: string }) | undefined;
    if (!record || !Array.isArray(record.items)) return null;
    return { ...record, attempted: Boolean(record.attempted) };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function idbPut(pkg: SavedPackage): Promise<boolean> {
  const db = await openIdb();
  if (!db) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put({ ...pkg, id: IDB_KEY });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

async function idbDel(): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(IDB_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    /* The record stays; the next visit retries it. */
  } finally {
    db.close();
  }
}

function createDraftOrder(pkg: SavedPackage): Promise<Response> {
  return fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Content package", price: String(pkg.total), shortMessage: summarize(pkg) }),
  });
}

type PipelineResult = { done: boolean; auth: boolean; errors: string[] };

/* Runs the pipeline for one package, resuming from each entry's recorded
   stage. Stage is progress only; a failure records entry.error and keeps
   the stage, so a retry resumes instead of duplicating work. */
async function runPackage(pkg: SavedPackage): Promise<PipelineResult> {
  const errors: string[] = [];
  if (!pkg.video.length || pkg.photos.length < 2) {
    // No video pieces, or too few photos to render: keep today's behavior —
    // one draft order the customer can see. Production needs two photos.
    const res = await createDraftOrder(pkg);
    if (res.status === 401) return { done: false, auth: true, errors: [] };
    if (!res.ok) return { done: false, auth: false, errors: [await errorText(res)] };
    return { done: true, auth: false, errors: [] };
  }
  for (const entry of pkg.video) {
    if (entry.stage === "generating") continue;
    if (entry.stage !== "new" && !entry.projectId) entry.stage = "new";
    entry.error = undefined;
    try {
      if (entry.stage === "new") {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: entry.title, price: String(entry.price), shortMessage: summarizeItem(pkg, entry.title), aspect: entry.aspect, targetDuration: entry.targetDuration }),
        });
        if (res.status === 401) return { done: false, auth: true, errors };
        if (!res.ok) {
          entry.error = await errorText(res);
          errors.push(`${entry.title}: ${entry.error}`);
          await idbPut(pkg);
          continue;
        }
        const data = (await res.json()) as { project?: { id?: string } };
        entry.projectId = data.project?.id || null;
        entry.stage = "created";
        await idbPut(pkg);
      }
      if (entry.stage === "created" && entry.projectId) {
        let failed = false;
        for (let i = 0; i < pkg.photos.length; i += 1) {
          const file = dataUrlToFile(pkg.photos[i], `photo-${String(i + 1).padStart(2, "0")}`);
          if (!file) {
            entry.error = "A photo could not be read.";
            failed = true;
            break;
          }
          const form = new FormData();
          form.append("file", file);
          const up = await fetch(`/api/projects/${entry.projectId}/assets`, { method: "POST", body: form });
          if (up.status === 401) return { done: false, auth: true, errors };
          if (!up.ok) {
            entry.error = await errorText(up);
            failed = true;
            break;
          }
        }
        if (failed) {
          errors.push(`${entry.title}: ${entry.error}`);
          await idbPut(pkg);
          continue;
        }
        entry.stage = "uploaded";
        await idbPut(pkg);
      }
      if (entry.stage === "uploaded" && entry.projectId) {
        const sub = await fetch(`/api/projects/${entry.projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
        if (sub.status === 401) return { done: false, auth: true, errors };
        if (!sub.ok) {
          entry.error = await errorText(sub);
          errors.push(`${entry.title}: ${entry.error}`);
          await idbPut(pkg);
          continue;
        }
        entry.stage = "submitted";
        await idbPut(pkg);
      }
      if (entry.stage === "submitted" && entry.projectId) {
        const gen = await fetch(`/api/projects/${entry.projectId}/generate`, { method: "POST" });
        if (gen.status === 401) return { done: false, auth: true, errors };
        if (!gen.ok) {
          entry.error = await errorText(gen);
          errors.push(`${entry.title}: ${entry.error}`);
          await idbPut(pkg);
          continue;
        }
        entry.stage = "generating";
        await idbPut(pkg);
      }
    } catch {
      entry.error = "Couldn't reach MotionWren. Check your connection and try again.";
      errors.push(`${entry.title}: ${entry.error}`);
      await idbPut(pkg);
    }
  }
  return { done: pkg.video.every((entry) => entry.stage === "generating"), auth: false, errors };
}

/* After a package is created, make it visible: on the dashboard reload the
   list, anywhere else go to the dashboard. Creating without showing anything
   looked like nothing happened. */
function showCreated() {
  if (window.location.pathname === "/dashboard") window.location.reload();
  else window.location.assign("/dashboard");
}

type Banner = { message: string; retryPackage: boolean };

/* Listens for the content-package flow's mw:package event (dispatched on
   window by the studio loader) and runs the order through production. */
export default function MwPackageListener() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    async function flushPending() {
      // New path: an IndexedDB package that has never been attempted.
      // Attempted packages wait for the banner's Try again — otherwise every
      // dashboard visit would retry (and could hit the hourly rate limits).
      const pending = await idbGet();
      if (pending && !pending.attempted) {
        const result = await runPackage(pending);
        if (result.auth) return; // Still signed out — keep it for the next visit.
        if (result.done) {
          await idbDel();
          showCreated();
          return;
        }
        pending.attempted = true;
        await idbPut(pending);
        setBanner({ message: result.errors[0] || "Production could not start for every piece.", retryPackage: true });
        return;
      }
      // Legacy path: packages saved by the older version in localStorage
      // (items only, no photos) still create their draft order.
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(PENDING_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      let legacy: SavedPackage;
      try {
        legacy = JSON.parse(raw) as SavedPackage;
      } catch {
        try {
          window.localStorage.removeItem(PENDING_KEY);
        } catch {
          /* Storage unavailable — nothing to clear. */
        }
        return;
      }
      try {
        const res = await createDraftOrder(legacy);
        if (!res.ok) {
          if (res.status === 401) return;
          setBanner({ message: await errorText(res), retryPackage: false });
          return;
        }
        try {
          window.localStorage.removeItem(PENDING_KEY);
        } catch {
          /* Storage unavailable — the order is already created. */
        }
        showCreated();
      } catch {
        setBanner({ message: "Couldn't reach MotionWren. Check your connection and try again.", retryPackage: false });
      }
    }

    async function onPackage(event: Event) {
      const detail = (event as CustomEvent<PackageDetail>).detail || {};
      const pkg = normalize(detail);
      // Persist first: a failure or a sign-in redirect must never lose the
      // package (or its photos). If IndexedDB is unavailable, fall back to
      // the legacy localStorage record (items only, no photos) so the order
      // itself still survives sign-in.
      const persisted = await idbPut(pkg);
      if (!persisted) {
        try {
          window.localStorage.setItem(PENDING_KEY, JSON.stringify({ items: pkg.items, answers: pkg.answers, total: pkg.total }));
        } catch {
          /* Storage unavailable — the in-memory pipeline below still runs. */
        }
      }
      // Signed out? Save and send them to sign-in; the dashboard mount flush
      // runs the pipeline once they land back signed in.
      try {
        const account = await fetch("/api/account", { cache: "no-store" });
        if (!account.ok) {
          if (account.status === 401) window.location.assign("/signin");
          else setBanner({ message: "Couldn't reach MotionWren. Check your connection and try again.", retryPackage: true });
          return;
        }
      } catch {
        setBanner({ message: "Couldn't reach MotionWren. Check your connection and try again.", retryPackage: true });
        return;
      }
      const result = await runPackage(pkg);
      if (result.auth) {
        window.location.assign("/signin");
        return;
      }
      if (result.done) {
        await idbDel();
        setBanner(null);
        showCreated();
        return;
      }
      pkg.attempted = true;
      await idbPut(pkg);
      setBanner({ message: result.errors[0] || "Production could not start for every piece.", retryPackage: true });
    }

    async function retryPipeline() {
      setBanner(null);
      const pending = await idbGet();
      if (!pending) return;
      pending.attempted = false;
      await idbPut(pending);
      const result = await runPackage(pending);
      if (result.auth) {
        window.location.assign("/signin");
        return;
      }
      if (result.done) {
        await idbDel();
        showCreated();
        return;
      }
      pending.attempted = true;
      await idbPut(pending);
      setBanner({ message: result.errors[0] || "Production could not start for every piece.", retryPackage: true });
    }

    void flushPending();
    window.addEventListener("mw:package", onPackage);
    (window as unknown as { __mwRetryPipeline?: () => void }).__mwRetryPipeline = retryPipeline;
    return () => {
      window.removeEventListener("mw:package", onPackage);
      delete (window as unknown as { __mwRetryPipeline?: () => void }).__mwRetryPipeline;
    };
  }, []);

  if (!banner) return null;
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
      <span>{banner.message}</span>
      <button
        type="button"
        onClick={() => {
          if (banner.retryPackage) {
            const retry = (window as unknown as { __mwRetryPipeline?: () => void }).__mwRetryPipeline;
            if (retry) {
              retry();
              return;
            }
          }
          setBanner(null);
          const studio = (window as unknown as { MotionWrenStudio?: { open?: (flow: string) => void } }).MotionWrenStudio;
          if (studio?.open) studio.open("plan");
        }}
      >
        Try again
      </button>
      <button type="button" aria-label="Dismiss" onClick={() => setBanner(null)}>
        ×
      </button>
    </div>
  );
}
