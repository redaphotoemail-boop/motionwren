"use client";

import { useEffect, useMemo, useState } from "react";
import { PHOTO_MOVE_KEYS } from "../engine-catalog";
import { CardsPreview, FinalSection, FinalSoundPanel, emptySound, type FinalSound } from "./final-edit";
import type { StudioJob } from "./production";

/* Edit a finished film from History: its listing cards, music, voiceover,
   sound effects, and the camera movement of any single scene. Everything that
   is kept is not made again; only a scene made again has a price, and it is
   shown before anything starts. */

type Data = {
  status: string; kind: string; engine: string; engineName: string; resolution: string; aspect: string; duration: number; count: number; sceneSeconds: number;
  photoEngine: boolean; remakeCostCents: number;
  cards: { opening: { title: string; detail: string; message: string } | null; closing: { name: string; contact: string; logo: string } | null } | null;
  music: string; voice: { mode: "scene" | "film"; voiceId: string; lines: string[] } | null; sfx: { prompts: string[] } | null;
  scenes: { index: number; motion: string; photo: string }[];
};
type Props = {
  jobId: string; onClose: () => void; onStarted: (job: StudioJob | null, message: string) => void;
  motions: { key: string; label: string }[]; scenePrompt: (motion: string) => string;
};

const prettyMove = (key: string) => key.replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase());
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function EditFilm({ jobId, onClose, onStarted, motions, scenePrompt }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sound, setSoundState] = useState<FinalSound>(emptySound("keep"));
  const [initial, setInitial] = useState("");
  const [openingOn, setOpeningOn] = useState(false); const [closingOn, setClosingOn] = useState(false);
  const [title, setTitle] = useState(""); const [detail, setDetail] = useState(""); const [message, setMessage] = useState("");
  const [agent, setAgent] = useState(""); const [contact, setContact] = useState(""); const [logo, setLogo] = useState<"keep" | "none" | string>("none"); const [hadLogo, setHadLogo] = useState(false);
  const [moves, setMoves] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; fix?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/studio/production/${jobId}/edit`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as Data & { error?: string };
      if (cancelled) return;
      if (!response.ok) { setLoadError(body.error || "This film can't be edited."); return; }
      setData(body);
      const next: FinalSound = { music: body.music === "auto" ? "keep" : body.music, voiceMode: body.voice?.mode || "off", voiceId: body.voice?.voiceId || "", lines: body.voice?.lines || [], film: body.voice?.mode === "film" ? (body.voice.lines.find(Boolean) || "") : "", sfxOn: Boolean(body.sfx), sfx: body.sfx?.prompts || [] };
      setSoundState(next); setInitial(JSON.stringify(next));
      setOpeningOn(Boolean(body.cards?.opening)); setClosingOn(Boolean(body.cards?.closing));
      setTitle(body.cards?.opening?.title || ""); setDetail(body.cards?.opening?.detail || ""); setMessage(body.cards?.opening?.message || "");
      setAgent(body.cards?.closing?.name || ""); setContact(body.cards?.closing?.contact || ""); setHadLogo(Boolean(body.cards?.closing?.logo)); setLogo(body.cards?.closing?.logo ? "keep" : "none");
    }).catch(() => !cancelled && setLoadError("This film can't be edited right now."));
    return () => { cancelled = true; };
  }, [jobId]);

  const setSound = (patch: Partial<FinalSound>) => setSoundState((current) => ({ ...current, ...patch }));
  const initialSound = useMemo(() => initial ? JSON.parse(initial) as FinalSound : null, [initial]);
  const voiceChanged = initialSound ? JSON.stringify([sound.voiceMode, sound.voiceId, sound.voiceMode === "film" ? sound.film : sound.lines]) !== JSON.stringify([initialSound.voiceMode, initialSound.voiceId, initialSound.voiceMode === "film" ? initialSound.film : initialSound.lines]) : false;
  const sfxChanged = initialSound ? JSON.stringify([sound.sfxOn, sound.sfxOn ? sound.sfx : []]) !== JSON.stringify([initialSound.sfxOn, initialSound.sfxOn ? initialSound.sfx : []]) : false;
  const musicChanged = initialSound ? sound.music !== initialSound.music && sound.music !== "keep" : false;
  const changedScenes = Object.entries(moves).filter(([, value]) => value).map(([index]) => Number(index));
  const cardsChanged = Boolean(data) && (openingOn !== Boolean(data?.cards?.opening) || closingOn !== Boolean(data?.cards?.closing) || title !== (data?.cards?.opening?.title || "") || detail !== (data?.cards?.opening?.detail || "") || message !== (data?.cards?.opening?.message || "") || agent !== (data?.cards?.closing?.name || "") || contact !== (data?.cards?.closing?.contact || "") || (logo !== (hadLogo ? "keep" : "none")));
  const remakeCents = data && !data.photoEngine ? changedScenes.length * data.remakeCostCents : 0;
  const anything = cardsChanged || voiceChanged || sfxChanged || musicChanged || changedScenes.length > 0;

  const branding = { listingTitle: title, listingBeds: "", listingBaths: "", listingSquareFeet: "", listingPrice: detail, listingMessage: message, agentName: agent, agentEmail: "", agentPhone: contact, agentLogo: logo.startsWith("data:") ? logo : "" } as never;

  function acceptLogo(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 2_000_000) { setProblem({ message: "Use a PNG, JPG or WebP logo under 2 MB." }); return; }
    const reader = new FileReader(); reader.onload = () => setLogo(String(reader.result)); reader.readAsDataURL(file);
  }

  async function apply() {
    if (!data) return;
    setBusy(true); setProblem(null);
    const body: Record<string, unknown> = {};
    if (cardsChanged) body.cards = (openingOn && (title.trim() || detail.trim() || message.trim())) || (closingOn && (agent.trim() || contact.trim() || logo !== "none"))
      ? { opening: openingOn ? { title, detail, message } : null, closing: closingOn ? { name: agent, contact, logo: logo === "none" ? "" : logo } : null } : null;
    if (musicChanged) body.music = sound.music;
    if (voiceChanged) {
      if (sound.voiceMode !== "off" && !sound.voiceId) { setBusy(false); setProblem({ message: "Choose a voice, or turn the voiceover off." }); return; }
      body.voice = sound.voiceMode === "off" ? { mode: "off" } : { mode: sound.voiceMode, voiceId: sound.voiceId, lines: sound.lines.slice(0, data.count), film: sound.film };
    }
    if (sfxChanged) body.sfx = { on: sound.sfxOn, prompts: sound.sfx.slice(0, data.count) };
    if (changedScenes.length) body.scenes = changedScenes.map((scene) => data.photoEngine ? { scene, photoMove: moves[scene] } : { scene, prompt: scenePrompt(moves[scene]) });
    try {
      const response = await fetch(`/api/studio/production/${jobId}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { job?: StudioJob; error?: string; fix?: string; warning?: string };
      if (!response.ok) { setProblem({ message: result.error || "The edit could not start.", fix: result.fix }); return; }
      onStarted(result.job || null, changedScenes.length && !data.photoEngine ? "Making the changed scenes again, then editing your film. The new version will appear here." : "Editing your film. The new version will appear here in a minute or two.");
    } catch { setProblem({ message: "The edit could not start. Check your connection and try again." }); }
    finally { setBusy(false); }
  }

  const vertical = data?.aspect === "vertical";
  return <div className="fin-overlay" role="dialog" aria-modal="true" aria-label="Edit film" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="fin-sheet">
      <header className="fin-sheet-head"><div><span className="label">EDIT FILM</span><h2>Change your finished film</h2><p>Scenes you leave alone are kept as they are and cost nothing again.</p></div><button type="button" className="fin-close" onClick={onClose} disabled={busy} aria-label="Close">×</button></header>
      {loadError ? <div className="fin-problem">{loadError}</div> : !data ? <p className="fin-quiet">Opening your film…</p> : <div className="fin-sheet-body">
        <FinalSection title="Scenes and movement" note={data.photoEngine ? "Camera moves on photos are free to change." : `Choose a new movement for a scene to make it again — ${dollars(data.remakeCostCents)} per scene on ${data.engineName}.`}>
          <div className="fin-scenes">{data.scenes.map((scene) => <div className="fin-scene" key={scene.index}><img src={scene.photo} alt={`Scene ${scene.index + 1}`}/><div><strong>Scene {scene.index + 1}</strong><small>{scene.motion ? (data.photoEngine ? prettyMove(scene.motion) : scene.motion) : "Movement as made"}</small></div>
            <select value={moves[scene.index] || ""} onChange={(event) => setMoves((current) => ({ ...current, [scene.index]: event.target.value }))} aria-label={`New movement for scene ${scene.index + 1}`}><option value="">Keep as is</option>{data.photoEngine ? PHOTO_MOVE_KEYS.map((key) => <option key={key} value={key}>{prettyMove(key)}</option>) : motions.filter((item) => item.key !== "custom" && item.key !== "mixed").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>)}</div>
        </FinalSection>

        <FinalSection title="Listing cards" note="Turn a card on to add or change it; turn it off to remove it from the film.">
          <div className="fin-cards">
            <div className="fin-card-block"><div className="fin-card-head"><div><strong>Opening card</strong><small>The property, over the first seconds</small></div><button type="button" className={openingOn ? "fin-switch on" : "fin-switch"} onClick={() => setOpeningOn(!openingOn)} aria-pressed={openingOn} aria-label="Opening card"><i/></button></div>
              {openingOn && <div className="fin-fields"><label><span className="label">Property name or address</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="21 Beacon Street, Boston"/></label><label><span className="label">Details</span><input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="3 beds · 2 baths · $1,250,000"/></label><label><span className="label">Short message</span><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Open house Sunday" maxLength={80}/></label></div>}</div>
            <div className="fin-card-block"><div className="fin-card-head"><div><strong>Closing agent card</strong><small>Name, contact and logo, over the last seconds</small></div><button type="button" className={closingOn ? "fin-switch on" : "fin-switch"} onClick={() => setClosingOn(!closingOn)} aria-pressed={closingOn} aria-label="Closing card"><i/></button></div>
              {closingOn && <div className="fin-fields"><label><span className="label">Agent name</span><input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="Jordan Lee"/></label><label><span className="label">Phone and email</span><input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="617-555-0142 · jordan@realty.com"/></label><label className="fin-logo"><span className="label">Logo</span><span>{logo === "keep" ? "Current logo kept" : logo === "none" ? "No logo" : "New logo added"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => acceptLogo(event.target.files?.[0])}/>{logo !== "none" && <button type="button" className="fin-link" onClick={() => setLogo("none")}>Remove logo</button>}</label></div>}</div>
            <CardsPreview photo={data.scenes[0]?.photo} branding={branding} opening={openingOn && Boolean(title.trim() || detail.trim() || message.trim())} closing={closingOn && Boolean(agent.trim() || contact.trim() || logo !== "none")} vertical={vertical}/>
          </div>
        </FinalSection>

        <FinalSection title="Sound" note="Music, voiceover and sound effects are mixed again under your film.">
          <FinalSoundPanel sound={sound} setSound={setSound} count={data.count} sceneSeconds={data.sceneSeconds} totalSeconds={data.duration} jobId={jobId} sceneThumbs={data.scenes.map((scene) => scene.photo)} showMusic={data.count > 1} allowKeepMusic musicNote="Pick a different style to replace the current music, or keep it." disabled={busy}/>
        </FinalSection>
        {problem && <div className="fin-problem" role="alert"><span>{problem.message}</span>{problem.fix === "elevenlabs" && <a href="https://elevenlabs.io/app/subscription" target="_blank" rel="noreferrer">Open ElevenLabs plans →</a>}</div>}
      </div>}
      {data && <footer className="fin-sheet-foot"><div><strong>{!anything ? "No changes yet" : remakeCents ? `${dollars(remakeCents)} to make ${changedScenes.length} scene${changedScenes.length === 1 ? "" : "s"} again` : "No new scenes to make"}</strong><small>{anything ? "A new version is saved to History; the current one stays." : "Change something above to enable Apply."}</small></div><button type="button" className="generate" onClick={apply} disabled={!anything || busy}>{busy ? "Starting…" : "Apply changes"}<span>→</span></button></footer>}
    </div>
  </div>;
}
