"use client";

/* A social template's guidelines and photo check, shown in Studio once the template is picked. Before anything is made it
   says what the template needs from the photos; after the photos are added it reads them and says, in plain words, what
   to fix for the best result: the count, the order, the story (rooms, day or night), the movement, the photo quality.
   Nothing here changes how a film is made: it only tells, and can reorder the photos on request. */

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzePixels, type SocialCheck } from "../social-check";
import { socialGuide, socialPlan, type SocialSpec } from "../social-templates";
import { engineCost, type StudioEngineKey, type StudioResolution } from "../engine-catalog";

export type SocialPhoto = { name: string; source: string };
type Packet = { image: string; name: string; w: number; h: number; sharp: number; bright: number; hash: string };

/* One photo, measured in the browser: its size, sharpness, brightness and look-alike hash, plus a small copy for the reader. */
async function packetOf(photo: SocialPhoto): Promise<Packet> {
  const image = new Image();
  image.src = photo.source;
  await image.decode();
  const w = image.naturalWidth, h = image.naturalHeight;
  const draw = (maxSide: number) => { const scale = Math.min(1, maxSide / Math.max(w, h)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale)); const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("no canvas"); context.drawImage(image, 0, 0, canvas.width, canvas.height); return { canvas, context }; };
  const small = draw(256);
  const { sharp, bright, hash } = analyzePixels(small.context.getImageData(0, 0, small.canvas.width, small.canvas.height).data, small.canvas.width, small.canvas.height);
  const reader = draw(768);
  return { image: reader.canvas.toDataURL("image/jpeg", 0.8), name: photo.name, w, h, sharp, bright, hash };
}

const money = (value: number) => `$${value.toFixed(2)}`;

export default function SocialGuide({ spec, photos, engine, resolution, onArrange, disabled }: { spec: SocialSpec; photos: SocialPhoto[]; engine: StudioEngineKey; resolution: StudioResolution; onArrange?: (order: number[]) => void; disabled?: boolean }) {
  const guide = socialGuide(spec);
  const [state, setState] = useState<{ status: "idle" | "checking" | "done" | "failed"; check?: SocialCheck; connected?: boolean; error?: string; of?: string }>({ status: "idle" });
  const signature = useMemo(() => `${spec.key}|${photos.map((photo) => `${photo.name}:${photo.source.length}:${photo.source.slice(-24)}`).join("|")}`, [spec.key, photos]);
  const latest = useRef(signature);
  useEffect(() => { latest.current = signature; }, [signature]);
  async function run() {
    if (!photos.length) { setState({ status: "idle" }); return; }
    const asked = signature;
    setState({ status: "checking", of: asked });
    try {
      const packets = await Promise.all(photos.slice(0, 12).map(packetOf));
      const response = await fetch("/api/studio/social-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: spec.key, photos: packets }) });
      const data = await response.json().catch(() => ({})) as { check?: SocialCheck; connected?: boolean; error?: string };
      if (latest.current !== asked) return; // the photos changed while this was being read
      if (!response.ok || !data.check) throw new Error(data.error || "The photos could not be checked.");
      setState({ status: "done", check: data.check, connected: data.connected, of: asked });
    } catch (error) {
      if (latest.current === asked) setState({ status: "failed", error: error instanceof Error ? error.message : "The photos could not be checked.", of: asked });
    }
  }
  // Checks by itself when photos are added or changed (after a short pause), so the guidance arrives with the uploads.
  useEffect(() => {
    if (!photos.length || disabled) return;
    const timer = setTimeout(() => { void run(); }, 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const plan = socialPlan(spec, Math.max(photos.length || guide.best, 2));
  const clips = engineCost(engine, resolution, plan.minScene * plan.count);
  const check = state.status === "done" && state.of === signature ? state.check : undefined;
  const fixes = check?.findings.filter((item) => item.level === "fix") || [], tips = check?.findings.filter((item) => item.level === "tip") || [], oks = check?.findings.filter((item) => item.level === "ok") || [];
  const stale = state.status === "done" && state.of !== signature;

  return <div className="sg" aria-label={`${spec.name}: what it needs`}>
    <p className="sg-lead">{spec.summary}</p>
    <p className="sg-meta">{spec.canvas} · {plan.seconds.toFixed(1)} s{spec.bpm ? ` · music ${spec.bpm} BPM` : " · no music"} · {guide.best} photos for the best result, at least {guide.least} · films cost about {money(clips)} for the clips</p>
    <h4 className="sg-h">Your photos, in this order</h4>
    <ol className="sg-acts">{spec.acts.map((act, index) => <li key={act.label} className="sg-act">
      <span className="sg-n">{index + 1}</span>
      <span className="sg-body"><strong>{act.label}{act.essential ? <i className="sg-tag">needed</i> : <i className="sg-tag soft">optional</i>}{act.light !== "any" ? <i className="sg-tag light">{act.light === "day" ? "daylight" : act.light === "dusk" ? "dusk" : "night"}</i> : null}</strong><small>{act.hint}</small><small className="sg-move">Camera: {act.move}</small></span>
    </li>)}</ol>
    <details className="sg-more"><summary>Rules for the best result</summary><ul>{spec.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>{spec.avoid.length ? <><strong>Avoid</strong><ul>{spec.avoid.map((rule) => <li key={rule}>{rule}</li>)}</ul></> : null}{spec.words.length ? <><strong>Words to add in Titles</strong><ul>{spec.words.map((word) => <li key={word}>{word}</li>)}</ul></> : null}<strong>What is different from the original</strong><ul>{spec.approx.map((note) => <li key={note}>{note}</li>)}</ul></details>

    <div className="sg-check" aria-live="polite">
      <div className="sg-check-head"><strong>Photo check</strong>
        <button type="button" className="sg-run" disabled={disabled || !photos.length || state.status === "checking"} onClick={() => { void run(); }}>{state.status === "checking" ? "Checking…" : photos.length ? "Check my photos" : "Add photos to check them"}</button></div>
      {state.status === "checking" ? <p className="sg-note">Reading your photos: order, story, movement and quality…</p> : null}
      {state.status === "failed" ? <p className="sg-note bad">{state.error}</p> : null}
      {stale ? <p className="sg-note">Your photos changed. Checking again…</p> : null}
      {check ? <>
        <p className={`sg-verdict ${check.verdict}`}>{check.summary}</p>
        {state.connected === false ? <p className="sg-note">The photo reader is not connected, so rooms and lighting could not be read. Size, sharpness and brightness were still checked.</p> : null}
        {fixes.length ? <ul className="sg-list fix" aria-label="To fix">{fixes.map((item, index) => <li key={`f${index}`}>{item.text}</li>)}</ul> : null}
        {tips.length ? <ul className="sg-list tip" aria-label="Tips">{tips.map((item, index) => <li key={`t${index}`}>{item.text}</li>)}</ul> : null}
        {check.plan.length ? <ol className="sg-plan" aria-label="How your photos will play">{check.plan.map((step, position) => <li key={step.photo}>{photos[step.photo]?.source ? <img src={photos[step.photo].source} alt="" /> : null}<span><b>{position + 1}. {step.label}</b><small>{step.move}</small></span></li>)}</ol> : null}
        {oks.length ? <ul className="sg-list ok" aria-label="Looks good">{oks.map((item, index) => <li key={`o${index}`}>{item.text}</li>)}</ul> : null}
        {check.reordered && onArrange ? <button type="button" className="sg-run" disabled={disabled} onClick={() => onArrange([...check.arrangement.used, ...check.arrangement.unused])}>Arrange my photos this way</button> : null}
      </> : null}
    </div>
  </div>;
}
