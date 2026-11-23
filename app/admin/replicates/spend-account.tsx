"use client";

import { useEffect, useState } from "react";
import { Metric, cents } from "../ui";

type ReplicateData = { spend: { totalCents: number; renderJobsCents: number; historyCents: number; renderJobCount: number; historyCount: number }; token: { configured: boolean }; balance: { available: false; message: string }; billingUrl: string; lowBalanceAlertCents: number | null };

/* The Replicate account: what was recorded, where the real balance lives, and the local low-balance reminder.
   Estimates are labelled; no invented balance numbers. */
export function SpendAccount() {
  const [data, setData] = useState<ReplicateData | null>(null);
  const [threshold, setThreshold] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const response = await fetch("/api/admin/replicates", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Replicate data could not be loaded.");
    setData(result); setThreshold(result.lowBalanceAlertCents == null ? "" : String(result.lowBalanceAlertCents));
  }
  useEffect(() => { void Promise.resolve().then(load).catch((cause) => setError(cause instanceof Error ? cause.message : "Replicate data could not be loaded.")); }, []);

  async function saveThreshold() {
    setMessage(""); setError("");
    const response = await fetch("/api/admin/replicates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lowBalanceAlertCents: threshold === "" ? null : Number(threshold) }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "The alert could not be saved."); return; }
    setMessage(threshold === "" ? "Low-balance alert cleared." : "Low-balance alert saved."); await load();
  }

  const billingUrl = data?.billingUrl || "https://replicate.com/account/billing";
  return <div className="fin-account">
    <p className="muted">Recorded provider spend and balance links. Estimates are labelled; no invented balance numbers.</p>
    {error && <p role="alert" className="fine">{error}</p>}
    {message && <p role="status" className="fine">{message}</p>}
    <section className="metrics" aria-label="Spend">
      <Metric label="Total recorded spend" value={cents(data?.spend.totalCents)} note="Jobs + saved generations" />
      <Metric label="Render jobs" value={cents(data?.spend.renderJobsCents)} note={`${data?.spend.renderJobCount || 0} recorded jobs`} />
      <Metric label="Saved generations" value={cents(data?.spend.historyCents)} note={`${data?.spend.historyCount || 0} saved files`} />
      <Metric label="API token" value={data ? (data.token.configured ? "Connected" : "Missing") : "…"} note="Server-side environment status" tone={data && !data.token.configured ? "bad" : undefined} />
    </section>
    <p className="muted">{data?.balance.message || "Replicate does not expose a balance endpoint."} <a className="text-btn" href={billingUrl} target="_blank" rel="noreferrer">View balance and top up</a></p>
    <label className="field">
      <span>Low-balance reminder, in cents (a local reminder; it does not know the provider balance)</span>
      <input inputMode="numeric" value={threshold} onChange={(event) => setThreshold(event.target.value.replace(/\D/g, ""))} placeholder="Example: 1000 = $10.00" />
    </label>
    <button type="button" className="btn btn-ink btn-sm" onClick={saveThreshold}>Save reminder</button>
  </div>;
}
