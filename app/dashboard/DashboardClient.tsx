"use client";

import { useEffect, useMemo, useState } from "react";

type JobStatus = "uploading" | "new" | "production" | "review" | "delivered" | "archived";
type Job = { id: string; clientName: string; clientEmail: string; businessName: string; projectName: string; packageSeconds: number; style: string; notes: string; status: JobStatus; photoCount: number; createdAt: number; updatedAt: number; completedAt?: number | null; assets?: Array<{ id: string; fileName: string; bytes: number; position: number; url: string }> };
const statusLabels: Record<JobStatus, string> = { uploading: "Incomplete", new: "New", production: "In production", review: "Client review", delivered: "Delivered", archived: "Archived" };

export default function DashboardClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [filter, setFilter] = useState<"active" | JobStatus>("active");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadJobs() {
    setLoading(true);
    try { const response = await fetch("/api/jobs"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setJobs(data.jobs || []); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "The production queue could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadJobs(); }, []);
  const counts = useMemo(() => ({ new: jobs.filter((job) => job.status === "new").length, production: jobs.filter((job) => job.status === "production").length, review: jobs.filter((job) => job.status === "review").length, delivered: jobs.filter((job) => job.status === "delivered").length }), [jobs]);
  const visibleJobs = jobs.filter((job) => filter === "active" ? !["archived", "uploading"].includes(job.status) : job.status === filter);

  async function openJob(id: string) {
    setMessage("");
    const response = await fetch(`/api/jobs/${id}`);
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "This project could not be opened.");
    setSelected(data.job);
  }

  async function changeStatus(status: JobStatus) {
    if (!selected) return;
    setMessage("Saving status…");
    const response = await fetch(`/api/jobs/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "The status could not be changed.");
    setSelected(data.job);
    setJobs((current) => current.map((job) => job.id === selected.id ? { ...job, status, updatedAt: Date.now() } : job));
    setMessage("Status saved.");
  }

  return <main className="dashboard-shell">
    <header className="dashboard-header"><a className="client-brand" href="/dashboard"><span>FM</span> FRAME MOTION</a><nav><a href="/">Client page</a><a href="/studio">Production studio</a></nav></header>
    <section className="dashboard-title"><div><p className="client-kicker">OWNER DASHBOARD</p><h1>Production queue</h1><p>Every client, source photo and production decision in one place.</p></div><button onClick={loadJobs}>Refresh</button></section>
    <section className="dashboard-metrics"><article><span>New</span><strong>{counts.new}</strong><small>Ready to review</small></article><article><span>Production</span><strong>{counts.production}</strong><small>Being created</small></article><article><span>Review</span><strong>{counts.review}</strong><small>Waiting on client</small></article><article><span>Delivered</span><strong>{counts.delivered}</strong><small>Completed projects</small></article></section>
    <section className="dashboard-workspace">
      <div className="queue-panel"><div className="queue-toolbar"><div>{(["active", "new", "production", "review", "delivered"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "active" ? "Active" : statusLabels[value]}</button>)}</div><span>{visibleJobs.length} project{visibleJobs.length === 1 ? "" : "s"}</span></div>{loading ? <div className="queue-empty">Loading the production queue…</div> : visibleJobs.length ? <div className="queue-list">{visibleJobs.map((job) => <button key={job.id} className={selected?.id === job.id ? "job-row active" : "job-row"} onClick={() => openJob(job.id)}><div><strong>{job.projectName}</strong><span>{job.businessName} · {job.clientName}</span></div><div><b>{job.packageSeconds}s</b><span>{job.photoCount} photos</span></div><div><i className={`status-${job.status}`}>{statusLabels[job.status]}</i><small>{new Date(job.createdAt).toLocaleDateString()}</small></div></button>)}</div> : <div className="queue-empty"><strong>No projects here.</strong><span>New client submissions will appear automatically.</span></div>}</div>
      <aside className="job-detail">{selected ? <><div className="job-detail-head"><div><span>{selected.id.slice(0, 8).toUpperCase()}</span><h2>{selected.projectName}</h2><p>{selected.businessName}</p></div><div className="job-detail-actions"><a href={`/api/jobs/${selected.id}/download`}>Download project ZIP</a><a href={`/studio?job=${selected.id}`}>Open in production studio →</a></div></div><div className="detail-grid"><div><span>Client</span><strong>{selected.clientName}</strong><a href={`mailto:${selected.clientEmail}`}>{selected.clientEmail}</a></div><div><span>Film</span><strong>{selected.packageSeconds} seconds</strong><small>{selected.style} direction · {selected.photoCount} photos</small></div><div className="detail-wide"><span>Production status</span><select value={selected.status} onChange={(event) => changeStatus(event.target.value as JobStatus)}>{(["new", "production", "review", "delivered", "archived"] as JobStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div>{selected.notes && <div className="detail-wide"><span>Client notes</span><p>{selected.notes}</p></div>}</div><div className="asset-heading"><div><span>SOURCE PHOTOS</span><strong>{selected.assets?.length || 0} files in production order</strong></div><small>Open or download any original</small></div><div className="asset-grid">{selected.assets?.map((asset, index) => <article key={asset.id}><a href={asset.url} target="_blank"><img src={asset.url} alt={`Source photo ${index + 1}`}/></a><div><span>{index + 1}</span><a href={`${asset.url}?download=1`}>Download</a></div></article>)}</div></> : <div className="detail-empty"><span>◫</span><strong>Select a project</strong><p>Client details, notes and source photos will appear here.</p></div>}</aside>
    </section>{message && <div className="dashboard-message">{message}</div>}
  </main>;
}
