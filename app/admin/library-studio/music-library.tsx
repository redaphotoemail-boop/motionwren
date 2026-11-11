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
    <section className="panel">
      <div className="panel-head"><h2>Music library</h2><span className="muted small">{tracks.length} track{tracks.length === 1 ? "" : "s"}</span></div>
      <p className="muted">Every track ElevenLabs makes for a film is kept here. Once a style has enough tracks, new films reuse the least-played one instead of paying for new music. Add your own licensed instrumentals to fill it faster.</p>
      <label className="field-toggle">Reuse a style once it has
        <input type="number" min={0} max={50} value={target} disabled={busy} onChange={(event) => setTarget(Number(event.target.value))} onBlur={() => { void send({ action: "target", target }); }} style={{ width: 64, margin: "0 8px" }} />
        tracks that are long enough <span className="muted small">(0 = always make new)</span>
      </label>
      {message ? <p className="notice">{message}</p> : null}
      {MUSIC_TEMPLATES.map((template) => {
        const own = tracks.filter((track) => track.style === template.id);
        const ready = own.filter((track) => track.active).length;
        return (
          <div key={template.id} style={{ marginTop: 16 }}>
            <div className="panel-head"><h3>{template.name}</h3><span className="muted small">{ready} of {target} ready{ready >= target && target > 0 ? " · reusing" : ""}</span></div>
            {own.length === 0 ? <p className="muted small">None yet — the next film in this style adds one.</p> : own.map((track) => (
              <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={() => play(track.id)}>{playing === track.id ? "Pause" : "Play"}</button>
                <span style={{ flex: 1, minWidth: 140, opacity: track.active ? 1 : .5 }}>{track.name}<span className="muted small"> · {Math.round(track.seconds)} s · {track.source === "upload" ? "added by you" : "ElevenLabs"} · used {track.uses}×</span></span>
                <label className="field-toggle"><input type="checkbox" checked={track.active} disabled={busy} onChange={(event) => { void send({ action: "update", id: track.id, active: event.target.checked }); }} /> On</label>
                <button type="button" className="btn" disabled={busy} onClick={() => { if (window.confirm(`Delete "${track.name}"? Films already made keep their copy.`)) void send({ action: "delete", id: track.id }); }}>Delete</button>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Add a track</strong>
        <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={busy}>{MUSIC_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
        <input type="file" accept="audio/mpeg,.mp3" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      </div>
    </section>
  );
}
