"use client";

/* "Suggest an edit": reads the photos and proposes a template and music style. Nothing changes until Apply is tapped. */

import { useEffect, useState } from "react";
import type { WrenTemplate } from "../wrencut";
import { suggestEdit, type EditSuggestion, type Mood } from "../edit-suggest";
import { musicTemplate } from "../music-catalog";

type Props = { getImages: () => Promise<string[]>; photoCount: number; disabled?: boolean; onApply: (template: WrenTemplate | null, music: Mood) => void };

export default function SuggestEdit({ getImages, photoCount, disabled, onApply }: Props) {
  const [wrens, setWrens] = useState<WrenTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<EditSuggestion | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/wrencut", { cache: "no-store" }).then(async (response) => {
      const data = response.ok ? await response.json().catch(() => ({})) as { templates?: WrenTemplate[] } : {};
      if (!cancelled) setWrens((data.templates || []).filter((item) => item.active));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (photoCount < 2) return null;

  async function suggest() {
    setBusy(true); setNote(""); setResult(null);
    try {
      const response = await fetch("/api/studio/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: (await getImages()).slice(0, 12) }) });
      const data = await response.json().catch(() => ({})) as { moods?: (Mood | null)[]; error?: string };
      if (!response.ok || !data.moods) { setNote(data.error || "The photos could not be read. Try again."); return; }
      setResult(suggestEdit({ photoCount, moods: data.moods, templates: wrens.map((item) => ({ id: item.id, name: item.name, best: item.guide?.best ?? item.photos, least: item.guide?.least ?? 2 })) }));
    } catch { setNote("The photos could not be read. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const template = result?.templateId ? wrens.find((item) => item.id === result.templateId) || null : null;
  return <div className="sug-edit">
    <button type="button" className="fin-link" onClick={suggest} disabled={busy || disabled}>{busy ? "Reading your photos…" : "Suggest an edit from my photos"}</button>
    {note && <p className="sug-note">{note}</p>}
    {result && <div className="sug-card">
      <p>{result.reason}</p>
      <div className="sug-row">
        <span>{template ? template.name : "No template"} · {musicTemplate(result.music)?.name || result.music} music</span>
        <button type="button" onClick={() => { onApply(template, result.music); setResult(null); }} disabled={disabled}>Apply</button>
      </div>
    </div>}
  </div>;
}
