"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Studio production, as the owner sees it. Every Studio video is made on the
   server (see /api/studio/production): this file only watches. Jobs are
   found again after a refresh, scenes that fail restart on their own, and the
   finished video lands in History whether or not this page stays open. */

export type SceneInfo = {
  state: "queued" | "submitting" | "creating" | "retry" | "ready" | "failed" | "waiting" | "retrying";
  attempt: number;
  reason?: "" | "throttle" | "credit" | "retry";
  nextAt?: number;
  error?: string;
  predictionId?: string;
  saved?: boolean;
  expired?: boolean; // a stopped video's scene that Resume will make again
};
export type ProviderNote = { waitingUntil: number; paused: boolean; lowCredit: boolean };
export type StudioJob = {
  id: string;
  kind: string;
  status: "starting" | "generating" | "stitching" | "saving" | "succeeded" | "failed";
  progress: string;
  completed: number;
  total: number;
  error?: string | null;
  historyId?: string | null;
  videoUrl?: string | null;
  downloadUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  duration: number;
  aspect: string;
  resolution: string;
  category: string;
  costCents: number;
  motion?: string;
  scenes?: SceneInfo[] | null;
  provider?: ProviderNote | null;
};

export const ACTIVE = ["starting", "generating", "stitching", "saving"];
export const isActive = (job?: StudioJob | null) => Boolean(job && ACTIVE.includes(job.status));
const STUDIO_KINDS = ["studio-series", "studio-single"];

/* Which Studio tab a job belongs to. */
export function jobMode(job: StudioJob): "series" | "single" | "extend" | "transition" {
  if (job.kind === "studio-series" || job.kind === "series-stitch" || job.kind === "customer-series") return "series";
  if (job.kind === "studio-single") return /extension/i.test(job.category) ? "extend" : "single";
  return "transition";
}

/* Tracks every video this owner has in production, polling only while
   something is being made. A failed check is retried quietly — the video
   keeps going on the server either way. */
export function useStudioJobs(handlers: { onFinished?: (job: StudioJob) => void; onRestore?: (jobs: StudioJob[]) => void } = {}) {
  const [jobs, setJobs] = useState<Record<string, StudioJob>>({});
  const [restored, setRestored] = useState(false);
  const [offline, setOffline] = useState(false);
  const failures = useRef(0);
  const handlersRef = useRef(handlers);
  const jobsRef = useRef(jobs);
  useEffect(() => { handlersRef.current = handlers; });
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const track = useCallback((job: StudioJob) => setJobs((current) => ({ ...current, [job.id]: { ...current[job.id], ...job } })), []);
  const forget = useCallback((id: string) => setJobs((current) => { const next = { ...current }; delete next[id]; return next; }), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transitions?all=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { jobs: [] })
      .then((data: { jobs?: StudioJob[] }) => {
        if (cancelled) return;
        const found = data.jobs || [];
        setJobs((current) => { const next = { ...current }; for (const job of found) next[job.id] = { ...next[job.id], ...job }; return next; });
        if (found.length) handlersRef.current.onRestore?.(found);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setRestored(true); });
    return () => { cancelled = true; };
  }, []);

  const activeIds = Object.values(jobs).filter(isActive).map((job) => job.id).sort().join(",");
  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const results = await Promise.all(ids.map(async (id) => {
          const response = await fetch(`/api/transitions/${id}`, { cache: "no-store" });
          if (response.status === 404) return { id, gone: true as const };
          if (!response.ok) throw new Error("check failed");
          return { id, job: (await response.json()).job as StudioJob };
        }));
        failures.current = 0; setOffline(false);
        const finished = results.flatMap((result) => "job" in result && result.job && isActive(jobsRef.current[result.id]) && !isActive(result.job) ? [result.job] : []);
        setJobs((current) => {
          const next = { ...current };
          for (const result of results) {
            if ("gone" in result) delete next[result.id];
            else next[result.id] = { ...current[result.id], ...result.job };
          }
          return next;
        });
        for (const job of finished) handlersRef.current.onFinished?.(job);
      } catch {
        failures.current += 1;
        if (failures.current >= 3) setOffline(true);
      } finally { busy = false; }
    };
    void check();
    const timer = window.setInterval(check, 4000);
    return () => window.clearInterval(timer);
  }, [activeIds]);

  return { jobs, track, forget, restored, offline };
}

