"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../ui-icon";
import { studioEngines } from "../engine-catalog";

type Overview = { metrics: { users: Record<string, number>; projects: Record<string, number>; jobs: Record<string, number>; history: Record<string, number>; payments: Record<string, number>; subscriptions: Record<string, number>; storageBytes: number; assets: Record<string, number> }; recentProjects: Array<Record<string, string | number>>; recentJobs: Array<Record<string, string | number | null>>; recentActivity: Array<Record<string, string | number | null>>; system: Record<string, string> };
const bytes = (value: number) => value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;

export default function AdminDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [secondsPerImage, setSecondsPerImage] = useState<3 | 5 | "auto">("auto");
  const [savingTiming, setSavingTiming] = useState(false);
  const [timingMessage, setTimingMessage] = useState("");
  const [defaultEngine, setDefaultEngine] = useState("wan3");
  const [savingEngine, setSavingEngine] = useState(false);
  const [engineMessage, setEngineMessage] = useState("");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [clearingTests, setClearingTests] = useState(false);

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
  useEffect(() => { void Promise.resolve().then(load); }, []);
  useEffect(() => { fetch("/api/admin/settings", { cache: "no-store" }).then((response) => response.json()).then((result) => { if (result.multiShotSecondsPerImage === 3 || result.multiShotSecondsPerImage === 5 || result.multiShotSecondsPerImage === "auto") setSecondsPerImage(result.multiShotSecondsPerImage); if (typeof result.defaultEngine === "string" && studioEngines.some((engine) => engine.key === result.defaultEngine)) setDefaultEngine(result.defaultEngine); }).catch(() => undefined); }, []);

  async function saveTiming(value: 3 | 5 | "auto") {
    setSecondsPerImage(value); setSavingTiming(true); setTimingMessage("");
    try {
      const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ multiShotSecondsPerImage: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The timing setting could not be saved.");
      setTimingMessage(`New multi-shot scenes will use ${value} seconds per image.`);
    } catch (error) { setTimingMessage(error instanceof Error ? error.message : "The timing setting could not be saved."); }
    finally { setSavingTiming(false); }
  }

  async function saveEngine(value: string) {
    setDefaultEngine(value); setSavingEngine(true); setEngineMessage("");
    try {
      const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultEngine: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The engine setting could not be saved.");
      setEngineMessage(`New videos will use ${studioEngines.find((engine) => engine.key === value)?.name || value}.`);
    } catch (error) { setEngineMessage(error instanceof Error ? error.message : "The engine setting could not be saved."); }
    finally { setSavingEngine(false); }
  }

  async function clearTestRows() {
    if (!window.confirm("Delete all of your own draft and failed test projects? Real client orders are untouched. This cannot be undone.")) return;
    setClearingTests(true); setCleanupMessage("");
    try {
      const response = await fetch("/api/admin/cleanup-tests", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Test rows could not be cleared.");
      setCleanupMessage(`Cleared ${result.deletedProjects} test project${result.deletedProjects === 1 ? "" : "s"} and ${result.deletedAssets} stored file${result.deletedAssets === 1 ? "" : "s"}.`);
      await load();
    } catch (error) { setCleanupMessage(error instanceof Error ? error.message : "Test rows could not be cleared."); }
    finally { setClearingTests(false); }
  }

  async function runRetention() {
    if (!window.confirm("Remove expired files and old terminal job records now?")) return;
    setMaintenanceMessage("Running retention…");
    const response = await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "RUN RETENTION" }) });
    const result = await response.json();
    setMaintenanceMessage(response.ok ? `Removed ${result.deletedAssets} expired source files and ${result.deletedHistory} expired deliveries.` : result.error || "Retention could not run.");
    await load();
  }

  const providerCost = Number(data?.metrics.jobs.providerCostCents || 0) / 100;
  const revenue = Number(data?.metrics.payments.revenueCents || 0) / 100;
  const activeProjects = Number(data?.metrics.projects.active || 0);
  const failedJobs = Number(data?.metrics.jobs.failed || 0);
  const stuckJobs = Number(data?.metrics.jobs.stuck || 0);
  const needsAttention = failedJobs + stuckJobs;
  const isReady = (value?: string) => value === "Operational" || value === "Connected";
  const setupItems = [
    { name: "Video generation", value: data?.system.callbacks || "Checking", ready: isReady(data?.system.callbacks) },
    { name: "Video finishing", value: data?.system.compositorStatus || "Checking", ready: isReady(data?.system.compositorStatus) },
    { name: "Email", value: data?.system.email || "Checking", ready: isReady(data?.system.email) },
    { name: "Billing", value: data?.system.billing || "Not connected", ready: isReady(data?.system.billing) },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";

  return <main className="portal-shell admin-shell owner-dashboard">

    <section className="portal-content owner-content" id="overview">
      <div className="owner-welcome"><div><span className="owner-only"><Icon name="shield" size={14}/>Manager access</span><h1>{greeting}</h1><p>Your business, orders and production in one clear view.</p></div><div><Link className="owner-access" href="/dashboard"><Icon name="projects" size={17}/>Open Customer Portal</Link><Link className="primary-action" href="/studio"><Icon name="studio" size={17}/>Open production studio</Link><button className="refresh-admin" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
      {error && <div className="portal-alert error" role="alert">{error}</div>}

      <section className={`owner-health ${needsAttention ? "has-alert" : ""}`}><div><Icon name={needsAttention ? "alert" : "check"}/><span><strong>{needsAttention ? `${needsAttention} item${needsAttention === 1 ? "" : "s"} need attention` : "Production is running normally"}</strong><small>{needsAttention ? "Review the affected jobs below." : `${activeProjects} active ${activeProjects === 1 ? "project" : "projects"} right now.`}</small></span></div><a href="#production">View production <Icon name="arrow" size={15}/></a></section>

      <section className="owner-metrics" aria-label="Business metrics">
        <article><span>Customers</span><strong>{Number(data?.metrics.users.total || 0)}</strong><small>{Number(data?.metrics.users.active || 0)} active</small></article>
        <article><span>Total projects</span><strong>{Number(data?.metrics.projects.total || 0)}</strong><small>{activeProjects} in production</small></article>
        <article><span>Collected revenue</span><strong>${revenue.toFixed(2)}</strong><small>${providerCost.toFixed(2)} provider cost (est.) · ${(revenue - providerCost).toFixed(2)} est. profit</small></article>
        <article><span>Storage</span><strong>{bytes(Number(data?.metrics.storageBytes || 0))}</strong><small>{Number(data?.metrics.assets.total || 0)} stored assets</small></article>
      </section>

      <section className="owner-panel recent-orders" id="orders"><div className="owner-panel-head"><div><span>ORDERS</span><h2>Recent client projects</h2><p>Recent {data?.recentProjects.length || 0} of {Number(data?.metrics.projects.total || 0)} projects</p></div><Link href="/dashboard">Client view <Icon name="arrow" size={14}/></Link><button className="owner-access" onClick={clearTestRows} disabled={clearingTests}>{clearingTests ? "Clearing…" : "Clear test rows"}</button></div>{cleanupMessage && <div className="timing-message" role="status">{cleanupMessage}</div>}<div className="clean-table"><div className="clean-table-head"><span>Property</span><span>Customer</span><span>Items</span><span>Package price</span><span>Est. cost</span><span>Est. profit</span><span>Status</span><span>Photos</span></div>{data?.recentProjects.length ? data.recentProjects.map((project) => { const hasPrice = project.price !== null && project.price !== undefined && String(project.price) !== ""; const price = hasPrice ? Number(project.price) : 0; const hasCost = project.productionCostCents !== null && project.productionCostCents !== undefined; const cost = hasCost ? Number(project.productionCostCents) / 100 : 0; return <Link className="clean-table-row" href={`/admin/projects/${String(project.id)}`} key={String(project.id)}><span><strong>{String(project.title)}</strong><small>{new Date(Number(project.updatedAt)).toLocaleString()}</small></span><span>{String(project.ownerEmail || project.ownerId || "Unknown")}</span><span>{String(project.shortMessage || "")}</span><span>{hasPrice ? `$${price.toFixed(2)}` : "—"}</span><span>{hasCost ? `$${cost.toFixed(2)}` : "—"}</span><span>{hasPrice && hasCost ? `$${(price - cost).toFixed(2)}` : "—"}</span><span><b className={`status-pill ${String(project.status)}`}>{String(project.status)}</b></span><span>{Number(project.assetCount || 0)}</span></Link>; }) : <div className="owner-empty"><Icon name="orders"/><strong>No projects yet</strong><span>New client orders will appear here.</span></div>}</div></section>

      <section className="owner-panel production-queue" id="production"><div className="owner-panel-head"><div><span>PRODUCTION</span><h2>Job activity</h2></div></div><div className="job-list">{data?.recentJobs.length ? data.recentJobs.slice(0, 8).map((job) => <div className="job-item" key={String(job.id)}><i className={String(job.status)}><Icon name={String(job.status) === "failed" ? "alert" : "motion"} size={15}/></i><span><strong>{String(job.projectTitle || job.kind).replaceAll("-", " ")}</strong><small>{String(job.category)} · ${(Number(job.costCents || 0) / 100).toFixed(2)}</small></span><b className={`status-pill ${String(job.status)}`}>{String(job.status)}</b></div>) : <div className="owner-empty compact"><Icon name="motion"/><strong>No jobs yet</strong><span>Production activity will appear here.</span></div>}</div></section>

      <section className="owner-panel costs-panel" id="costs"><div className="owner-panel-head"><div><span>PRODUCTION COSTS</span><h2>What each video costs to make</h2><p>Engine prices per second of video, plus what production has actually cost so far. Until payments are connected, order prices are package totals, not collected payments.</p></div></div><div className="clean-table"><div className="clean-table-head"><span>Engine</span><span>Resolutions</span><span>Price per second</span></div>{studioEngines.map((engine) => <div className="clean-table-row" key={engine.key}><span><strong>{engine.name}</strong><small>{engine.bestFor}</small></span><span>{engine.resolutions.join(" · ")}</span><span>{Object.entries(engine.pricePerSecond).map(([resolution, price]) => `${resolution} $${Number(price).toFixed(3)}`).join(" · ")}</span></div>)}</div><div className="cost-totals"><span>Provider spend (est.) <strong>${providerCost.toFixed(2)}</strong></span><span>Collected revenue <strong>${revenue.toFixed(2)}</strong></span><span>Est. profit <strong>${(revenue - providerCost).toFixed(2)}</strong></span></div></section>

      <section className="owner-panel engine-control" id="engines"><div className="owner-panel-head"><div><span>PRODUCTION ENGINES</span><h2>Choose the right model</h2><p>Pick the engine every new video renders with. Every model below uses its connected production endpoint.</p></div><Link href="/studio">Compare in Studio <Icon name="arrow" size={14}/></Link></div><div className="engine-strip">{studioEngines.map((engine) => <button type="button" key={engine.key} className={engine.key === defaultEngine ? "engine-model active" : "engine-model"} onClick={() => saveEngine(engine.key)} disabled={savingEngine} aria-pressed={engine.key === defaultEngine}><span>{engine.key === defaultEngine ? "SELECTED" : engine.badge || "AVAILABLE"}</span><strong>{engine.name}</strong><small>{engine.resolutions.join(" · ")} · {engine.audio ? "Audio" : "Silent"}</small><p>{engine.description}</p></button>)}</div>{engineMessage && <small className="timing-message" role="status">{engineMessage}</small>}<p className="timing-note">Applies to new videos only. Videos already in production keep the engine they started with.</p></section>

      <section className="owner-panel timing-control" id="timing"><div className="owner-panel-head"><div><span>MULTI-SHOT DEFAULT</span><h2>Scene timing</h2><p>Controls the duration of each scene in new multi-shot productions.</p></div><Icon name="motion" size={22}/></div><div className="timing-options"><button className={secondsPerImage === "auto" ? "active" : ""} onClick={() => saveTiming("auto")} disabled={savingTiming} aria-pressed={secondsPerImage === "auto"}><strong>Automatic</strong><small>5s for 1–4 images · 3s for 5+ images</small></button><button className={secondsPerImage === 3 ? "active" : ""} onClick={() => saveTiming(3)} disabled={savingTiming} aria-pressed={secondsPerImage === 3}><strong>3 seconds</strong><small>Faster, tighter edits</small></button><button className={secondsPerImage === 5 ? "active" : ""} onClick={() => saveTiming(5)} disabled={savingTiming} aria-pressed={secondsPerImage === 5}><strong>5 seconds</strong><small>More room for smooth movement</small></button></div>{timingMessage && <small className="timing-message" role="status">{timingMessage}</small>}<p className="timing-note">This is owner-only. Automatic keeps small sequences readable and makes larger sequences more efficient. The final video length is calculated from the number of scenes and crossfades.</p></section>

      <details className="owner-panel activity-panel"><summary><span><Icon name="history"/><b>Activity</b></span><small>Account, project and production events</small></summary><div className="activity-feed">{data?.recentActivity?.length ? data.recentActivity.map((event) => <div key={String(event.id)}><i><Icon name={String(event.action).includes("deleted") ? "alert" : String(event.action).includes("completed") ? "check" : "history"} size={15}/></i><span><strong>{String(event.action).replaceAll(".", " ")}</strong><small>{String(event.actorName || event.actorEmail || "System")} · {String(event.entityType || "activity")}</small></span><time>{new Date(Number(event.createdAt)).toLocaleString()}</time></div>) : <div className="owner-empty compact"><Icon name="history"/><strong>No activity yet</strong><span>New business events will appear here.</span></div>}</div></details>

      <details className="owner-panel setup-panel"><summary><span><Icon name="storage"/><b>Platform setup and infrastructure</b></span><small>Storage, database and external connections</small></summary><div className="setup-body"><div className="setup-status-grid">{setupItems.map((item) => <div key={item.name}><i className={item.ready ? "ready" : "pending"}/><span><strong>{item.name}</strong><small>{item.value}</small></span></div>)}</div><div className="infrastructure-cards"><article><span>STORAGE</span><h3>{data?.system.storage || "Cloudflare R2"}</h3><p>Private originals and finished videos with lifecycle metadata.</p></article><article><span>DATABASE</span><h3>{data?.system.database || "Cloudflare D1"}</h3><p>Accounts, projects, jobs, credits and audit records.</p></article><article><span>SECURITY</span><h3>Dependency audit</h3><p>{data?.system.dependencyAudit || "Audit status unavailable"}</p></article></div><div className="maintenance-row"><div><strong>Retention cleanup</strong><span>Remove expired source files and old terminal job records.</span>{maintenanceMessage && <small>{maintenanceMessage}</small>}</div><button onClick={runRetention}>Run cleanup</button></div></div></details>
    </section>
  </main>;
}
