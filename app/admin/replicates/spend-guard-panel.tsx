"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";

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
  return <section className="panel spend-guard" aria-label="Spending limits">
    <p className="eyebrow">Spending guard</p>
    <h2 className="panel-title">{!guard ? "Spending limits" : guard.settings.paused ? "Paused by you" : stopped ? "Stopped at the limit" : "Running within your limits"}</h2>
    <p className="muted">{guard?.stopped?.message || "At 100% of a limit everything that costs money stops by itself: new films, scenes not yet sent, re-makes, upscales and quality checks. You are alerted at 50%, 80% and 100%."}</p>
    {error && <p role="alert" className="fine">{error}</p>}
    {message && <p role="status" className="fine">{message}</p>}

    {guard && <div className="mgr-cols even">
      {([["Today", guard.day, guard.settings.dailyCents], ["This month", guard.month, guard.settings.monthlyCents]] as const).map(([label, period, limit]) => <div key={label}>
        <strong>{label}</strong>
        <p className="muted">{cents(period.totalCents)}{limit > 0 ? ` of ${cents(limit)} · ${share(period.totalCents, limit)}%` : " · no limit"}</p>
        <small>Films {cents(period.engineCents)} · quality check {cents(period.reviewCents)} · editing {cents(period.editCents)}</small>
      </div>)}
    </div>}

    <div className="mgr-cols even">
      <label className="field"><span>Monthly limit ($)</span><input inputMode="decimal" value={fields.monthly} onChange={(event) => setFields({ ...fields, monthly: event.target.value.replace(/[^\d.]/g, "") })} /></label>
      <label className="field"><span>Daily limit ($)</span><input inputMode="decimal" value={fields.daily} onChange={(event) => setFields({ ...fields, daily: event.target.value.replace(/[^\d.]/g, "") })} /></label>
      <label className="field"><span>Ask me first above, per film ($)</span><input inputMode="decimal" value={fields.perFilm} onChange={(event) => setFields({ ...fields, perFilm: event.target.value.replace(/[^\d.]/g, "") })} /></label>
    </div>
    <p className="fine">0 means no limit. The day runs midnight to midnight, New York time.</p>
    <div className="actions">
      <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => save({ monthly: fields.monthly, daily: fields.daily, perFilm: fields.perFilm }, "Limits saved.")}>Save limits</button>
      <button type="button" className={guard?.settings.paused ? "btn btn-white btn-sm" : "btn btn-ink btn-sm"} disabled={busy || !guard} onClick={() => save({ paused: !guard?.settings.paused }, guard?.settings.paused ? "Spending resumed." : "Spending paused. Nothing that costs money will run.")}>{guard?.settings.paused ? "Resume spending" : "Pause all spending"}</button>
    </div>
  </section>;
}
