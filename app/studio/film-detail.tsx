"use client";

/* Production detail view (Studio History, owner only): one film, its original video and
   every version made from it — each previewable, downloadable and editable from here.
   Versions are grouped by filmId, which the history API already computes; this component
   only renders the group it is given. Editing an older version edits the film as it is
   now, not that version as it was — the sheet says so, instead of pretending otherwise. */
import { aspectLabel } from "../aspect-label";

export type FilmDetailItem = {
  id: string;
  prompt: string;
  engine: string;
  category: string;
  resolution: string;
  aspect: string;
  frameRatio?: number | null;
  duration: number;
  costCents: number;
  createdAt: number;
  submittedAt?: number | null;
  filmId?: string | null;
  version?: number | null;
  versionKind?: "edit" | "version" | null;
  template?: string | null;
  fromClips?: boolean;
  videoUrl: string;
  downloadUrl: string;
  editJobId?: string | null;
  editable?: boolean;
  editBlockedReason?: string | null;
};

function versionName(item: FilmDetailItem): string {
  if (item.version === 0) return "Original";
  if (item.version) return item.versionKind === "version" ? `Version ${item.version}` : `Edit ${item.version}`;
  return "Video";
}

function engineName(engine: string): string {
  return engine === "wan3" ? "Wan 3.0" : engine === "upscale" ? "Upscaler" : engine;
}

export default function FilmDetail({ items, activeJobIds, onClose, onEdit }: {
  items: FilmDetailItem[];
  activeJobIds: string[];
  onClose: () => void;
  onEdit: (jobId: string) => void;
}) {
  const ordered = [...items].sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  const original = ordered[0];
  if (!original) return null;
  const filmId = original.filmId || original.id;
  const editingNow = activeJobIds.includes(filmId);
  const totalCost = items.reduce((sum, item) => sum + (item.costCents || 0), 0);
  return <div className="fin-overlay" role="dialog" aria-modal="true" aria-label="Production detail" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="fin-sheet">
      <header className="fin-sheet-head"><div><span className="label">PRODUCTION</span><h2>{original.prompt ? original.prompt.slice(0, 80) : "Your video"}</h2><p>{aspectLabel(original.aspect, original.frameRatio)} · {original.resolution} · {original.duration}s · {engineName(original.engine)}{original.template ? ` · ${original.template}` : ""}{items.length > 1 ? ` · ${items.length} versions · $${(totalCost / 100).toFixed(2)} total` : original.costCents ? ` · $${(original.costCents / 100).toFixed(2)}` : ""}</p></div><button type="button" className="fin-close" onClick={onClose} aria-label="Close">×</button></header>
      <div className="fin-sheet-body">
        {editingNow && <p className="history-message">A new version of this film is being made right now. It will appear below when it is ready.</p>}
        <div className="fin-section"><header><strong>Original</strong><small>Made {new Date(original.submittedAt || original.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></header>
          <video src={original.videoUrl} controls playsInline preload="metadata" style={{ width: "100%" }} />
          <div className="history-card-footer"><div><strong>{original.costCents ? `$${(original.costCents / 100).toFixed(2)}` : "—"}</strong></div><div><a className="download" href={original.downloadUrl}>Download</a>{original.editable && original.editJobId ? <button onClick={() => onEdit(original.editJobId as string)}>Edit</button> : <button disabled title={original.editBlockedReason || "This video can't be edited."}>Edit</button>}</div></div>
        </div>
        {ordered.length > 1 && <div className="fin-section"><header><strong>Every version</strong><small>Newest last. Each one previews, downloads and edits from here — no more hunting through History for the 16:9 or the vertical.</small></header>
          {ordered.slice(1).map((item) => <div key={item.id} className="fin-version">
            <div><strong>{versionName(item)}</strong><small>{new Date(item.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{item.template ? ` · ${item.template}` : ""}{item.fromClips ? " · Made from saved clips" : ""} · {aspectLabel(item.aspect, item.frameRatio)} · {item.resolution}</small></div>
            <video src={item.videoUrl} controls playsInline preload="metadata" style={{ width: "100%" }} />
            <div className="history-card-footer"><div><strong>{item.costCents ? `$${(item.costCents / 100).toFixed(2)}` : "—"}</strong></div><div><a className="download" href={item.downloadUrl}>Download</a>{item.editable && item.editJobId ? <button onClick={() => onEdit(item.editJobId as string)}>Edit</button> : <button disabled title={item.editBlockedReason || "This video can't be edited."}>Edit</button>}</div></div>
          </div>)}
          <p className="fin-quiet">Editing an older version edits the film as it is now, not that version as it was.</p>
        </div>}
        {original.prompt && <details className="history-prompt"><summary>Prompt</summary><p>{original.prompt}</p></details>}
      </div>
    </div>
  </div>;
}
