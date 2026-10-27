"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, FormEvent, use, useCallback, useEffect, useState } from "react";
import { Icon } from "../../../ui-icon";
import { StatusPill, money } from "../../ui";

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

  const facts = project ? [
    ["Customer", project.customerName ? `${project.customerName} · ${project.customerEmail || ""}` : project.customerEmail || "—"],
    ["Property", [project.beds && `${project.beds} beds`, project.baths && `${project.baths} baths`, project.squareFeet && `${Number(project.squareFeet).toLocaleString()} sq ft`].filter(Boolean).join(" · ") || "—"],
    ["Package price", project.price ? money(Number(project.price)) : "—"],
    ["Final video", `${project.targetDuration || 20} seconds · ${project.resolution} · ${project.aspect}`],
    ["Opening message", project.shortMessage || "—"],
    ["Agent", [project.agentName, project.agentEmail, project.agentPhone].filter(Boolean).join(" · ") || "—"],
  ] : [];

  return <div className="mgr-page">
    <Link className="text-btn back-link" href="/admin/orders"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>All orders</Link>
    <header className="mgr-head">
      <div>
        <p className="eyebrow">Production order</p>
        <h1>{project?.title || "Project"}</h1>
        <p className="mgr-sub">{project?.listingAddress || project?.customerName || project?.customerEmail || "Customer project"}</p>
      </div>
      {project && <div className="mgr-head-actions"><StatusPill status={project.status} /></div>}
    </header>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}

    {loading && !project ? <div className="empty-soft"><span>Loading production order…</span></div> : project && <div className="mgr-cols">
      <div className="mgr-stack">
        <section className="panel">
          <div className="panel-head"><h2>Listing brief</h2>{project.listingUrl ? <a className="text-btn" href={project.listingUrl} target="_blank" rel="noreferrer">Open original listing <Icon name="arrow" size={14} /></a> : <span className="muted small">Manual entry</span>}</div>
          <dl className="facts-list">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Source photos</h2><span className="muted small">{project.assets.length} in production order</span></div>
          <ol className="asset-grid">{project.assets.map((asset, index) => <li key={asset.id}>
            <a className="asset-thumb" href={`/api/admin/projects/${id}/assets/${asset.id}`} target="_blank" rel="noreferrer" aria-label={`View photo ${index + 1}, ${asset.fileName}`}>
              <Image src={`/api/admin/projects/${id}/assets/${asset.id}`} alt="" width={320} height={240} unoptimized onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              <b>{String(index + 1).padStart(2, "0")}</b>
            </a>
            <span><strong>{asset.fileName}</strong><small>{(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB · <a href={`/api/admin/projects/${id}/assets/${asset.id}?download=1`}>Download</a></small></span>
          </li>)}</ol>
        </section>
      </div>
      <div className="mgr-stack">
        <section className="panel">
          <div className="panel-head"><h2>Production control</h2></div>
          <p className="muted small">Moves the status the customer sees.</p>
          <div className="status-buttons">{["queued", "generating", "stitching", "saving", "completed", "failed"].map((status) => <button key={status} type="button" className={project.status === status ? "active" : ""} disabled={working || project.status === status} onClick={() => setStatus(status)}>{status}</button>)}</div>
          <Link className="btn btn-soft btn-sm" href={`/studio?duration=${project.targetDuration || 20}`}><Icon name="studio" size={15} />Open in Studio</Link>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Final delivery</h2></div>
          <p className="muted small">Uploading here marks the project complete, stores the file privately, and adds it to the customer’s history.</p>
          {project.finalHistoryId && <a className="text-btn" href={`/api/history/${project.finalHistoryId}/video?download=1`}><Icon name="finish" size={15} />Download current delivery</a>}
          <form className="delivery-form" onSubmit={deliver}>
            <label className="file-pick"><input type="file" accept="video/mp4,video/webm" onChange={(event: ChangeEvent<HTMLInputElement>) => setVideo(event.target.files?.[0] || null)} /><span>{video ? video.name : "Choose MP4 or WebM"}</span></label>
            <button className="btn btn-ink btn-sm" disabled={working || !video}>{working ? "Saving…" : "Publish final delivery"}</button>
          </form>
          <p className="fine">Up to 100 MB. Replace only after final quality review.</p>
        </section>
      </div>
    </div>}
  </div>;
}
