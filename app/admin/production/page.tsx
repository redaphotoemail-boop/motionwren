"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { PageHead, cents } from "../ui";
import EnginePanels from "../engines/panels";
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

  const status = !health ? "…" : !health.tokenConfigured ? "Engine key missing" : health.paused ? "Paused — needs credit" : health.waitingUntil > now ? `Engine pacing until ${time(health.waitingUntil)}` : "Running normally";
  const perScene = (job: Job) => job.costCents / Math.max(1, job.scenes?.length || job.total || 1);

  type Problem = { id: string; title: string; detail: string; fixes: Array<{ label: string; href?: string; run?: () => void }> };
  const problems: Problem[] = [];
  if (health) {
    if (!health.tokenConfigured) problems.push({ id: "key", title: "Video engine key is missing", detail: "No video can be made until the Replicate key is added.", fixes: [{ label: "Open Replicate keys", href: "https://replicate.com/account/api-tokens" }] });
    if (health.paused || health.lowCredit) problems.push({ id: "credit", title: health.paused ? "Production is paused: the engine account needs credit" : "The engine account is low on credit", detail: "Under $5, Replicate allows one new request about every 10 seconds, so scenes are made one at a time.", fixes: [{ label: "Add credit", href: "https://replicate.com/account/billing" }] });
    if (health.music === "Backup in use" || health.music === "Missing") {
      const paid = /payment_required|paid_plan|free users|upgrade/i.test(health.musicNote || "");
      problems.push({ id: "music", title: health.music === "Missing" ? "Films are being made without music" : "Music is using the backup (Stable Audio)", detail: paid ? "ElevenLabs refuses because the account behind our key is on a free plan, which does not include API use. Upgrading to a paid plan fixes it." : (health.musicNote || "ElevenLabs did not answer.").slice(0, 200), fixes: [...(paid ? [{ label: "Upgrade ElevenLabs", href: "https://elevenlabs.io/app/subscription" }] : []), { label: busy === "music" ? "Checking…" : "Test music again", run: () => void testMusic() }] });
    }
    if (health.editor === "backup" || health.editor === "trouble") problems.push({ id: "editor", title: health.editor === "backup" ? "Editing service is not being used" : "Editing service is retrying", detail: (health.editorError || "Films are being joined by the backup joiner, so the music changes between scenes.").slice(0, 200), fixes: [{ label: "Check again", run: () => void load().then(() => setMessage("Checked.")) }] });
    if (health.waitingUntil > now && !health.paused) problems.push({ id: "pacing", title: "The engine asked us to slow down", detail: `Scenes resume at ${time(health.waitingUntil)}. Nothing is lost.`, fixes: [{ label: "Nothing to do", run: undefined }] });
  }
  const stopped = jobs.filter((job) => job.status === "failed");
  if (stopped.length) problems.push({ id: "stopped", title: `${stopped.length} video${stopped.length === 1 ? "" : "s"} stopped`, detail: "Resume keeps the scenes already made.", fixes: [{ label: "Show them", href: "#videos" }] });
  const dot = (job: Job) => isActive(job) ? "is-live" : job.status === "failed" ? "is-bad" : "is-ok";
  const summary = (job: Job) => {
    const scenes = job.scenes || [];
    const ready = scenes.filter((scene) => scene.state === "ready").length;
    return isActive(job) ? `${ready} of ${scenes.length || job.total || 1} scenes` : job.status === "failed" ? "Stopped" : "Ready";
  };

  return <div className="mgr-page prodm">
    <PageHead eyebrow="Production" title="Production" sub="Settings, problems, every video being made, and the engines." />
    <nav className="mgr-jump" aria-label="On this page">
      <a href="#controls">Controls</a>
      {problems.length > 0 && <a href="#problems">Problems <b>{problems.length}</b></a>}
      <a href="#videos">Videos</a>
      <a href="#engines">Engines</a>
    </nav>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}

    <section id="controls" className="prodm-block" aria-label="Controls">
      <h2>Controls</h2>
      <div className="prodm-setting">
        <div><strong>Scenes at once</strong><small>How many scenes the engine makes at the same time. Keep 1 while the engine account is under $5.</small></div>
        <div className="tabs" role="radiogroup" aria-label="Scenes at once">
          {[1, 2, 3, 4].map((value) => <button key={value} type="button" role="radio" aria-checked={health?.maxActive === value} className={health?.maxActive === value ? "active" : ""} onClick={() => setConcurrency(value)}>{value}</button>)}
        </div>
      </div>
      <EnginePanels part="controls" />
      {samples && <details className="prodm-more">
        <summary>Music tools</summary>
        <div className="prodm-setting">
          <div><strong>Client music samples</strong><small>{samples.every((sample) => sample.ready) ? `All ${samples.length} templates have a sample clients can play.` : `${samples.filter((sample) => sample.ready).length} of ${samples.length} ready.`}</small></div>
          <div className="prod-actions">
            {samples.some((sample) => !sample.ready) && <button type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={() => makeSamples(false)}>{busy === "samples" ? "Making…" : "Make samples"}</button>}
            {samples.every((sample) => sample.ready) && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Make all the samples again? This uses about a minute of ElevenLabs music.")) void makeSamples(true); }}>{busy === "samples" ? "Making…" : "Remake all"}</button>}
          </div>
        </div>
        <div className="prodm-setting">
          <div><strong>Music check</strong><small>Makes a 5-second ElevenLabs track to confirm the key works (a few cents).</small></div>
          <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={testMusic}>{busy === "music" ? "Checking…" : "Test music"}</button>
        </div>
      </details>}
    </section>

    <section className="prodm-strip" aria-label="Production health">
      <span><i className={`dot ${health?.paused || !health?.tokenConfigured ? "dot-bad" : health && health.waitingUntil > now ? "dot-warn" : "dot-ok"}`} />{status}</span>
      <span>Engine <b>{health?.engine || "…"}</b></span>
      <span>With the engine <b>{health ? `${health.activeScenes} of ${health.maxActive}` : "…"}</b>{health ? ` · ${health.queuedScenes} in line` : ""}</span>
      <span>Editing <b>{!health ? "…" : health.editor === "ready" ? "Ready" : health.editor === "trouble" ? "Retrying" : "Backup"}</b></span>
      <span>Music <b>{health?.music || "…"}</b></span>
    </section>

    {problems.length > 0 && <section id="problems" className="prodm-block" aria-label="Problems">
      <h2>Problems</h2>
      <ul className="prodm-problems">
        {problems.map((problem) => <li key={problem.id}>
          <div><strong>{problem.title}</strong><small>{problem.detail}</small></div>
          <div className="prodm-fixes">
            {problem.fixes.filter((fix) => fix.href || fix.run).map((fix) => fix.href
              ? <a key={fix.label} className="btn btn-ink btn-xs" href={fix.href} {...(fix.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{fix.label}</a>
              : <button key={fix.label} type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={fix.run}>{fix.label}</button>)}
          </div>
        </li>)}
      </ul>
    </section>}

    <section id="videos" className="prodm-block" aria-label="Videos">
      <h2>Videos <small>last 24 hours</small></h2>
      {!jobs.length && <div className="empty-soft"><strong>No videos in the last 24 hours</strong><span>New client orders and Studio videos appear here.</span></div>}
      <div className="prodm-rows">
      {jobs.map((job) => {
        const scenes = job.scenes || [];
        const allReady = scenes.length > 1 && scenes.every((scene) => scene.state === "ready");
        return <details className="prodm-row" key={job.id}>
          <summary>
            <i className={`dot ${dot(job)}`} />
            <span className="prodm-row-title">{job.category.replace(/^Studio · /, "") || "Video"}{job.owner ? <small> · {job.owner}</small> : null}</span>
            <span className="prodm-row-meta">{summary(job)}</span>
            <span className="prodm-row-cost">{cents(job.costCents)}</span>
            <span className="prodm-row-time">{ago(job.createdAt, now || job.createdAt)}</span>
          </summary>
          <div className="prodm-job">
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
          </div>
        </details>;
      })}
      </div>
    </section>

    <section id="engines" className="prodm-block" aria-label="Engines">
      <h2>Engines</h2>
      <EnginePanels part="overview" />
    </section>
  </div>;
}
