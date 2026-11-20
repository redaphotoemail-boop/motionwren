"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QualityTab from "./quality-tab";
import { aspectLabel } from "../aspect-label";
import { explainSend, loadSendLog, saveSendLog, type SendLog } from "./send-log";
import { clearPending, savePending, type PendingUpload } from "./pending-upload";
export { loadPending, clearPending, type PendingUpload } from "./pending-upload";

/* Studio production, as the owner sees it. Every Studio video is made on the
   server (see /api/studio/production): this file only watches. Jobs are
   found again after a refresh, scenes that fail restart on their own, and the
   finished video lands in History whether or not this page stays open. */

export type SceneInfo = {
  state: "queued" | "submitting" | "creating" | "retry" | "ready" | "failed" | "waiting" | "retrying";
  attempt: number;
  reason?: "" | "throttle" | "credit" | "retry" | "budget";
  nextAt?: number;
  error?: string;
  predictionId?: string;
  saved?: boolean;
  expired?: boolean; // a stopped video's scene that Resume will make again
  engine?: string; // what the video engine last said about this scene: "starting" (not running yet) or "processing" (running)
  startedAt?: number; // when this scene was sent to the engine
  motion?: string; // the camera movement this scene was asked for
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
  cardsNote?: string;
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

export type Sending = { id: string; done: number; total: number; phase?: "sending" | "checking" };
/** The studio's confirmation that every photo is stored and was checked (its size matches what the phone sent). */
export type Receipt = { id: string; count: number; at: number };
type SendHooks = { onCreated?: (job: StudioJob) => void; onProgress: (sending: Sending) => void; onVerified?: (receipt: Receipt) => void };

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/* Sends the photos of a film that exists on the server and starts it, proving each step:
   every photo carries its SHA-256 and the server reads it back before it replies; when all are in, the start request says
   how big each photo was and the server checks what it really holds. A photo that is missing or short is sent again (twice at most)
   before the film starts. Nothing is charged until the film starts. Resumable: `only` limits it to the photos still missing. */
async function deliverPhotos(job: StudioJob, blobs: Blob[], hooks: SendHooks, only?: number[]): Promise<StudioJob> {
  const count = blobs.length;
  // What this phone saw while sending (kept on the device for the stopped-film explanation), and the screen kept awake meanwhile.
  const log: SendLog = { startedAt: Date.now(), sizes: blobs.map((blob) => blob.size), hiddenMs: 0, hiddenTimes: 0, events: [], sent: 0 };
  let hiddenAt = 0;
  const onVisibility = () => { if (document.visibilityState === "hidden") hiddenAt = Date.now(); else if (hiddenAt) { log.hiddenMs += Date.now() - hiddenAt; log.hiddenTimes += 1; hiddenAt = 0; saveSendLog(job.id, log); } };
  document.addEventListener("visibilitychange", onVisibility);
  let wake: { release: () => Promise<void> } | null = null;
  try { void (navigator as unknown as { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then((lock) => { wake = lock; }).catch(() => undefined); } catch { /* not supported: sending still works */ }
  saveSendLog(job.id, log);
  const digests = await Promise.all(blobs.map(async (blob) => hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))));
  let sentCount = count - (only ? only.length : count);
  hooks.onProgress({ id: job.id, done: sentCount, total: count, phase: "sending" });
  // Photos go up one at a time, at full quality, so the first arrives as soon as possible. Each try gives up after two minutes (a stalled connection) and tries again, so one stuck upload can't leave the film waiting.
  async function sendPhoto(index: number) {
    const blob = blobs[index];
    let sent = false, reason = "";
    for (let attempt = 0; attempt < 4 && !sent; attempt += 1) {
      if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
      const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 120_000); const began = Date.now();
      const note = (outcome: SendLog["events"][number]["outcome"], detail?: string) => { log.events.push({ scene: index + 1, attempt: attempt + 1, bytes: blob.size, ms: Date.now() - began, outcome, ...(detail ? { detail: detail.slice(0, 120) } : {}) }); saveSendLog(job.id, log); };
      try {
        const response = await fetch(`/api/studio/production/${job.id}?scene=${index + 1}`, { method: "PUT", headers: { "Content-Type": blob.type || "image/jpeg", "x-photo-sha256": digests[index] }, body: blob, signal: controller.signal });
        const answer = await response.json().catch(() => ({})) as { error?: string; bytes?: number; sha256?: string };
        // Only the studio's own receipt counts: it must name the same size and fingerprint the phone sent.
        if (response.ok && answer.bytes === blob.size && answer.sha256 === digests[index]) { sent = true; note("ok"); }
        else { reason = answer.error || (response.ok ? "The receipt did not match the photo." : ""); note("refused", reason || `HTTP ${response.status}`); if (response.status < 500 && response.status !== 429 && response.status !== 422) break; }
      } catch { reason = "The connection dropped or stalled."; note(controller.signal.aborted ? "timeout" : "dropped"); }
      finally { window.clearTimeout(timer); }
    }
    if (!sent) throw new Error(`Scene ${index + 1}'s photo could not be sent. ${reason} Nothing was made or charged — please try again.`.replace(/\s+/g, " "));
    sentCount += 1; log.sent = sentCount; saveSendLog(job.id, log); hooks.onProgress({ id: job.id, done: sentCount, total: count, phase: "sending" });
  }
  try {
    const queue = only ? [...only] : Array.from({ length: count }, (_, index) => index);
    for (let round = 0; round < 3; round += 1) {
      for (const index of queue.splice(0)) await sendPhoto(index);
      hooks.onProgress({ id: job.id, done: count, total: count, phase: "checking" });
      const started = await fetch(`/api/studio/production/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photos: blobs.map((blob, index) => ({ bytes: blob.size, sha256: digests[index] })) }) });
      const result = await started.json().catch(() => ({})) as { error?: string; missing?: number[]; verified?: number; job?: StudioJob };
      if (started.ok && result.job?.id) { hooks.onVerified?.({ id: job.id, count: result.verified || count, at: Date.now() }); return result.job; }
      // Some photos are missing or short on the server: send just those again, then check again.
      if (started.status === 409 && result.missing?.length && round < 2) { queue.push(...result.missing.map((scene) => scene - 1).filter((index) => index >= 0 && index < count)); sentCount = count - queue.length; hooks.onProgress({ id: job.id, done: sentCount, total: count, phase: "sending" }); continue; }
      throw new Error(result.error || "The video could not start. Please try again.");
    }
    throw new Error("The studio could not confirm every photo. Nothing was made or charged — please try again.");
  } finally {
    log.finishedAt = Date.now(); saveSendLog(job.id, log);
    document.removeEventListener("visibilitychange", onVisibility);
    wake?.release().catch(() => undefined);
  }
}

async function beginFilm(body: Record<string, unknown>, blobs: Blob[], hooks: SendHooks, tab: string): Promise<StudioJob> {
  const send = (extra: Record<string, unknown> = {}) => fetch("/api/studio/production", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }) });
  let created = await send();
  let data = await created.json().catch(() => ({}));
  // Spending guard: a film that costs more than your per-film amount asks for a yes before anything is charged.
  if (created.status === 409 && data.needsConfirm) {
    if (!window.confirm(`This film costs about $${((Number(data.costCents) || 0) / 100).toFixed(2)}. Make it?`)) throw new Error("Cancelled. Nothing was made or charged.");
    created = await send({ confirmSpend: true });
    data = await created.json().catch(() => ({}));
  }
  if (!created.ok || !data.job?.id) throw new Error(data.error || "The video could not start. Please try again.");
  const job = data.job as StudioJob;
  hooks.onCreated?.(job);
  hooks.onProgress({ id: job.id, done: 0, total: Number(data.plan?.count) || blobs.length, phase: "sending" });
  // Kept on the device until the studio confirms every photo, so a closed page or a dropped connection can be finished with "Send again".
  await savePending({ jobId: job.id, tab, body, photos: blobs, at: Date.now() });
  const started = await deliverPhotos(job, blobs, hooks);
  await clearPending(job.id);
  return started;
}

/* Starts a Studio video in small, proven steps: create it (nothing is made or charged yet), send each scene's photo with a
   fingerprint, let the studio read each back, then start only once it has confirmed every photo. The job is shown from the
   first step, so the loading view appears at once. */
export async function startStudioProduction(body: Record<string, unknown>, photos: string[], hooks: SendHooks, tab = ""): Promise<StudioJob> {
  const blobs = await Promise.all(photos.map(async (photo) => (await fetch(photo)).blob()));
  return beginFilm(body, blobs, hooks, tab);
}

/** A film whose photos were left unfinished: what the studio holds of it now (null if it can't be asked). */
export async function checkUnfinished(jobId: string): Promise<{ status: string; total: number; sizes: number[]; received: number } | null> {
  try { const response = await fetch(`/api/studio/production/${jobId}?photos=1`, { cache: "no-store" }); return response.ok ? await response.json() : null; } catch { return null; }
}

/** Finishes sending: the same film if the studio is still waiting for it (only the missing photos go), else a new one from the same photos and settings. */
export async function resumeStudioUpload(pending: PendingUpload, hooks: SendHooks): Promise<StudioJob> {
  const state = await checkUnfinished(pending.jobId);
  if (state && state.status === "starting" && state.total === pending.photos.length) {
    const missing = state.sizes.map((size: number, index: number) => size === pending.photos[index].size ? -1 : index).filter((index: number) => index >= 0);
    const job = { id: pending.jobId } as StudioJob;
    const started = await deliverPhotos(job, pending.photos, hooks, missing.length ? missing : []);
    await clearPending(pending.jobId);
    return started;
  }
  const started = await beginFilm(pending.body, pending.photos, hooks, pending.tab);
  await clearPending(pending.jobId);
  return started;
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
  if (/photos did not finish|no photo/i.test(error)) { const got = /(\d+) of (\d+) photos? reached/i.exec(error); return got ? (Number(got[1]) === 0 ? `None of the ${got[2]} photos reached the server. Nothing was made or charged. Send them again from the Studio.` : `Only ${got[1]} of ${got[2]} photos reached the server. Nothing was made or charged. Send them again from the Studio.`) : "The photos didn't all reach the server. Nothing was made or charged. Send them again from the Studio."; }
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
  if (scene.state === "creating") { const mins = scene.startedAt && now > scene.startedAt ? Math.floor((now - scene.startedAt) / 60000) : 0; return `${scene.attempt > 1 ? `Making · try ${scene.attempt}` : "Making"}${mins >= 1 ? ` · ${mins} min` : ""}`; }
  if (scene.reason === "budget") return "Held · spending limit";
  if (scene.reason === "credit") return "Paused";
  if (scene.reason === "throttle") return `Engine busy${wait}`;
  if (scene.state === "retry" || scene.state === "retrying") return `Try ${Math.min(3, scene.attempt + 1)} soon${wait}`;
  return "In line";
}

import { videoRef } from "../video-ref";
export function ProductionView({ job, title, thumbs, onStop, onResume, onStartOver, onDismiss, onDelete, offline, sending }: { job: StudioJob; title: string; thumbs?: string[]; onStop?: () => void; onResume?: () => void; onStartOver?: () => void; onDismiss?: () => void; onDelete?: () => void; offline?: boolean; sending?: Sending | null }) {
  const [now, setNow] = useState(() => job.updatedAt || job.createdAt);
  const [broken, setBroken] = useState<number[]>([]);
  const [restarting, setRestarting] = useState(false);
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
  const heldBySpend = scenes.some((scene) => scene.reason === "budget");
  const inLine = job.status === "generating" && !scenes.some((scene) => ["creating", "submitting"].includes(scene.state));
  const ready = job.status === "generating" ? Math.min(job.completed, scenes.length) : ["stitching", "saving", "succeeded"].includes(job.status) ? scenes.length : 0;
  const percent = percentOf(job, sending);
  const uploadFailed = job.status === "failed" && /photos did not finish|no photo/i.test(String(job.error || ""));
  const got = /(\d+) of (\d+) photos? reached/i.exec(String(job.error || ""));
  const steps = [
    { key: "sent", label: uploadFailed ? `Photos not received${got ? ` · ${got[1]} of ${got[2]}` : ""}` : job.status === "starting" && sending && sending.id === job.id && sending.done < sending.total ? `Sending photos · ${sending.done} of ${sending.total}` : "Photos sent", done: job.status !== "starting" && !uploadFailed, current: job.status === "starting" },
    { key: "scenes", label: many ? `Creating scenes${job.status === "generating" ? ` · ${ready} of ${scenes.length}` : ""}` : "Creating the clip", done: ["stitching", "saving", "succeeded"].includes(job.status), current: job.status === "generating" },
    ...(many ? [{ key: "join", label: "Editing with music", done: ["saving", "succeeded"].includes(job.status), current: job.status === "stitching" }] : []),
    { key: "save", label: "Saving to History", done: job.status === "succeeded", current: job.status === "saving" },
  ];
  const studioFrames = STUDIO_KINDS.includes(job.kind);

  return <section className={`prod${active ? " is-active" : ""}${job.status === "failed" ? " is-failed" : ""}`} aria-live="polite">
    <header className="prod-head">
      <div>
        <span className="prod-eyebrow">{active ? <><i className="prod-dot" />In production</> : job.status === "succeeded" ? "Ready" : "Stopped"}</span>
        <strong>{title}</strong><small>{aspectLabel(job.aspect)}</small><small className="video-ref">{videoRef(job.id)}</small>
        {(() => { const moves = [...new Set((job.scenes || []).map((scene) => scene.motion).filter(Boolean))]; const label = moves.length > 1 ? `Mixed — ${moves.join(", ")}` : moves[0] || job.motion; return label ? <small className="prod-motion">Movement: {label}</small> : null; })()}
        {job.cardsNote && <small className={`prod-motion${job.cardsNote.startsWith("not") ? " prod-reason" : ""}`}>Listing cards: {job.cardsNote}</small>}
        <small className={active || job.status === "succeeded" ? "" : "prod-reason"}>{active ? `${clock((now - job.createdAt) / 1000)} elapsed · usually 3–10 minutes` : job.status === "succeeded" ? "Saved to History." : stoppedMessage(job)}</small>
        {!active && job.status === "failed" && job.error && <small className="prod-reason prod-raw">Why: {String(job.error).slice(0, 400)}</small>}
        {active && (() => { const slow = scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.state === "creating" && scene.startedAt && now - scene.startedAt > 5 * 60 * 1000); if (!slow.length) return null; const first = slow[0]; const mins = Math.floor((now - (first.scene.startedAt || now)) / 60000); return <div className="prod-slow"><p><strong>The video engine is taking longer than usual.</strong> Scene {first.index + 1} has been with it for {mins} minutes (normally 1–5). It says: {first.scene.engine === "starting" ? "not started yet" : first.scene.engine === "processing" ? "still running" : "no answer"}. Nothing is wrong with your photo. It is stopped and sent again automatically after {first.scene.engine === "starting" ? 6 : 9} minutes.</p><button type="button" className="prod-stop" disabled={restarting} onClick={async () => { setRestarting(true); try { await fetch(`/api/studio/production/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart-scene", scene: first.index }) }); } finally { setRestarting(false); } }}>{restarting ? "Sending again…" : "Send again now"}</button></div>; })()}
        {uploadFailed && (() => { const why = explainSend(loadSendLog(job.id), Number(got?.[2]) || scenes.length); return <details className="prod-diagnose"><summary>What happened</summary><p>{why.verdict}</p>{why.facts.length > 0 && <ul>{why.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>}<p>{why.advice}</p></details>; })()}
        {(job.scenes || []).some((scene) => scene.flagged) && <div className="prod-quality"><QualityTab id={job.id} job label="Preview what was flagged"/></div>}
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
      : heldBySpend ? "Held by your spending limit: no more scenes are sent until you raise the limit or resume spending on the Spend page. Nothing is lost."
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
