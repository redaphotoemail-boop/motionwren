"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../ui-icon";
import { WrenMark, Wordmark } from "../components/brand";
import PropertyFilm from "../components/property-film";

type Account = { displayName: string; email: string; role: "admin" | "customer"; plan: string; creditBalance: number };
type Project = { id: string; title: string; status: string; listingAddress?: string; assetCount: number; aspect: string; resolution: string; targetDuration?: number; updatedAt: number; finalHistoryId?: string | null };
type Notification = { id: string; type: string; title: string; message: string; readAt?: number | null; createdAt: number };
type Group = "all" | "production" | "completed" | "draft" | "failed";

const activeStatuses = ["submitted", "queued", "generating", "stitching", "saving"];
const statusCopy: Record<string, { label: string; detail: string }> = {
  draft: { label: "Saved", detail: "This order is saved." },
  submitted: { label: "Received", detail: "Your project is in the production queue." },
  queued: { label: "Queued", detail: "Production will begin shortly." },
  generating: { label: "Creating scenes", detail: "Your property photos are being animated." },
  stitching: { label: "Finishing video", detail: "Scenes, transitions and audio are being assembled." },
  saving: { label: "Preparing delivery", detail: "The final quality check is underway." },
  completed: { label: "Ready", detail: "Your video is ready to download." },
  failed: { label: "Needs attention", detail: "We could not finish this version." },
};
const groupOf = (status: string): Exclude<Group, "all"> => status === "draft" ? "draft" : status === "failed" ? "failed" : status === "completed" ? "completed" : "production";
const groupLabels: Record<Group, string> = { all: "All", production: "In production", completed: "Ready", draft: "Saved", failed: "Needs attention" };
const discover = [
  { title: "Content package", text: "The full set: hero film, vertical reel, story teaser, feed posts and graphics, sized for every channel. $83 full package.", shape: "set" },
  { title: "Hero listing film", text: "One polished film from your listing photos. $39.", shape: "wide" },
  { title: "Vertical reel", text: "Short-form video for Instagram and TikTok. $19.", shape: "tall" },
] as const;

