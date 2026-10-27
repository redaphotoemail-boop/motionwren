"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { engineCost, studioEngine, studioEngines, type StudioEngine, type StudioEngineKey } from "../../engine-catalog";
import { PageHead, money } from "../ui";

const FILM_SECONDS = 20;
const topResolution = (engine: StudioEngine) => engine.resolutions.includes("1080p") ? "1080p" : engine.resolutions[engine.resolutions.length - 1];
const filmEstimate = (engine: StudioEngine) => engineCost(engine.key, topResolution(engine), FILM_SECONDS);

export default function EnginesPage() {
  const [defaultEngine, setDefaultEngine] = useState<StudioEngineKey>("wan3");
  const [loaded, setLoaded] = useState(false);
  const [savingEngine, setSavingEngine] = useState(false);
  const [engineMessage, setEngineMessage] = useState("");
  const [secondsPerImage, setSecondsPerImage] = useState<3 | 5 | "auto">("auto");
  const [savingTiming, setSavingTiming] = useState(false);
  const [timingMessage, setTimingMessage] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" }).then((response) => response.json()).then((result) => {
      if (result.multiShotSecondsPerImage === 3 || result.multiShotSecondsPerImage === 5 || result.multiShotSecondsPerImage === "auto") setSecondsPerImage(result.multiShotSecondsPerImage);
      if (typeof result.defaultEngine === "string" && studioEngines.some((engine) => engine.key === result.defaultEngine)) setDefaultEngine(result.defaultEngine);
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

  const current = studioEngine(defaultEngine);
  const others = studioEngines.filter((engine) => engine.key !== defaultEngine);

  return <div className="mgr-page">
    <PageHead eyebrow="Engines" title="Choose the right model" sub="Pick the engine every new video renders with. Every model below uses its connected production endpoint.">
      <Link className="btn btn-white btn-sm" href="/studio"><Icon name="studio" size={15} />Compare in Studio</Link>
    </PageHead>

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
    {engineMessage && <div className="notice" role="status"><span className="dot dot-ok" /><span>{engineMessage}</span></div>}

    <section className="panel">
      <div className="panel-head"><h2>All engines</h2><span className="muted small">Catalog prices · ≈ cost of a {FILM_SECONDS}-second film</span></div>
      <div className="engine-grid">
        {others.map((engine) => <article key={engine.key} className="engine-card">
          <div className="engine-card-top"><strong>{engine.name}</strong>{engine.badge && <span className="tag">{engine.badge}</span>}</div>
          <p>{engine.description}</p>
          <small className="engine-meta">{engine.resolutions.join(" · ")} · {engine.audio ? "Audio" : "Silent"} · {engine.bestFor}</small>
          <div className="engine-card-foot">
            <span><b>≈ {money(filmEstimate(engine))}</b><small>{Object.entries(engine.pricePerSecond).map(([resolution, price]) => `${resolution} $${Number(price).toFixed(3)}/s`).join(" · ")}</small></span>
            <button type="button" className="btn btn-white btn-xs" onClick={() => saveEngine(engine.key)} disabled={savingEngine}>Make default</button>
          </div>
        </article>)}
      </div>
      <p className="fine">Applies to new videos only. Videos already in production keep the engine they started with. RECOMMENDED is our suggested starting point — the selected default is what new videos actually use. Film estimates are price per second × {FILM_SECONDS} seconds; real bills depend on scene count and the provider.</p>
    </section>

    <section className="panel" id="timing">
      <div className="panel-head"><h2>Scene timing</h2><span className="muted small">Multi-shot default</span></div>
      <p className="muted">Controls the duration of each scene in new multi-shot productions.</p>
      <div className="choice-row">
        {([["auto", "Automatic", "5s for 1–4 images · 3s for 5+ images"], [3, "3 seconds", "Faster, tighter edits"], [5, "5 seconds", "More room for smooth movement"]] as Array<[3 | 5 | "auto", string, string]>).map(([value, label, note]) => <button key={String(value)} type="button" className={secondsPerImage === value ? "choice active" : "choice"} aria-pressed={secondsPerImage === value} onClick={() => saveTiming(value)} disabled={savingTiming}><strong>{label}</strong><small>{note}</small></button>)}
      </div>
      {timingMessage && <p className="note" role="status">{timingMessage}</p>}
      <p className="fine">Automatic keeps small sequences readable and makes larger sequences more efficient. The final video length is calculated from the number of scenes and crossfades.</p>
    </section>
  </div>;
}
