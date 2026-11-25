"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";

type Item = { id: string; title: string; segment: "customer" | "studio"; status: string; duration: number; costCents: number; createdAt: number; owner: string };
type Line = { label: string; detail: string; cents: number; estimate: boolean };
type Detail = { title: string; status: string; createdAt: number; duration: number; engine: string; scenes: number; lines: Line[]; totalCents: number };

const share = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const when = (time: number) => new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/* One film, line by line: pick a film and see every cost of making it. Same bars as "What one film costs us". */
export function OneFilmCost() {
  const [films, setFilms] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || films) return;
    void (async () => {
      try {
        const response = await fetch("/api/admin/film-cost", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The films could not be loaded.");
        setFilms(body.films); if (body.films[0]) setPicked(body.films[0].id);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "The films could not be loaded."); }
    })();
  }, [open, films]);
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/admin/film-cost?id=${encodeURIComponent(picked)}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "That film's cost could not be loaded.");
        if (!cancelled) { setDetail(body); setError(""); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "That film's cost could not be loaded."); }
    })();
    return () => { cancelled = true; setDetail(null); };
  }, [picked]);

  return <details className="panel fin-more" aria-label="One film, line by line" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary><span><strong>One film, line by line</strong><small>Pick a film and see every cost of making it</small></span></summary>
    {error && <p role="alert" className="fine">{error}</p>}
    {films && films.length === 0 && <p className="muted">No films yet.</p>}
    {films && films.length > 0 && <label className="field"><span>Film</span>
      <select value={picked} onChange={(event) => setPicked(event.target.value)}>
        {films.map((film) => <option key={film.id} value={film.id}>{when(film.createdAt)} · {film.title} · {film.segment === "customer" ? `client${film.owner ? ` (${film.owner})` : ""}` : "test"} · {film.duration}s · {cents(film.costCents)} · {film.status}</option>)}
      </select>
    </label>}
    {open && !detail && !error && picked && <p className="muted">Loading…</p>}
    {detail && <>
      <div className="hero-total">{cents(detail.totalCents)}</div>
      <p className="muted">{detail.title} · {detail.engine} · {detail.scenes} scene{detail.scenes === 1 ? "" : "s"} · {detail.duration} seconds · {detail.status}</p>
      <div className="cost-lines">
        {detail.lines.map((line) => <div key={line.label}>
          <div><span>{line.label}</span><strong>{line.estimate ? "≈ " : ""}{cents(line.cents)} <small style={{ display: "inline" }}>{share(line.cents, detail.totalCents)}%</small></strong></div>
          <div className="bar" aria-hidden="true"><i style={{ width: `${share(line.cents, detail.totalCents)}%` }} /></div>
          <small>{line.detail}</small>
        </div>)}
      </div>
      <p className="fine">≈ marks an estimate from list prices; the engine line is what production recorded. Card fees and the fixed monthly plans are not per film. Your providers&apos; billing pages stay the final word.</p>
    </>}
  </details>;
}
