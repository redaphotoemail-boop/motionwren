"use client";

/* A "Quality" tab on each saved film: what the automatic check flagged, with a preview of every flagged scene,
   so the owner can decide whether it can pass or needs to be re-made. */
import { useEffect, useState } from "react";

type Item = { scene: number; issues: string[]; clip: string; round?: number };
type Attempt = { attempt: number; clip: string; issues: string[]; instruction: string; by?: "check" | "you" };
type SceneInfo = { scene: number; state: "flagged" | "clean" | "unchecked" | "photo-move"; frames: number; issues: string[]; clip: string; canFix: boolean; attempts: Attempt[]; lineGuard?: { used: "ai" | "still"; reason: string } };
type Report = { rounds: number; delivered: Item[]; earlier: Item[]; jobId?: string; scenes?: SceneInfo[]; fixCents?: number; fixEngine?: string };

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
  const [data, setData] = useState<Report | null>(null);
  const [fixing, setFixing] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || data) return;
    setError("");
    try {
      const response = await fetch(job ? `/api/studio/production/${id}/quality` : `/api/history/${id}/quality`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Partial<Report> & { error?: string };
      if (!response.ok) setError(body.error || "The quality notes could not be loaded."); else setData({ ...body, rounds: body.rounds || 0, delivered: body.delivered || [], earlier: body.earlier || [] });
    } catch { setError("The quality notes could not be loaded."); }
  }
  async function fixScene(info: SceneInfo) {
    if (!data?.jobId) return;
    setFixing((now) => ({ ...now, [info.scene]: "Writing the fix and sending it…" }));
    try {
      const response = await fetch(`/api/studio/production/${data.jobId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "fix-scene", scene: info.scene - 1 }) });
      const body = await response.json().catch(() => ({})) as { error?: string; instruction?: string; cents?: number };
      setFixing((now) => ({ ...now, [info.scene]: response.ok ? `Sent. This instruction was written for scene ${info.scene} and the scene is being made again (about $${((body.cents || 0) / 100).toFixed(2)}). The new film will appear in History as a new version.\n\n${body.instruction || ""}` : body.error || "The fix could not be started." }));
    } catch { setFixing((now) => ({ ...now, [info.scene]: "The fix could not be started. Check the connection and try again." })); }
  }
  const sceneCard = (info: SceneInfo) => {
    const look = info.state === "flagged" ? { icon: "!", text: "Problem remains" } : info.state === "clean" ? { icon: "✓", text: "Checked · no problem found" } : info.state === "photo-move" ? { icon: "–", text: "Photo move · made by the editor" } : { icon: "–", text: "Not checked" };
    return <div className={`qual-scene qual-scene-${info.state}`} key={info.scene}>
      <div className="qual-scene-head"><strong>Scene {info.scene}</strong><span className={`qual-badge qual-${info.state === "flagged" ? "flagged" : info.state === "clean" ? "approved" : "unchecked"}`}><i aria-hidden="true">{look.icon}</i>{look.text}{info.frames ? ` · ${info.frames} frames looked at` : ""}</span></div>
      <div className="qual-item">
        <div className="qual-clip"><video src={info.clip} controls preload="metadata" playsInline muted/><button type="button" className="qual-expand" aria-label={`Full screen: scene ${info.scene}`} onClick={() => setBig({ src: info.clip, title: `Scene ${info.scene} · current version` })}>⤢ Full screen</button></div>
        <div>{info.issues.length ? info.issues.map((text) => <small key={text}>{text}</small>) : <small>{info.state === "clean" ? "Nothing was added, removed or moved compared with the photo, and no car moved." : info.state === "photo-move" ? "No video engine is used for this scene." : "Not checked."}</small>}{info.lineGuard && <small>{info.lineGuard.used === "still" ? `Line guard: the film uses a still-photo move here instead of this clip. ${info.lineGuard.reason}` : "Line guard: every straight line held."}</small>}</div>
      </div>
      {info.attempts.length > 1 && <details className="qual-attempts"><summary>{info.attempts.length} attempts · see what was changed</summary>
        {info.attempts.map((attempt) => <div className="qual-attempt" key={attempt.attempt}>
          <strong>Attempt {attempt.attempt}{attempt.attempt === info.attempts.length ? " · current" : ""}</strong>
          {attempt.instruction ? <p className="qual-prompt"><b>{attempt.by === "you" ? "Fix you asked for" : "Fix written by the check"}:</b> {attempt.instruction}</p> : <small>Made from the scene&apos;s own prompt.</small>}
          {attempt.issues.length > 0 && attempt.issues.map((text) => <small key={text}>Found: {text}</small>)}
          <button type="button" className="qual-expand" onClick={() => setBig({ src: attempt.clip, title: `Scene ${info.scene} · attempt ${attempt.attempt}` })}>⤢ Watch attempt {attempt.attempt}</button>
        </div>)}
      </details>}
      {info.canFix && <button type="button" className="qual-fix" disabled={Boolean(fixing[info.scene]) && !/could not|right now|Choose|stopped|still being/i.test(fixing[info.scene])} onClick={() => fixScene(info)}>Fix this scene{data?.fixCents ? ` · about $${(data.fixCents / 100).toFixed(2)}` : ""}</button>}
      {fixing[info.scene] && <p className="qual-prompt">{fixing[info.scene]}</p>}
    </div>;
  };
  const card = (item: Item, label: string) => <div className="qual-item" key={`${label}-${item.round || 0}-${item.scene}`}>
    <div className="qual-clip"><video src={item.clip} controls preload="metadata" playsInline muted/><button type="button" className="qual-expand" aria-label={`Full screen: scene ${item.scene}`} onClick={() => setBig({ src: item.clip, title: `Scene ${item.scene} · ${label}` })}>⤢ Full screen</button></div>
    <div><strong>Scene {item.scene} · {label}</strong>{item.issues.length ? item.issues.map((text) => <small key={text}>{text}</small>) : <small>Flagged by the quality check.</small>}</div>
  </div>;
  return <div className="cost-tab">
    <button type="button" className={`cost-toggle${state === "flagged" ? " qual-toggle-flagged" : ""}`} aria-expanded={open} onClick={toggle}>{state === "flagged" ? "⚠ " : ""}{label}</button>
    {open && <div className="cost-list">
      {error && <p>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data?.scenes?.length ? <>{data.rounds > 0 && <strong>Made again automatically {data.rounds} {data.rounds === 1 ? "time" : "times"} (3 attempts at most)</strong>}{data.scenes.map(sceneCard)}</> : null}
      {data && !data.scenes?.length && !data.delivered.length && !data.earlier.length && <p>Nothing was flagged on this film.</p>}
      {data && !data.scenes?.length && data.delivered.length > 0 && <><strong>Still flagged in the finished film</strong>{data.delivered.map((item) => card(item, "delivered"))}</>}
      {data && !data.scenes?.length && data.earlier.length > 0 && <><strong>Re-made automatically ({data.rounds} {data.rounds === 1 ? "time" : "times"})</strong>{data.earlier.map((item) => card(item, `attempt ${item.round}`))}</>}
    </div>}
    {big && <div className="qual-full" role="dialog" aria-modal="true" aria-label={big.title} onClick={() => setBig(null)}>
      <div className="qual-full-bar"><strong>{big.title}</strong><button type="button" onClick={() => setBig(null)}>Close ✕</button></div>
      <video src={big.src} controls autoPlay loop playsInline onClick={(event) => event.stopPropagation()}/>
    </div>}
  </div>;
}
