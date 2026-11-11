"use client";

import { useEffect, useState } from "react";
import { PageHead, ago } from "../ui";

type Gift = { code: string; credits: number; note: string | null; createdAt: number; redeemedAt: number | null; redeemedByEmail: string | null };

export default function GiftsPage() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [credits, setCredits] = useState(1);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const [freshCredits, setFreshCredits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/gifts", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gift codes could not be loaded.");
      setGifts(data.codes || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Gift codes could not be loaded."); }
  }
  useEffect(() => { void Promise.resolve().then(load); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setFresh([]);
    try {
      const response = await fetch("/api/admin/gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credits, count, note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The code could not be made.");
      setFresh(data.codes || []); setFreshCredits(credits); setNote(""); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "The code could not be made."); }
    finally { setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); window.setTimeout(() => setCopied(""), 1500); } catch { /* the code stays visible to copy by hand */ }
  }

  const unused = gifts.filter((gift) => !gift.redeemedAt);
  const unusedVideos = unused.reduce((sum, gift) => sum + gift.credits, 0);
  const Pills = ({ values, value, set }: { values: number[]; value: number; set: (n: number) => void }) => <div className="gift-pills" role="radiogroup">{values.map((n) => <button key={n} type="button" role="radio" aria-pressed={value === n} aria-checked={value === n} onClick={() => set(n)}>{n}</button>)}</div>;

  return <div className="mgr-page gift">
    <PageHead eyebrow="Gifts" title="Give free videos" sub="Make a code, send it to anyone. Whoever enters it first gets the videos. For a percentage off at checkout, make a promotion code in Stripe." />
    {error && <div className="notice notice-bad" role="alert"><span>{error}</span></div>}
    <div className="gift-stats">
      <div><b>{unused.length}</b><span>unused codes</span></div>
      <div><b>{unusedVideos}</b><span>free videos waiting</span></div>
      <div><b>{gifts.length - unused.length}</b><span>redeemed</span></div>
    </div>
    <form className="gift-make" onSubmit={create}>
      <h2>New code</h2>
      <div className="gift-field"><span>Free videos in each code</span><Pills values={[1, 2, 3, 5, 10]} value={credits} set={setCredits} /></div>
      <div className="gift-field"><span>How many codes</span><Pills values={[1, 2, 5, 10, 20]} value={count} set={setCount} /></div>
      <label className="gift-field"><span>Note, only you see it</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="For Sarah, open house promo" maxLength={120} /></label>
      <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? "Making…" : "Make code"}</button>
    </form>
    {fresh.length > 0 && <section className="gift-new" aria-label="New codes">
      {fresh.map((code) => <div className="gift-code" key={code}><div><code>{code}</code><br /><small>{freshCredits} free {freshCredits === 1 ? "video" : "videos"}</small></div><button type="button" className="btn btn-soft btn-xs" onClick={() => copy(code)}>{copied === code ? "Copied" : "Copy"}</button></div>)}
      {fresh.length > 1 && <button type="button" className="text-btn" onClick={() => copy(fresh.join("\n"))}>{copied === fresh.join("\n") ? "Copied" : "Copy all"}</button>}
    </section>}
    <section className="gift-list" aria-label="All codes">
      <h2>All codes</h2>
      {gifts.length === 0 && <p className="muted">No codes yet.</p>}
      {gifts.map((gift) => <div className="gift-row" key={gift.code}>
        <div><code>{gift.code}</code><br /><small>{gift.credits} {gift.credits === 1 ? "video" : "videos"}{gift.note ? ` · ${gift.note}` : ""} · made {ago(gift.createdAt)}</small></div>
        <div>{gift.redeemedAt ? <span className="gift-used">Used by {gift.redeemedByEmail || "a customer"}</span> : <button type="button" className="text-btn" onClick={() => copy(gift.code)}>{copied === gift.code ? "Copied" : "Copy"}</button>}</div>
      </div>)}
    </section>
  </div>;
}
