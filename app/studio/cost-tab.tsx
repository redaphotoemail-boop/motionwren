"use client";

/* A small "Cost" tab on every saved film: every cost of making it, line by line. */
import { useState } from "react";

type Line = { label: string; detail: string; cents: number; estimate: boolean };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CostTab({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ lines: Line[]; totalCents: number } | null>(null);
  const [error, setError] = useState("");
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || data) return;
    setError("");
    try {
      const response = await fetch(`/api/history/${id}/cost`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { lines?: Line[]; totalCents?: number; error?: string };
      if (!response.ok || !body.lines) setError(body.error || "The cost could not be loaded."); else setData({ lines: body.lines, totalCents: body.totalCents || 0 });
    } catch { setError("The cost could not be loaded."); }
  }
  return <div className="cost-tab">
    <button type="button" className="cost-toggle" aria-expanded={open} onClick={toggle}>Cost</button>
    {open && <div className="cost-list">
      {error && <p>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && <>
        {data.lines.map((line) => <div className="cost-row" key={line.label}><div><strong>{line.label}</strong><small>{line.detail}</small></div><span>{line.estimate ? "≈ " : ""}{money(line.cents)}</span></div>)}
        <div className="cost-row cost-total"><strong>Total</strong><span>{money(data.totalCents)}</span></div>
        <small className="cost-note">≈ marks an estimate from list prices. Your providers' billing pages are the final word.</small>
      </>}
    </div>}
  </div>;
}
