"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui-icon";
import { WrenMark, Wordmark } from "../components/brand";
import PropertyFilm from "../components/property-film";
import { buildOrders, groupOf, kindOf, productionProgress, type Deliverable, type DeliverableKind, type Order, type Project, type StatusGroup } from "./orders";

/* The client's workspace: every order in one place, each with all of its
   deliverables — the videos MotionWren produces and the pieces our team
   designs — with their status, a player and downloads. */

type Account = { displayName: string; email: string; role: "admin" | "customer"; plan: string; creditBalance: number };
type Notification = { id: string; type: string; title: string; message: string; readAt?: number | null; createdAt: number };
type Filter = "all" | StatusGroup | "history";
type Playing = { title: string; historyId: string; vertical: boolean };

const ACTIVE = ["approval", "submitted", "queued", "generating", "stitching", "saving", "editing", "review"];
/* Being made by the engines right now: these cannot be deleted mid-way. */
const MAKING = ["queued", "generating", "stitching", "saving"];
/* A video still "Starting" after a few minutes never reached the engines
   (a dropped connection or the hourly limit); offer to start it again. */
const STUCK_AFTER = 3 * 60 * 1000;
/* The customer-facing holding message. Keep the wording in sync with
   HOLDING_MESSAGE in app/api/_lib/render-jobs.ts — the same words go in the
   notification and the email. */
const HOLDING_MESSAGE = "We're looking into this — your video is taking a little longer than usual. This can happen with a technical issue or a high volume of submissions. We're on it and we'll get back to you as soon as it's ready.";
const videoStatus: Record<string, string> = {
  draft: "Saved",
  approval: "Received",
  submitted: "Starting",
  queued: "Queued",
  generating: "Creating scenes",
  stitching: "Finishing",
  saving: "Preparing delivery",
  editing: "In final edit",
  review: "Final check",
  completed: "Ready",
  failed: "Needs attention",
  cancelled: "Stopped",
};
const filterLabels: Record<Filter, string> = { all: "All", production: "In production", completed: "Ready", failed: "Needs attention", cancelled: "Stopped", draft: "Saved", history: "History" };
const discover = [
  { title: "Content package", text: "The full set: hero film, vertical reel, story teaser, feed posts and graphics, sized for every channel. $83 full package.", shape: "set" },
  { title: "Hero listing film", text: "One polished film from your listing photos. $39.", shape: "wide" },
  { title: "Vertical reel", text: "Short-form video for Instagram and TikTok. $19.", shape: "tall" },
] as const;

function greetingFor(date: Date) {
  const hour = date.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dateTime = (time: number) => new Date(time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function KindIcon({ kind }: { kind: DeliverableKind }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "film") return <svg {...common}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" /></svg>;
  if (kind === "reel") return <svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="m10.5 9.5 4 2.5-4 2.5z" /></svg>;
  if (kind === "story") return <svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M9.5 5.5h5" /><circle cx="12" cy="13" r="2.5" /></svg>;
  if (kind === "post") return <svg {...common}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.5" /></svg>;
  if (kind === "cover") return <svg {...common}><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="m4.5 17 5-5 4 4 2.5-2.5 3.5 3.5" /><circle cx="16" cy="9" r="1.5" /></svg>;
  return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m12 7.5 1.2 3.3 3.3 1.2-3.3 1.2L12 16.5l-1.2-3.3L7.5 12l3.3-1.2z" /></svg>;
}

/* A calm, determinate bar for a video being made; it moves as scenes finish. */
function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return <span className="mw-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></span>;
}

function aspectLabel(aspect: string) {
  return aspect === "vertical" ? "9:16" : aspect === "horizontal" ? "16:9" : aspect;
}

