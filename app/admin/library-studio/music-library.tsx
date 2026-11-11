"use client";

/* The music library: tracks kept for reuse. Added automatically from every
   film that ElevenLabs makes music for; the manager can add their own, switch
   a track off or delete it. */

import { useCallback, useEffect, useRef, useState } from "react";
import { MUSIC_TEMPLATES } from "../../music-catalog";

type Track = { id: string; style: string; name: string; seconds: number; source: string; uses: number; active: boolean };

async function lengthOf(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error("That file could not be read as audio."));
      audio.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export function MusicLibrary() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [target, setTarget] = useState(5);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const [style, setStyle] = useState(MUSIC_TEMPLATES[0].id);

  const apply = (data: { tracks?: Track[]; target?: number; error?: string }) => { if (data.tracks) setTracks(data.tracks); if (typeof data.target === "number") setTarget(data.target); };
  const load = useCallback(async () => { const response = await fetch("/api/admin/music-library", { cache: "no-store" }); apply(await response.json().catch(() => ({}))); }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function send(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/music-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That could not be saved.");
      apply(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "That could not be saved."); }
    finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setMessage("");
    try {
      const seconds = await lengthOf(file);
      const response = await fetch(`/api/admin/music-library/upload?style=${style}&seconds=${seconds.toFixed(1)}&name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The track could not be added.");
      apply(data); setMessage("Track added.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The track could not be added."); }
    finally { setBusy(false); }
  }

  function play(id: string) {
    if (!audio.current) audio.current = new Audio();
    const player = audio.current;
    if (playing === id) { player.pause(); setPlaying(""); return; }
    player.src = `/api/admin/music-library/${id}/audio`;
    player.onended = () => setPlaying("");
    void player.play().then(() => setPlaying(id)).catch(() => { setPlaying(""); setMessage("That track could not be played."); });
  }

  return (
    <section className="panel ml">
      <header className="ml-head"><div><h2>Music library</h2><p>Tracks kept for reuse, so new films stop paying for new music.</p></div><span className="ml-count">{tracks.length} track{tracks.length === 1 ? "" : "s"}</span></header>
      <div className="ml-rule">
        <span>Reuse a style once it has</span>
        <input type="number" min={0} max={50} value={target} disabled={busy} onChange={(event) => setTarget(Number(event.target.value))} onBlur={() => { void send({ action: "target", target }); }} aria-label="Tracks needed before reuse" />
        <span>tracks <small>(0 = always make new)</small></span>
      </div>
      {message ? <p className="ml-note">{message}</p> : null}
      {MUSIC_TEMPLATES.map((template) => {
        const own = tracks.filter((track) => track.style === template.id);
        const ready = own.filter((track) => track.active).length;
        const reusing = target > 0 && ready >= target;
        return (
          <div key={template.id} className="ml-style">
            <div className="ml-style-head"><div><h3>{template.name}</h3><small>{template.blurb}</small></div><span className={reusing ? "ml-state on" : "ml-state"}>{reusing ? "Reusing" : `${ready} of ${target}`}</span></div>
            <div className="ml-bar" aria-hidden><i style={{ width: `${target > 0 ? Math.min(100, (ready / target) * 100) : 100}%` }} /></div>
            {own.length === 0 ? <p className="ml-empty">The next film in this style adds the first track.</p> : <ul className="ml-tracks">{own.map((track) => (
              <li key={track.id} className={track.active ? "" : "off"}>
                <button type="button" className="ml-play" onClick={() => play(track.id)} aria-label={playing === track.id ? "Pause" : "Play"}>{playing === track.id ? "❚❚" : "▶"}</button>
                <span className="ml-name"><strong>{track.name}</strong><small>{Math.round(track.seconds)} s · {track.source === "upload" ? "Added by you" : "ElevenLabs"} · used {track.uses}×</small></span>
                <button type="button" role="switch" aria-checked={track.active} aria-label={`${track.name} on`} className={track.active ? "ml-switch on" : "ml-switch"} disabled={busy} onClick={() => { void send({ action: "update", id: track.id, active: !track.active }); }}><i /></button>
                <button type="button" className="ml-del" disabled={busy} aria-label={`Delete ${track.name}`} onClick={() => { if (window.confirm(`Delete "${track.name}"? Films already made keep their copy.`)) void send({ action: "delete", id: track.id }); }}>Delete</button>
              </li>
            ))}</ul>}
          </div>
        );
      })}
      <div className="ml-add">
        <div><strong>Add your own track</strong><small>Any licensed instrumental, mp3.</small></div>
        <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={busy}>{MUSIC_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
        <label className="ml-file">Choose mp3<input type="file" accept="audio/mpeg,.mp3" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>
      </div>
    </section>
  );
}
