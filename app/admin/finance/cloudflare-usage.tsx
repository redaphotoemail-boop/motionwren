"use client";

import { useEffect, useState } from "react";
import { cents } from "../ui";
import { CATEGORIES, PLAN_DOLLARS } from "../../cloudflare-cost";

type Row = { key: string; group: string; label: string; unit: string; included: number; note?: string; used: number | null; share: number; overageCents: number };
type Watchdog = { lastSweepAt?: number; stoppedToday?: number; day?: string; lastStoppedAt?: number; spendCheckedAt?: number; todayDollars?: number | null; spendError?: string; limitDollars?: number };
type FeatureLine = { key: string; label: string; note: string; cents: number; estimate: boolean; split: boolean };
type Bill = { connected: false } | { connected: true; error: string } | { connected: true; error?: undefined; source: "billing" | "estimate"; billingProblem: string; machineProblem: string; periodStart: number; periodEnd: number; planCents: number; usageCents: number; soFarCents: number; projectedCents: number; share: number; products: { name: string; cents: number }[]; features: FeatureLine[] };
type Report = ({ connected: false } | { connected: true; at: number; since: string; rows: Row[]; overageCents: number; totalCents: number; problems: Record<string, string> }) & { watchdog?: Watchdog; bill?: Bill };
type ReadyBill = Extract<Bill, { source: "billing" | "estimate" }>;

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pctOf = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const isReady = (bill?: Bill): bill is ReadyBill => Boolean(bill && bill.connected && !("error" in bill && bill.error) && "source" in bill);

/* What the billing period's Cloudflare bill is made of: by MotionWren feature, then by Cloudflare service. Same bars as Spending's breakdown. */
function CloudflareBreakdown({ bill }: { bill: ReadyBill }) {
  const total = bill.soFarCents;
  const products = [...bill.products, { name: "Workers Paid plan", cents: bill.planCents }].sort((a, b) => b.cents - a.cents);
  return <div className="fin-breakdown" aria-label="Cloudflare bill breakdown">
    <h3 className="fin-breakdown-title">By feature</h3>
    <div className="cost-lines">
      {bill.features.map((line) => <div key={line.key}>
        <div><span>{line.label}</span><strong>{cents(line.cents)} <small style={{ display: "inline" }}>{pctOf(line.cents, total)}%</small></strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${pctOf(line.cents, total)}%` }} /></div>
        <small>{[line.note, line.split ? "split by the machine time it used" : ""].filter(Boolean).join(" · ")}</small>
      </div>)}
    </div>
    {bill.machineProblem && <p className="fine">The editing machines could not be split by feature just now ({bill.machineProblem}).</p>}
    <h3 className="fin-breakdown-title">By Cloudflare service</h3>
    <div className="cost-lines">
      {products.map((line) => <div key={line.name}>
        <div><span>{line.name}</span><strong>{cents(line.cents)} <small style={{ display: "inline" }}>{pctOf(line.cents, total)}%</small></strong></div>
        <div className="bar" aria-hidden="true"><i style={{ width: `${pctOf(line.cents, total)}%` }} /></div>
      </div>)}
    </div>
  </div>;
}

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

/* Cloudflare, live: the billing period's bill so far and where it is heading, what it is made of (by MotionWren
   feature and by Cloudflare service), and the usage behind it. Same bars as Spending. */
export function CloudflareUsage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
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
        <h2 className="panel-title">{report?.connected ? (isReady(report.bill) ? `${cents(report.bill.soFarCents)} so far this billing period` : `${cents(report.totalCents)} so far this month`) : "Cloudflare costs"}</h2>
      </div>
      {report?.connected && <button type="button" className="btn btn-white btn-sm" onClick={() => setTick((value) => value + 1)}>Refresh</button>}
    </div>
    {error && <p role="alert" className="fine">{error}</p>}
    {report && !report.connected && <>
      <p className="muted">Not connected yet. Add a read-only Cloudflare token and the live numbers appear here, by category.</p>
      <details className="fin-more"><summary>How to connect</summary>
        <p className="fine">In Cloudflare: My Profile → API Tokens → Create Token → Custom token. Permissions: Account · Account Analytics · Read, and Account · Billing · Read (nothing else; both only read). Then, for this site (Workers & Pages → motionwren → Settings → Variables and Secrets), add two secrets: <code>CLOUDFLARE_API_TOKEN</code> (the token) and <code>CLOUDFLARE_ACCOUNT_ID</code> (your account ID, shown in the dashboard sidebar and in the URL).</p>
        <p className="fine">What it will show, by category: {[...new Set(CATEGORIES.map((item) => item.group))].join(", ")}.</p>
      </details>
    </>}
    {report?.connected && <>
      {isReady(report.bill) ? <>
        <p className="muted">{day(report.bill.periodStart)} to {day(report.bill.periodEnd)} · {cents(report.bill.planCents)} plan + {cents(report.bill.usageCents)} usage · next charge {day(report.bill.periodEnd)}, about {cents(report.bill.projectedCents)} if usage keeps this pace.</p>
        <div className="fin-meters">
          <div className={`fin-meter fin-meter-tap${open ? " open" : ""}`} role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(!open); } }}>
            <div className="fin-meter-head"><span>This billing period</span><strong>{cents(report.bill.soFarCents)}<small>{` · on track for ${cents(report.bill.projectedCents)}`}</small></strong></div>
            <div className="fin-meter-bar" role="img" aria-label={`${report.bill.share}% of the billing period has passed`}><i style={{ width: `${Math.max(2, report.bill.share)}%` }} /></div>
            <small className="fin-meter-hint">{open ? "Hide the breakdown" : "See what it is made of, by feature"}</small>
          </div>
          {typeof report.watchdog?.todayDollars === "number" && <div className="fin-meter">
            <div className="fin-meter-head"><span>Editing machines today</span><strong>{cents(report.watchdog.todayDollars * 100)}<small>{` of the ${cents((report.watchdog.limitDollars || 1) * 100)} daily alert`}</small></strong></div>
            <div className={`fin-meter-bar${report.watchdog.todayDollars >= (report.watchdog.limitDollars || 1) ? " full" : report.watchdog.todayDollars >= 0.8 * (report.watchdog.limitDollars || 1) ? " warn" : ""}`} role="img" aria-label="Editing machine spend today against the daily alert"><i style={{ width: `${Math.min(100, pctOf(report.watchdog.todayDollars, report.watchdog.limitDollars || 1))}%` }} /></div>
          </div>}
        </div>
        {open && <CloudflareBreakdown bill={report.bill} />}
        <p className="fine">{report.bill.source === "billing" ? "From Cloudflare's billable usage, the same figures as its invoice." : `Estimated from Cloudflare's usage at its published rates, for the calendar month. For the exact invoice figures and dates, add Account · Billing · Read to the token${report.bill.billingProblem ? ` (Cloudflare said: ${report.bill.billingProblem})` : ""}.`}</p>
      </> : <p className="muted">{cents(PLAN_DOLLARS * 100)} plan{report.overageCents > 0 ? ` + ${cents(report.overageCents)} used beyond what the plan includes` : " · everything so far is within what the plan includes"}.{report.bill && "error" in report.bill && report.bill.error ? ` The bill could not be read just now (${report.bill.error}).` : ""}</p>}
      <details className="fin-more"><summary>Usage against what the plan includes</summary>
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
      </details>
    </>}
    <WatchdogLine watchdog={report?.watchdog} />
  </section>;
}