export default function CustomerDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [greeting, setGreeting] = useState("Welcome");
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0); // when the list was last loaded
  const hasActiveProject = projects.some((project) => ACTIVE.includes(project.status));
  const orders = useMemo(() => buildOrders(projects), [projects]);

  async function load() {
    setLoading(true); setError("");
    try {
      const [accountResponse, projectResponse, notificationResponse] = await Promise.all([fetch("/api/account", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" }), fetch("/api/notifications", { cache: "no-store" })]);
      const accountData = await accountResponse.json(); const projectData = await projectResponse.json(); const notificationData = await notificationResponse.json();
      if (!accountResponse.ok) throw new Error(accountData.error || "Sign in is required.");
      if (!projectResponse.ok) throw new Error(projectData.error || "Your orders could not be loaded.");
      setAccount(accountData.account); setBillingEnabled(Boolean(accountData.billingEnabled)); setProjects(projectData.projects || []); setCheckedAt(Date.now()); if (notificationResponse.ok) setNotifications(notificationData.notifications || []);
    } catch (err) { setError(err instanceof Error ? err.message : "The workspace could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void Promise.resolve().then(() => { setGreeting(greetingFor(new Date())); return load(); }); }, []);
  useEffect(() => {
    if (!hasActiveProject) return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const data = await response.json();
        if (response.ok) { setProjects(data.projects || []); setCheckedAt(Date.now()); }
      } catch { /* The next interval or manual refresh will retry. */ }
    }, 10000);
    return () => window.clearInterval(interval);
  }, [hasActiveProject]);
  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPlaying(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  async function redeemCode(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setError(""); setMessage(""); setRedeeming(true);
    try {
      const response = await fetch("/api/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "That code could not be used.");
      else { setMessage(data.message || "Code applied."); setCode(""); await load(); }
    } catch { setError("That code could not be used. Try again."); }
    finally { setRedeeming(false); }
  }

  async function startCheckout(plan: "single" | "five" | "pro") {
    setError("");
    const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    const data = await response.json();
    if (!response.ok || !data.url) return setError(data.error || "Checkout could not be started.");
    window.location.assign(data.url);
  }

  async function retryProject(id: string) {
    setError(""); setMessage("");
    const response = await fetch(`/api/projects/${id}/generate`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Production could not be restarted."); return; }
    setMessage(data.status === "approval" ? "Received. Your video goes into production shortly." : "Production restarted. You can close this page.");
    await load();
  }

  async function refundProject(id: string) {
    if (!window.confirm("Return 1 video credit to your account and stop this order?")) return;
    setError(""); setMessage("");
    const response = await fetch(`/api/projects/${id}/refund`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The refund could not be issued. Please try again."); return; }
    setMessage("Refund issued — 1 video credit was returned to your account.");
    await load();
  }

  async function removeOrders(list: Order[]) {
    let failed = 0;
    let busy = false;
    for (const order of list) {
      for (const project of order.projects) {
        const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
        if (response.status === 409) busy = true;
        else if (!response.ok) failed += 1;
      }
    }
    if (busy) setError("Videos that are being made can be deleted once they finish.");
    else if (failed) setError("Part of this could not be deleted. Please try again.");
  }

  async function deleteOrder(order: Order) {
    if (!window.confirm("Delete this order, its videos and its photos? This cannot be undone.")) return;
    setError("");
    await removeOrders([order]);
    setSelectedKeys((keys) => keys.filter((key) => key !== order.key));
    await load();
  }

  async function deleteSelected() {
    const list = orders.filter((order) => selectedKeys.includes(order.key));
    if (!list.length) return;
    if (!window.confirm(`Delete ${list.length} order${list.length === 1 ? "" : "s"}, with their videos and photos? This cannot be undone.`)) return;
    setError("");
    await removeOrders(list);
    setSelectedKeys([]); setSelecting(false);
    await load();
  }

  async function downloadData() {
    setError("");
    try {
      const response = await fetch("/api/account/export", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "motionwren-my-data.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setError("Your data could not be downloaded. Please try again."); }
  }

  async function deleteAccount() {
    /* Export first: deletion is permanent and removes orders, photos,
       videos and credits. The account menu above already offers
       "Download my data" — this step makes sure it is not skipped. */
    if (!window.confirm("Delete your account permanently? Download your data first (account menu → Download my data) — deletion removes your orders, photos, videos and credits and cannot be undone.")) return;
    const typed = window.prompt("This permanently deletes your account, orders, photos and videos. Type DELETE MY ACCOUNT to confirm.");
    if (typed === null) return;
    if (typed.trim() !== "DELETE MY ACCOUNT") { setError("Account not deleted. Type DELETE MY ACCOUNT exactly to confirm."); return; }
    const response = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Your account could not be deleted. Please contact us."); return; }
    window.location.assign("/api/auth/logout");
  }

  async function dismissNotification(id: string) {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt: Date.now() } : item));
  }

  function toggleSelected(key: string) {
    setSelectedKeys((keys) => keys.includes(key) ? keys.filter((selected) => selected !== key) : [...keys, key]);
  }

  const counts: Record<Filter, number> = { all: orders.length, production: 0, completed: 0, failed: 0, cancelled: 0, draft: 0, history: 0 };
  for (const order of orders) counts[order.group] += 1;
  const visibleOrders = orders.filter((order) => filter === "all" || order.group === filter);
  // History: every video ever ordered, newest first, one row each.
  const orderTitle = new Map<string, string>();
  for (const order of orders) for (const project of order.projects) orderTitle.set(project.id, order.title);
  const historyItems = projects.filter((project) => project.status !== "draft" && project.title.trim().toLowerCase() !== "content package").sort((a, b) => b.createdAt - a.createdAt);
  counts.history = historyItems.length;
  const videoGroups = projects.filter((project) => project.title.trim().toLowerCase() !== "content package").map((project) => groupOf(project.status));
  const readyVideos = videoGroups.filter((group) => group === "completed").length;
  const makingVideos = videoGroups.filter((group) => group === "production").length;
  const failedVideos = videoGroups.filter((group) => group === "failed").length;
  const summary = [readyVideos && `${readyVideos} ${readyVideos === 1 ? "video" : "videos"} ready`, makingVideos && `${makingVideos} in production`, failedVideos && `${failedVideos} need${failedVideos === 1 ? "s" : ""} attention`].filter(Boolean).join(" · ");
  const firstUnread = notifications.find((item) => !item.readAt);
  const firstName = account?.displayName && !account.displayName.includes("@") ? account.displayName.trim().split(/\s+/)[0] : "";
  const initial = (account?.displayName || account?.email || "M").slice(0, 1).toUpperCase();

  function renderDeliverable(item: Deliverable) {
    if (item.type === "design") {
      return <li className="dlv" key={item.key}>
        <span className="dlv-icon"><KindIcon kind={item.kind} /></span>
        <div className="dlv-text"><strong>{item.title}</strong><small>Designed by our team</small></div>
        <span className="status status-design"><i />In design</span>
      </li>;
    }
    const project = item.project;
    const vertical = project.aspect === "vertical";
    const expired = project.status === "completed" && !project.finalHistoryId;
    const stuck = project.status === "submitted" && checkedAt > 0 && checkedAt - project.updatedAt > STUCK_AFTER;
    const canRetry = project.status === "failed" || stuck;
    const holding = Boolean(project.holding);
    const until = project.videoExpiresAt ? `Available until ${shortDate(project.videoExpiresAt)}` : "";
    const progress = productionProgress(project);
    return <li className="dlv" key={item.key}>
      <span className="dlv-icon"><KindIcon kind={item.kind} /></span>
      <div className="dlv-text">
        <strong>{item.title}</strong>
        <small>{[aspectLabel(project.aspect), project.targetDuration ? `${project.targetDuration} sec` : "", project.finalHistoryId ? until : "", progress?.detail || ""].filter(Boolean).join(" · ")}</small>
        {holding ? <span className="dlv-note">{HOLDING_MESSAGE}</span> : progress && !stuck && <ProgressBar percent={progress.percent} label={progress.stage} />}
      </div>
      <span className={`status status-${item.group}`}><i />{holding ? "Taking longer" : progress && !stuck ? progress.stage : videoStatus[project.status] || project.status}</span>
      {(project.finalHistoryId || canRetry || expired || (holding && project.refundable)) && <div className="dlv-actions">
        {project.finalHistoryId && <>
          <button type="button" className="btn btn-soft btn-xs" onClick={() => setPlaying({ title: item.title, historyId: project.finalHistoryId as string, vertical })}><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor" /></svg>Watch</button>
          <a className="btn btn-ink btn-xs" href={`/api/history/${project.finalHistoryId}/video?download=1`}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>Download</a>
        </>}
        {canRetry && <button type="button" className="btn btn-soft btn-xs" onClick={() => retryProject(project.id)}>Try again</button>}
        {holding && project.refundable && <button type="button" className="btn btn-soft btn-xs" onClick={() => refundProject(project.id)}>Request a refund</button>}
        {expired && <span className="dlv-note">Download expired — <a href="mailto:info@redaphoto.com">contact us</a></span>}
      </div>}
    </li>;
  }

  return <main className="ws" id="main-content">
    <header className="ws-top">
      <div className="ws-wrap ws-top-inner">
        <Link href="/" className="ws-home" aria-label="MotionWren home"><Wordmark size={28} /></Link>
        <nav className="ws-actions" aria-label="Workspace">
          {account?.role === "admin" && <Link className="text-btn" href="/admin"><Icon name="dashboard" size={16} />Manager</Link>}
          <button type="button" className="btn btn-ink btn-sm ws-create-top" data-mw="plan"><span aria-hidden="true">+</span>Create video</button>
          <details className="ws-account">
            <summary aria-label="Account"><span className="avatar">{initial}</span></summary>
            <div className="ws-menu">
              <strong>{account?.displayName || (loading ? "Loading…" : "Account")}</strong>
              <small>{account?.email}</small>
              {account && <small className="ws-menu-plan">{account.role === "admin" ? "Owner" : account.plan === "free" ? "Pay per video" : account.plan}{account.plan !== "internal" ? ` · ${account.creditBalance ?? 0} credits` : ""}</small>}
              <button type="button" className="ws-menu-item" onClick={downloadData}>Download my data</button>
              {account?.role !== "admin" && <button type="button" className="ws-menu-item danger" onClick={deleteAccount}>Delete account</button>}
              <a className="ws-menu-link" href="/api/auth/logout" target="_top">Sign out</a>
            </div>
          </details>
        </nav>
      </div>
    </header>

    <div className="ws-wrap ws-body">
      <section className="ws-hello">
        <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>{loading ? "Loading your orders…" : summary || (orders.length ? "Everything is up to date." : "Your workspace is ready.")}</p>
      </section>

      {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
      {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}
      {firstUnread && <div className="notice"><span className={`dot ${firstUnread.type.includes("failed") ? "dot-bad" : "dot-ok"}`} /><span><strong>{firstUnread.title}</strong> {firstUnread.message}</span><button type="button" className="text-btn" onClick={() => dismissNotification(firstUnread.id)}>Dismiss</button></div>}

      {account?.role !== "admin" && <section className="credits">
        <div><p className="eyebrow">Video credits</p><h2>Choose only what you need.</h2></div>
        <div className="credits-options">
          <button type="button" disabled={!billingEnabled} onClick={() => startCheckout("single")}><strong>1 video</strong><span>$29</span></button>
          <button type="button" disabled={!billingEnabled} onClick={() => startCheckout("five")}><strong>5 videos</strong><span>$125</span></button>
          <button type="button" disabled={!billingEnabled} onClick={() => startCheckout("pro")}><strong>10 monthly</strong><span>$199/mo</span></button>
        </div>
        {!billingEnabled && <p className="fine">Card payments are not switched on yet.</p>}
      </section>}

      {account && account.role !== "admin" && <form className="redeem" onSubmit={redeemCode}>
        <label htmlFor="gift-code">Have a gift code?</label>
        <input id="gift-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="MW-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} />
        <button type="submit" disabled={redeeming || !code.trim()}>{redeeming ? "Checking…" : "Redeem"}</button>
      </form>}

      <section id="orders" className="ws-videos" aria-labelledby="orders-title">
        <div className="ws-bar">
          <h2 id="orders-title" className="sr-only">Your orders</h2>
          {orders.length > 0 ? <div className="tabs" role="tablist" aria-label="Filter orders">
            {(["all", "production", "completed", "failed", "cancelled", "draft", "history"] as Filter[]).filter((group) => group === "all" || counts[group] > 0 || filter === group).map((group) => <button key={group} type="button" role="tab" aria-selected={filter === group} className={filter === group ? "active" : ""} onClick={() => { setFilter(group); if (group === "history") { setSelecting(false); setSelectedKeys([]); } }}>{filterLabels[group]}<span>{counts[group]}</span></button>)}
          </div> : <span />}
          <div className="ws-bar-tools">
            {orders.length > 0 && filter !== "history" && <button type="button" className="text-btn" onClick={() => { setSelecting((value) => !value); setSelectedKeys([]); }}>{selecting ? "Done" : "Select"}</button>}
            {orders.length > 0 && <button type="button" className="text-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>}
          </div>
        </div>

        {filter === "history" ? (historyItems.length ? <ol className="hist-list">
          {historyItems.map((project) => {
            const progress = productionProgress(project);
            const group = groupOf(project.status);
            const vertical = project.aspect === "vertical";
            const stuck = project.status === "submitted" && checkedAt > 0 && checkedAt - project.updatedAt > STUCK_AFTER;
            const canRetry = project.status === "failed" || stuck;
            const holding = Boolean(project.holding);
            const coverKey = project.coverAssetId ? `${project.id}/${project.coverAssetId}` : "";
            return <li className="hist-row" key={project.id}>
              <span className={`hist-thumb${vertical ? " tall" : ""}`}>
                {coverKey && !brokenCovers.includes(coverKey)
                  // eslint-disable-next-line @next/next/no-img-element -- private, signed-in photo served by our own API
                  ? <img src={`/api/projects/${project.id}/assets/${project.coverAssetId}`} alt="" loading="lazy" decoding="async" onError={() => setBrokenCovers((list) => [...list, coverKey])} />
                  : <KindIcon kind={kindOf(project.title, project.aspect)} />}
              </span>
              <div className="hist-text">
                <strong>{project.title}</strong>
                <small>{[orderTitle.get(project.id) && orderTitle.get(project.id) !== project.title ? orderTitle.get(project.id) as string : "", dateTime(project.createdAt), project.targetDuration ? `${project.targetDuration} sec` : "", aspectLabel(project.aspect)].filter(Boolean).join(" · ")}</small>
                {holding ? <span className="dlv-note">{HOLDING_MESSAGE}</span> : progress && !stuck && <ProgressBar percent={progress.percent} label={progress.stage} />}
              </div>
              <span className={`status status-${group}`}><i />{holding ? "Taking longer" : progress && !stuck ? (progress.detail || progress.stage) : videoStatus[project.status] || project.status}</span>
              <div className="hist-actions">
                {project.finalHistoryId && <>
                  <button type="button" className="btn btn-soft btn-xs" onClick={() => setPlaying({ title: project.title, historyId: project.finalHistoryId as string, vertical })}>Watch</button>
                  <a className="btn btn-ink btn-xs" href={`/api/history/${project.finalHistoryId}/video?download=1`}>Download</a>
                </>}
                {canRetry && <button type="button" className="btn btn-soft btn-xs" onClick={() => retryProject(project.id)}>Try again</button>}
                {holding && project.refundable && <button type="button" className="btn btn-soft btn-xs" onClick={() => refundProject(project.id)}>Request a refund</button>}
              </div>
            </li>;
          })}
        </ol> : <div className="empty-soft"><strong>No videos yet</strong><span>Every video you order will be listed here.</span></div>)
        : loading && !projects.length ? <div className="order-list">{[0, 1].map((index) => <div key={index} className="order order-skeleton skeleton" />)}</div>
          : orders.length ? (visibleOrders.length ? <div className={`order-list${selecting ? " is-selecting" : ""}`}>
            {visibleOrders.map((order) => {
              const selected = selectedKeys.includes(order.key);
              const coverKey = order.cover ? `${order.cover.projectId}/${order.cover.assetId}` : "";
              const showCover = order.cover && !brokenCovers.includes(coverKey);
              return <article className={`order${selected ? " selected" : ""}`} key={order.key}>
                {selecting && <label className="video-check"><input type="checkbox" checked={selected} onChange={() => toggleSelected(order.key)} aria-label={`Select ${order.title}`} /><span /></label>}
                <div className="order-cover">
                  {showCover && order.cover
                    // eslint-disable-next-line @next/next/no-img-element -- private, signed-in photo served by our own API
                    ? <img src={`/api/projects/${order.cover.projectId}/assets/${order.cover.assetId}`} alt="" loading="lazy" decoding="async" onError={() => setBrokenCovers((list) => [...list, coverKey])} />
                    : <span className="order-cover-art" aria-hidden="true"><WrenMark size={34} /></span>}
                </div>
                <div className="order-body">
                  <header className="order-head">
                    <div className="order-name">
                      <h3>{order.title}</h3>
                      <p>{[shortDate(order.createdAt), order.code ? `Order ${order.code}` : "", order.listingAddress || ""].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="order-count">{order.videos ? `${order.ready} of ${order.videos} ${order.videos === 1 ? "video" : "videos"} ready` : "In design"}</span>
                  </header>
                  <ul className="dlv-list">{order.deliverables.map(renderDeliverable)}</ul>
                  {!order.projects.some((project) => MAKING.includes(project.status)) && <div className="order-foot"><button type="button" className="text-btn danger" onClick={() => deleteOrder(order)}>Delete order</button></div>}
                </div>
              </article>;
            })}
            <button type="button" className="order-new" data-mw="plan"><span className="video-new-plus">+</span><strong>New order</strong><small>Upload listing photos</small></button>
          </div> : <div className="empty-soft"><strong>No orders match this filter</strong><span>Try a different status.</span></div>)
          : <div className="ws-empty">
            <div className="ws-empty-film"><PropertyFilm hud="label" interval={4400} label="Sample property film" /></div>
            <h2>Your first film starts here.</h2>
            <p>Add your listing photos and we will turn them into a polished property video.</p>
            <button type="button" className="btn btn-ink btn-lg" data-mw="plan">Create your first video</button>
          </div>}
      </section>

      <section id="discover" className="discover" aria-labelledby="discover-title">
        <p className="eyebrow">Discover</p>
        <h2 id="discover-title">More for every listing.</h2>
        <div className="discover-grid">
          {discover.map((item) => <button type="button" key={item.title} className="discover-item" data-mw="plan">
            <span className={`discover-art art-${item.shape}`} aria-hidden="true"><i /><i /><i /></span>
            <strong>{item.title}</strong>
            <small>{item.text}</small>
            <span className="discover-go">Create <Icon name="arrow" size={14} /></span>
          </button>)}
        </div>
      </section>

      <footer className="ws-foot"><WrenMark size={18} /><span>MotionWren</span><a href="mailto:info@redaphoto.com">Help</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refund">Refunds</Link><Link href="/cookies">Cookies</Link><Link href="/accessibility">Accessibility</Link></footer>
    </div>

    {selecting && <div className="select-bar" role="region" aria-label="Selection">
      <span>{selectedKeys.length} selected</span>
      <button type="button" className="text-btn" onClick={() => setSelectedKeys(visibleOrders.map((order) => order.key))}>Select all</button>
      {selectedKeys.length > 0 && <button type="button" className="text-btn" onClick={() => setSelectedKeys([])}>Clear selection</button>}
      <button type="button" className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={!selectedKeys.length}>Delete selected</button>
    </div>}

    {playing && <div className="player" role="dialog" aria-modal="true" aria-label={playing.title} onClick={(event) => { if (event.target === event.currentTarget) setPlaying(null); }}>
      <div className={`player-sheet${playing.vertical ? " tall" : ""}`}>
        <div className="player-bar">
          <strong>{playing.title}</strong>
          <button type="button" className="player-x" aria-label="Close" onClick={() => setPlaying(null)}><svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
        <video className="player-video" src={`/api/history/${playing.historyId}/video`} controls autoPlay playsInline preload="metadata" />
        <div className="player-actions"><a className="btn btn-ink btn-sm" href={`/api/history/${playing.historyId}/video?download=1`}>Download</a></div>
      </div>
    </div>}
    <button type="button" className="fab" data-mw="plan" aria-label="Create video"><span aria-hidden="true">+</span>Create video</button>
  </main>;
}