export type Sending = { id: string; done: number; total: number };

/* Starts a Studio video in three small steps: create it (nothing is made or
   charged yet), send each scene's photo, then start. The job is shown from
   the first step, so the loading view appears at once. A photo that fails to
   send is tried again; once all are in, the server finishes starting even if
   the page is refreshed. */
export async function startStudioProduction(body: Record<string, unknown>, photos: string[], hooks: { onCreated: (job: StudioJob) => void; onProgress: (sending: Sending) => void }): Promise<StudioJob> {
  const created = await fetch("/api/studio/production", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await created.json().catch(() => ({}));
  if (!created.ok || !data.job?.id) throw new Error(data.error || "The video could not start. Please try again.");
  const job = data.job as StudioJob;
  const count = Number(data.plan?.count) || photos.length;
  hooks.onCreated(job);
  hooks.onProgress({ id: job.id, done: 0, total: count });
  for (let index = 0; index < count; index += 1) {
    const blob = await (await fetch(photos[index])).blob();
    let sent = false, reason = "";
    for (let attempt = 0; attempt < 3 && !sent; attempt += 1) {
      if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
      try {
        const response = await fetch(`/api/studio/production/${job.id}?scene=${index + 1}`, { method: "PUT", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
        if (response.ok) sent = true;
        else { reason = ((await response.json().catch(() => ({}))) as { error?: string }).error || ""; if (response.status < 500 && response.status !== 429) break; }
      } catch { reason = "The connection dropped."; }
    }
    if (!sent) throw new Error(`Scene ${index + 1}'s photo could not be sent. ${reason} Nothing was made or charged — please try again.`.replace(/\s+/g, " "));
    hooks.onProgress({ id: job.id, done: index + 1, total: count });
  }
  const started = await fetch(`/api/studio/production/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const result = await started.json().catch(() => ({}));
  if (!started.ok || !result.job?.id) throw new Error(result.error || "The video could not start. Please try again.");
  return result.job as StudioJob;
}

/* Resumes a stopped video: finished scenes are kept when possible. */
export async function resumeStudioJob(id: string): Promise<StudioJob> {
  const response = await fetch(`/api/studio/production/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume" }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.job?.id) throw new Error(data.error || "This video could not be picked up again.");
  return data.job as StudioJob;
}
export const canStartOver = (job: StudioJob) => job.status === "failed" && STUDIO_KINDS.includes(job.kind) && !/did not finish sending|photo could not be sent|replaced by a new run/i.test(job.error || "");
export async function startOverStudioJob(id: string): Promise<StudioJob> {
  const response = await fetch(`/api/studio/production/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-over" }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.job?.id) throw new Error(data.error || "This video could not be started over.");
  return data.job as StudioJob;
}
export const canResume = (job: StudioJob) => job.status === "failed" && STUDIO_KINDS.includes(job.kind) && !/did not finish sending|photo could not be sent|replaced by a new run/i.test(job.error || "");

export async function stopStudioJob(id: string) {
  await fetch(`/api/transitions/${id}`, { method: "DELETE" }).catch(() => undefined);
}

function percentOf(job: StudioJob, sending?: Sending | null) {
  if (job.status === "succeeded") return 100;
  if (job.status === "starting" && sending && sending.id === job.id && sending.total) return Math.round(2 + (sending.done / sending.total) * 6);
  if (job.status === "saving") return 95;
  if (job.status === "stitching") return 86;
  if (job.status === "generating" && job.total) return Math.round(8 + (Math.min(job.completed, job.total) / job.total) * 74);
  return 3;
}

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/* The loading view: what is happening now, every scene's state, and that it
   is safe to leave. */
/* A scene's state in plain words. */
/* What a stopped video's card says: plain words, never the engine's own
   message (that stays in the manager's Production page detail). */
export function stoppedMessage(job: Pick<StudioJob, "error" | "status">) {
  const error = String(job.error || "");
  if (/not.?found|not supported|unavailable|HTTP 40[34]/i.test(error)) return "The video engine rejected this request. Its model looks unavailable right now. Start over with a different engine.";
  if (/throttl|rate limit|burst|429/i.test(error)) return "Stopped while the video engine was busy. Resume finishes it.";
  if (/credit/i.test(error)) return "Paused: the video engine account needs credit. Resume once it's topped up.";
  if (/photos did not finish|no photo/i.test(error)) return "The photos didn't finish uploading. Start over to make it.";
  if (/failed \d+ times|could not be made/i.test(error)) return "A scene couldn't be made after 3 tries. Resume tries it again.";
  if (/too long|time limit/i.test(error)) return "This video took too long and was stopped. Resume tries again.";
  if (/input_file|join|stitch|edit|compos/i.test(error)) return "Stopped while the scenes were being joined. Resume finishes it.";
  return "This video stopped before it finished. Resume finishes it.";
}

export function sceneLabel(scene: SceneInfo, now: number) {
  const wait = scene.nextAt && scene.nextAt > now ? ` · ${Math.ceil((scene.nextAt - now) / 1000)}s` : "";
  if (scene.state === "ready" && scene.expired) return "Will remake";
  if (scene.state === "ready") return "Ready";
  if (scene.state === "failed") return "Failed";
  if (scene.state === "submitting") return "Sending";
  if (scene.state === "creating") return scene.attempt > 1 ? `Making · try ${scene.attempt}` : "Making";
  if (scene.reason === "credit") return "Paused";
  if (scene.reason === "throttle") return `Engine busy${wait}`;
  if (scene.state === "retry" || scene.state === "retrying") return `Try ${Math.min(3, scene.attempt + 1)} soon${wait}`;
  return "In line";
}

export function ProductionView({ job, title, thumbs, onStop, onResume, onStartOver, onDismiss, onDelete, offline, sending }: { job: StudioJob; title: string; thumbs?: string[]; onStop?: () => void; onResume?: () => void; onStartOver?: () => void; onDismiss?: () => void; onDelete?: () => void; offline?: boolean; sending?: Sending | null }) {
  const [now, setNow] = useState(() => job.updatedAt || job.createdAt);
  const [broken, setBroken] = useState<number[]>([]);
  const active = isActive(job);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const scenes: SceneInfo[] = job.scenes?.length ? job.scenes : Array.from({ length: Math.max(1, job.total) }, (_, index) => ({ state: index < job.completed ? "ready" : job.status === "starting" ? "queued" : "creating", attempt: 1 }));
  const many = scenes.length > 1;
  const retrying = scenes.filter((scene) => scene.reason === "retry" || scene.state === "retrying" || (scene.state === "creating" && scene.attempt > 1)).length;
  const pacing = scenes.some((scene) => scene.reason === "throttle") || Boolean(job.provider?.waitingUntil && job.provider.waitingUntil > now && !job.provider.paused);
  const paused = Boolean(job.provider?.paused) || scenes.some((scene) => scene.reason === "credit");
  const inLine = job.status === "generating" && !scenes.some((scene) => ["creating", "submitting"].includes(scene.state));
  const ready = job.status === "generating" ? Math.min(job.completed, scenes.length) : ["stitching", "saving", "succeeded"].includes(job.status) ? scenes.length : 0;
  const percent = percentOf(job, sending);
  const steps = [
    { key: "sent", label: job.status === "starting" && sending && sending.id === job.id && sending.done < sending.total ? `Sending photos · ${sending.done} of ${sending.total}` : "Photos sent", done: job.status !== "starting", current: job.status === "starting" },
    { key: "scenes", label: many ? `Creating scenes${job.status === "generating" ? ` · ${ready} of ${scenes.length}` : ""}` : "Creating the clip", done: ["stitching", "saving", "succeeded"].includes(job.status), current: job.status === "generating" },
    ...(many ? [{ key: "join", label: "Editing with music", done: ["saving", "succeeded"].includes(job.status), current: job.status === "stitching" }] : []),
    { key: "save", label: "Saving to History", done: job.status === "succeeded", current: job.status === "saving" },
  ];
  const studioFrames = STUDIO_KINDS.includes(job.kind);

  return <section className={`prod${active ? " is-active" : ""}${job.status === "failed" ? " is-failed" : ""}`} aria-live="polite">
    <header className="prod-head">
      <div>
        <span className="prod-eyebrow">{active ? <><i className="prod-dot" />In production</> : job.status === "succeeded" ? "Ready" : "Stopped"}</span>
        <strong>{title}</strong>
        {job.motion && <small className="prod-motion">Movement: {job.motion}</small>}
        <small className={active || job.status === "succeeded" ? "" : "prod-reason"}>{active ? `${clock((now - job.createdAt) / 1000)} elapsed · usually 3–10 minutes` : job.status === "succeeded" ? "Saved to History." : stoppedMessage(job)}</small>
        {!active && job.status === "failed" && job.error && <small className="prod-reason prod-raw">Why: {String(job.error).slice(0, 400)}</small>}
      </div>
      {active && onStop && <button type="button" className="prod-stop" onClick={onStop}>Stop</button>}
      {!active && (onResume || onStartOver || onDismiss || onDelete) && <div className="prod-actions">
        {onResume && canResume(job) && <button type="button" className="prod-stop prod-resume" onClick={onResume} title="Keep the finished scenes and make the rest">Resume</button>}
        {onStartOver && canStartOver(job) && <button type="button" className="prod-stop" onClick={onStartOver} title="A new run with the same photos and settings">Start over</button>}
        {onDismiss && <button type="button" className="prod-stop" onClick={onDismiss}>Hide</button>}
        {onDelete && job.status === "failed" && <button type="button" className="prod-stop" onClick={onDelete} title="Erase this stopped video for good">Delete</button>}
      </div>}
    </header>
    {job.status !== "failed" && <div className="prod-bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>}
    <ol className="prod-steps">
      {steps.map((step) => <li key={step.key} className={step.done ? "done" : step.current ? "current" : ""}><span aria-hidden="true" />{step.label}</li>)}
    </ol>
    {many && <ol className="prod-scenes" aria-label="Scenes">
      {scenes.map((scene, index) => {
        const thumb = thumbs?.[index] || (studioFrames && active && !broken.includes(index) ? `/api/job-frames/${job.id}/scene-${String(index + 1).padStart(2, "0")}.jpg` : "");
        const label = sceneLabel(scene, now);
        const look = scene.state === "ready" && scene.expired ? "waiting" : scene.state === "creating" || scene.state === "submitting" ? (scene.attempt > 1 ? "retrying" : "creating") : scene.state === "retry" || scene.state === "retrying" ? "waiting" : scene.state === "queued" || scene.state === "waiting" ? "waiting" : scene.state;
        return <li key={index} className={`prod-scene is-${look}`} title={`Scene ${index + 1}: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the owner's own scene photo, served privately */}
          {thumb ? <img src={thumb} alt="" onError={() => setBroken((list) => [...list, index])} /> : <b>{index + 1}</b>}
          <span className="prod-scene-state" aria-hidden="true" />
          <em>{index + 1} · {label}</em>
        </li>;
      })}
    </ol>}
    {active && <p className="prod-note">{job.status === "starting" && sending?.id === job.id ? "Keep this page open while the photos are sent — after that you can leave or refresh."
      : offline ? "Reconnecting… your video keeps going on our server."
      : paused ? "Paused: the video engine account needs credit. Everything is kept and continues automatically once credit is added."
      : pacing ? "The engine is pacing requests, so scenes are made one after another. The next one starts automatically — nothing is lost."
      : retrying ? `${retrying === 1 ? "A scene is" : `${retrying} scenes are`} being redone automatically — no need to do anything.`
      : inLine ? "In line for the engine — scenes are made one after another. You can leave or refresh this page."
      : "You can leave or refresh this page. It keeps going on our server and lands in History."}</p>}
  </section>;
}

/* History labels: what a saved video is, in plain words. */
export function historyKind(category: string): { label: string; group: "film" | "clip" | "upscale" } {
  const value = (category || "").toLowerCase();
  if (value.startsWith("upscale")) return { label: `Upscaled${category.slice(7).trim() ? ` ${category.slice(7).trim()}` : ""}`, group: "upscale" };
  if (value.startsWith("studio · ")) return { label: category.slice(9), group: /film/i.test(category) ? "film" : "clip" };
  if (value.startsWith("stitched series")) return { label: "Finished series", group: "film" };
  if (value.startsWith("series · ")) return { label: "Scene clip", group: "clip" };
  if (value.startsWith("extension")) return { label: "Extension", group: "clip" };
  if (value === "real estate") return { label: "Client video", group: "film" };
  if (value.includes("transition") || value.includes("dissolve")) return { label: "Frame transition", group: "film" };
  if (value.startsWith("branded")) return { label: "With listing cards", group: "film" };
  return { label: "Single clip", group: "clip" };
}
