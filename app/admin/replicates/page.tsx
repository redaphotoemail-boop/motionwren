"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead, cents } from "../ui";

type Lines = { videoCents: number; musicCents: number; editCents: number; totalCents: number };
type Totals = Lines & { videos: number; finished: number; perFinishedCents: number; priceCents: number };
type Segment = { customer: Totals; studio: Totals };
type CostData = { month: Segment; allTime: Segment; recent: Array<Lines & { id: string; segment: "customer" | "studio"; status: string; title: string; owner: string; duration: number; createdAt: number; priceCents: number | null }>; fixedMonthly: { cloudflare: number; elevenLabs: number }; rates: { musicPerMinute: number; editPerFilm: number }; paymentsConnected: boolean };
const share = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "–";
const when = (value: number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type ReplicateData = { spend: { totalCents: number; renderJobsCents: number; historyCents: number; renderJobCount: number; historyCount: number }; token: { configured: boolean }; balance: { available: false; message: string }; billingUrl: string; lowBalanceAlertCents: number | null };

export default function ReplicatesPage() {
  const [data, setData] = useState<ReplicateData | null>(null);
  const [costs, setCosts] = useState<CostData | null>(null);
  const [who, setWho] = useState<"customer" | "studio">("customer");
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
  useEffect(() => { void fetch("/api/admin/costs", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => { if (result) setCosts(result); }).catch(() => undefined); }, []);
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
    <PageHead eyebrow="Spend" title="Costs and spend" sub="What each video costs to make, plus recorded provider spend. Estimates are labelled; no invented balance numbers.">
      <a className="btn btn-white btn-sm" href={billingUrl} target="_blank" rel="noreferrer">Open official billing <Icon name="arrow" size={14} /></a>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    {message && <div className="notice notice-ok" role="status"><Icon name="check" size={18} /><span>{message}</span></div>}

    {costs && (() => {
      const month = costs.month[who];
      const all = costs.allTime[who];
      const lines: Array<[string, number, string]> = [["Video engine", month.videoCents, "Replicate: the scenes"], ["Music", month.musicCents, `ElevenLabs: about $${costs.rates.musicPerMinute.toFixed(2)} a minute`], ["Editing", month.editCents, "Cloudflare: joining and mixing"]];
      const shown = costs.recent.filter((row) => row.segment === who);
      const priced = who === "customer";
      return <section className="panel" aria-label="Cost per video">
        <p className="eyebrow">Cost per video</p>
        <h2 className="panel-title">What each video costs to make</h2>
        <div className="filters"><div className="tabs" role="radiogroup" aria-label="Which videos">
          {([["customer", "Client orders"], ["studio", "My tests"]] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={who === value} className={who === value ? "active" : ""} onClick={() => setWho(value)}>{label}</button>)}
        </div></div>
        <section className="metrics" aria-label="Cost totals">
          <Metric label="Average per finished video" value={cents(month.perFinishedCents)} note={`${month.finished} finished this month`} />
          <Metric label="This month" value={cents(month.totalCents)} note={`${month.videos} video${month.videos === 1 ? "" : "s"}`} />
          <Metric label="All time" value={cents(all.totalCents)} note={`${all.videos} video${all.videos === 1 ? "" : "s"}`} />
          {priced && <Metric label="List price of orders" value={cents(month.priceCents)} note={costs.paymentsConnected ? "This month" : "This month · not charged yet"} />}
        </section>
        <div className="facts-list">
          {lines.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{cents(value)} <small>{share(value, month.totalCents)} · {note}</small></strong></div>)}
          <div><span>Total this month</span><strong>{cents(month.totalCents)}</strong></div>
        </div>
        {shown.length > 0 && <div className="table costs" role="table" aria-label="Recent videos">
          <div className="table-head" role="row"><span>Video</span><span>Engine</span><span>Music</span><span>Editing</span><span>Total</span><span>{priced ? "Price" : ""}</span><span>{priced ? "Margin" : ""}</span></div>
          {shown.map((row) => <div role="row" className="table-row" key={row.id}>
            <span className="cell-main"><strong>{row.title}{row.owner ? ` · ${row.owner}` : ""}</strong><small>{when(row.createdAt)} · {row.duration}s · {row.status === "succeeded" ? "finished" : row.status}</small><small className="cost-mobile">Engine {cents(row.videoCents)} · Music {cents(row.musicCents)} · Edit {cents(row.editCents)}</small></span>
            <span className="cell-num" data-label="Engine">{cents(row.videoCents)}</span>
            <span className="cell-num" data-label="Music">{row.musicCents ? cents(row.musicCents) : "–"}</span>
            <span className="cell-num" data-label="Editing">{row.editCents ? cents(row.editCents) : "–"}</span>
            <span className="cell-num" data-label="Total"><strong>{cents(row.totalCents)}</strong></span>
            <span className="cell-num" data-label="Price">{priced && row.priceCents != null ? cents(row.priceCents) : ""}</span>
            <span className="cell-num" data-label="Margin">{priced && row.priceCents != null ? cents(row.priceCents - row.totalCents) : ""}</span>
          </div>)}
        </div>}
        <p className="fine">Monthly plans, not per video: Cloudflare ${costs.fixedMonthly.cloudflare} + ElevenLabs ${costs.fixedMonthly.elevenLabs} = ${costs.fixedMonthly.cloudflare + costs.fixedMonthly.elevenLabs} a month. Estimates from list prices: the video engine is what production recorded when each video started, music and editing are calculated from the film&apos;s length. Open the providers&apos; billing pages for exact charges.{priced ? " Margin is list price minus cost; orders are not charged until payments are connected." : ""}</p>
      </section>;
    })()}

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
