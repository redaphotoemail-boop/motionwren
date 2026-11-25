"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

/* The client's editor for a delivered film (Reda, Nov 25 2026). Optional: the film is already delivered.
   Words on the cards, scene order, frame, music and voiceover change without making anything again.
   A scene can be made again a few times (included with the film); every earlier version of a scene is kept and
   can be put back. Each change makes a new version of the film; earlier versions stay in the client's history. */

type Take = { take: number; clip: string; at: number };
type Scene = { index: number; photo: string; clip: string; takes: Take[]; still: boolean };
type Card = { title?: string; detail?: string; message?: string; name?: string; contact?: string; logo?: string } | null;
type Film = {
  status: "ready" | "updating"; frame: string; madeRatio: number | null; order: number[]; scenes: Scene[];
  cards: { opening: Card; closing: Card } | null; music: string; musicChoices: { id: string; name: string }[];
  voice: { mode: string; voiceId: string; film: string } | null; voices: { id: string; name: string; note: string; previewUrl: string }[];
  sceneSounds: boolean; remakes: { used: number; included: number };
};

const FRAMES: { id: string; label: string; note: string }[] = [
  { id: "horizontal", label: "16:9", note: "Website, YouTube, TV" },
  { id: "vertical", label: "9:16", note: "Reels, TikTok, Stories" },
  { id: "square", label: "1:1", note: "Feed posts" },
  { id: "portrait", label: "4:5", note: "Tall feed posts" },
];
const OPENING_FIELDS: [keyof NonNullable<Card>, string, number][] = [["title", "Address or title", 80], ["detail", "Price, beds, baths", 140], ["message", "Short message", 120]];
const CLOSING_FIELDS: [keyof NonNullable<Card>, string, number][] = [["name", "Agent name", 80], ["contact", "Phone, email or brokerage", 140]];

