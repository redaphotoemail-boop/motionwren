"use client";

/* WrenCut — admin only. Bring a reference edit (a video file or a direct
   link), and it is read and turned into a template named "MotionWren N".
   Nothing of the reference is kept. A template's preview clip is built from
   real footage: videos chosen from History and/or uploaded photos. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WrenTemplate } from "../../wrencut";
import { studioEngines } from "../../engine-catalog";
import { PageHead } from "../ui";
import { PreviewPlayer } from "../../wrencut-player";

type HistoryItem = { id: string; prompt: string; duration: number; videoUrl: string; createdAt: number };
const STAGES: Record<string, string> = { moves: "Reading camera moves and speed ramps…", text: "Reading the titles…", sound: "Listening for music and effects…", downloading: "Receiving the video…", reading: "Finding the cuts…", cuts: "Finding the cuts…", colour: "Reading the colour…", saving: "Saving the template…" };

export default function WrenCutPage() {
  const [templates, setTemplates] = useState<WrenTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/wrencut", { cache: "no-store" });
      if (response.ok) setTemplates(((await response.json()) as { templates: WrenTemplate[] }).templates);
    } catch { /* the list stays as it was */ }
    setLoaded(true);
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);

  function follow(job: string) {
    const tick = async () => {
      try {
        const response = await fetch(`/api/admin/wrencut?job=${job}`, { cache: "no-store" });
        const data = await response.json() as { status?: string; stage?: string; error?: string; template?: WrenTemplate };
        if (data.status === "done" && data.template) { setBusy(""); setMessage(`${data.template.name} is ready — ${data.template.seconds} s, built for ${data.template.photos} photos. Add its preview below.`); await load(); return; }
        if (data.status === "failed" || data.status === "unknown" || !response.ok) { setBusy(""); setMessage(data.error || "The video could not be read. Try again."); return; }
        setBusy(STAGES[data.stage || ""] || "Reading the edit…");
      } catch { /* try again on the next tick */ }
      timer.current = setTimeout(tick, 3000);
    };
    void tick();
  }

  async function start(init: RequestInit) {
    setMessage(""); setBusy("Receiving the video…");
    try {
      const response = await fetch("/api/admin/wrencut/read", init);
      const data = await response.json() as { job?: string; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "The video could not be sent.");
      follow(data.job);
    } catch (error) { setBusy(""); setMessage(error instanceof Error ? error.message : "The video could not be sent."); }
  }
  const sendFile = (file: File) => start({ method: "POST", headers: { "Content-Type": file.type || "video/mp4" }, body: file });
  const sendLink = () => start({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) });

  async function act(id: string, action: "active" | "delete" | "rename" | "engine", active?: boolean, name?: string, engine?: string) {
    const response = await fetch("/api/admin/wrencut", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, active, name, engine }) });
    const data = await response.json() as { templates?: WrenTemplate[]; error?: string };
    if (response.ok && data.templates) setTemplates(data.templates); else setMessage(data.error || "That could not be saved.");
  }

  return (
    <div className="mgr-page">
      <PageHead eyebrow="Manager · Admin only" title="WrenCut" sub="Bring an edit you like. It is read — cuts, camera moves, transitions, colour — and kept as a MotionWren template. The reference is deleted." />
      {message ? <p className="notice">{message}</p> : null}
      <div className="mgr-stack lib-stack">
        <section className="panel wc-bring">
          <div className="panel-head"><h2>Bring a reference</h2></div>
          <label className={busy ? "ml-file off" : "ml-file"}>Upload the video<input type="file" accept="video/*" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void sendFile(file); }} /></label>
          <div className="wc-or"><span>or paste a link</span></div>
          <div className="wc-link">
            <input type="url" inputMode="url" placeholder="https://…/video.mp4" value={link} disabled={Boolean(busy)} onChange={(event) => setLink(event.target.value)} />
            <button type="button" className="secondary" disabled={Boolean(busy) || !link.trim()} onClick={() => { void sendLink(); }}>Read it</button>
          </div>
          <p className="muted small">Paste a TikTok, Instagram or other video link and the server will try to fetch it. Some links are blocked by the site. If this one is, use Instagram\u2019s Share → Download, then upload the file.</p>
          {busy ? <p className="wc-busy" role="status"><i />{busy}</p> : null}
        </section>
        {templates.map((template) => <TemplateCard key={template.id} template={template} onChange={load} onAct={act} />)}
        {loaded && !templates.length ? <p className="muted">No templates yet. Bring the first reference above.</p> : null}
      </div>
    </div>
  );
}

