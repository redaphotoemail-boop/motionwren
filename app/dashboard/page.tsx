"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Icon } from "../ui-icon";

type Account = { displayName: string; email: string; role: "admin" | "customer"; plan: string; creditBalance: number };
type Project = { id: string; title: string; status: string; listingAddress?: string; assetCount: number; aspect: string; resolution: string; targetDuration?: number; updatedAt: number; finalHistoryId?: string | null };
type Notification = { id: string; type: string; title: string; message: string; readAt?: number | null; createdAt: number };
type ProjectStep = 1 | 2;

const emptyForm = { listingUrl: "", title: "", listingAddress: "", beds: "", baths: "", squareFeet: "", price: "", shortMessage: "", aspect: "horizontal", targetDuration: "20", agentName: "", agentEmail: "", agentPhone: "" };
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
const formatNumber = (value: string) => value ? Number(value.replace(/\D/g, "")).toLocaleString("en-US") : "";
const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export default function CustomerDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [projectStep, setProjectStep] = useState<ProjectStep>(1);
  const [importingListing, setImportingListing] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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

  function change(key: keyof typeof emptyForm, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  function openNewProject() { setProjectStep(1); document.getElementById("new-project")?.scrollIntoView({ behavior: "smooth" }); }
  function moveFile(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function importListing() {
    setImportFeedback(null); setError("");
    if (!form.listingUrl.trim()) return setImportFeedback({ kind: "error", text: "Paste the public listing link first." });
    setImportingListing(true);
    try {
      const response = await fetch("/api/listing-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: form.listingUrl }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The listing could not be imported.");
      const fields = data.fields || {};
      setForm((current) => ({ ...current, listingUrl: data.sourceUrl || current.listingUrl, title: fields.title || current.title, listingAddress: fields.listingAddress || current.listingAddress, beds: fields.beds || current.beds, baths: fields.baths || current.baths, squareFeet: fields.squareFeet || current.squareFeet, price: fields.price || current.price }));
      const count = Array.isArray(data.importedFields) ? data.importedFields.length : 0;
      setImportFeedback({ kind: "success", text: count ? `We filled ${count} details. Check them below.` : "Link saved. Add the property name below." });
    } catch (err) { setImportFeedback({ kind: "error", text: `${err instanceof Error ? err.message : "The listing could not be imported."} You can continue manually.` }); }
    finally { setImportingListing(false); }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (!form.title.trim()) { setProjectStep(1); return setError("Add a project or property name."); }
    if (files.length < 2) return setError("Add at least two property photos in the order they should appear.");
    setCreating(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The project could not be created.");
      for (let index = 0; index < files.length; index += 1) {
        setMessage(`Uploading photo ${index + 1} of ${files.length}…`);
        const payload = new FormData(); payload.append("file", files[index]);
        const upload = await fetch(`/api/projects/${data.project.id}/assets`, { method: "POST", body: payload });
        const uploadData = await upload.json();
        if (!upload.ok) throw new Error(uploadData.error || `Photo ${index + 1} could not be stored.`);
      }
      setMessage("Starting your video…");
      const submission = await fetch(`/api/projects/${data.project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
      const submissionData = await submission.json();
      if (!submission.ok) {
        if (submission.status === 402 && billingEnabled) throw new Error("A video credit is required. Your photos are saved safely in a draft.");
        throw new Error(submissionData.error || "Your photos are saved, but the project could not be submitted.");
      }
      const generation = await fetch(`/api/projects/${data.project.id}/generate`, { method: "POST" });
      const generationData = await generation.json();
      setForm(emptyForm); setFiles([]); setProjectStep(1); setImportFeedback(null);
      setMessage(generation.ok ? "Your video is in production. You can leave this page—we’ll keep working." : generationData.error || "Your project was received and is waiting for production.");
      await load();
      document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" });
    } catch (err) { const failure = err instanceof Error ? err.message : "The project could not be created."; await load(); setError(failure); }
    finally { setCreating(false); }
  }

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
      <nav aria-label="Workspace"><a className="active" href="#projects"><Icon name="projects" size={16}/>Videos</a><button onClick={openNewProject}><Icon name="upload" size={16}/>Create</button>{account?.role === "admin" && <Link className="owner-nav" href="/admin"><Icon name="dashboard" size={16}/>Manager</Link>}</nav>
      <div className="account-actions"><div className="account-chip"><strong>{account?.displayName || "Account"}</strong><small>{account?.role === "admin" ? "Owner" : account?.plan || "Member"}</small></div><a className="sign-out-link" href="/api/auth/logout" target="_top">Sign out</a></div>
    </header>

    <section className="portal-content client-content">
      <div className="client-welcome"><div><span className="label">YOUR VIDEO WORKSPACE</span><h1>{account?.displayName ? `Welcome, ${account.displayName.split(" ")[0]}` : "Welcome"}</h1><p>Turn listing photos into a polished property video in minutes.</p></div><button className="primary-action" onClick={openNewProject}><Icon name="upload" size={17}/>Create a video</button></div>
      {error && <div className="portal-alert error" role="alert">{error}</div>}{message && <div className="portal-alert success" role="status">{message}</div>}
      {notifications.some((item) => !item.readAt) && <div className="client-notice"><Icon name={notifications.some((item) => !item.readAt && item.type.includes("failed")) ? "alert" : "check"}/><div><strong>{notifications.find((item) => !item.readAt)?.title}</strong><span>{notifications.find((item) => !item.readAt)?.message}</span></div><button onClick={async () => { await fetch("/api/notifications", { method: "PATCH" }); setNotifications((items) => items.map((item) => ({ ...item, readAt: Date.now() }))); }}>Dismiss</button></div>}

      <section id="new-project" className="create-video-card">
        <div className="create-video-head"><div><span className="step-kicker">CREATE A VIDEO</span><h2>{projectStep === 1 ? "Start with the property" : "Add your best photos"}</h2><p>{projectStep === 1 ? "Paste the listing link for the fastest setup, or type the essentials." : "Choose the order. We handle the motion, pacing and finish."}</p></div><div className="two-step-progress" aria-label={`Step ${projectStep} of 2`}><span className="active">1</span><i/><span className={projectStep === 2 ? "active" : ""}>2</span></div></div>
        <form onSubmit={createProject}>
          {projectStep === 1 && <div className="client-step">
            <div className="quick-import"><div className="quick-import-title"><Icon name="link"/><span><strong>Paste a listing link</strong><small>We’ll fill whatever the page makes available.</small></span></div><div className="listing-import-form"><input type="url" inputMode="url" value={form.listingUrl} onChange={(event) => { change("listingUrl", event.target.value); setImportFeedback(null); }} placeholder="Paste the public listing URL" aria-label="Public listing URL"/><button type="button" onClick={importListing} disabled={importingListing || !form.listingUrl.trim()}>{importingListing ? "Checking…" : "Fill details"}</button></div>{importFeedback && <div className={`import-feedback ${importFeedback.kind}`}><Icon name={importFeedback.kind === "success" ? "check" : "alert"} size={17}/><span>{importFeedback.text}</span></div>}</div>
            <div className="essential-fields"><label className="wide"><span>Property name or address <em>Required</em></span><input autoFocus required value={form.title} onChange={(event) => change("title", event.target.value)} placeholder="12 Beacon Hill Road"/></label><label><span>Price</span><div className="prefixed-input"><b>$</b><input inputMode="numeric" value={formatNumber(form.price)} onChange={(event) => change("price", event.target.value.replace(/\D/g, ""))} placeholder="1,250,000"/></div></label><label><span>Beds</span><input inputMode="decimal" value={form.beds} onChange={(event) => change("beds", event.target.value)} placeholder="3"/></label><label><span>Baths</span><input inputMode="decimal" value={form.baths} onChange={(event) => change("baths", event.target.value)} placeholder="2.5"/></label><label><span>Square feet</span><input inputMode="numeric" value={formatNumber(form.squareFeet)} onChange={(event) => change("squareFeet", event.target.value.replace(/\D/g, ""))} placeholder="2,150"/></label></div>
            <details className="optional-settings"><summary><span><Icon name="user" size={18}/><b>Optional listing and agent details</b></span><small>Add opening text or a closing contact card</small></summary><div className="optional-fields"><label className="wide"><span>Full property address</span><input value={form.listingAddress} onChange={(event) => change("listingAddress", event.target.value)} placeholder="City, State"/></label><label className="wide"><span>Opening message</span><input value={form.shortMessage} onChange={(event) => change("shortMessage", event.target.value)} placeholder="Just listed · Open house Sunday"/></label><label><span>Agent name</span><input value={form.agentName} onChange={(event) => change("agentName", event.target.value)} placeholder="Jordan Lee"/></label><label><span>Email</span><input type="email" value={form.agentEmail} onChange={(event) => change("agentEmail", event.target.value)} placeholder="jordan@realty.com"/></label><label><span>Phone</span><input type="tel" value={formatPhone(form.agentPhone)} onChange={(event) => change("agentPhone", event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="617-555-0142"/></label></div></details>
          </div>}

          {projectStep === 2 && <div className="client-step photo-step">
            <label className="premium-upload"><Icon name="upload" size={30}/><strong>Add property photos</strong><span>Choose 2–12 JPG, PNG or WebP images.</span><input required multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files || []).slice(0, 12))}/><b>{files.length ? `${files.length} selected` : "Choose photos"}</b></label>
            {files.length > 0 && <div className="photo-order"><div><strong>Scene order</strong><small>The video follows this order.</small></div>{files.map((file, index) => <div className="photo-order-row" key={`${file.name}-${file.lastModified}`}><span>{index + 1}</span><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></div><button type="button" aria-label={`Move ${file.name} earlier`} disabled={index === 0} onClick={() => moveFile(index, -1)}>↑</button><button type="button" aria-label={`Move ${file.name} later`} disabled={index === files.length - 1} onClick={() => moveFile(index, 1)}>↓</button><button type="button" className="remove-photo" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div>}
            <details className="optional-settings video-options"><summary><span><Icon name="motion" size={18}/><b>Video preferences</b></span><small>{form.targetDuration} seconds · {form.aspect === "horizontal" ? "Horizontal" : form.aspect === "vertical" ? "Vertical" : "Cinematic"}</small></summary><div className="video-choice-grid"><fieldset><legend>Length</legend><div>{[20,30,50].map((seconds) => <button type="button" key={seconds} className={form.targetDuration === String(seconds) ? "active" : ""} onClick={() => change("targetDuration", String(seconds))}>{seconds}s</button>)}</div></fieldset><fieldset><legend>Format</legend><div>{[["horizontal","16:9"],["vertical","9:16"],["cinematic","Cinema"]].map(([value,label]) => <button type="button" key={value} className={form.aspect === value ? "active" : ""} onClick={() => change("aspect", value)}>{label}</button>)}</div></fieldset></div></details>
          </div>}

          <div className="client-wizard-actions">{projectStep === 2 ? <button type="button" className="text-action" onClick={() => setProjectStep(1)}>Back</button> : <span/>}<span className="save-note"><Icon name="shield" size={15}/>Private and securely stored</span>{projectStep === 1 ? <button type="button" className="primary-action" onClick={() => { setError(""); if (!form.title.trim()) return setError("Add a project or property name to continue."); setProjectStep(2); }}>Continue <Icon name="arrow" size={16}/></button> : <button type="submit" className="primary-action" disabled={creating || files.length < 2}>{creating ? message || "Creating…" : "Create my video"} {!creating && <Icon name="arrow" size={16}/>}</button>}</div>
        </form>
      </section>

      <section id="projects" className="client-projects">
        <div className="client-section-head"><div><span className="label">YOUR VIDEOS</span><h2>Projects and deliveries</h2></div><div className="project-summary"><span><b>{inProgress}</b> in progress</span><span><b>{completed}</b> ready</span>{account?.plan !== "internal" && <span><b>{account?.creditBalance ?? 0}</b> credits</span>}<button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
        {billingEnabled && account?.role !== "admin" && <section className="credit-purchase"><div><span className="label">VIDEO CREDITS</span><h2>Choose only what you need.</h2></div><div><button onClick={() => startCheckout("single")}><strong>1 video</strong><span>$29</span></button><button onClick={() => startCheckout("five")}><strong>5 videos</strong><span>$125</span></button><button onClick={() => startCheckout("pro")}><strong>10 monthly</strong><span>$199/mo</span></button></div></section>}
        {loading ? <div className="portal-empty">Loading your videos…</div> : projects.length ? <div className="project-list-clean">{projects.map((project) => { const status = statusCopy[project.status] || { label: project.status, detail: "Project status updated." }; return <article className="project-row" key={project.id}><div className="project-thumbnail"><Icon name={project.status === "completed" ? "check" : "motion"}/></div><div className="project-main"><div><span className={`status-pill ${project.status}`}>{status.label}</span><small>{new Date(project.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></div><h3>{project.title}</h3><p>{status.detail}</p><div className="project-meta"><span>{project.assetCount} photos</span><span>{project.targetDuration || 20}s</span><span>{project.resolution}</span><span>{project.aspect}</span></div></div><div className="project-row-actions">{project.status === "draft" && <button onClick={() => submitProject(project.id)}>Start production</button>}{project.finalHistoryId && <a className="download-project" href={`/api/history/${project.finalHistoryId}/video?download=1`}><Icon name="finish" size={16}/>Download</a>}<button className="more-delete" onClick={() => deleteProject(project.id)}>Delete</button></div></article>; })}</div> : <div className="portal-empty friendly-empty"><Icon name="projects" size={30}/><strong>No videos yet</strong><span>Add a listing and your photos to create the first one.</span><button className="primary-action" onClick={openNewProject}>Create your first video</button></div>}
      </section>
    </section>
    <button className="mobile-create-button" onClick={openNewProject}><Icon name="upload" size={18}/>Create video</button>
  </main>;
}
