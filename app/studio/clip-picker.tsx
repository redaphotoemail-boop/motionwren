"use client";

/* "Use saved clips" (Studio, owner only): pick clips that were already generated for earlier films and make a new film
   from them — no new generation, so no engine cost. Clips of one frame shape (16:9, vertical…) can be mixed. */
import { useState } from "react";
import { videoRef } from "../video-ref";

type Scene = { index: number; move: string; photo: string; clip: string };
type Film = { id: string; label: string; aspect: string; resolution: string; seconds: number; createdAt: number; scenes: Scene[] };
export type ChosenClip = { jobId: string; scene: number };

const shape = (aspect: string) => aspect === "vertical" ? "9:16" : aspect === "cinematic" ? "2.39:1" : aspect === "square" ? "1:1" : "16:9";

export default function ClipPicker({ disabled, starting, onMake }: { disabled?: boolean; starting?: boolean; onMake: (clips: ChosenClip[], note: (message: string) => void) => void }) {
  const [open, setOpen] = useState(false);
  const [films, setFilms] = useState<Film[] | null>(null);
  const [chosen, setChosen] = useState<ChosenClip[]>([]);
  const [note, setNote] = useState("");
  async function toggle() {
    const next = !open; setOpen(next);
    if (!next || films) return;
    try {
      const response = await fetch("/api/studio/clips", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { films?: Film[]; error?: string };
      if (!response.ok || !data.films) setNote(data.error || "Your clips could not be loaded."); else setFilms(data.films);
    } catch { setNote("Your clips could not be loaded."); }
  }
  const shapeOf = (jobId: string) => films?.find((film) => film.id === jobId)?.aspect;
  const lockedShape = chosen.length ? shapeOf(chosen[0].jobId) : null;
  const position = (jobId: string, scene: number) => chosen.findIndex((item) => item.jobId === jobId && item.scene === scene);
  function pick(film: Film, scene: Scene) {
    const at = position(film.id, scene.index);
    if (at >= 0) return setChosen((current) => current.filter((_, index) => index !== at));
    if (chosen.length >= 12) return setNote("A film can use up to 12 clips.");
    if (lockedShape && film.aspect !== lockedShape) return setNote(`Clips of one shape only. Your first clip is ${shape(lockedShape)}.`);
    setNote(""); setChosen((current) => [...current, { jobId: film.id, scene: scene.index }]);
  }
  return <div className="clip-picker">
    <button type="button" className="add-scene" onClick={toggle} disabled={disabled} aria-expanded={open}><span>▶</span>Use clips already made</button>
    {open && <div className="clip-panel">
      <p className="clip-help">Choose clips from your earlier films, in the order you want them. No new generation: only the edit is made.</p>
      {!films && !note && <p className="clip-help">Loading your clips…</p>}
      {films && !films.length && <p className="clip-help">No saved clips yet. Finished films keep their clips from now on.</p>}
      {films?.map((film) => <section className="clip-film" key={film.id}>
        <header><strong>{film.label}</strong><small>{videoRef(film.id)} · {shape(film.aspect)} · {new Date(film.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></header>
        <div className="clip-grid">{film.scenes.map((scene) => {
          const at = position(film.id, scene.index);
          const blocked = Boolean(lockedShape && film.aspect !== lockedShape);
          return <button type="button" key={scene.index} className={at >= 0 ? "clip-item on" : blocked ? "clip-item blocked" : "clip-item"} onClick={() => pick(film, scene)} aria-pressed={at >= 0} title={scene.move}>
            <img src={scene.photo} alt={`Scene ${scene.index + 1}`} loading="lazy"/>
            {at >= 0 && <b>{at + 1}</b>}
            <small>Scene {scene.index + 1}</small>
          </button>;
        })}</div>
      </section>)}
      {note && <p className="clip-note">{note}</p>}
      <div className="clip-bar">
        <span>{chosen.length ? `${chosen.length} clip${chosen.length === 1 ? "" : "s"} chosen` : "Tap clips to choose them"}</span>
        <button type="button" onClick={() => onMake(chosen, setNote)} disabled={disabled || starting || chosen.length < 2}>{starting ? "Starting…" : "Make a film from these"}</button>
      </div>
    </div>}
  </div>;
}
