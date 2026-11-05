"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead, cents } from "../ui";
import { cardFeeCents } from "../../cost-model";

type Lines = { videoCents: number; musicCents: number; editCents: number; totalCents: number };
type Totals = Lines & { videos: number; finished: number; perFinishedCents: number; priceCents: number; musicSeconds: number };
type Segment = { customer: Totals; studio: Totals };
type Row = Lines & { id: string; segment: "customer" | "studio"; status: string; title: string; owner: string; duration: number; createdAt: number; priceCents: number | null };
type CostData = { month: Segment; allTime: Segment; recent: Row[]; fixedMonthly: { cloudflare: number; elevenLabs: number }; rates: { musicPerMinute: number; editPerFilm: number; includedMusicMinutes: number; cardPercent: number; cardFixed: number }; paymentsConnected: boolean };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const placed = (value: number) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function FinancePage() {
  const [costs, setCosts] = useState<CostData | null>(null);
  const [error, setError] = useState("");
  const [who, setWho] = useState<"customer" | "studio">("customer");
  const [period, setPeriod] = useState<"month" | "allTime">("month");

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const response = await fetch("/api/admin/costs", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Finance data could not be loaded.");
        setCosts(result);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Finance data could not be loaded."); }
    });
  }, []);

  const body = (() => {
    if (!costs) return <div className="empty-soft compact"><span>{error ? "" : "Loading finance…"}</span></div>;
    const data = costs[period][who];
    const orders = who === "customer";
    const fixedCents = period === "month" ? Math.round((costs.fixedMonthly.cloudflare + costs.fixedMonthly.elevenLabs) * 100) : 0;
    const feeCents = orders ? cardFeeCents(data.priceCents, data.finished) : 0;
    const categories: Array<{ label: string; cents: number; note: string }> = [
      { label: "Video engine", cents: data.videoCents, note: "Replicate: generating every scene" },
      { label: "Music", cents: data.musicCents, note: `ElevenLabs: one track per film, about $${costs.rates.musicPerMinute.toFixed(2)} a minute` },
      { label: "Editing", cents: data.editCents, note: "Cloudflare: joining scenes and mixing the music" },
      ...(period === "month" ? [{ label: "Monthly plans", cents: fixedCents, note: `Cloudflare $${costs.fixedMonthly.cloudflare} + ElevenLabs $${costs.fixedMonthly.elevenLabs}, paid whether or not anyone orders` }] : []),
      ...(orders ? [{ label: "Card fees (projected)", cents: feeCents, note: `${costs.rates.cardPercent}% + $${costs.rates.cardFixed.toFixed(2)} per order once payments are on` }] : []),
    ];
    const total = categories.reduce((sum, item) => sum + item.cents, 0);
    const revenue = orders ? data.priceCents : 0;
    const profit = revenue - total;
    const musicMinutes = (costs[period].customer.musicSeconds + costs[period].studio.musicSeconds) / 60;
    const perOrderProfit = data.finished && orders ? Math.round((revenue - data.totalCents - feeCents) / data.finished) : 0;
    const breakEven = orders && perOrderProfit > 0 ? Math.ceil(fixedCents / perOrderProfit) : null;
    const shown = costs.recent.filter((row) => row.segment === who);
    const label = period === "month" ? "this month" : "all time";

    return <>
      <section className="panel" aria-label="Cost of the full production process">
        <p className="eyebrow">Cost of production, A to Z</p>
        <div className="hero-total">{cents(total)}</div>
        <p className="muted">{who === "customer" ? "Client orders" : "Your own tests"} · {label} · {data.videos} video{data.videos === 1 ? "" : "s"}, {data.finished} finished. Here is where it went:</p>
        <div className="cost-lines">
          {categories.map((item) => <div key={item.label}>
            <div><span>{item.label}</span><strong>{cents(item.cents)} <small style={{ display: "inline" }}>{pct(item.cents, total)}%</small></strong></div>
            <div className="bar" aria-hidden="true"><i style={{ width: `${pct(item.cents, total)}%` }} /></div>
            <small>{item.note}</small>
          </div>)}
        </div>
      </section>

      <section className="metrics" aria-label="Money in and out">
        {orders && <Metric label="Revenue at list price" value={cents(revenue)} note={costs.paymentsConnected ? label : `${label} · not charged yet`} />}
        {orders && <Metric label="Profit after all costs" value={cents(profit)} note={revenue ? `${pct(profit, revenue)}% margin` : "No priced orders"} tone={profit < 0 ? "bad" : undefined} />}
        <Metric label="Cost per finished video" value={cents(data.perFinishedCents)} note="Engine + music + editing" />
        <Metric label="Music used" value={`${musicMinutes.toFixed(1)} min`} note={period === "month" ? `of ${costs.rates.includedMusicMinutes} included in the plan` : "all films, all time"} />
        {orders && breakEven !== null && period === "month" && <Metric label="Orders to cover plans" value={String(breakEven)} note={`Monthly plans ÷ ${cents(perOrderProfit)} profit per order`} />}
      </section>

      <section className="panel" aria-label="Every order">
        <p className="eyebrow">Every order</p>
        <h2 className="panel-title">Cost of each video and where it went</h2>
        {shown.length ? <div className="table costs" role="table" aria-label="Orders with costs">
          <div className="table-head" role="row"><span>Video</span><span>Engine</span><span>Music</span><span>Editing</span><span>Total</span><span>{orders ? "Price" : ""}</span><span>{orders ? "Profit" : ""}</span></div>
          {shown.map((row) => <div role="row" className="table-row" key={row.id}>
            <span className="cell-main"><strong>{row.title}{row.owner ? ` · ${row.owner}` : ""}</strong><small>{placed(row.createdAt)} · {row.duration}s · {row.status === "succeeded" ? "finished" : row.status}</small><small className="cost-mobile">Engine {cents(row.videoCents)} · Music {cents(row.musicCents)} · Edit {cents(row.editCents)}</small></span>
            <span className="cell-num" data-label="Engine">{cents(row.videoCents)}</span>
            <span className="cell-num" data-label="Music">{row.musicCents ? cents(row.musicCents) : "–"}</span>
            <span className="cell-num" data-label="Editing">{row.editCents ? cents(row.editCents) : "–"}</span>
            <span className="cell-num" data-label="Total"><strong>{cents(row.totalCents)}</strong></span>
            <span className="cell-num" data-label="Price">{orders && row.priceCents != null ? cents(row.priceCents) : ""}</span>
            <span className="cell-num" data-label="Profit">{orders && row.priceCents != null ? cents(row.priceCents - row.totalCents) : ""}</span>
          </div>)}
        </div> : <div className="empty-soft compact"><span>No videos yet.</span></div>}
        <p className="fine">Estimates from list prices: the video engine is what production recorded when each video started (failed attempts included), music and editing are calculated from each film&apos;s length. The providers&apos; billing pages stay the final word. Revenue is the order&apos;s list price; nothing is charged until payments are connected.</p>
      </section>
    </>;
  })();

  return <div className="mgr-page">
    <PageHead eyebrow="Finance" title="Finance" sub="What it costs to make a video, where the money goes, and what is left.">
      <a className="btn btn-white btn-sm" href="/admin/replicates">Provider spend <Icon name="arrow" size={14} /></a>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
    <div className="filters">
      <div className="tabs" role="radiogroup" aria-label="Which videos">
        {([["customer", "Client orders"], ["studio", "My tests"]] as const).map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={who === value} className={who === value ? "active" : ""} onClick={() => setWho(value)}>{text}</button>)}
      </div>
      <div className="tabs" role="radiogroup" aria-label="Period">
        {([["month", "This month"], ["allTime", "All time"]] as const).map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{text}</button>)}
      </div>
    </div>
    {body}
  </div>;
}
