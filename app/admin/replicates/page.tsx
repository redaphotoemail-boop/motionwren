"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";

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

  return <main className="portal-shell owner-dashboard"><section className="portal-content owner-content"><div className="owner-welcome"><div><span className="owner-only"><Icon name="shield" size={14}/>Manager access</span><h1>Provider spend</h1><p>Recorded (estimated) generation spend and connection status. No invented balance numbers.</p></div><a className="secondary-action" href={data?.billingUrl || "https://replicate.com/account/billing"} target="_blank" rel="noreferrer">Open official billing <Icon name="arrow" size={15}/></a></div>{error && <div className="portal-alert error" role="alert">{error}</div>}{message && <div className="portal-alert success" role="status">{message}</div>}<section className="owner-metrics"><article><span>Total recorded spend</span><strong>${((data?.spend.totalCents || 0) / 100).toFixed(2)}</strong><small>Jobs + saved generations</small></article><article><span>Render jobs</span><strong>${((data?.spend.renderJobsCents || 0) / 100).toFixed(2)}</strong><small>{data?.spend.renderJobCount || 0} recorded jobs</small></article><article><span>Saved generations</span><strong>${((data?.spend.historyCents || 0) / 100).toFixed(2)}</strong><small>{data?.spend.historyCount || 0} saved files</small></article><article><span>API token</span><strong>{data?.token.configured ? "Connected" : "Missing"}</strong><small>Server-side environment status</small></article></section><section className="owner-panel replicates-panel"><div className="owner-panel-head"><div><span>ACCOUNT BALANCE</span><h2>Official balance lives in Replicate</h2><p>{data?.balance.message || "Replicate does not expose a balance endpoint."}</p></div><a className="primary-action" href={data?.billingUrl || "https://replicate.com/account/billing"} target="_blank" rel="noreferrer">View balance and top up</a></div></section><section className="owner-panel replicates-panel"><div className="owner-panel-head"><div><span>ALERTS</span><h2>Low-balance reminder</h2><p>This is only a local reminder threshold. It does not claim to know the provider balance.</p></div></div><label className="replicate-threshold"><span>Alert threshold in cents</span><input inputMode="numeric" value={threshold} onChange={(event) => setThreshold(event.target.value.replace(/\D/g, ""))} placeholder="Example: 1000"/><small>Example: 1000 means $10.00. Leave blank only if you do not want an alert threshold.</small></label><button className="primary-action" onClick={saveThreshold}>Save alert</button></section></section></main>;
}