export default function EditFilm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [order, setOrder] = useState<number[]>([]);
  const [opening, setOpening] = useState<NonNullable<Card>>({});
  const [closing, setClosing] = useState<NonNullable<Card>>({});
  const [music, setMusic] = useState("auto");
  const [voiceId, setVoiceId] = useState("");
  const [script, setScript] = useState("");
  const [showTakes, setShowTakes] = useState<number | null>(null);

  async function load() {
    try {
      const response = await fetch(`/api/projects/${id}/edit`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This film can't be edited.");
      setFilm(data); setOrder(data.order);
      setOpening(data.cards?.opening || {}); setClosing(data.cards?.closing || {});
      setMusic(data.music || "auto"); setVoiceId(data.voice?.voiceId || ""); setScript(data.voice?.film || "");
      setError("");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "This film can't be edited."); }
  }
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a change is being made, look again now and then so the page shows when it's ready.
  useEffect(() => {
    if (film?.status !== "updating") return;
    const timer = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(timer);
  }, [film?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(label: string, body: Record<string, unknown>, done: string) {
    setBusy(label); setNotice(""); setError("");
    try {
      const response = await fetch(`/api/projects/${id}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That change didn't go through.");
      setNotice(done);
      await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "That change didn't go through."); }
    finally { setBusy(""); }
  }

  const move = (from: number, to: number) => setOrder((list) => { if (to < 0 || to >= list.length) return list; const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  const updating = film?.status === "updating";
  const locked = Boolean(busy) || updating;
  const orderChanged = film ? order.some((value, index) => value !== film.order[index]) : false;
  const remakesLeft = film ? Math.max(0, film.remakes.included - film.remakes.used) : 0;

  if (error && !film) return <main className="fe"><Link href="/dashboard" className="fe-back">← Back to your orders</Link><p className="fe-error" role="alert">{error}</p></main>;
  if (!film) return <main className="fe"><p className="fe-muted">Loading your film…</p></main>;

  return <main className="fe">
    <Link href="/dashboard" className="fe-back">← Back to your orders</Link>
    <h1>Edit your film</h1>
    <p className="fe-lead">Every change makes a new version of your film. Earlier versions stay in your orders.</p>
    {updating && <p className="fe-notice" role="status">Your film is being updated. This page refreshes when it&rsquo;s ready.</p>}
    {notice && !updating && <p className="fe-notice" role="status">{notice}</p>}
    {error && <p className="fe-error" role="alert">{error}</p>}

    <section className="fe-block" aria-labelledby="fe-frame">
      <h2 id="fe-frame">Frame</h2>
      <p className="fe-muted">Your film was made once in your photos&rsquo; own shape, so any frame is a new cut, never a new film.</p>
      <div className="fe-choices">
        {FRAMES.map((frame) => <button key={frame.id} type="button" className={`fe-choice${film.frame === frame.id || (film.frame === "made" && frame.id === "horizontal" && !film.madeRatio) ? " on" : ""}`} disabled={locked || film.frame === frame.id} onClick={() => send("frame", { frame: frame.id }, `Cutting your film to ${frame.label}.`)}><strong>{frame.label}</strong><small>{frame.note}</small></button>)}
      </div>
    </section>

    <section className="fe-block" aria-labelledby="fe-scenes">
      <h2 id="fe-scenes">Scenes</h2>
      <p className="fe-muted">Move scenes up or down to change the order. Making a scene again keeps the version it replaces, so you can always put it back. {film.remakes.included ? `${remakesLeft} of ${film.remakes.included} scene remakes left.` : ""}</p>
      {film.sceneSounds && <p className="fe-muted">This film has a voice or sound for each scene, so its order stays as it is.</p>}
      <ol className="fe-scenes">
        {order.map((index, place) => {
          const scene = film.scenes[index];
          return <li key={index} className="fe-scene">
            <img src={scene.photo} alt={`Scene ${place + 1} photo`} loading="lazy" />
            <div className="fe-scene-body">
              <strong>Scene {place + 1}</strong>
              {scene.still && <small>Shown as a gentle move on your photo, so every line stays true.</small>}
              <div className="fe-scene-actions">
                <button type="button" className="btn btn-soft btn-xs" aria-label={`Move scene ${place + 1} up`} disabled={locked || film.sceneSounds || place === 0} onClick={() => move(place, place - 1)}>↑</button>
                <button type="button" className="btn btn-soft btn-xs" aria-label={`Move scene ${place + 1} down`} disabled={locked || film.sceneSounds || place === order.length - 1} onClick={() => move(place, place + 1)}>↓</button>
                <button type="button" className="btn btn-soft btn-xs" disabled={locked || remakesLeft < 1} onClick={() => { if (window.confirm(`Make scene ${place + 1} again? The version in your film now is kept, so you can put it back.`)) void send("remake", { remake: { scene: index } }, `Making scene ${place + 1} again. Your film updates when it's ready.`); }}>Make again</button>
                {scene.takes.length > 0 && <button type="button" className="btn btn-soft btn-xs" aria-expanded={showTakes === index} onClick={() => setShowTakes(showTakes === index ? null : index)}>Earlier versions ({scene.takes.length})</button>}
              </div>
              {showTakes === index && <div className="fe-takes">
                <figure><video src={scene.clip} controls muted playsInline preload="metadata" /><figcaption>In your film now</figcaption></figure>
                {scene.takes.map((take) => <figure key={take.take}><video src={take.clip} controls muted playsInline preload="metadata" /><figcaption>{new Date(take.at).toLocaleString()}<button type="button" className="btn btn-ink btn-xs" disabled={locked} onClick={() => send("take", { useTake: { scene: index, take: take.take } }, `Putting that version of scene ${place + 1} back.`)}>Use this one</button></figcaption></figure>)}
              </div>}
            </div>
          </li>;
        })}
      </ol>
      {orderChanged && <div className="fe-row"><button type="button" className="btn btn-ink btn-sm" disabled={locked} onClick={() => send("order", { order }, "Putting your scenes in the new order.")}>Save the new order</button><button type="button" className="btn btn-soft btn-sm" disabled={locked} onClick={() => setOrder(film.order)}>Undo</button></div>}
    </section>

    <section className="fe-block" aria-labelledby="fe-text">
      <h2 id="fe-text">Text on the film</h2>
      <p className="fe-muted">The opening and closing cards are laid over the film, so changing them never changes a scene.</p>
      <div className="fe-fields">
        <fieldset><legend>Opening card</legend>{OPENING_FIELDS.map(([key, label, max]) => <label key={key}>{label}<input value={String(opening[key] || "")} maxLength={max} onChange={(event) => setOpening({ ...opening, [key]: event.target.value })} /></label>)}</fieldset>
        <fieldset><legend>Closing card</legend>{CLOSING_FIELDS.map(([key, label, max]) => <label key={key}>{label}<input value={String(closing[key] || "")} maxLength={max} onChange={(event) => setClosing({ ...closing, [key]: event.target.value })} /></label>)}</fieldset>
      </div>
      <button type="button" className="btn btn-ink btn-sm" disabled={locked} onClick={() => send("cards", { cards: { opening, closing: { ...closing, logo: closing.logo ? "keep" : "" } } }, "Updating the text on your film.")}>Save the text</button>
    </section>

    <section className="fe-block" aria-labelledby="fe-music">
      <h2 id="fe-music">Music</h2>
      <div className="fe-row">
        <select value={music} aria-label="Music" onChange={(event) => setMusic(event.target.value)} disabled={locked}>
          <option value="auto">As made</option>
          {film.musicChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
          <option value="none">No music</option>
        </select>
        <button type="button" className="btn btn-ink btn-sm" disabled={locked || music === film.music || music === "auto"} onClick={() => send("music", { music }, "Changing the music.")}>Use this music</button>
      </div>
    </section>

    <section className="fe-block" aria-labelledby="fe-voice">
      <h2 id="fe-voice">Voiceover</h2>
      {film.voices.length ? <>
        <p className="fe-muted">One voice reads your words over the whole film.</p>
        <div className="fe-row">
          <select value={voiceId} aria-label="Voice" onChange={(event) => setVoiceId(event.target.value)} disabled={locked}>
            <option value="">Choose a voice</option>
            {film.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.note ? ` · ${voice.note}` : ""}</option>)}
          </select>
          {voiceId && <audio controls preload="none" src={film.voices.find((voice) => voice.id === voiceId)?.previewUrl} aria-label="Hear this voice" />}
        </div>
        <textarea value={script} maxLength={1500} rows={4} aria-label="What the voice says" placeholder="What the voice says, for example: Welcome to 12 Ridge Road…" onChange={(event) => setScript(event.target.value)} disabled={locked} />
        <div className="fe-row">
          <button type="button" className="btn btn-ink btn-sm" disabled={locked || !voiceId || script.trim().length < 10} onClick={() => send("voice", { voice: { mode: "film", voiceId, film: script.trim() } }, "Adding the voiceover.")}>Use this voiceover</button>
          {film.voice && <button type="button" className="btn btn-soft btn-sm" disabled={locked} onClick={() => send("voice", { voice: null }, "Taking the voiceover off.")}>No voiceover</button>}
        </div>
      </> : <p className="fe-muted">Voiceovers aren&rsquo;t available right now.</p>}
    </section>
  </main>;
}
