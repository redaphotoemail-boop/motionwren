"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";
import { SpendBreakdown } from "./spend-breakdown";

type Period = { totalCents: number; engineCents: number; reviewCents: number; editCents: number; level: number };
type Guard = { settings: { monthlyCents: number; dailyCents: number; perFilmCents: number; paused: boolean }; month: Period; day: Period; running: boolean; stopped: { why: string; message: string } | null };

const toDollars = (value: number) => String(value / 100);
const share = (spent: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0);

/* The spending guard: limits, what has been spent, and the one-tap pause. At 100% of a limit everything that costs money stops by itself. */
export function SpendGuardPanel() {
  const [guard, setGuard] = useState<Guard | null>(null);
  const [fields, setFields] = useState({ monthly: "", daily: "", perFilm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<"day" | "month" | null>(null);

  const apply = (result: Guard) => { setGuard(result); setFields({ monthly: toDollars(result.settings.monthlyCents), daily: toDollars(result.settings.dailyCents), perFilm: toDollars(result.settings.perFilmCents) }); };
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/spend-guard", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The spending limits could not be loaded.");
      apply(result);
    })().catch((cause) => setError(cause instanceof Error ? cause.message : "The spending limits could not be loaded."));
  }, []);

  async function save(change: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/spend-guard", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "That could not be saved.");
      apply(result); setMessage(done);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That could not be saved."); } finally { setBusy(false); }
  }

  const stopped = guard ? !guard.running : false;
  const paused = guard?.settings.paused === true;
  const tone = !guard ? "" : paused || stopped ? "fin-bad" : "fin-ok";
  return <section className={`panel spend-guard fin-guard ${tone}`} aria-label="Spending limits">
    <div className="fin-guard-top">
      <div>
        <p className="eyebrow">Spending</p>
        <h2 className="panel-title">{!guard ? "Spending limits" : paused ? "Paused by you" : stopped ? "Stopped at the limit" : "Running within your limits"}</h2>
      </div>
      <button type="button" className={paused ? "btn btn-ink btn-sm" : "btn btn-white btn-sm"} disabled={busy || !guard} onClick={() => save({ paused: !paused }, paused ? "Spending resumed." : "Spending paused. Nothing that costs money will run.")}>{paused ? "Resume spending" : "Pause all spending"}</button>
    </div>
    {guard?.stopped?.message && <p className="muted">{guard.stopped.message}</p>}
    {error && <p role="alert" className="fine">{error}</p>}
    {message && <p role="status" className="fine">{message}</p>}

    {guard && <div className="fin-meters">
      {([["Today", "day", guard.day, guard.settings.dailyCents], ["This month", "month", guard.month, guard.settings.monthlyCents]] as const).map(([label, key, period, limit]) => {
        const used = share(period.totalCents, limit);
        const expanded = open === key;
        const toggle = () => setOpen(expanded ? null : key);
        return <div key={label} className={`fin-meter fin-meter-tap${expanded ? " open" : ""}`} role="button" tabIndex={0} aria-expanded={expanded} onClick={toggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}>
          <div className="fin-meter-head"><span>{label}</span><strong>{cents(period.totalCents)}<small>{limit > 0 ? ` of ${cents(limit)}` : " · no limit"}</small></strong></div>
          <div className={`fin-meter-bar${used >= 100 ? " full" : used >= 80 ? " warn" : ""}`} role="img" aria-label={limit > 0 ? `${used}% of the ${label.toLowerCase()} limit used` : `${label}: no limit`}><i style={{ width: `${limit > 0 ? Math.max(used, period.totalCents > 0 ? 2 : 0) : 0}%` }} /></div>
          <small className="fin-meter-hint">{expanded ? "Hide the breakdown" : "See what it is made of"}</small>
        </div>;
      })}
    </div>}
    {guard && open && <SpendBreakdown period={open} label={open === "day" ? "Today" : "This month"} />}

    <details className="fin-more">
      <summary>Change limits</summary>
      <div className="mgr-cols even">
        <label className="field"><span>Monthly limit ($)</span><input inputMode="decimal" value={fields.monthly} onChange={(event) => setFields({ ...fields, monthly: event.target.value.replace(/[^\d.]/g, "") })} /></label>
        <label className="field"><span>Daily limit ($)</span><input inputMode="decimal" value={fields.daily} onChange={(event) => setFields({ ...fields, daily: event.target.value.replace(/[^\d.]/g, "") })} /></label>
        <label className="field"><span>Ask me first above, per film ($)</span><input inputMode="decimal" value={fields.perFilm} onChange={(event) => setFields({ ...fields, perFilm: event.target.value.replace(/[^\d.]/g, "") })} /></label>
      </div>
      <p className="fine">0 means no limit. At 100% of a limit everything that costs money stops by itself (new films, scenes not yet sent, re-makes, upscales, quality checks). You are alerted at 50%, 80% and 100%. The day runs midnight to midnight, New York time.</p>
      <div className="actions"><button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => save({ monthly: fields.monthly, daily: fields.daily, perFilm: fields.perFilm }, "Limits saved.")}>Save limits</button></div>
    </details>
  </section>;
}
