"use client";

/* "Smart choice": reads the photos and suggests a camera movement for each scene, the same way customer films do.
   Nothing changes until Apply is tapped, and every scene's movement can still be changed by hand afterwards. */

import { useState } from "react";

export type StudioMove = "push" | "pull" | "slide" | "tilt";
type Pick = { move: string; name: string; why: string };

/** Studio's movement list is smaller than the customer one: both slides become "slide", a rise becomes "tilt up",
    and a lowering becomes "pull" (the gentlest of the remaining moves). */
export function studioMove(move: string): StudioMove {
  if (move === "push") return "push";
  if (move === "pull" || move === "drop") return "pull";
  if (move === "rise") return "tilt";
  return "slide";
}

type Props = { getImages: () => Promise<string[]>; photoCount: number; disabled?: boolean; onApply: (moves: StudioMove[]) => void };

export default function SmartMoves({ getImages, photoCount, disabled, onApply }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [picks, setPicks] = useState<Pick[] | null>(null);
  if (photoCount < 2) return null;

  async function read() {
    setBusy(true); setNote(""); setPicks(null);
    try {
      const response = await fetch("/api/studio/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: (await getImages()).slice(0, 12) }) });
      const data = await response.json().catch(() => ({})) as { picks?: Pick[]; smart?: boolean; note?: string; error?: string };
      if (!response.ok || !data.picks) { setNote(data.error || "The photos could not be read. Try again."); return; }
      if (data.smart === false) { setNote(data.note || "Smart movement is off in Admin."); return; }
      setPicks(data.picks);
    } catch { setNote("The photos could not be read. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return <div className="sug-edit">
    <button type="button" className="fin-link" onClick={read} disabled={busy || disabled}>{busy ? "Reading your photos…" : "Smart choice of movements"}</button>
    {note && <p className="sug-note">{note}</p>}
    {picks && <div className="sug-card">
      <p>{picks.map((pick, index) => `${index + 1}. ${pick.name}`).join("  ·  ")}</p>
      <div className="sug-row">
        <span>Chosen from what each photo shows, opening by moving in and closing by pulling back.</span>
        <button type="button" onClick={() => { onApply(picks.map((pick) => studioMove(pick.move))); setPicks(null); }} disabled={disabled}>Apply</button>
      </div>
    </div>}
  </div>;
}
