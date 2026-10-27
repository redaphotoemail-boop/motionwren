"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../ui-icon";
import { studioEngine, studioEngines, type StudioEngineKey } from "../engine-catalog";
import { Metric, PageHead, JobStatus, ago, bytes, cents, money } from "./ui";

type Row = Record<string, string | number | null>;
type Overview = { metrics: { users: Record<string, number>; projects: Record<string, number>; jobs: Record<string, number>; history: Record<string, number>; payments: Record<string, number>; subscriptions: Record<string, number>; storageBytes: number; assets: Record<string, number> }; recentProjects: Row[]; recentJobs: Row[]; recentActivity: Row[]; system: Record<string, string> };

const actionPhrases: Record<string, string> = {
  "project.created": "created an order",
  "project.submitted": "sent an order to production",
  "project.delivered": "received a delivery",
  "project.status_changed": "had a status change",
  "project.deleted": "deleted a project",
  "project.test-rows-cleared": "cleared test rows",
  "asset.uploaded": "uploaded photos",
  "asset.deleted": "removed a photo",
  "listing.imported": "imported a listing link",
  "billing.checkout_created": "opened checkout",
  "account.deletion_requested": "asked to delete their account",
  "retention.completed": "ran retention cleanup",
};
const phrase = (action: string) => actionPhrases[action] || action.replaceAll(".", " ").replaceAll("_", " ").replaceAll("-", " ");

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [defaultEngine, setDefaultEngine] = useState<StudioEngineKey>("wan3");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [runningRetention, setRunningRetention] = useState(false);
  const [today, setToday] = useState("");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [greeting, setGreeting] = useState("Welcome back.");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operations data could not be loaded.");
      setData(result);
    } catch (err) { setError(err instanceof Error ? err.message : "Operations data could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    // Old links pointed at /admin#orders; orders now have their own page.
    if (window.location.hash === "#orders") { window.location.replace(`/admin/orders${window.location.search}`); return; }
    if (window.location.hash === "#engines" || window.location.hash === "#timing") { window.location.replace("/admin/engines"); return; }
    void Promise.resolve().then(() => {
      const now = new Date();
      const hour = now.getHours();
      setGreeting(hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.");
      setToday(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
      return load();
    });
    fetch("/api/admin/settings", { cache: "no-store" }).then((response) => response.json()).then((result) => { if (typeof result.defaultEngine === "string" && studioEngines.some((engine) => engine.key === result.defaultEngine)) setDefaultEngine(result.defaultEngine); }).catch(() => undefined);
  }, []);

  async function runRetention() {
    if (!window.confirm("Remove expired files, old terminal job records, AND expired customer deliveries now? This cannot be undone.")) return;
    setRunningRetention(true); setMaintenanceMessage("Running retention…");
    const response = await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "RUN RETENTION" }) });
    const result = await response.json();
    setMaintenanceMessage(response.ok ? `Removed ${result.deletedAssets} expired source files and ${result.deletedHistory} expired deliveries.` : result.error || "Retention could not run.");
    setRunningRetention(false);
    await load();
  }

  const metrics = data?.metrics;
  const providerCost = Number(metrics?.jobs.providerCostCents || 0) / 100;
  const revenue = Number(metrics?.payments.revenueCents || 0) / 100;
  const totalProjects = Number(metrics?.projects.total || 0);
  const activeProjects = Number(metrics?.projects.active || 0);
  const draftProjects = Number(metrics?.projects.draft || 0);
  const completedProjects = Number(metrics?.projects.completed || 0);
  const failedProjects = Number(metrics?.projects.failed || 0);
  const otherProjects = Math.max(0, totalProjects - activeProjects - draftProjects - completedProjects - failedProjects);
  const failedJobs = Number(metrics?.jobs.failed || 0);
  const stuckJobs = Number(metrics?.jobs.stuck || 0);
  const needsAttention = failedJobs + stuckJobs;
  const isReady = (value?: string) => value === "Operational" || value === "Connected";
  const setupItems = [
    { name: "Video generation", value: data?.system.callbacks || "Checking", ready: isReady(data?.system.callbacks), next: "Check the Worker configuration." },
    { name: "Video finishing", value: data?.system.compositorStatus || "Checking", ready: isReady(data?.system.compositorStatus), next: "Check the Worker configuration." },
    { name: "Email", value: data?.system.email || "Checking", ready: isReady(data?.system.email), next: "Add RESEND_API_KEY and a sender address to the Worker secrets." },
    { name: "Billing", value: data?.system.billing || "Not connected", ready: isReady(data?.system.billing), next: "Add STRIPE_SECRET_KEY to the Worker secrets." },
  ];
  const engine = studioEngine(defaultEngine);
  const pipeline = [
    { key: "draft", label: "Saved", value: draftProjects },
    { key: "production", label: "In production", value: activeProjects + otherProjects },
    { key: "completed", label: "Ready", value: completedProjects },
    { key: "failed", label: "Needs attention", value: failedProjects },
  ];

  return <div className="mgr-page">
    <PageHead eyebrow={today || "Overview"} title={greeting} sub="Your business, orders and production in one clear view.">
      <button type="button" className="text-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      <Link className="btn btn-ink btn-sm" href="/studio"><Icon name="studio" size={15} />Open Studio</Link>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}

    {data ? <>
      <section className={`health${needsAttention ? " health-alert" : ""}`}>
        <span className={`dot ${needsAttention ? "dot-bad" : "dot-ok"}`} />
        <span><strong>{needsAttention ? `${needsAttention} item${needsAttention === 1 ? "" : "s"} need attention` : "Production is running normally"}</strong>{needsAttention ? ` · ${failedJobs} failed, ${stuckJobs} stuck over 15 minutes` : ` · ${activeProjects} active ${activeProjects === 1 ? "project" : "projects"} right now`}</span>
        <Link className="text-btn" href={needsAttention ? "/admin/orders?status=failed" : "/admin/orders?status=production"}>View <Icon name="arrow" size={14} /></Link>
      </section>

      <section className="metrics" aria-label="Business metrics">
        <Metric label="Collected revenue" value={money(revenue)} note={data.system.billing === "Connected" ? "Paid through Stripe" : "Stripe not connected yet"} />
        <Metric label="Provider cost" value={money(providerCost)} note="Estimated, includes test jobs" />
        <Metric label="Orders" value={totalProjects} note={`${activeProjects} in production`} />
        <Metric label="Customers" value={Number(metrics?.users.total || 0)} note={`${Number(metrics?.users.active || 0)} active`} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Order pipeline</h2><Link className="text-btn" href="/admin/orders">All orders <Icon name="arrow" size={14} /></Link></div>
        <div className="pipeline" role="img" aria-label={pipeline.map((step) => `${step.label} ${step.value}`).join(", ")}>
          {pipeline.filter((step) => step.value > 0).map((step) => <i key={step.key} className={`pipe-${step.key}`} style={{ flexGrow: step.value }} />)}
          {!totalProjects && <i className="pipe-empty" />}
        </div>
        <div className="pipeline-legend">
          {pipeline.map((step) => <Link key={step.key} href={`/admin/orders?status=${step.key}`}><span className={`swatch pipe-${step.key}`} /><span>{step.label}</span><b>{step.value}</b></Link>)}
        </div>
      </section>

      <div className="mgr-cols">
        <section className="panel">
          <div className="panel-head"><h2>Live production</h2><span className="muted small">Est. provider cost per job</span></div>
          {data.recentJobs.length ? <ul className="rows">
            {data.recentJobs.slice(0, 7).map((job) => <li key={String(job.id)} className="row">
              <span className="row-main"><strong>{String(job.projectTitle || job.kind || "Render").replaceAll("-", " ")}</strong><small>{String(job.category || "")}{job.resolution ? ` · ${job.resolution}` : ""}{job.duration ? ` · ${job.duration}s` : ""} · {ago(Number(job.updatedAt))}{job.error ? ` · ${String(job.error).slice(0, 70)}` : ""}</small></span>
              <span className="row-num">{cents(job.costCents)}</span>
              <JobStatus status={String(job.status)} />
            </li>)}
          </ul> : <div className="empty-soft compact"><strong>No jobs yet</strong><span>Production activity will appear here.</span></div>}
        </section>

        <div className="mgr-stack">
          <section className="panel engine-now">
            <p className="eyebrow">Default engine</p>
            <h2>{engine.name}</h2>
            <p className="muted">Every new customer video renders with this engine.</p>
            <p className="engine-now-price">{Object.entries(engine.pricePerSecond).map(([resolution, price]) => `${resolution} $${Number(price).toFixed(3)}/s`).join(" · ")}</p>
            <Link className="btn btn-soft btn-sm" href="/admin/engines">Change engine</Link>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>System</h2></div>
            <ul className="system-list">
              {setupItems.map((item) => <li key={item.name}><span className={`dot ${item.ready ? "dot-ok" : "dot-warn"}`} /><span>{item.name}</span><small>{item.value}</small></li>)}
              <li><span className="dot dot-ok" /><span>Storage</span><small>{bytes(Number(metrics?.storageBytes || 0))} · {Number(metrics?.assets.total || 0)} files</small></li>
            </ul>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Recent activity</h2><span className="muted small">Who did what · est. cost shown when production starts</span></div>
        {data.recentActivity?.length ? <ul className="rows activity">
          {data.recentActivity.slice(0, showAllActivity ? 20 : 8).map((event) => {
            const actor = String(event.actorName || event.actorEmail || "System");
            const costed = String(event.action) === "project.submitted" && event.costCents !== null && event.costCents !== undefined;
            return <li key={String(event.id)} className="row">
              <span className="avatar sm" aria-hidden="true">{actor.slice(0, 1).toUpperCase()}</span>
              <span className="row-main"><strong>{actor} <em>{phrase(String(event.action))}</em></strong><small>{event.projectTitle ? String(event.projectTitle) : String(event.entityType || "activity")}{event.actorEmail && event.actorName ? ` · ${String(event.actorEmail)}` : ""}</small></span>
              <span className="row-num">{costed ? cents(event.costCents) : ""}</span>
              <time>{ago(Number(event.createdAt))}</time>
            </li>;
          })}
        </ul> : <div className="empty-soft compact"><strong>No activity yet</strong><span>New business events will appear here.</span></div>}
        {data.recentActivity?.length > 8 && <div className="table-more"><button type="button" className="btn btn-soft btn-sm" onClick={() => setShowAllActivity((value) => !value)}>{showAllActivity ? "Show less" : "Show more"}</button></div>}
      </section>

      <details className="panel fold">
        <summary><span><strong>Platform setup and infrastructure</strong><small>Storage, database and external connections</small></span><Icon name="arrow" size={16} /></summary>
        <ul className="setup-list">
          {setupItems.map((item) => <li key={item.name}><span className={`dot ${item.ready ? "dot-ok" : "dot-warn"}`} /><span><strong>{item.name}</strong><small>{item.value}</small>{!item.ready && <small className="next">Next step: {item.next}</small>}</span></li>)}
        </ul>
        <div className="infra">
          <div><span className="eyebrow">Storage</span><strong>{data.system.storage || "Cloudflare R2"}</strong><small>Private originals and finished videos with lifecycle metadata.</small></div>
          <div><span className="eyebrow">Database</span><strong>{data.system.database || "Cloudflare D1"}</strong><small>Accounts, projects, jobs, credits and audit records.</small></div>
          <div><span className="eyebrow">Security</span><strong>Dependency audit</strong><small>{data.system.dependencyAudit || "Audit status unavailable"}</small></div>
        </div>
      </details>

      <section className="panel maintenance">
        <div><strong>Retention cleanup</strong><small>Remove expired source files, old terminal job records, and expired customer deliveries.</small>{maintenanceMessage && <small className="note">{maintenanceMessage}</small>}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={runRetention} disabled={runningRetention}>{runningRetention ? "Running…" : "Run cleanup"}</button>
      </section>
    </> : !error && <div className="metrics">{[0, 1, 2, 3].map((index) => <div key={index} className="metric skeleton" />)}</div>}
  </div>;
}
