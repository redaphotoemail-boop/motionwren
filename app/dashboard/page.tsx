"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../ui-icon";

type Account = { displayName: string; email: string; role: "admin" | "customer"; plan: string; creditBalance: number };
type Project = { id: string; title: string; status: string; listingAddress?: string; assetCount: number; aspect: string; resolution: string; targetDuration?: number; updatedAt: number; finalHistoryId?: string | null };
type Notification = { id: string; type: string; title: string; message: string; readAt?: number | null; createdAt: number };

const activeStatuses = ["submitted", "queued", "generating", "stitching", "saving"];
const statusCopy: Record<string, { label: string; detail: string }> = {
  draft: { label: "Ready to submit", detail: "Your photos are saved." },
  submitted: { label: "Received", detail: "Your project is in the production queue." },
  queued: { label: "Queued", detail: "Production will begin shortly." },
  generating: { label: "Creating scenes", detail: "Your property photos are being animated." },
  stitching: { label: "Finishing video", detail: "Scenes, transitions and audio are being assembled." },
  saving: { label: "Preparing delivery", detail: "The final quality check is underway." },
  completed: { label: "Ready", detail: "Your video is ready to download." },
  failed: { label: "Needs attention", detail: "We could not finish this version." },
};

export default function CustomerDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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

  useEffect(() => { void Promise.resolve().then(load); }, []);
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

  async function submitProject(id: string) {
    setError("");
    const response = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "The project could not be submitted.");
    const generation = await fetch(`/api/projects/${id}/generate`, { method: "POST" });
    const generationData = await generation.json();
    setMessage(generation.ok ? "Production started. You can close this page." : generationData.error || "Project submitted and waiting for production.");
    await load();
  }

  async function startCheckout(plan: "single" | "five" | "pro") {
    setError("");
    const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    const data = await response.json();
    if (!response.ok || !data.url) return setError(data.error || "Checkout could not be started.");
    window.location.assign(data.url);
  }

  async function deleteProject(id: string) {
    if (!window.confirm("Delete this project and all of its uploaded photos?")) return;
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!response.ok) return setError("The project could not be deleted.");
    await load();
  }

  const inProgress = projects.filter((project) => activeStatuses.includes(project.status)).length;
  const completed = projects.filter((project) => project.status === "completed").length;

  return <main className="portal-shell customer-shell premium-dashboard">
    <header className="portal-header client-header">
      <Link className="brand" href="/"><span className="brand-mark">MW</span><span>MotionWren</span></Link>
      <nav aria-label="Workspace"><a className="active" href="#projects"><Icon name="projects" size={16}/>Videos</a><button data-mw="video"><Icon name="upload" size={16}/>Create</button>{account?.role === "admin" && <Link className="owner-nav" href="/admin"><Icon name="dashboard" size={16}/>Manager</Link>}</nav>
      <div className="account-actions"><div className="account-chip"><strong>{account?.displayName || "Account"}</strong><small>{account?.role === "admin" ? "Owner" : account?.plan || "Member"}</small></div><a className="sign-out-link" href="/api/auth/logout" target="_top">Sign out</a></div>
    </header>

    <section className="portal-content client-content">
      <div className="client-welcome"><div><span className="label">YOUR VIDEO WORKSPACE</span><h1>{account?.displayName ? `Welcome, ${account.displayName.split(" ")[0]}` : "Welcome"}</h1><p>Turn listing photos into a polished property video in minutes.</p><button type="button" className="text-action" data-mw="plan">Not sure what you need? Plan my content package</button></div><button className="primary-action" data-mw="video"><Icon name="upload" size={17}/>Create a video</button></div>
      {error && <div className="portal-alert error" role="alert">{error}</div>}{message && <div className="portal-alert success" role="status">{message}</div>}
      {notifications.some((item) => !item.readAt) && <div className="client-notice"><Icon name={notifications.some((item) => !item.readAt && item.type.includes("failed")) ? "alert" : "check"}/><div><strong>{notifications.find((item) => !item.readAt)?.title}</strong><span>{notifications.find((item) => !item.readAt)?.message}</span></div><button onClick={async () => { await fetch("/api/notifications", { method: "PATCH" }); setNotifications((items) => items.map((item) => ({ ...item, readAt: Date.now() }))); }}>Dismiss</button></div>}

      <section id="projects" className="client-projects">
        <div className="client-section-head"><div><span className="label">YOUR VIDEOS</span><h2>Projects and deliveries</h2></div><div className="project-summary"><span><b>{inProgress}</b> in progress</span><span><b>{completed}</b> ready</span>{account?.plan !== "internal" && <span><b>{account?.creditBalance ?? 0}</b> credits</span>}<button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
        {billingEnabled && account?.role !== "admin" && <section className="credit-purchase"><div><span className="label">VIDEO CREDITS</span><h2>Choose only what you need.</h2></div><div><button onClick={() => startCheckout("single")}><strong>1 video</strong><span>$29</span></button><button onClick={() => startCheckout("five")}><strong>5 videos</strong><span>$125</span></button><button onClick={() => startCheckout("pro")}><strong>10 monthly</strong><span>$199/mo</span></button></div></section>}
        {loading ? <div className="portal-empty">Loading your videos…</div> : projects.length ? <div className="project-list-clean">{projects.map((project) => { const status = statusCopy[project.status] || { label: project.status, detail: "Project status updated." }; return <article className="project-row" key={project.id}><div className="project-thumbnail"><Icon name={project.status === "completed" ? "check" : "motion"}/></div><div className="project-main"><div><span className={`status-pill ${project.status}`}>{status.label}</span><small>{new Date(project.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></div><h3>{project.title}</h3><p>{status.detail}</p><div className="project-meta"><span>{project.assetCount} photos</span><span>{project.targetDuration || 20}s</span><span>{project.resolution}</span><span>{project.aspect}</span></div></div><div className="project-row-actions">{project.status === "draft" && <button onClick={() => submitProject(project.id)}>Start production</button>}{project.finalHistoryId && <a className="download-project" href={`/api/history/${project.finalHistoryId}/video?download=1`}><Icon name="finish" size={16}/>Download</a>}<button className="more-delete" onClick={() => deleteProject(project.id)}>Delete</button></div></article>; })}</div> : <div className="portal-empty friendly-empty"><Icon name="projects" size={30}/><strong>No videos yet</strong><span>Add a listing and your photos to create the first one.</span><button className="primary-action" data-mw="video">Create your first video</button></div>}
      </section>
    </section>
    <button className="mobile-create-button" data-mw="video"><Icon name="upload" size={18}/>Create video</button>
  </main>;
}
