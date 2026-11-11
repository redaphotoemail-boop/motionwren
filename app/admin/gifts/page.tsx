"use client";

import { useEffect, useState } from "react";
import { Metric, PageHead, ago } from "../ui";

type Gift = { code: string; credits: number; note: string | null; createdAt: number; redeemedAt: number | null; redeemedByEmail: string | null };

export default function GiftsPage() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [credits, setCredits] = useState(1);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
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
      setFresh(data.codes || []); setNote(""); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "The code could not be made."); }
    finally { setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); window.setTimeout(() => setCopied(""), 1500); } catch { /* the code stays visible to copy by hand */ }
  }

  const unused = gifts.filter((gift) => !gift.redeemedAt);
  const used = gifts.length - unused.length;
  const unusedVideos = unused.reduce((sum, gift) => sum + gift.credits, 0);

  return <>
    <PageHead eyebrow="Gifts" title="Gift codes" sub="Make a code worth 1, 2 or 3 free videos and give it to anyone. Whoever enters it first gets the videos. For a percentage off at checkout, make a promotion code in Stripe (checkout already accepts them)." />
    {error && <div className="notice notice-bad" role="alert"><span>{error}</span></div>}
    <section className="metrics">
      <Metric label="Unused codes" value={unused.length} note={`${unusedVideos} free videos waiting`} />
      <Metric label="Redeemed" value={used} />
    </section>
    <form className="panel" onSubmit={create} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <label>Free videos in each code
        <select value={credits} onChange={(event) => setCredits(Number(event.target.value))}>
          {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n} {n === 1 ? "video" : "videos"}</option>)}
        </select>
      </label>
      <label>How many codes
        <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {[1, 2, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>Note (only you see it)
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="For Sarah, open house promo" maxLength={120} />
      </label>
      <button type="submit" className="btn" disabled={busy}>{busy ? "Making…" : "Make code"}</button>
    </form>
    {fresh.length > 0 && <section className="panel">
      <h3>New {fresh.length === 1 ? "code" : "codes"}, worth {credits} {credits === 1 ? "video" : "videos"} each</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {fresh.map((code) => <li key={code}><code style={{ fontSize: 18 }}>{code}</code> <button type="button" className="text-btn" onClick={() => copy(code)}>{copied === code ? "Copied" : "Copy"}</button></li>)}
      </ul>
      <button type="button" className="text-btn" onClick={() => copy(fresh.join("\n"))}>{copied === fresh.join("\n") ? "Copied" : "Copy all"}</button>
    </section>}
    <section className="panel">
      <h3>All codes</h3>
      {gifts.length === 0 ? <p>No codes yet.</p> : <table>
        <thead><tr><th>Code</th><th>Videos</th><th>Note</th><th>Made</th><th>Status</th></tr></thead>
        <tbody>{gifts.map((gift) => <tr key={gift.code}>
          <td><code>{gift.code}</code></td><td>{gift.credits}</td><td>{gift.note || ""}</td><td>{ago(gift.createdAt)}</td>
          <td>{gift.redeemedAt ? `Used by ${gift.redeemedByEmail || "a customer"} ${ago(gift.redeemedAt)}` : <button type="button" className="text-btn" onClick={() => copy(gift.code)}>{copied === gift.code ? "Copied" : "Copy"}</button>}</td>
        </tr>)}</tbody>
      </table>}
    </section>
  </>;
}
