"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead } from "../ui";
import { ProductionView, isActive, sceneLabel, type StudioJob } from "../../studio/production";

/* A scene's last engine message in plain words (the exact text stays in the tooltip). */
function sceneNote(error: string) {
  if (/throttl|rate limit|burst|429/i.test(error)) return "Engine was busy · waited and retried";
  if (/credit/i.test(error)) return "Engine account needs credit";
  if (/could not be reached|network|timeout|5\d\d/i.test(error)) return "Engine didn't answer · retried";
  if (/picked up again/i.test(error)) return "Stopped before it finished";
  return "Engine couldn't make this scene";
}

/* Manager only: production health and every video being made — clients'
   orders and Studio videos — with each scene's detail and the actions that
   fix a stuck video. Every action goes through the same queue, so a double
   click cannot create duplicate engine jobs. */

type Health = { engine: string; maxActive: number; activeScenes: number; queuedScenes: number; activeVideos: number; waitingUntil: number; paused: boolean; lowCredit: boolean; lastError: string; lastErrorAt: number; tokenConfigured: boolean; editor?: "ready" | "trouble" | "backup"; editorOkAt?: number; editorError?: string; music?: string; musicNote?: string; polishNote?: string };
type Job = StudioJob & { owner?: string };

const time = (value: number) => value ? new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
const ago = (value: number, now: number) => { const minutes = Math.round((now - value) / 60000); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`; };

export default function ProductionPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(0);
  const [samples, setSamples] = useState<Array<{ id: string; name: string; ready: boolean }> | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/production", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Production could not be loaded.");
    setHealth(data.health); setJobs(data.jobs || []); setNow(Date.now());
  }, []);

  const live = jobs.some(isActive);
  useEffect(() => {
    let stop = false;
    const tick = () => load().catch((cause) => { if (!stop) setError(cause instanceof Error ? cause.message : "Production could not be loaded."); });
    void Promise.resolve().then(tick);
    const timer = window.setInterval(tick, live ? 5000 : 30000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [load, live]);

  async function act(job: Job, action: string, scene?: number, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${job.id}:${action}:${scene ?? ""}`); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/production/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(scene === undefined ? {} : { scene }) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That did not work.");
      setMessage(action === "start-over" ? "Started over with the same photos and settings." : action === "reassemble" ? "Joining the scenes again." : "Back in production.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That did not work."); }
    finally { setBusy(""); }
  }

  async function setConcurrency(value: number) {
    setError("");
    const response = await fetch("/api/admin/production", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxActive: value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The setting could not be saved."); return; }
    setMessage(`Up to ${value} scene${value === 1 ? "" : "s"} at once.`); await load();
  }

  const loadSamples = useCallback(async () => {
    const response = await fetch("/api/admin/music-samples", { cache: "no-store" });
    if (response.ok) setSamples((await response.json()).samples);
  }, []);
  useEffect(() => { void Promise.resolve().then(loadSamples).catch(() => undefined); }, [loadSamples]);

  async function makeSamples(force: boolean) {
    setBusy("samples"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/music-samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The samples could not be made.");
      if (data.failed?.length) setError(`${data.failed.length} sample${data.failed.length === 1 ? "" : "s"} could not be made: ${data.failed[0].error}`);
      else setMessage(`${data.made} sample${data.made === 1 ? "" : "s"} made. Clients can hear them in the plan now.`);
      setSamples(data.samples);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The samples could not be made."); }
    finally { setBusy(""); }
  }

  async function testMusic() {
    setBusy("music"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/music-check", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The music check did not run.");
      if (data.ok) setMessage("ElevenLabs music works. The next film uses it.");
      else setError(`ElevenLabs refused: ${data.error || "no answer"}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The music check did not run."); }
    finally { setBusy(""); }
  }

  const musicNote = !health?.music ? undefined : health.music === "ElevenLabs" ? "Backup: Stable Audio"
    : health.music === "Backup in use" ? `Last film used Stable Audio${health.musicNote ? ` · ${health.musicNote}` : ""}`
    : health.music === "Missing" ? `Last film had no music${health.musicNote ? ` · ${health.musicNote}` : ""}`
    : "Add the ElevenLabs key to use ElevenLabs";
  const status = !health ? "…" : !health.tokenConfigured ? "Engine key missing" : health.paused ? "Paused — needs credit" : health.waitingUntil > now ? `Engine pacing until ${time(health.waitingUntil)}` : "Running normally";
  const perScene = (job: Job) => job.costCents / Math.max(1, job.scenes?.length || job.total || 1);

  return <div className="mgr-page">
    <PageHead eyebrow="Production" title="Videos being made" sub="Every client order and Studio video, scene by scene. Videos keep going on the server; nothing here needs a page left open." />
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}
    {health?.lowCredit && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span><strong>The video engine account is low on credit.</strong> Under $5, Replicate allows one new request about every 10 seconds, so scenes are made one at a time. Add credit to speed production up. <a href="https://replicate.com/account/billing" target="_blank" rel="noreferrer">Open billing</a></span></div>}

    <section className="metrics" aria-label="Production health">
      <Metric label="Status" value={status} tone={health?.paused || !health?.tokenConfigured ? "bad" : health && health.waitingUntil > now ? "warn" : "ok"} />
      <Metric label="Engine" value={health?.engine || "…"} />
      <Metric label="With the engine" value={health ? `${health.activeScenes} of ${health.maxActive}` : "…"} note={health ? `${health.queuedScenes} in line · ${health.activeVideos} video${health.activeVideos === 1 ? "" : "s"}` : undefined} />
      <Metric label="Last provider message" value={health?.lastErrorAt ? ago(health.lastErrorAt, now) : "None"} note={health?.lastError ? sceneNote(health.lastError) : undefined} />
      <Metric label="Editing" value={!health ? "…" : health.editor === "ready" ? "Ready" : health.editor === "trouble" ? "Retrying" : "Backup joiner"} tone={health?.editor === "ready" ? "ok" : health?.editor === "trouble" ? "warn" : "bad"} note={health?.editor === "backup" ? "Editing service not set up: music changes between scenes" : health?.editorOkAt ? `Last film edited ${ago(health.editorOkAt, now)}${health.polishNote ? ` · ${health.polishNote}` : ""}` : "One music track, true crossfades"} />
      <Metric label="Music" value={health?.music || "…"} tone={health?.music === "ElevenLabs" ? "ok" : "warn"} note={musicNote} />
    </section>

    {health && ["Backup in use", "Missing"].includes(health.music || "") && <section className="prodm-setting">
      <div><strong>Music check</strong><small>Makes a 5-second ElevenLabs track to confirm the key works (a few cents of ElevenLabs credit).</small></div>
      <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={testMusic}>{busy === "music" ? "Checking…" : "Test music"}</button>
    </section>}

    {samples && <section className="prodm-setting">
      <div><strong>Music samples for clients</strong><small>{samples.every((sample) => sample.ready) ? `All ${samples.length} templates have a 14-second sample clients can play in the plan.` : `${samples.filter((sample) => sample.ready).length} of ${samples.length} ready. Making them uses about a minute of ElevenLabs music in total.`}</small></div>
      <div className="prod-actions">
        {samples.some((sample) => !sample.ready) && <button type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={() => makeSamples(false)}>{busy === "samples" ? "Making…" : "Make samples"}</button>}
        {samples.every((sample) => sample.ready) && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Make all the samples again? This uses about a minute of ElevenLabs music.")) void makeSamples(true); }}>{busy === "samples" ? "Making…" : "Remake all"}</button>}
      </div>
    </section>}

    <section className="prodm-setting">
      <div><strong>Scenes at once</strong><small>How many scenes may be with the engine at the same time, across all videos. Keep 1 while the engine account is under $5 of credit.</small></div>
      <div className="tabs" role="radiogroup" aria-label="Scenes at once">
        {[1, 2, 3, 4].map((value) => <button key={value} type="button" role="radio" aria-checked={health?.maxActive === value} className={health?.maxActive === value ? "active" : ""} onClick={() => setConcurrency(value)}>{value}</button>)}
      </div>
    </section>

    <section className="prodm-list" aria-label="Videos">
      {!jobs.length && <div className="empty-soft"><strong>No videos in the last 24 hours</strong><span>New client orders and Studio videos appear here.</span></div>}
      {jobs.map((job) => {
        const scenes = job.scenes || [];
        const allReady = scenes.length > 1 && scenes.every((scene) => scene.state === "ready");
        return <article className="prodm-job" key={job.id}>
          <ProductionView job={job} title={`${job.category.replace(/^Studio · /, "") || "Video"}${job.owner ? ` · ${job.owner}` : ""}`} />
          <div className="prodm-actions">
            {job.status === "failed" && <button type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "resume", undefined, `Resume this video? Finished scenes are kept; about ${scenes.filter((scene) => scene.state !== "ready").length || 1} scene(s) are made again (~$${((perScene(job) * Math.max(1, scenes.filter((scene) => scene.state !== "ready").length)) / 100).toFixed(2)}).`)}>Resume</button>}
            {!isActive(job) && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "start-over", undefined, `Start over with the same photos and settings? Every scene is made again (~$${(job.costCents / 100).toFixed(2)}).`)}>Start over</button>}
            {!isActive(job) && allReady && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "reassemble", undefined, "Join the finished scenes again into a new version of the film?")}>Re-join scenes</button>}
          </div>
          {scenes.length > 0 && <ol className="prodm-scenes">
            {scenes.map((scene, index) => <li key={index}>
              <span className="prodm-n">{index + 1}</span>
              <span className={`prodm-state is-${scene.state}`}>{sceneLabel(scene, now)}</span>
              <span className="prodm-meta">{[scene.attempt ? `try ${scene.attempt}/3` : "", scene.nextAt && scene.nextAt > now ? `next ${time(scene.nextAt)}` : "", scene.saved ? "kept" : ""].filter(Boolean).join(" · ")}</span>
              <span className="prodm-detail" title={scene.error || undefined}>{scene.state !== "ready" && scene.error ? sceneNote(scene.error) : scene.predictionId ? `Engine job ${scene.predictionId}` : ""}</span>
              <span className="prodm-btns">
                {["failed", "retry"].includes(scene.state) && <button type="button" className="text-btn" disabled={Boolean(busy)} onClick={() => act(job, "retry-scene", index)}>Retry now</button>}
                {scene.state === "ready" && !isActive(job) && <button type="button" className="text-btn" disabled={Boolean(busy)} onClick={() => act(job, "regenerate-scene", index, `Make scene ${index + 1} again (~$${(perScene(job) / 100).toFixed(2)}) and re-join the film?`)}>Regenerate</button>}
              </span>
            </li>)}
          </ol>}
        </article>;
      })}
    </section>
  </div>;
}