function TemplateCard({ template, onChange, onAct }: { template: WrenTemplate; onChange: () => Promise<void>; onAct: (id: string, action: "active" | "delete" | "rename" | "engine", active?: boolean, name?: string, engine?: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(template.name);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState(template.previewUrl || "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // A preview keeps being made on the server when this page is left: on return, pick it up again.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/admin/wrencut/preview?id=${template.id}`, { cache: "no-store" });
        const data = await response.json() as { status?: string; previewUrl?: string };
        if (cancelled) return;
        if (data.status === "done" && data.previewUrl) { setPreviewUrl(data.previewUrl); void onChange(); }
        else if (data.status === "running") { setStatus("Making the preview…"); follow(); }
      } catch { /* nothing was running */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  async function openPicker() {
    setOpen(!open);
    if (history) return;
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      const data = response.ok ? await response.json() as { items: HistoryItem[] } : { items: [] };
      setHistory(data.items);
    } catch { setHistory([]); }
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(""); setStatus("Uploading photos…");
    const keys: string[] = [];
    for (const file of Array.from(files).slice(0, 12)) {
      const response = await fetch("/api/admin/wrencut/photo", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const data = await response.json() as { key?: string; error?: string };
      if (!response.ok || !data.key) { setError(data.error || "A photo could not be uploaded."); setStatus(""); return; }
      keys.push(data.key);
    }
    setPhotos((current) => [...current, ...keys].slice(0, 12)); setStatus("");
  }
  function follow() {
    const tick = async () => {
      try {
        const response = await fetch(`/api/admin/wrencut/preview?id=${template.id}`, { cache: "no-store" });
        const data = await response.json() as { status?: string; error?: string; previewUrl?: string; sound?: string };
        if (data.status === "done" && data.previewUrl) { setPreviewUrl(data.previewUrl); setStatus(""); setOpen(false); if (data.sound) setError(data.sound); await onChange(); return; }
        if (data.status === "failed" || data.status === "unknown" || !response.ok) { setStatus(""); setError(data.error || "The preview could not be made. Try again."); return; }
      } catch { /* try again */ }
      timer.current = setTimeout(tick, 3000);
    };
    timer.current = setTimeout(tick, 3000);
  }
  async function build() {
    setError(""); setStatus("Making the preview…");
    try {
      const response = await fetch("/api/admin/wrencut/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: template.id, history: picked, photos }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "The preview could not be started.");
      follow();
    } catch (cause) { setStatus(""); setError(cause instanceof Error ? cause.message : "The preview could not be started."); }
  }
  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 12));

  return (
    <section className="panel wc-card">
      <div className="wc-top">
        <span className="wc-poster">{previewUrl ? <video src={previewUrl} muted loop playsInline autoPlay preload="metadata" /> : <b>{Math.round(template.seconds)}<small>s</small></b>}</span>
        <div className="wc-meta">
          {renaming ? (
            <form className="wc-rename" onSubmit={(event) => { event.preventDefault(); void onAct(template.id, "rename", undefined, nameDraft).then(() => setRenaming(false)); }}>
              <input value={nameDraft} maxLength={40} autoFocus aria-label="Template name" onChange={(event) => setNameDraft(event.target.value)} />
              <button type="submit" disabled={!nameDraft.trim()}>Save</button>
              <button type="button" className="ml-del" onClick={() => setRenaming(false)}>Cancel</button>
            </form>
          ) : <h2>{template.name} <button type="button" className="ml-del wc-edit" onClick={() => { setNameDraft(template.name); setRenaming(true); }}>Rename</button></h2>}
          <p className="muted">{template.seconds} s · built for {template.photos} photos{template.hasMusic ? " · music style" : ""}{template.hasEffects ? " · cut effects" : ""}{template.titles?.length ? ` · ${template.titles.length} titles` : ""}{template.ramps ? ` · ${template.ramps} speed ramps` : ""}</p>
        </div>
        <button type="button" role="switch" aria-checked={template.active} aria-label="Show in Studio" className={template.active ? "ml-switch on" : "ml-switch"} onClick={() => { void onAct(template.id, "active", !template.active); }}><i /></button>
      </div>
      <label className="wc-engine"><span>Made with</span>
        <select value={template.engine || ""} onChange={(event) => { void onAct(template.id, "engine", undefined, undefined, event.target.value); }}>
          <option value="">Studio&rsquo;s current engine</option>
          {studioEngines.filter((item) => !item.unavailable && !item.photoMove).map((item) => <option key={item.key} value={item.key}>{item.shortName}</option>)}
        </select>
      </label>
      <div className="wc-actions">
        {previewUrl ? <button type="button" className="secondary" onClick={() => setWatching(true)}>Watch with sound</button> : null}
        <button type="button" className="secondary" onClick={() => { void openPicker(); }}>{previewUrl ? "Make a new preview" : "Make the preview"}</button>
        <button type="button" className="ml-del" onClick={() => { if (window.confirm(`Delete ${template.name}?`)) void onAct(template.id, "delete"); }}>Delete</button>
      </div>
      {open ? (
        <div className="wc-picker">
          <p className="muted small">Choose videos from History (they are cut to fit), or upload photos. This template is built for {template.photos} photos — more clips than that are fine, fewer repeat.</p>
          {history === null ? <p className="muted small">Loading History…</p> : history.length ? (
            <ul className="wc-history">
              {history.map((item) => (
                <li key={item.id}>
                  <button type="button" className={picked.includes(item.id) ? "on" : ""} aria-pressed={picked.includes(item.id)} onClick={() => toggle(item.id)}>
                    <video src={`${item.videoUrl}#t=0.1`} muted playsInline preload="metadata" />
                    <small>{Math.round(item.duration)}s</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No videos in History yet.</p>}
          <label className="ml-file wc-photos">Upload photos{photos.length ? ` (${photos.length} added)` : ""}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} /></label>
          <button type="button" disabled={Boolean(status) || (!picked.length && !photos.length)} onClick={() => { void build(); }}>Make the preview</button>
        </div>
      ) : null}
      {watching && previewUrl ? <PreviewPlayer src={previewUrl} title={template.name} onClose={() => setWatching(false)} /> : null}
      {status ? <p className="wc-busy" role="status"><i />{status}</p> : null}
      {error ? <p className="notice">{error}</p> : null}
    </section>
  );
}
