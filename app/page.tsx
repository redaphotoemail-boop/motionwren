"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type PackageSeconds = 20 | 35 | 50;
type FilmStyle = "classic" | "social" | "luxury";
type UploadState = "idle" | "creating" | "uploading" | "finishing" | "success" | "error";
type SelectedPhoto = { id: string; file: File; preview: string };

const packages: Array<{ seconds: PackageSeconds; photos: number; label: string; note: string }> = [
  { seconds: 20, photos: 5, label: "20 seconds", note: "A focused social introduction" },
  { seconds: 35, photos: 10, label: "35 seconds", note: "A complete property story" },
  { seconds: 50, photos: 15, label: "50 seconds", note: "A fuller premium showcase" },
];

const styles: Array<{ value: FilmStyle; label: string; note: string }> = [
  { value: "classic", label: "Classic", note: "Clean and property-focused" },
  { value: "social", label: "Social", note: "Vertical and attention-ready" },
  { value: "luxury", label: "Luxury", note: "Slower and cinematic" },
];

function photoKey(file: File) {
  return `${file.name.toLowerCase()}:${file.size}:${file.lastModified}`;
}

export default function ClientPortal() {
  const inputRef = useRef<HTMLInputElement>(null);
  const draggedId = useRef<string | null>(null);
  const [packageSeconds, setPackageSeconds] = useState<PackageSeconds>(35);
  const [style, setStyle] = useState<FilmStyle>("classic");
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [draft, setDraft] = useState<{ id: string; uploadToken: string } | null>(null);
  const selectedPackage = packages.find((item) => item.seconds === packageSeconds)!;
  const requiredPhotos = selectedPackage.photos;
  const remaining = Math.max(0, requiredPhotos - photos.length);
  const ready = photos.length === requiredPhotos && clientName.trim() && clientEmail.includes("@") && businessName.trim() && projectName.trim();
  const busy = ["creating", "uploading", "finishing"].includes(status);
  const totalSize = useMemo(() => photos.reduce((sum, photo) => sum + photo.file.size, 0), [photos]);

  function changePackage(seconds: PackageSeconds) {
    if (busy) return;
    setPackageSeconds(seconds);
    const nextLimit = packages.find((item) => item.seconds === seconds)!.photos;
    setPhotos((current) => {
      current.slice(nextLimit).forEach((photo) => URL.revokeObjectURL(photo.preview));
      return current.slice(0, nextLimit);
    });
    setDraft(null);
    setError("");
  }

  function addPhotos(files: FileList | File[]) {
    if (busy) return;
    const incoming = Array.from(files);
    const invalid = incoming.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024);
    if (invalid) return setError("Use JPG, PNG or WebP photos under 12 MB each.");
    setPhotos((current) => {
      const existing = new Set(current.map((photo) => photoKey(photo.file)));
      const unique = incoming.filter((file) => !existing.has(photoKey(file)));
      const room = requiredPhotos - current.length;
      if (unique.length > room) setError(`This version uses exactly ${requiredPhotos} photos. ${room} space${room === 1 ? "" : "s"} remain.`);
      else if (unique.length < incoming.length) setError("Duplicate photos were skipped.");
      else setError("");
      return [...current, ...unique.slice(0, room).map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))];
    });
    setDraft(null);
  }

  function removePhoto(id: string) {
    if (busy) return;
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((photo) => photo.id !== id);
    });
    setDraft(null);
  }

  function movePhoto(sourceId: string | null, targetId: string) {
    if (!sourceId || sourceId === targetId || busy) return;
    setPhotos((current) => {
      const from = current.findIndex((photo) => photo.id === sourceId);
      const to = current.findIndex((photo) => photo.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraft(null);
  }

  async function sendProject() {
    if (!ready || busy) return;
    setError("");
    setProgress(0);
    try {
      let activeDraft = draft;
      if (!activeDraft) {
        setStatus("creating");
        const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName, clientEmail, businessName, projectName, packageSeconds, style, notes }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We could not start your project.");
        activeDraft = { id: data.id, uploadToken: data.uploadToken };
        setDraft(activeDraft);
      }
      setStatus("uploading");
      for (let index = 0; index < photos.length; index += 1) {
        const form = new FormData();
        form.append("file", photos[index].file);
        form.append("position", String(index));
        const response = await fetch(`/api/jobs/${activeDraft.id}/photos`, { method: "POST", headers: { "x-upload-token": activeDraft.uploadToken }, body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Photo ${index + 1} could not be uploaded.`);
        setProgress(Math.round(((index + 1) / photos.length) * 100));
      }
      setStatus("finishing");
      const complete = await fetch(`/api/jobs/${activeDraft.id}/complete`, { method: "POST", headers: { "x-upload-token": activeDraft.uploadToken } });
      const completeData = await complete.json();
      if (!complete.ok) throw new Error(completeData.error || "Your project could not be finalized.");
      setReference(activeDraft.id.slice(0, 8).toUpperCase());
      setStatus("success");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Something interrupted the upload. Your photos are still selected—try again.");
    }
  }

  if (status === "success") {
    return <main className="client-shell"><header className="client-header"><a className="client-brand" href="/"><span>FM</span> FRAME MOTION</a></header><section className="success-screen"><div className="success-mark">✓</div><p className="client-kicker">PROJECT RECEIVED</p><h1>Your property film is in the studio.</h1><p>We received all {requiredPhotos} photos and your instructions. We’ll review the material before production and contact you at <strong>{clientEmail}</strong>.</p><div className="reference-card"><span>Project reference</span><strong>{reference}</strong></div><button onClick={() => window.location.reload()}>Send another property</button></section></main>;
  }

  return <main className="client-shell">
    <header className="client-header"><a className="client-brand" href="/"><span>FM</span> FRAME MOTION</a><div className="client-header-note">Professional property films · Boston</div></header>
    <section className="client-intro"><div><p className="client-kicker">PROPERTY FILMS FROM YOUR PHOTOS</p><h1>Send the photos.<br/>We’ll create the film.</h1><p className="client-lead">Choose a length, upload the exact number of photos and tell us where to reach you. No editing knowledge required.</p></div><aside><strong>Property-first production</strong><span>Architecture and room details stay protected.</span><strong>Review before purchase</strong><span>You decide after seeing the finished result.</span></aside></section>
    <section className="client-flow">
      <div className="client-step"><div className="step-heading"><span>01</span><div><h2>Choose the length</h2><p>The recommended 35-second version tells a complete story without feeling long.</p></div></div><div className="package-grid">{packages.map((item) => <button key={item.seconds} className={packageSeconds === item.seconds ? "active" : ""} onClick={() => changePackage(item.seconds)} disabled={busy}><strong>{item.label}</strong><span>{item.photos} photos</span><small>{item.note}</small>{item.seconds === 35 && <b>RECOMMENDED</b>}</button>)}</div></div>
      <div className="client-step"><div className="step-heading"><span>02</span><div><h2>Add {requiredPhotos} photos</h2><p>Place them in the order viewers should see them. Drag to rearrange.</p></div></div><button className={photos.length === requiredPhotos ? "client-drop complete" : "client-drop"} onClick={() => inputRef.current?.click()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); addPhotos(event.dataTransfer.files); }} onDragOver={(event) => event.preventDefault()} disabled={busy || photos.length === requiredPhotos}><strong>{photos.length === requiredPhotos ? "All photos added" : `Choose ${remaining} photo${remaining === 1 ? "" : "s"}`}</strong><span>{photos.length}/{requiredPhotos} · JPG, PNG or WebP · 12 MB each</span></button><input ref={inputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addPhotos(event.target.files); event.target.value = ""; }}/>{photos.length > 0 && <div className="client-photo-grid">{photos.map((photo, index) => <article key={photo.id} draggable={!busy} onDragStart={() => { draggedId.current = photo.id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => movePhoto(draggedId.current, photo.id)}><img src={photo.preview} alt={`Selected property photo ${index + 1}`}/><span>{index + 1}</span><button onClick={() => removePhoto(photo.id)} aria-label={`Remove photo ${index + 1}`}>×</button></article>)}</div>}</div>
      <div className="client-step"><div className="step-heading"><span>03</span><div><h2>Choose the feel</h2><p>Classic is the safest choice for most listings.</p></div></div><div className="style-grid">{styles.map((item) => <button key={item.value} className={style === item.value ? "active" : ""} onClick={() => { setStyle(item.value); setDraft(null); }} disabled={busy}><strong>{item.label}</strong><small>{item.note}</small></button>)}</div></div>
      <div className="client-step contact-step"><div className="step-heading"><span>04</span><div><h2>Where should we send it?</h2><p>Only the essentials. Notes are optional.</p></div></div><div className="client-fields"><label><span>Your name</span><input value={clientName} onChange={(event) => { setClientName(event.target.value); setDraft(null); }} autoComplete="name"/></label><label><span>Email</span><input type="email" value={clientEmail} onChange={(event) => { setClientEmail(event.target.value); setDraft(null); }} autoComplete="email"/></label><label><span>Business or agency</span><input value={businessName} onChange={(event) => { setBusinessName(event.target.value); setDraft(null); }} autoComplete="organization"/></label><label><span>Property or project name</span><input value={projectName} onChange={(event) => { setProjectName(event.target.value); setDraft(null); }} placeholder="Example: 42 Maple Street"/></label><label className="wide"><span>Notes or helpful links <em>Optional</em></span><textarea value={notes} onChange={(event) => { setNotes(event.target.value); setDraft(null); }} placeholder="Listing link, special feature, preferred message or anything we should know."/></label></div></div>
      {error && <div className="client-error"><strong>We couldn’t finish that.</strong><span>{error}</span></div>}
      {busy && <div className="upload-progress"><div><strong>{status === "creating" ? "Preparing your project…" : status === "finishing" ? "Finalizing your project…" : `Uploading photos · ${progress}%`}</strong><span>Keep this page open until the confirmation appears.</span></div><i><b style={{ width: `${status === "creating" ? 4 : status === "finishing" ? 100 : progress}%` }}/></i></div>}
      <div className="client-submit"><div><strong>No payment or commitment now.</strong><span>Review the finished film first. Purchase it only if you want to use it.</span><small>{(totalSize / 1024 / 1024).toFixed(1)} MB selected</small></div><button onClick={sendProject} disabled={!ready || busy}>{busy ? "Sending your project…" : remaining ? `Add ${remaining} more photo${remaining === 1 ? "" : "s"}` : "Send my project"}<span>→</span></button></div>
    </section>
    <footer className="client-footer"><span>FRAME MOTION</span><p>Boston-based property film production</p><a href="/dashboard">Studio access</a></footer>
  </main>;
}
