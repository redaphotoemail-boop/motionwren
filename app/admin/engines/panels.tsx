"use client";

import { useEffect, useState } from "react";
import { engineCost, studioEngine, studioEngines, type StudioEngine, type StudioEngineKey } from "../../engine-catalog";
import { money } from "../ui";

const FILM_SECONDS = 20;
const topResolution = (engine: StudioEngine) => engine.resolutions.includes("1080p") ? "1080p" : engine.resolutions[engine.resolutions.length - 1];
const filmEstimate = (engine: StudioEngine) => engineCost(engine.key, topResolution(engine), FILM_SECONDS);

export default function EnginePanels({ part }: { part: "controls" | "overview" }) {
  const [defaultEngine, setDefaultEngine] = useState<StudioEngineKey>("wan3");
  const [loaded, setLoaded] = useState(false);
  const [savingEngine, setSavingEngine] = useState(false);
  const [engineMessage, setEngineMessage] = useState("");
  const [secondsPerImage, setSecondsPerImage] = useState<3 | 5 | "auto">("auto");
  const [savingTiming, setSavingTiming] = useState(false);
  const [timingMessage, setTimingMessage] = useState("");
  const [orders, setOrders] = useState<{ mode: "approval" | "automatic"; payments: boolean }>({ mode: "approval", payments: false });
  const [ordersMessage, setOrdersMessage] = useState("");
  const [review, setReview] = useState<{ cloudflare: boolean; claude: boolean; autoFix: boolean; connected: { cloudflare: boolean; claude: boolean } }>({ cloudflare: false, claude: false, autoFix: true, connected: { cloudflare: false, claude: false } });
  const [aiMessage, setAiMessage] = useState("");
  const [freeFirst, setFreeFirst] = useState(false);
  const [freeMessage, setFreeMessage] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" }).then((response) => response.json()).then((result) => {
      if (result.multiShotSecondsPerImage === 3 || result.multiShotSecondsPerImage === 5 || result.multiShotSecondsPerImage === "auto") setSecondsPerImage(result.multiShotSecondsPerImage);
      if (typeof result.defaultEngine === "string" && studioEngines.some((engine) => engine.key === result.defaultEngine)) setDefaultEngine(result.defaultEngine);
      setOrders({ mode: result.customerProduction === "automatic" ? "automatic" : "approval", payments: Boolean(result.paymentsConnected) });
      setReview({ cloudflare: result.review?.cloudflare === true, claude: result.review?.claude === true, autoFix: result.autoFix !== false, connected: { cloudflare: result.reviewConnected?.cloudflare === true, claude: result.reviewConnected?.claude === true } });
      setFreeFirst(result.freeFirstVideo === true);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function saveEngine(value: StudioEngineKey) {
    const engine = studioEngine(value);
    if (!window.confirm(`Make ${engine.name} the default engine for all new videos?`)) return;
    const previous = defaultEngine;
    setDefaultEngine(value); setSavingEngine(true); setEngineMessage("");
    try {
      const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultEngine: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The engine setting could not be saved.");
      setEngineMessage(`New videos will use ${engine.name}.`);
    } catch (error) { setDefaultEngine(previous); setEngineMessage(error instanceof Error ? error.message : "The engine setting could not be saved."); }
    finally { setSavingEngine(false); }
  }

  async function saveTiming(value: 3 | 5 | "auto") {
    setSecondsPerImage(value); setSavingTiming(true); setTimingMessage("");
    try {
      const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ multiShotSecondsPerImage: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The timing setting could not be saved.");
      setTimingMessage(value === "auto" ? "New multi-shot scenes will set their timing automatically." : `New multi-shot scenes will use ${value} seconds per image.`);
    } catch (error) { setTimingMessage(error instanceof Error ? error.message : "The timing setting could not be saved."); }
    finally { setSavingTiming(false); }
  }

  async function saveOrders(mode: "approval" | "automatic") {
    if (mode === "automatic" && !orders.payments && !window.confirm("Start customer orders automatically, without payment? Each order uses engine credit as soon as it is submitted.")) return;
    setOrdersMessage("");
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerProduction: mode }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setOrdersMessage(result.error || "The setting could not be saved."); return; }
    setOrders({ mode, payments: Boolean(result.paymentsConnected) });
    setOrdersMessage(mode === "automatic" ? "New orders start on their own." : "New orders wait for you to press Start production.");
  }

  async function saveFreeFirst(next: boolean) {
    setFreeMessage("");
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ freeFirstVideo: next }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setFreeMessage(result.error || "The setting could not be saved."); return; }
    setFreeFirst(result.freeFirstVideo === true);
    setFreeMessage(result.freeFirstVideo === true ? "New customers now get one free video." : "The free first video is off.");
  }

  async function saveReview(change: { review?: { cloudflare?: boolean; claude?: boolean }; autoFix?: boolean }) {
    setAiMessage("");
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setAiMessage(result.error || "The setting could not be saved."); return; }
    setReview({ cloudflare: result.review?.cloudflare === true, claude: result.review?.claude === true, autoFix: result.autoFix !== false, connected: { cloudflare: result.reviewConnected?.cloudflare === true, claude: result.reviewConnected?.claude === true } });
    setAiMessage("Saved.");
  }

  const current = studioEngine(defaultEngine);
  const others = studioEngines.filter((engine) => engine.key !== defaultEngine).sort((a, b) => Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable)));

  if (part === "controls") return <>
    <section className="panel" id="quality">
      <div className="panel-head"><h2>Film quality check</h2><span className="muted small">Free check always on</span></div>
      <p className="muted">Every film is measured for sharpness, black or frozen picture, sudden jumps and flicker. Problems reach you as an alert; the film is still delivered.</p>
      <div className="choice-row">
        {([
          ["Cloudflare AI review", review.cloudflare, review.connected.cloudflare ? "Looks at stills and compares each one with its source photo, about a cent or two a film" : "Not connected yet", () => saveReview({ review: { cloudflare: !review.cloudflare } })],
          ["Claude review", review.claude, review.connected.claude ? "Sharper eyes, a few cents a film" : "Needs an Anthropic key", () => saveReview({ review: { claude: !review.claude } })],
          ["Fix automatically", review.autoFix, "Re-makes a flagged scene, up to 2 more times", () => saveReview({ autoFix: !review.autoFix })],
        ] as Array<[string, boolean, string, () => void]>).map(([label, on, note, toggle]) => <button key={label} type="button" className={on ? "choice active" : "choice"} aria-pressed={on} onClick={toggle}><strong>{label}: {on ? "On" : "Off"}</strong><small>{note}</small></button>)}
      </div>
      {aiMessage && <p className="muted small" role="status">{aiMessage}</p>}
    </section>
    <section className="panel" id="free-first-video">
      <div className="panel-head"><h2>Free first video</h2><span className="muted small">{freeFirst ? "On" : "Off"}</span></div>
      <p className="muted">One free video credit for each new customer, once per account, to let an agent see a real result before paying. Each one costs about $2.37 in engine and music (measured average); at most 25 are given a day. Off until you turn it on.</p>
      <div className="choice-row">
        <button type="button" className={freeFirst ? "choice active" : "choice"} aria-pressed={freeFirst} onClick={() => saveFreeFirst(!freeFirst)}><strong>Free first video: {freeFirst ? "On" : "Off"}</strong><small>Applies to accounts with no credit history yet</small></button>
      </div>
      {freeMessage && <p className="muted small" role="status">{freeMessage}</p>}
    </section>
    <section className="panel" id="orders">
      <div className="panel-head"><h2>Customer orders</h2><span className="muted small">{orders.payments ? "Payments connected" : "Payments not connected"}</span></div>
      <p className="muted">{orders.payments ? "Paid orders start on their own." : "Until payments are connected, choose whether orders start on their own or wait for you."}</p>
      {!orders.payments && <div className="choice-row">
        {([["approval", "Wait for my OK", "You press Start production on each order"], ["automatic", "Start automatically", "Uses engine credit right away, unpaid"]] as Array<["approval" | "automatic", string, string]>).map(([value, label, note]) => <button key={value} type="button" className={orders.mode === value ? "choice active" : "choice"} aria-pressed={orders.mode === value} onClick={() => saveOrders(value)}><strong>{label}</strong><small>{note}</small></button>)}
      </div>}
      {ordersMessage && <p className="note" role="status">{ordersMessage}</p>}
    </section>

    <section className="panel" id="timing">
      <div className="panel-head"><h2>Scene timing</h2><span className="muted small">Multi-shot default</span></div>
      <p className="muted">How long each photo stays on screen in new customer videos.</p>
      <div className="choice-row">
        {([["auto", "Automatic", "3–5 s, set by video length"], [3, "3 seconds", "Faster, tighter edits"], [5, "5 seconds", "More room for smooth movement"]] as Array<[3 | 5 | "auto", string, string]>).map(([value, label, note]) => <button key={String(value)} type="button" className={secondsPerImage === value ? "choice active" : "choice"} aria-pressed={secondsPerImage === value} onClick={() => saveTiming(value)} disabled={savingTiming}><strong>{label}</strong><small>{note}</small></button>)}
      </div>
      {timingMessage && <p className="note" role="status">{timingMessage}</p>}
      <p className="fine">The video length stays what the customer ordered; timing decides how many of their photos it uses. A 20-second reel uses 4 photos at 5 seconds, 7 at 3 seconds.</p>
    </section>
  </>;
  return <>
    <section className={`engine-hero${loaded ? "" : " is-loading"}`} aria-live="polite">
      <div>
        <p className="eyebrow">Default for every new video</p>
        <h2>{current.name}</h2>
        <p>{current.description}</p>
        <div className="engine-tags"><span>{current.resolutions.join(" · ")}</span><span>{current.audio ? "Native audio" : "Video only"}</span><span>{current.bestFor}</span></div>
      </div>
      <dl>
        <div><dt>Per second</dt><dd>{Object.entries(current.pricePerSecond).map(([resolution, price]) => <span key={resolution}>{resolution} <b>${Number(price).toFixed(3)}</b></span>)}</dd></div>
        <div><dt>{FILM_SECONDS}-second film at {topResolution(current)}</dt><dd className="big">≈ {money(filmEstimate(current))}</dd></div>
      </dl>
    </section>

    <section className="panel">
      <div className="panel-head"><h2>All engines</h2><span className="muted small">Catalog prices · ≈ cost of a {FILM_SECONDS}-second film</span></div>
      <div className="engine-grid">
        {others.map((engine) => <article key={engine.key} className={engine.unavailable ? "engine-card is-off" : "engine-card"} aria-disabled={Boolean(engine.unavailable)}>
          <div className="engine-card-top"><strong>{engine.name}</strong>{engine.badge && <span className="tag">{engine.badge}</span>}</div>
          <p>{engine.description}</p>
          <small className="engine-meta">{engine.resolutions.join(" · ")} · {engine.audio ? "Audio" : "Silent"} · {engine.bestFor}</small>
          <div className="engine-card-foot">
            <span><b>≈ {money(filmEstimate(engine))}</b><small>{Object.entries(engine.pricePerSecond).map(([resolution, price]) => `${resolution} $${Number(price).toFixed(3)}/s`).join(" · ")}</small></span>
            {engine.unavailable ? <span className="off-reason">Not working: {engine.unavailable}</span> : <button type="button" className="btn btn-white btn-xs" onClick={() => saveEngine(engine.key)} disabled={savingEngine}>Make default</button>}
          </div>
        </article>)}
      </div>
      <p className="fine">Applies to new videos only. Videos already in production keep the engine they started with. RECOMMENDED is our suggested starting point — the selected default is what new videos actually use. Film estimates are price per second × {FILM_SECONDS} seconds; real bills depend on scene count and the provider.</p>
    </section>
  </>;
}
