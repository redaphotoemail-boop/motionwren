/* Small presentational helpers shared by the manager pages. */

export const money = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const cents = (value: unknown) => money(Number(value || 0) / 100);
export const bytes = (value: number) => value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;

export const projectStatusLabels: Record<string, string> = { draft: "Saved", submitted: "Received", queued: "Queued", generating: "Creating scenes", stitching: "Finishing video", saving: "Preparing delivery", completed: "Ready", failed: "Needs attention" };
export const statusGroup = (value: string) => value === "draft" ? "draft" : value === "failed" ? "failed" : value === "completed" ? "completed" : "production";

export function StatusPill({ status }: { status: string }) {
  const group = statusGroup(status);
  return <span className={`status status-${group}`}><i />{projectStatusLabels[status] || status}</span>;
}

export function JobStatus({ status }: { status: string }) {
  const group = status === "failed" ? "failed" : status === "completed" ? "completed" : "production";
  return <span className={`status status-${group}`}><i />{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

export function ago(timestamp: number) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PageHead({ eyebrow, title, sub, children }: { eyebrow?: string; title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return <header className="mgr-head">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {sub && <p className="mgr-sub">{sub}</p>}
    </div>
    {children && <div className="mgr-head-actions">{children}</div>}
  </header>;
}

export function Metric({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "warn" | "ok" | "bad" }) {
  return <article className={`metric${tone ? ` metric-${tone}` : ""}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </article>;
}
