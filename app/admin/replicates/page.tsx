"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead, cents } from "../ui";

type ReplicateData = { spend: { totalCents: number; renderJobsCents: number; historyCents: number; renderJobCount: number; historyCount: number }; token: { configured: boolean }; balance: { available: false; message: string }; billingUrl: string; lowBalanceAlertCents: number | null };

export default function ReplicatesPage() {
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
  return <div className="mgr-page">
    <PageHead eyebrow="Spend" title="Provider spend" sub="Recorded (estimated) generation spend and connection status. No invented balance numbers.">
      <a className="btn btn-white btn-sm" href={billingUrl} target="_blank" rel="noreferrer">Open official billing <Icon name="arrow" size={14} /></a>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}

    <section className="metrics" aria-label="Spend">
      <Metric label="Total recorded spend" value={cents(data?.spend.totalCents)} note="Jobs + saved generations" />
      <Metric label="Render jobs" value={cents(data?.spend.renderJobsCents)} note={`${data?.spend.renderJobCount || 0} recorded jobs`} />
      <Metric label="Saved generations" value={cents(data?.spend.historyCents)} note={`${data?.spend.historyCount || 0} saved files`} />
      <Metric label="API token" value={data ? (data.token.configured ? "Connected" : "Missing") : "…"} note="Server-side environment status" tone={data && !data.token.configured ? "bad" : undefined} />
    </section>

    <div className="mgr-cols even">
      <section className="panel">
        <p className="eyebrow">Account balance</p>
        <h2 className="panel-title">Official balance lives in Replicate</h2>
        <p className="muted">{data?.balance.message || "Replicate does not expose a balance endpoint."}</p>
        <a className="btn btn-ink btn-sm" href={billingUrl} target="_blank" rel="noreferrer">View balance and top up</a>
      </section>
      <section className="panel">
        <p className="eyebrow">Alerts</p>
        <h2 className="panel-title">Low-balance reminder</h2>
        <p className="muted">This is only a local reminder threshold. It does not claim to know the provider balance.</p>
        <label className="field">
          <span>Alert threshold in cents</span>
          <input inputMode="numeric" value={threshold} onChange={(event) => setThreshold(event.target.value.replace(/\D/g, ""))} placeholder="Example: 1000" />
        </label>
        <p className="fine">1000 means $10.00. Leave blank only if you do not want an alert threshold.</p>
        <button type="button" className="btn btn-ink btn-sm" onClick={saveThreshold}>Save alert</button>
      </section>
    </div>
  </div>;
}
