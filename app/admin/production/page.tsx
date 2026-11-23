"use client";

import { videoRef } from "../../video-ref";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { PageHead, cents } from "../ui";
import { studioEngines } from "../../engine-catalog";
import EnginePanels from "../engines/panels";
import { ProductionView, isActive, sceneLabel, type StudioJob } from "../../studio/production";
import { ISSUE_WORDS, type IssueCode } from "../../problem-words";
import type { Issue, TimelineEvent } from "../../api/_lib/job-diagnosis";

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

type Health = { engine: string; backupEngine?: string; maxActive: number; activeScenes: number; queuedScenes: number; activeVideos: number; waitingUntil: number; paused: boolean; lowCredit: boolean; lastError: string; lastErrorAt: number; tokenConfigured: boolean; editor?: "ready" | "trouble" | "backup"; editorOkAt?: number; editorError?: string; music?: string; musicNote?: string; polishNote?: string };
type Job = StudioJob & { owner?: string; engine?: string; issues?: Issue[]; timeline?: TimelineEvent[] };

const time = (value: number) => value ? new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
/* A full time for every video and every event: the date too once it is not today. */
const stamp = (value: number, seconds = false) => {
  if (!value) return "time not recorded";
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" as const } : {}) });
  return today ? clock : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${clock}`;
};
const engineLabel = (key?: string) => studioEngines.find((engine) => engine.key === key)?.shortName || "";
const ago = (value: number, now: number) => { const minutes = Math.round((now - value) / 60000); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`; };

