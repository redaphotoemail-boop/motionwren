"use client";

/* A "Quality" tab on each saved film: what the automatic check flagged, with a preview of every flagged scene,
   so the owner can decide whether it can pass or needs to be re-made. */
import { useState } from "react";

type Item = { scene: number; issues: string[]; clip: string; round?: number };

export default function QualityTab({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ rounds: number; delivered: Item[]; earlier: Item[] } | null>(null);
  const [error, setError] = useState("");
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || data) return;
    setError("");
    try {
      const response = await fetch(`/api/history/${id}/quality`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { rounds?: number; delivered?: Item[]; earlier?: Item[]; error?: string };
      if (!response.ok) setError(body.error || "The quality notes could not be loaded."); else setData({ rounds: body.rounds || 0, delivered: body.delivered || [], earlier: body.earlier || [] });
    } catch { setError("The quality notes could not be loaded."); }
  }
  const card = (item: Item, label: string) => <div className="qual-item" key={`${label}-${item.round || 0}-${item.scene}`}>
    <video src={item.clip} controls preload="metadata" playsInline muted/>
    <div><strong>Scene {item.scene} · {label}</strong>{item.issues.length ? item.issues.map((text) => <small key={text}>{text}</small>) : <small>Flagged by the quality check.</small>}</div>
  </div>;
  return <div className="cost-tab">
    <button type="button" className="cost-toggle" aria-expanded={open} onClick={toggle}>Quality</button>
    {open && <div className="cost-list">
      {error && <p>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && !data.delivered.length && !data.earlier.length && <p>Nothing was flagged on this film.</p>}
      {data && data.delivered.length > 0 && <><strong>Still flagged in the finished film</strong>{data.delivered.map((item) => card(item, "delivered"))}</>}
      {data && data.earlier.length > 0 && <><strong>Re-made automatically ({data.rounds} {data.rounds === 1 ? "time" : "times"})</strong>{data.earlier.map((item) => card(item, `attempt ${item.round}`))}</>}
    </div>}
  </div>;
}
