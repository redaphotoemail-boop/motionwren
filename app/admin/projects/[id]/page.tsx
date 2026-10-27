"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, use, useCallback, useEffect, useState } from "react";

type Asset = { id: string; fileName: string; sizeBytes: number; sortOrder: number };
type Project = { id: string; ownerId: string; title: string; status: string; listingUrl?: string; listingAddress?: string; beds?: string; baths?: string; squareFeet?: string; price?: string; shortMessage?: string; aspect: string; resolution: string; targetDuration?: number; agentName?: string; agentEmail?: string; agentPhone?: string; customerEmail?: string; customerName?: string; finalHistoryId?: string; assets: Asset[] };

export default function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/admin/projects/${id}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Project could not be loaded."); setProject(data.project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be loaded."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function setStatus(status: string) {
    if (!window.confirm(`Move this project to ${status}? The customer will see this status.`)) return;
    setWorking(true); setError(""); setMessage("");
    try { const response = await fetch(`/api/admin/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Status could not be updated."); setMessage(`Project moved to ${status}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Status could not be updated."); }
    finally { setWorking(false); }
  }

  async function deliver(event: FormEvent) {
    event.preventDefault(); if (!video) return setError("Choose the finished video first.");
    setWorking(true); setError(""); setMessage("Uploading final delivery…");
    try { const body = new FormData(); body.append("video", video); const response = await fetch(`/api/admin/projects/${id}`, { method: "POST", body }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Final delivery could not be saved."); setVideo(null); setMessage("Delivery saved. The customer can now download it from project history."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Final delivery could not be saved."); }
    finally { setWorking(false); }
  }

  return <main className="portal-shell admin-shell"><section className="portal-content">
    <div className="portal-title"><div><span className="label">PRODUCTION ORDER</span><h1>{project?.title || "Project"}</h1><p>{project?.customerName || project?.customerEmail || "Customer project"}</p></div><Link className="secondary-action" href="/admin">Back to operations</Link></div>
    {error && <div className="portal-alert error">{error}</div>}{message && <div className="portal-alert success">{message}</div>}{loading ? <div className="portal-empty">Loading production order…</div> : project && <div className="project-operations">
      <section className="ops-panel order-summary"><div className="portal-section-heading"><div><span className="label">LISTING BRIEF</span><h2>{project.listingAddress || project.title}</h2></div><b className={`status-pill ${project.status}`}>{({ draft: "Saved", submitted: "Received", queued: "Queued", generating: "Creating scenes", stitching: "Finishing video", saving: "Preparing delivery", completed: "Ready", failed: "Needs attention" } as Record<string, string>)[project.status] || project.status}</b></div><dl><div><dt>Customer</dt><dd>{project.customerEmail || "—"}</dd></div><div><dt>Property</dt><dd>{[project.beds && `${project.beds} beds`, project.baths && `${project.baths} baths`, project.squareFeet && `${Number(project.squareFeet).toLocaleString()} sq ft`].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt>Price</dt><dd>{project.price ? `$${Number(project.price).toLocaleString()}` : "—"}</dd></div><div><dt>Final video</dt><dd>{project.targetDuration || 20} seconds · {project.resolution} · {project.aspect}</dd></div><div><dt>Listing source</dt><dd>{project.listingUrl ? <a href={project.listingUrl} target="_blank" rel="noreferrer">Open original listing</a> : "Manual entry"}</dd></div><div><dt>Opening message</dt><dd>{project.shortMessage || "—"}</dd></div><div><dt>Agent</dt><dd>{[project.agentName, project.agentEmail, project.agentPhone].filter(Boolean).join(" · ") || "—"}</dd></div></dl></section>
      <section className="ops-panel"><div className="portal-section-heading"><div><span className="label">SOURCE MEDIA</span><h2>{project.assets.length} ordered photographs</h2></div></div><div className="asset-order-list">{project.assets.map((asset, index) => <div key={asset.id}><b>{index + 1}</b><span><strong>{asset.fileName}</strong><small>{(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB</small></span><a href={`/api/admin/projects/${id}/assets/${asset.id}`} target="_blank" rel="noreferrer">View</a><a href={`/api/admin/projects/${id}/assets/${asset.id}?download=1`}>Download</a></div>)}</div></section>
      <section className="ops-panel"><div className="portal-section-heading"><div><span className="label">PRODUCTION CONTROL</span><h2>Track the order</h2></div></div><div className="status-controls">{["queued", "generating", "stitching", "saving", "completed", "failed"].map((status) => <button key={status} disabled={working || project.status === status} onClick={() => setStatus(status)}>{status}</button>)}</div><Link className="primary-action inline-action" href={`/studio?duration=${project.targetDuration || 20}`}>Open Studio Lab</Link></section>
      <section className="ops-panel delivery-panel"><div className="portal-section-heading"><div><span className="label">FINAL DELIVERY</span><h2>Attach the approved video</h2><p>Uploading here marks the project complete, stores the file privately, and adds it to the customer’s history.</p></div></div>{project.finalHistoryId && <a className="delivery-link" href={`/api/history/${project.finalHistoryId}/video?download=1`}>Download current delivery</a>}<form onSubmit={deliver}><input type="file" accept="video/mp4,video/webm" onChange={(event: ChangeEvent<HTMLInputElement>) => setVideo(event.target.files?.[0] || null)}/><button className="primary-action" disabled={working || !video}>{working ? "Saving…" : "Publish final delivery"}</button></form><small>MP4 or WebM, up to 100 MB. Replace only after final quality review.</small></section>
    </div>}
  </section></main>;
}
