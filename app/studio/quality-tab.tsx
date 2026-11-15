"use client";

/* A "Quality" tab on each saved film: what the automatic check flagged, with a preview of every flagged scene,
   so the owner can decide whether it can pass or needs to be re-made. */
import { useEffect, useState } from "react";

type Item = { scene: number; issues: string[]; clip: string; round?: number };

/* The status shown on every film: red = still has a problem after the last attempt, green = ready to deliver. */
export type QualityStatus = { state: "flagged" | "fixed" | "approved" | "unchecked"; attempts: number; issues: number };
export const QUALITY_LOOK: Record<QualityStatus["state"], { icon: string; text: (q: QualityStatus) => string }> = {
  flagged: { icon: "!", text: (q) => `Needs attention · not fixed after ${q.attempts} ${q.attempts === 1 ? "attempt" : "attempts"}` },
  fixed: { icon: "✓", text: (q) => `Fixed on attempt ${q.attempts} · ready to deliver` },
  approved: { icon: "✓", text: () => "Approved · ready to deliver" },
  unchecked: { icon: "–", text: () => "Not checked" },
};
export function QualityBadge({ quality }: { quality?: QualityStatus | null }) {
  if (!quality) return null;
  const look = QUALITY_LOOK[quality.state];
  return <span className={`qual-badge qual-${quality.state}`} role="status"><i aria-hidden="true">{look.icon}</i>{look.text(quality)}</span>;
}

export default function QualityTab({ id, job = false, label = "Quality", state }: { id: string; job?: boolean; label?: string; state?: QualityStatus["state"] }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState<{ src: string; title: string } | null>(null);
  useEffect(() => {
    if (!big) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setBig(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [big]);
  const [data, setData] = useState<{ rounds: number; delivered: Item[]; earlier: Item[] } | null>(null);
  const [error, setError] = useState("");
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || data) return;
    setError("");
    try {
      const response = await fetch(job ? `/api/studio/production/${id}/quality` : `/api/history/${id}/quality`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { rounds?: number; delivered?: Item[]; earlier?: Item[]; error?: string };
      if (!response.ok) setError(body.error || "The quality notes could not be loaded."); else setData({ rounds: body.rounds || 0, delivered: body.delivered || [], earlier: body.earlier || [] });
    } catch { setError("The quality notes could not be loaded."); }
  }
  const card = (item: Item, label: string) => <div className="qual-item" key={`${label}-${item.round || 0}-${item.scene}`}>
    <div className="qual-clip"><video src={item.clip} controls preload="metadata" playsInline muted/><button type="button" className="qual-expand" aria-label={`Full screen: scene ${item.scene}`} onClick={() => setBig({ src: item.clip, title: `Scene ${item.scene} · ${label}` })}>⤢ Full screen</button></div>
    <div><strong>Scene {item.scene} · {label}</strong>{item.issues.length ? item.issues.map((text) => <small key={text}>{text}</small>) : <small>Flagged by the quality check.</small>}</div>
  </div>;
  return <div className="cost-tab">
    <button type="button" className={`cost-toggle${state === "flagged" ? " qual-toggle-flagged" : ""}`} aria-expanded={open} onClick={toggle}>{state === "flagged" ? "⚠ " : ""}{label}</button>
    {open && <div className="cost-list">
      {error && <p>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && !data.delivered.length && !data.earlier.length && <p>Nothing was flagged on this film.</p>}
      {data && data.delivered.length > 0 && <><strong>Still flagged in the finished film</strong>{data.delivered.map((item) => card(item, "delivered"))}</>}
      {data && data.earlier.length > 0 && <><strong>Re-made automatically ({data.rounds} {data.rounds === 1 ? "time" : "times"})</strong>{data.earlier.map((item) => card(item, `attempt ${item.round}`))}</>}
    </div>}
    {big && <div className="qual-full" role="dialog" aria-modal="true" aria-label={big.title} onClick={() => setBig(null)}>
      <div className="qual-full-bar"><strong>{big.title}</strong><button type="button" onClick={() => setBig(null)}>Close ✕</button></div>
      <video src={big.src} controls autoPlay loop playsInline onClick={(event) => event.stopPropagation()}/>
    </div>}
  </div>;
}
