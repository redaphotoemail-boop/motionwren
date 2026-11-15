"use client";

/* "Make versions" (Edit film, owner only): the finished film's own scenes are cut into several templates at once.
   Nothing is made by the video engine again, so only the editing is paid for (and a small upscale fee if the film is 1080p).
   Each version is its own film in History. Templates are listed in a compact scrolling list, ticked, then made one after another. */
import { useEffect, useState } from "react";
import type { StudioJob } from "./production";

type Tpl = { id: string; name: string; seconds: number; photos: number; active?: boolean; social?: { key: string; frame: string } };
const frameName = (frame?: string) => frame === "vertical" ? "9:16" : frame === "cinematic" ? "2.39:1" : frame === "horizontal" ? "16:9" : "";

export default function Variants({ jobId, count, onStarted }: { jobId: string; count: number; onStarted: (job: StudioJob | null, message: string) => void }) {
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    fetch("/api/admin/wrencut", { cache: "no-store" }).then((response) => response.json()).then((body: { templates?: Tpl[] }) => setTemplates((body.templates || []).filter((item) => item.active))).catch(() => undefined);
  }, []);
  if (count < 2 || !templates.length) return null;
  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  async function make() {
    setBusy(true); setNote("");
    let last: StudioJob | null = null; let made = 0; const failed: string[] = [];
    for (const id of picked) {
      const tpl = templates.find((item) => item.id === id);
      try {
        const response = await fetch("/api/studio/production/from-clips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clips: Array.from({ length: count }, (_, scene) => ({ jobId, scene })), template: { wren: id }, music: "", label: tpl?.name || "Version" }) });
        const data = await response.json().catch(() => ({})) as { job?: StudioJob; error?: string };
        if (!response.ok || !data.job) failed.push(`${tpl?.name || "A template"}: ${data.error || "could not start"}`); else { made += 1; last = data.job; }
      } catch { failed.push(`${tpl?.name || "A template"}: connection problem`); }
    }
    setBusy(false);
    if (failed.length) setNote(`${made ? `${made} started. ` : ""}Not started: ${failed.join(" · ")}`);
    if (made) { setPicked([]); onStarted(last, `${made} ${made === 1 ? "version is" : "versions are"} being edited from your film's own scenes. Each will appear in History in a minute or two.`); }
  }
  return <section className="fin-section var-section">
    <header><strong>Make versions</strong><small>Cut this film&apos;s own scenes into other templates. No new generation: only the editing.</small></header>
    <div className="var-list" role="group" aria-label="Templates">{templates.map((item) => <label className={picked.includes(item.id) ? "var-item on" : "var-item"} key={item.id}>
      <input type="checkbox" checked={picked.includes(item.id)} onChange={() => toggle(item.id)} disabled={busy}/>
      <span><strong>{item.name}</strong><small>{Math.round(item.seconds * 10) / 10} s{item.social ? ` · ${frameName(item.social.frame)}` : ""}</small></span>
    </label>)}</div>
    <div className="var-bar"><span>{picked.length ? `${picked.length} chosen` : "Tick the versions you want"}</span><button type="button" onClick={make} disabled={busy || !picked.length}>{busy ? "Starting…" : `Make ${picked.length || ""} ${picked.length === 1 ? "version" : "versions"}`}</button></div>
    {note && <p className="var-note">{note}</p>}
  </section>;
}
