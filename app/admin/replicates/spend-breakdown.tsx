"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";

type Film = { id: string; title: string; segment: "customer" | "studio"; status: string; duration: number; createdAt: number; engineCents: number; reviewCents: number; editCents: number; totalCents: number };
type Breakdown = { films: number; categories: { engineCents: number; reviewCents: number; editCents: number }; segments: { customer: { films: number; cents: number }; studio: { films: number; cents: number } }; top: Film[] };

const share = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const when = (time: number) => new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/* What is behind a Spending bar (Today or This month): by kind of cost, by who it was for, and film by film.
   The totals use the same sums as the bar, so they always agree with it. */
export function SpendBreakdown({ period, label }: { period: "day" | "month"; label: string }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/admin/spend-guard/breakdown?period=${period}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The breakdown could not be loaded.");
        if (!cancelled) { setData(body); setError(""); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "The breakdown could not be loaded."); }
    })();
    return () => { cancelled = true; };
  }, [period]);

  if (error) return <p role="alert" className="fine">{error}</p>;
  if (!data) return <p className="muted">Loading the breakdown…</p>;
  const total = data.categories.engineCents + data.categories.reviewCents + data.categories.editCents;
  const kinds: [string, number, string][] = [
    ["Video engine", data.categories.engineCents, "Every scene sent to the engine, including the 1080p upscale and any scene made again"],
    ["AI reading and review", data.categories.reviewCents, "The AI photo reader and the AI quality check (the measured checks are free)"],
    ["Editing", data.categories.editCents, "Joining, transitions and finishing on our server (an estimate)"],
  ];
  const people: [string, number, number][] = [["Client orders", data.segments.customer.cents, data.segments.customer.films], ["My tests", data.segments.studio.cents, data.segments.studio.films]];
  return <div className="fin-breakdown" aria-label={`${label} spending breakdown`}>
    <p className="muted">{label}: {cents(total)} over {data.films} film{data.films === 1 ? "" : "s"} started. Music and card fees are counted on the Finance page, not on these bars.</p>
    <h3 className="fin-breakdown-title">Where it went</h3>
    <div className="cost-lines">
      {kinds.map(([name, value, note]) => <div key={name}>
        <div><span>{name}</span><strong>{cents(value)} <small style={{ display: "inline" }}>{share(value, total)}%</small></strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${share(value, total)}%` }} /></div>
        <small>{note}</small>
      </div>)}
    </div>
    <h3 className="fin-breakdown-title">Who it was for</h3>
    <div className="cost-lines">
      {people.map(([name, value, films]) => <div key={name}>
        <div><span>{name}</span><strong>{cents(value)} <small style={{ display: "inline" }}>{share(value, total)}%</small></strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${share(value, total)}%` }} /></div>
        <small>{films} film{films === 1 ? "" : "s"}</small>
      </div>)}
    </div>
    <h3 className="fin-breakdown-title">Film by film{data.films > data.top.length ? ` · the ${data.top.length} biggest of ${data.films}` : ""}</h3>
    {data.top.length === 0 ? <p className="muted">Nothing has been spent in this period.</p> : <div className="cost-lines">
      {data.top.map((film) => <div key={film.id}>
        <div><span>{film.title} · {film.segment === "customer" ? "client" : "test"} · {film.duration}s</span><strong>{cents(film.totalCents)}</strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${share(film.totalCents, data.top[0].totalCents)}%` }} /></div>
        <small>{when(film.createdAt)} · {film.status} · engine {cents(film.engineCents)}{film.reviewCents ? ` · AI ${cents(film.reviewCents)}` : ""}{film.editCents ? ` · editing ${cents(film.editCents)}` : ""}</small>
      </div>)}
    </div>}
  </div>;
}
