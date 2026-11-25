"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";
import { CATEGORIES, PLAN_DOLLARS } from "../../cloudflare-cost";

type Row = { key: string; group: string; label: string; unit: string; included: number; note?: string; used: number | null; share: number; overageCents: number };
type Watchdog = { lastSweepAt?: number; stoppedToday?: number; day?: string; lastStoppedAt?: number; spendCheckedAt?: number; todayDollars?: number | null; spendError?: string; limitDollars?: number };
type Report = ({ connected: false } | { connected: true; at: number; since: string; rows: Row[]; overageCents: number; totalCents: number; problems: Record<string, string> }) & { watchdog?: Watchdog };

const ago = (ms: number) => { const minutes = Math.round((Date.now() - ms) / 60000); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`; };

/* The editing-machine watchdog in one line: when it last looked, what it put to sleep today, today's spend. */
function WatchdogLine({ watchdog }: { watchdog?: Watchdog }) {
  if (!watchdog) return null;
  const today = new Date().toISOString().slice(0, 10);
  const limit = (watchdog.limitDollars || 1).toFixed(2);
  const parts = [
    watchdog.lastSweepAt ? `checked for idle editing machines ${ago(watchdog.lastSweepAt)}` : "has not checked the editing machines yet (it looks every 10 minutes)",
    `${watchdog.day === today ? watchdog.stoppedToday || 0 : 0} put to sleep today`,
    typeof watchdog.todayDollars === "number" ? `editing machines today: $${watchdog.todayDollars.toFixed(2)} of the $${limit} daily limit` : watchdog.spendError ? `today's spend could not be read (${watchdog.spendError})` : `alerts above $${limit} a day once Cloudflare is connected`,
  ];
  return <p className="fine">Watchdog: {parts.join(" · ")}.</p>;
}

const amount = (value: number, unit: string) => {
  if (unit === "GB" || unit === "GiB-hours" || unit === "GB-hours" || unit === "vCPU-minutes") return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${unit}`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(value));
};

/* Cloudflare, live: what has been used this month, by category, with the bill so far. Same bars as Spending. */
export function CloudflareUsage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/cloudflare-usage", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Cloudflare usage could not be loaded.");
        setReport(data); setError("");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Cloudflare usage could not be loaded."); }
    })();
  }, [tick]);
  useEffect(() => { const timer = setInterval(() => setTick((value) => value + 1), 60_000); return () => clearInterval(timer); }, []);

  const groups = report?.connected ? [...new Set(report.rows.map((row) => row.group))] : [];
  return <section className="panel fin-guard fin-ok" aria-label="Cloudflare costs">
    <div className="fin-guard-top">
      <div>
        <p className="eyebrow">Cloudflare</p>
        <h2 className="panel-title">{report?.connected ? `${cents(report.totalCents)} so far this month` : "Cloudflare costs"}</h2>
      </div>
      {report?.connected && <button type="button" className="btn btn-white btn-sm" onClick={() => setTick((value) => value + 1)}>Refresh</button>}
    </div>
    {error && <p role="alert" className="fine">{error}</p>}
    {report && !report.connected && <>
      <p className="muted">Not connected yet. Add a read-only Cloudflare token and the live numbers appear here, by category.</p>
      <details className="fin-more"><summary>How to connect</summary>
        <p className="fine">In Cloudflare: My Profile → API Tokens → Create Token → Custom token. Permission: Account · Account Analytics · Read (nothing else). Then, for this site (Workers & Pages → motionwren → Settings → Variables and Secrets), add two secrets: <code>CLOUDFLARE_API_TOKEN</code> (the token) and <code>CLOUDFLARE_ACCOUNT_ID</code> (your account ID, shown in the dashboard sidebar and in the URL).</p>
        <p className="fine">What it will show, by category: {[...new Set(CATEGORIES.map((item) => item.group))].join(", ")}.</p>
      </details>
    </>}
    {report?.connected && <>
      <p className="muted">{cents(PLAN_DOLLARS * 100)} plan{report.overageCents > 0 ? ` + ${cents(report.overageCents)} used beyond what the plan includes` : " · everything so far is within what the plan includes"}. Updates every minute.</p>
      {groups.map((group) => <div key={group} className="fin-meters">
        {report.rows.filter((row) => row.group === group).map((row) => {
          const problem = report.problems[row.key];
          const known = row.used !== null;
          return <div key={row.key} className="fin-meter">
            <div className="fin-meter-head"><span>{group} · {row.label}</span><strong>{known ? amount(row.used!, row.unit) : "–"}<small>{known ? (row.included > 0 ? ` of ${amount(row.included, row.unit)} included` : ` ${row.unit}`) : " not available"}</small></strong></div>
            <div className={`fin-meter-bar${row.share >= 100 ? " full" : row.share >= 80 ? " warn" : ""}`} role="img" aria-label={known ? `${row.label}: ${row.share}% of what the plan includes` : `${row.label}: not available`}><i style={{ width: `${known ? row.share : 0}%` }} /></div>
            <small className="muted">{problem ? `Cloudflare did not answer for this one (${problem})` : known && row.overageCents > 0 ? `${cents(row.overageCents)} beyond the included amount${row.note ? ` · ${row.note}` : ""}` : row.note || ""}</small>
          </div>;
        })}
      </div>)}
      <p className="fine">Since the 1st of the month (UTC), straight from Cloudflare. Cloudflare&apos;s billing page stays the final word. Logs and traces start billing on December 1.</p>
    </>}
    <WatchdogLine watchdog={report?.watchdog} />
  </section>;
}