export default function ProductionPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [credit, setCredit] = useState<{ saved: { cents: number; at: number } | null; spentCents: number; estimateCents: number | null } | null>(null);
  const [creditInput, setCreditInput] = useState("");
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
    const creditResponse = await fetch("/api/admin/replicate-credit", { cache: "no-store" }).catch(() => null);
    if (creditResponse?.ok) setCredit(await creditResponse.json().catch(() => null));
  }, []);

  async function saveCredit() {
    setError(""); setMessage("");
    const dollars = Number(creditInput);
    if (!Number.isFinite(dollars) || dollars < 0) { setError("Enter the balance in dollars, for example 25."); return; }
    const response = await fetch("/api/admin/replicate-credit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ balanceCents: Math.round(dollars * 100) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The balance could not be saved."); return; }
    setCredit(data); setCreditInput(""); setMessage("Balance saved.");
  }

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

  async function setBackup(value: string) {
    setError("");
    const response = await fetch("/api/admin/production", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupEngine: value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The setting could not be saved."); return; }
    setMessage(value === "off" ? "A stalled scene will wait on its own engine." : "A stalled scene is sent to the backup engine."); await load();
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
  // Every video with a problem, grouped under the problem in words.
  const groups = (Object.keys(ISSUE_WORDS) as IssueCode[]).map((code) => ({ code, words: ISSUE_WORDS[code], items: jobs.flatMap((job) => (job.issues || []).filter((issue) => issue.code === code).map((issue) => ({ job, issue }))) })).filter((group) => group.items.length);
  const problemGroups = groups.filter((group) => group.words.kind === "problem");
  const handledGroups = groups.filter((group) => group.words.kind === "handled");
  const problemCount = problems.length + problemGroups.reduce((sum, group) => sum + group.items.length, 0);
  const fixIssue = (job: Job, issue: Issue) => issue.fix && act(job, issue.fix.action, issue.fix.scene, issue.fix.action === "resume" && issue.fix.note ? `${issue.fix.label.replace("Fix: ", "Resume")}? ${issue.fix.note}` : undefined);
  const issueRow = ({ job, issue }: { job: Job; issue: Issue }, index: number) => <li key={`${job.id}:${issue.code}:${issue.scene ?? ""}:${index}`}>
    <div>
      <strong><b className="video-ref">{videoRef(job.id)}</b> {job.category.replace(/^Studio · /, "") || "Video"}{engineLabel(job.engine) ? ` · ${engineLabel(job.engine)}` : ""}{job.owner ? ` · ${job.owner}` : ""}</strong>
      <small>Started {stamp(job.createdAt, true)} · {issue.code === "stopped" ? "stopped" : "problem"} at {stamp(issue.at, true)}</small>
      <small>{issue.why}</small>
    </div>
    <div className="prodm-fixes">
      {issue.fix && <button type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={() => { void fixIssue(job, issue); }}>{issue.fix.label}</button>}
      <a className="btn btn-soft btn-xs" href="#videos" onClick={() => { const row = document.getElementById(`video-${job.id}`) as HTMLDetailsElement | null; if (row) row.open = true; }}>See video</a>
    </div>
  </li>;
  const dot = (job: Job) => isActive(job) ? "is-live" : job.status === "failed" ? "is-bad" : "is-ok";
  const summary = (job: Job) => {
    const scenes = job.scenes || [];
    const ready = scenes.filter((scene) => scene.state === "ready").length;
    return isActive(job) ? `${ready} of ${scenes.length || job.total || 1} scenes` : job.status === "failed" ? "Stopped" : "Ready";
  };

  return <div className="mgr-page prodm">
    <PageHead eyebrow="Production" title="Production" sub="Is it running, what needs you, and every video being made." />
    <nav className="mgr-jump" aria-label="On this page">
      {problemCount > 0 && <a href="#problems">Problems <b>{problemCount}</b></a>}
      <a href="#videos">Videos</a>
      <a href="#controls">Controls</a>
      <a href="#engines">Engines</a>
      <a href="#credit">Credit</a>
    </nav>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}

    <section className="prodm-strip" aria-label="Production health">
      <span><i className={`dot ${health?.paused || !health?.tokenConfigured ? "dot-bad" : health && health.waitingUntil > now ? "dot-warn" : "dot-ok"}`} />{status}</span>
      <span>Engine <b>{health?.engine || "…"}</b></span>
      <span>With the engine <b>{health ? `${health.activeScenes} of ${health.maxActive}` : "…"}</b>{health ? ` · ${health.queuedScenes} in line` : ""}</span>
      <span>Editing <b>{!health ? "…" : health.editor === "ready" ? "Ready" : health.editor === "trouble" ? "Retrying" : "Backup"}</b></span>
      <span>Music <b>{health?.music || "…"}</b></span>
    </section>

    {(problems.length > 0 || groups.length > 0) && <section id="problems" className="prodm-block" aria-label="Problems">
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
      {problemGroups.map((group) => <div className="prodm-group" key={group.code}>
        <h3>{group.words.title} <small>{group.items.length}</small></h3>
        <p className="muted small">{group.words.meaning}</p>
        <ul className="prodm-problems">{group.items.map(issueRow)}</ul>
      </div>)}
      {handledGroups.length > 0 && <details className="prodm-more">
        <summary>Handled automatically ({handledGroups.reduce((sum, group) => sum + group.items.length, 0)})</summary>
        {handledGroups.map((group) => <div className="prodm-group" key={group.code}>
          <h3>{group.words.title} <small>{group.items.length}</small></h3>
          <p className="muted small">{group.words.meaning}</p>
          <ul className="prodm-problems">{group.items.map(issueRow)}</ul>
        </div>)}
      </details>}
    </section>}

    <section id="credit" className="prodm-block" aria-label="Replicate credit">
      <h2>Replicate credit</h2>
      <div className="prodm-credit">
        <div>
          <strong>{credit?.estimateCents == null ? "Not set yet" : `About ${cents(Math.max(0, credit.estimateCents))} left`}</strong>
          <small>{credit?.saved ? `You had ${cents(credit.saved.cents)} on ${new Date(credit.saved.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}; ${cents(credit.spentCents)} used since. An estimate, Replicate does not share the real balance.` : "Type what Replicate shows and the page keeps count from there."}</small>
          <small><i className={`dot ${health?.paused ? "dot-bad" : health?.lowCredit || (credit?.estimateCents != null && credit.estimateCents < 500) ? "dot-warn" : "dot-ok"}`} />{health?.paused ? "Videos are paused: out of credit" : health?.lowCredit || (credit?.estimateCents != null && credit.estimateCents < 500) ? "Running low" : "Credit looks fine"}</small>
        </div>
        <div className="prodm-fixes">
          <a className="btn btn-ink btn-xs" href="https://replicate.com/account/billing" target="_blank" rel="noreferrer">Open Replicate billing</a>
          <input aria-label="Balance in dollars" inputMode="decimal" placeholder="Balance, $" value={creditInput} onChange={(event) => setCreditInput(event.target.value.replace(/[^0-9.]/g, ""))} />
          <button type="button" className="btn btn-soft btn-xs" disabled={!creditInput} onClick={saveCredit}>Save balance</button>
        </div>
      </div>
    </section>

    <section id="videos" className="prodm-block" aria-label="Videos">
      <h2>Videos <small>last 24 hours{jobs.length ? ` · ${jobs.filter(isActive).length} making · ${jobs.filter((job) => !isActive(job) && job.status !== "failed").length} ready · ${stopped.length} stopped` : ""}</small></h2>
      {!jobs.length && <div className="empty-soft"><strong>No videos in the last 24 hours</strong><span>New client orders and Studio videos appear here.</span></div>}
      <div className="prodm-rows">
      {jobs.map((job) => {
        const scenes = job.scenes || [];
        const allReady = scenes.length > 1 && scenes.every((scene) => scene.state === "ready");
        return <details className="prodm-row" key={job.id} id={`video-${job.id}`}>
          <summary>
            <i className={`dot ${dot(job)}`} />
            <span className="prodm-row-title"><b className="video-ref">{videoRef(job.id)}</b> {job.category.replace(/^Studio · /, "") || "Video"}{job.owner ? <small> · {job.owner}</small> : null}</span>
            <span className="prodm-row-meta">{summary(job)}</span>
            <span className="prodm-row-cost">{cents(job.costCents)}</span>
            <span className="prodm-row-time" title={ago(job.createdAt, now || job.createdAt)}>{stamp(job.createdAt)} · {ago(job.createdAt, now || job.createdAt)}</span>
          </summary>
          <div className="prodm-job">
          <ProductionView job={job} title={`${job.category.replace(/^Studio · /, "") || "Video"}${job.owner ? ` · ${job.owner}` : ""}`} />
          <div className="prodm-actions">
            {job.status === "failed" && <button type="button" className="btn btn-ink btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "resume", undefined, `Resume this video? Finished scenes are kept; about ${scenes.filter((scene) => scene.state !== "ready").length || 1} scene(s) are made again (~$${((perScene(job) * Math.max(1, scenes.filter((scene) => scene.state !== "ready").length)) / 100).toFixed(2)}).`)}>Resume</button>}
            {!isActive(job) && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "start-over", undefined, `Start over with the same photos and settings? Every scene is made again (~$${(job.costCents / 100).toFixed(2)}).`)}>Start over</button>}
            {!isActive(job) && allReady && <button type="button" className="btn btn-soft btn-xs" disabled={Boolean(busy)} onClick={() => act(job, "reassemble", undefined, "Join the finished scenes again into a new version of the film?")}>Re-join scenes</button>}
          </div>
          {(job.timeline || []).length > 0 && <details className="prodm-timeline" open={(job.issues || []).some((issue) => ISSUE_WORDS[issue.code].kind === "problem")}>
            <summary>History of this video</summary>
            <ol>{(job.timeline || []).map((event, index) => <li key={index} className={event.bad ? "is-bad" : ""}><time>{stamp(event.at, true)}</time><span>{event.text}</span></li>)}</ol>
          </details>}
          {(job.status === "failed" || scenes.some((scene) => scene.attempt > 1)) && <EngineReports id={job.id} />}
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


    <details id="controls" className="prodm-block fin-more" aria-label="Controls">
      <summary><span><strong>Controls</strong><small>Scenes at once, engine choice and music tools</small></span></summary>
      <div className="prodm-setting">
        <div><strong>Scenes at once</strong><small>How many scenes the engine makes at the same time. Keep 1 while the engine account is under $5.</small></div>
        <div className="tabs" role="radiogroup" aria-label="Scenes at once">
          {[1, 2, 3, 4].map((value) => <button key={value} type="button" role="radio" aria-checked={health?.maxActive === value} className={health?.maxActive === value ? "active" : ""} onClick={() => setConcurrency(value)}>{value}</button>)}
        </div>
      </div>
      <div className="prodm-setting">
        <div><strong>If a scene stalls, use</strong><small>A scene the engine leaves &ldquo;processing&rdquo; for too long is sent once to this engine, with the scenes still to make. Finished scenes are kept.</small></div>
        <select value={health?.backupEngine || "off"} onChange={(event) => { void setBackup(event.target.value); }} aria-label="Backup engine">
          <option value="off">Off, wait on the same engine</option>
          {studioEngines.filter((item) => !item.unavailable && !item.photoMove).map((item) => <option key={item.key} value={item.key}>{item.shortName || item.name}</option>)}
        </select>
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
    </details>

    <details id="engines" className="prodm-block fin-more" aria-label="Engines">
      <summary><span><strong>Engines</strong><small>Prices, speed and what each engine is for</small></span></summary>
      <EnginePanels part="overview" />
    </details>
  </div>;
}


type Report = { scene: number; attempt: number; engine: string; why: string; status: string; error: string; logs: string; queuedSeconds: number | null; runningSeconds: number | null; predictionId: string; savedAt: number };

/* What the engine itself said when a scene stalled or failed, copied at the time (its own logs are deleted after about an hour). */
function EngineReports({ id }: { id: string }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  async function open(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || reports) return;
    const response = await fetch(`/api/admin/production/${id}`, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    setReports(data?.reports || []);
  }
  return <details className="prodm-report" onToggle={open}>
    <summary>What the engine said</summary>
    {reports === null ? <small>Loading…</small> : reports.length === 0 ? <small>Nothing was saved for this video. Reports are saved from now on whenever a scene stalls or fails.</small> : reports.map((report) => <div key={`${report.scene}-${report.attempt}`}>
      <strong>Scene {report.scene + 1} · try {report.attempt} · {report.engine}</strong>
      <small>{[report.why === "stalled" ? "Stalled" : "Failed", report.status, report.queuedSeconds != null ? `waited ${Math.round(report.queuedSeconds)}s to start` : "", report.runningSeconds != null ? `ran ${Math.round(report.runningSeconds)}s` : "never started running", report.predictionId].filter(Boolean).join(" · ")}</small>
      {report.error && <small>Error: {report.error}</small>}
      <pre>{report.logs || "The engine wrote no log lines."}</pre>
    </div>)}
  </details>;
}