function greetingFor(date: Date) {
  const hour = date.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function Cover({ project }: { project: Project }) {
  const group = groupOf(project.status);
  const vertical = project.aspect === "vertical" || project.aspect === "9:16";
  return <div className={`cover cover-${group}`} aria-hidden="true">
    <div className={`cover-frame ${vertical ? "tall" : "wide"}`}>
      {group === "completed" && <span className="cover-play" />}
      {group === "production" && <span className="cover-sheen" />}
      {group === "failed" && <Icon name="alert" size={22} />}
      {group === "draft" && <Icon name="projects" size={22} />}
    </div>
  </div>;
}

export default function CustomerDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [filter, setFilter] = useState<Group>("all");
  const [error, setError] = useState("");
  const [greeting, setGreeting] = useState("Welcome");
  const hasActiveProject = projects.some((project) => activeStatuses.includes(project.status));

  async function load() {
    setLoading(true); setError("");
    try {
      const [accountResponse, projectResponse, notificationResponse] = await Promise.all([fetch("/api/account", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" }), fetch("/api/notifications", { cache: "no-store" })]);
      const accountData = await accountResponse.json(); const projectData = await projectResponse.json(); const notificationData = await notificationResponse.json();
      if (!accountResponse.ok) throw new Error(accountData.error || "Sign in is required.");
      if (!projectResponse.ok) throw new Error(projectData.error || "Projects could not be loaded.");
      setAccount(accountData.account); setBillingEnabled(Boolean(accountData.billingEnabled)); setProjects(projectData.projects || []); if (notificationResponse.ok) setNotifications(notificationData.notifications || []);
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
        if (response.ok) setProjects(data.projects || []);
      } catch { /* The next interval or manual refresh will retry. */ }
    }, 10000);
    return () => window.clearInterval(interval);
  }, [hasActiveProject]);

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
    setMessage("Production restarted. You can close this page.");
    await load();
  }

  async function deleteProject(id: string) {
    if (!window.confirm("Delete this project and all of its uploaded photos?")) return;
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!response.ok) return setError("The project could not be deleted.");
    setSelectedIds((ids) => ids.filter((selected) => selected !== id));
    await load();
  }

  async function deleteSelected() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} project${selectedIds.length === 1 ? "" : "s"} and all of their uploaded photos? This cannot be undone.`)) return;
    setError("");
    let failed = 0;
    for (const id of selectedIds) {
      const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!response.ok) failed += 1;
    }
    if (failed) setError(`${failed} project${failed === 1 ? "" : "s"} could not be deleted.`);
    setSelectedIds([]); setSelecting(false);
    await load();
  }

  async function dismissNotification(id: string) {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt: Date.now() } : item));
  }

  function toggleSelected(id: string) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id]);
  }

  const counts: Record<Group, number> = { all: projects.length, production: 0, completed: 0, draft: 0, failed: 0 };
  for (const project of projects) counts[groupOf(project.status)] += 1;
  const visibleProjects = projects.filter((project) => filter === "all" || groupOf(project.status) === filter);
  const firstUnread = notifications.find((item) => !item.readAt);
  const firstName = account?.displayName && !account.displayName.includes("@") ? account.displayName.trim().split(/\s+/)[0] : "";
  const summary = [counts.production && `${counts.production} in production`, counts.completed && `${counts.completed} ready`, counts.failed && `${counts.failed} need${counts.failed === 1 ? "s" : ""} attention`].filter(Boolean).join(" · ");
  const initial = (account?.displayName || account?.email || "M").slice(0, 1).toUpperCase();

  return <main className="ws">
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
              <a className="ws-menu-link" href="/api/auth/logout" target="_top">Sign out</a>
            </div>
          </details>
        </nav>
      </div>
    </header>

    <div className="ws-wrap ws-body">
      <section className="ws-hello">
        <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>{loading ? "Loading your videos…" : summary || (projects.length ? "Everything is up to date." : "Your workspace is ready.")}</p>
      </section>

      {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
      {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}
      {firstUnread && <div className="notice"><span className={`dot ${firstUnread.type.includes("failed") ? "dot-bad" : "dot-ok"}`} /><span><strong>{firstUnread.title}</strong> {firstUnread.message}</span><button type="button" className="text-btn" onClick={() => dismissNotification(firstUnread.id)}>Dismiss</button></div>}

      {billingEnabled && account?.role !== "admin" && <section className="credits">
        <div><p className="eyebrow">Video credits</p><h2>Choose only what you need.</h2></div>
        <div className="credits-options">
          <button type="button" onClick={() => startCheckout("single")}><strong>1 video</strong><span>$29</span></button>
          <button type="button" onClick={() => startCheckout("five")}><strong>5 videos</strong><span>$125</span></button>
          <button type="button" onClick={() => startCheckout("pro")}><strong>10 monthly</strong><span>$199/mo</span></button>
        </div>
      </section>}

      <section id="projects" className="ws-videos" aria-labelledby="videos-title">
        <div className="ws-bar">
          <h2 id="videos-title" className="sr-only">Your videos</h2>
          {projects.length > 0 ? <div className="tabs" role="tablist" aria-label="Filter videos">
            {(["all", "production", "completed", "draft", "failed"] as Group[]).filter((group) => group === "all" || counts[group] > 0 || filter === group).map((group) => <button key={group} type="button" role="tab" aria-selected={filter === group} className={filter === group ? "active" : ""} onClick={() => setFilter(group)}>{groupLabels[group]}<span>{counts[group]}</span></button>)}
          </div> : <span />}
          <div className="ws-bar-tools">
            {projects.length > 0 && <button type="button" className="text-btn" onClick={() => { setSelecting((value) => !value); setSelectedIds([]); }}>{selecting ? "Done" : "Select"}</button>}
            {projects.length > 0 && <button type="button" className="text-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>}
          </div>
        </div>

        {loading && !projects.length ? <div className="video-grid">{[0, 1, 2].map((index) => <div key={index} className="video-card skeleton" />)}</div>
          : projects.length ? (visibleProjects.length ? <div className={`video-grid${selecting ? " is-selecting" : ""}`}>
            <button type="button" className="video-new" data-mw="plan"><span className="video-new-plus">+</span><strong>New video</strong><small>Upload listing photos</small></button>
            {visibleProjects.map((project) => {
              const status = statusCopy[project.status] || { label: project.status, detail: "Project status updated." };
              const group = groupOf(project.status);
              const selected = selectedIds.includes(project.id);
              return <article className={`video-card${selected ? " selected" : ""}`} key={project.id}>
                {selecting && <label className="video-check"><input type="checkbox" checked={selected} onChange={() => toggleSelected(project.id)} aria-label={`Select ${project.title}`} /><span /></label>}
                <Cover project={project} />
                <div className="video-info">
                  <div className="video-status"><span className={`status status-${group}`}><i />{status.label}</span><time>{new Date(project.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
                  <h3>{project.title}</h3>
                  <p>{project.listingAddress || status.detail}</p>
                  {project.status === "completed" && !project.finalHistoryId && <p className="video-warn">Download expired — contact us to restore.</p>}
                  <p className="video-meta">{project.assetCount} photos · {project.targetDuration || 20}s · {project.aspect === "vertical" ? "9:16" : project.aspect === "horizontal" ? "16:9" : project.aspect}</p>
                  <div className="video-actions">
                    {project.finalHistoryId && <a className="btn btn-ink btn-xs" href={`/api/history/${project.finalHistoryId}/video?download=1`}><Icon name="finish" size={14} />Download</a>}
                    {project.status === "failed" && <button type="button" className="btn btn-soft btn-xs" onClick={() => retryProject(project.id)}>Try again</button>}
                    <button type="button" className="text-btn danger" onClick={() => deleteProject(project.id)}>Delete</button>
                  </div>
                </div>
              </article>;
            })}
          </div> : <div className="empty-soft"><strong>No videos match this filter</strong><span>Try a different status.</span></div>)
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

      <footer className="ws-foot"><WrenMark size={18} /><span>MotionWren</span><a href="mailto:info@redaphoto.com">Help</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></footer>
    </div>

    {selecting && <div className="select-bar" role="region" aria-label="Selection">
      <span>{selectedIds.length} selected</span>
      <button type="button" className="text-btn" onClick={() => setSelectedIds(visibleProjects.map((project) => project.id))}>Select all</button>
      {selectedIds.length > 0 && <button type="button" className="text-btn" onClick={() => setSelectedIds([])}>Clear selection</button>}
      <button type="button" className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={!selectedIds.length}>Delete selected</button>
    </div>}
    <button type="button" className="fab" data-mw="plan" aria-label="Create video"><span aria-hidden="true">+</span>Create video</button>
  </main>;
}
