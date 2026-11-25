"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";

type Film = { id: string; title: string; segment: "customer" | "studio"; status: string; duration: number; createdAt: number; engineCents: number; reviewCents: number; editCents: number; totalCents: number };
export type Breakdown = { films: number; categories: { engineCents: number; reviewCents: number; editCents: number }; segments: { customer: { films: number; cents: number }; studio: { films: number; cents: number } }; top: Film[] };
export type Breakdowns = { day: Breakdown | null; month: Breakdown | null; error: string };

const share = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const FILM_ROWS = 8;

/* Both periods load once, together, when the Spending box appears, so tapping Today or This month only swaps what is already there: no waiting, no flicker. */
export function useSpendBreakdowns(): Breakdowns {
  const [state, setState] = useState<Breakdowns>({ day: null, month: null, error: "" });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [day, month] = await Promise.all((["day", "month"] as const).map(async (period) => {
          const response = await fetch(`/api/admin/spend-guard/breakdown?period=${period}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "The breakdown could not be loaded.");
          return body as Breakdown;
        }));
        if (!cancelled) setState({ day, month, error: "" });
      } catch (cause) { if (!cancelled) setState({ day: null, month: null, error: cause instanceof Error ? cause.message : "The breakdown could not be loaded." }); }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

/* What is behind a Spending bar: three kinds of cost in one line each, then who it was for. Film by film stays one tap further down.
   The totals use the same sums as the bar, so they always agree with it. */
export function SpendBreakdown({ data, error, label }: { data: Breakdown | null; error: string; label: string }) {
  if (error) return <div className="fin-breakdown"><p role="alert" className="fine">{error}</p></div>;
  if (!data) return <div className="fin-breakdown fin-breakdown-wait" aria-busy="true"><p className="muted">Loading…</p></div>;
  const { engineCents, reviewCents, editCents } = data.categories;
  const total = engineCents + reviewCents + editCents;
  const kinds: [string, number][] = [["Video engine", engineCents], ["AI reading and review", reviewCents], ["Editing", editCents]];
  const shown = data.top.slice(0, FILM_ROWS);
  return <div className="fin-breakdown" aria-label={`${label} spending breakdown`}>
    <p className="muted">{label}: {cents(total)} over {data.films} film{data.films === 1 ? "" : "s"}. Music and card fees are on the Finance page.</p>
    <div className="cost-lines">
      {kinds.map(([name, value]) => <div key={name}>
        <div><span>{name}</span><strong>{cents(value)} <small style={{ display: "inline" }}>{share(value, total)}%</small></strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${share(value, total)}%` }} /></div>
      </div>)}
    </div>
    <p className="fin-breakdown-split"><span>Client orders <strong>{cents(data.segments.customer.cents)}</strong> · {data.segments.customer.films}</span><span>My tests <strong>{cents(data.segments.studio.cents)}</strong> · {data.segments.studio.films}</span></p>
    {shown.length > 0 && <details className="fin-breakdown-films">
      <summary>Film by film{data.films > shown.length ? ` · the ${shown.length} biggest` : ""}</summary>
      <ul>{shown.map((film) => <li key={film.id}><span>{film.title} · {film.segment === "customer" ? "client" : "test"} · {film.duration}s</span><strong>{cents(film.totalCents)}</strong></li>)}</ul>
    </details>}
  </div>;
}
