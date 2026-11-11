"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MUSIC_TEMPLATES } from "../music-catalog";
import { drawListingOverlays, type OverlayBranding } from "./overlays";

/* The finishing choices of a film — music, voiceover, sound effects, and a
   preview of the listing cards — as one calm panel. Used before a film is made
   (Studio) and to edit a finished one (History). It only collects choices; the
   server makes the sound and the composer edits the film. */

export type VoiceMode = "off" | "scene" | "film";
export type FinalSound = { music: string; voiceMode: VoiceMode; voiceId: string; lines: string[]; film: string; sfxOn: boolean; sfx: string[] };
export const emptySound = (music = "warm"): FinalSound => ({ music, voiceMode: "off", voiceId: "", lines: [], film: "", sfxOn: false, sfx: [] });

type Voice = { id: string; name: string; note: string; previewUrl: string };
type Problem = { message: string; fix?: string };

const FIX_LINKS: Record<string, { label: string; href: string }> = {
  elevenlabs: { label: "Open ElevenLabs plans", href: "https://elevenlabs.io/app/subscription" },
  "cloudflare-ai": { label: "Open Production page", href: "/admin/production" },
};

function ProblemNote({ problem }: { problem: Problem }) {
  const fix = problem.fix ? FIX_LINKS[problem.fix] : undefined;
  return <div className="fin-problem" role="alert"><span>{problem.message}</span>{fix && <a href={fix.href} target={fix.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{fix.label} →</a>}</div>;
}

/* One play button that plays a sample and stops the one before it. */
let currentAudio: HTMLAudioElement | null = null;
function PlayButton({ src, label }: { src: string; label: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "missing">("idle");
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { ref.current?.pause(); }, []);
  function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (state === "playing") { ref.current?.pause(); setState("idle"); return; }
    currentAudio?.pause();
    const audio = ref.current || new Audio();
    ref.current = audio; currentAudio = audio;
    audio.src = src; setState("loading");
    audio.onended = () => setState("idle"); audio.onpause = () => setState((value) => value === "playing" ? "idle" : value);
    audio.onerror = () => setState("missing");
    audio.play().then(() => setState("playing")).catch(() => setState("missing"));
  }
  return <button type="button" className={`fin-play ${state}`} onClick={toggle} aria-label={`${state === "playing" ? "Stop" : "Play"} ${label}`} title={state === "missing" ? "This sample is not ready yet" : undefined}>{state === "playing" ? "■" : state === "loading" ? "…" : state === "missing" ? "!" : "▶"}</button>;
}

/* ---------- music ---------- */

export function MusicChoice({ value, onChange, disabled, allowKeep }: { value: string; onChange: (id: string) => void; disabled?: boolean; allowKeep?: boolean }) {
  return <div className="fin-music" role="radiogroup" aria-label="Music">
    {allowKeep && <div role="radio" aria-checked={value === "keep"} tabIndex={0} className={value === "keep" ? "fin-pick active" : "fin-pick"} onClick={() => !disabled && onChange("keep")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) onChange("keep"); } }}><span><strong>Keep current</strong><small>Same music as now</small></span></div>}
    {MUSIC_TEMPLATES.map((template) => <div key={template.id} role="radio" aria-checked={value === template.id} tabIndex={0} className={value === template.id ? "fin-pick active" : "fin-pick"} onClick={() => !disabled && onChange(template.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) onChange(template.id); } }}>
      <span><strong>{template.name}</strong><small>{template.blurb}</small></span><PlayButton src={`/api/music-samples/${template.id}`} label={`${template.name} sample`}/>
    </div>)}
    <div role="radio" aria-checked={value === "none"} tabIndex={0} className={value === "none" ? "fin-pick active" : "fin-pick"} onClick={() => !disabled && onChange("none")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) onChange("none"); } }}><span><strong>No music</strong><small>Voice and effects only</small></span></div>
  </div>;
}

/* ---------- voices ---------- */

function useVoices(enabled: boolean) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  useEffect(() => {
    if (!enabled || voices || problem) return;
    let cancelled = false;
    fetch("/api/studio/voices").then(async (response) => {
      const data = await response.json().catch(() => ({})) as { voices?: Voice[]; error?: string; fix?: string };
      if (cancelled) return;
      if (!response.ok) setProblem({ message: data.error || "The voices could not be loaded.", fix: data.fix }); else setVoices(data.voices || []);
    }).catch(() => { if (!cancelled) setProblem({ message: "The voices could not be loaded." }); });
    return () => { cancelled = true; };
  }, [enabled, voices, problem]);
  return { voices, problem };
}

/* ---------- the panel ---------- */

type PanelProps = {
  sound: FinalSound; setSound: (patch: Partial<FinalSound>) => void;
  count: number; sceneSeconds: number; totalSeconds: number;
  /** Small data-URL photos of the scenes (Studio) — or a finished film's id (History). */
  getImages?: () => Promise<string[]>; jobId?: string;
  sceneThumbs?: string[];
  showMusic?: boolean; allowKeepMusic?: boolean; musicNote?: string;
  disabled?: boolean;
};

export function FinalSoundPanel({ sound, setSound, count, sceneSeconds, totalSeconds, getImages, jobId, sceneThumbs = [], showMusic = true, allowKeepMusic, musicNote, disabled }: PanelProps) {
  const { voices, problem: voiceProblem } = useVoices(sound.voiceMode !== "off");
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<Problem | null>(null);
  const single = count === 1;
  const [tray, setTray] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [trayBusy, setTrayBusy] = useState(false);
  const [trayNote, setTrayNote] = useState<Problem | null>(null);
  const [custom, setCustom] = useState("");

  async function moreOptions(target: "scene" | "film", index: number, current: string, instruction: string) {
    setTrayBusy(true); setTrayNote(null); setChoices([]);
    try {
      const base = jobId ? { jobId } : { images: getImages ? await getImages() : [], sceneSeconds, totalSeconds };
      const response = await fetch("/api/studio/film-sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, action: "options", target, index, current, lines: sound.lines, instruction }) });
      const data = await response.json().catch(() => ({})) as { options?: string[]; error?: string; fix?: string };
      if (!response.ok || !data.options?.length) { setTrayNote({ message: data.error || "No new versions came back.", fix: data.fix }); return; }
      setChoices(data.options);
    } catch { setTrayNote({ message: "No new versions came back." }); }
    finally { setTrayBusy(false); }
  }
  function openTray(key: string) { setTray(tray === key ? null : key); setChoices([]); setTrayNote(null); setCustom(""); }
  function pick(target: "scene" | "film", index: number, text: string) {
    if (target === "film") setSound({ film: text });
    else { const next = [...sound.lines]; while (next.length < count) next.push(""); next[index] = text; setSound({ lines: next }); }
    setTray(null); setChoices([]);
  }
  const Tray = ({ target, index, current }: { target: "scene" | "film"; index: number; current: string }) => <div className="fin-tray">
    <div className="fin-chips">{[["more", "Say more"], ["specific", "More specific"], ["story", "More story"], ["shorter", "Shorter"], ["different", "Different angle"]].map(([key, label]) => <button type="button" key={key} disabled={trayBusy} onClick={() => moreOptions(target, index, current, key)}>{label}</button>)}</div>
    <form className="fin-ask" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) moreOptions(target, index, current, custom.trim()); }}><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Or tell the writer what you want…" disabled={trayBusy}/><button type="submit" disabled={trayBusy || !custom.trim()}>Write</button></form>
    {trayBusy && <p className="fin-quiet">Writing three versions…</p>}
    {trayNote && <ProblemNote problem={trayNote}/>}
    {choices.length > 0 && <div className="fin-choices">{choices.map((text, position) => <button type="button" key={position} onClick={() => pick(target, index, text)}>{text}<small>{lineCount(text)} words · tap to use</small></button>)}</div>}
  </div>;

  async function writeFromScenes() {
    setWriting(true); setNote(null);
    try {
      const body = jobId ? { jobId } : { images: getImages ? await getImages() : [], sceneSeconds, totalSeconds };
      const response = await fetch("/api/studio/film-sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { scenes?: { voice: string; sfx: string }[]; film?: string; error?: string; fix?: string; source?: string; detail?: string };
      if (!response.ok || !data.scenes) { setNote({ message: data.error || "The scenes could not be read.", fix: data.fix }); return; }
      setSound({ lines: data.scenes.map((scene) => scene.voice), film: data.film || "", sfx: data.scenes.map((scene) => scene.sfx) });
      if (data.source === "basic") setNote({ message: `The writer could not shape these, so they are plain descriptions. Edit them freely.${data.detail ? ` (${data.detail})` : ""}` });
    } catch { setNote({ message: "The scenes could not be read." }); }
    finally { setWriting(false); }
  }
  const lineCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
  const maxWords = Math.floor(sceneSeconds * 2.2);
  const maxFilmWords = Math.floor(totalSeconds * 2.2);
  const hasText = sound.voiceMode === "film" ? Boolean(sound.film.trim()) : sound.lines.some((line) => line.trim());
  const modes: { key: VoiceMode; title: string; note: string }[] = single
    ? [{ key: "off", title: "Off", note: "No narration" }, { key: "film", title: "Narration", note: "Written from your photo" }]
    : [{ key: "off", title: "Off", note: "No narration" }, { key: "scene", title: "Each scene", note: "A line written for every shot" }, { key: "film", title: "Whole film", note: "One story told across the film" }];

  return <div className="fin-sound">
    {showMusic && <section className="fin-block">
      <header><div><strong>Music</strong><small>{musicNote || "One track runs under the whole film. Tap ▶ to hear each style."}</small></div></header>
      <MusicChoice value={sound.music} onChange={(music) => setSound({ music })} disabled={disabled} allowKeep={allowKeepMusic}/>
    </section>}

    <section className="fin-block">
      <header><div><strong>Voiceover</strong><small>Spoken narration, written from what each scene shows.</small></div></header>
      <div className="fin-modes" role="radiogroup" aria-label="Voiceover">{modes.map((mode) => <button type="button" key={mode.key} role="radio" aria-checked={sound.voiceMode === mode.key} className={sound.voiceMode === mode.key ? "active" : ""} disabled={disabled} onClick={() => setSound({ voiceMode: mode.key })}><strong>{mode.title}</strong><small>{mode.note}</small></button>)}</div>
      {sound.voiceMode !== "off" && <>
        <div className="fin-subhead"><span>Voice</span></div>
        {voiceProblem ? <ProblemNote problem={voiceProblem}/> : !voices ? <p className="fin-quiet">Loading voices…</p> : voices.length === 0 ? <p className="fin-quiet">No voices are available on the ElevenLabs account yet.</p> : <div className="fin-voices" role="radiogroup" aria-label="Voice">{voices.map((voice) => <div key={voice.id} role="radio" aria-checked={sound.voiceId === voice.id} tabIndex={0} className={sound.voiceId === voice.id ? "fin-pick active" : "fin-pick"} onClick={() => !disabled && setSound({ voiceId: voice.id })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) setSound({ voiceId: voice.id }); } }}><span><strong>{voice.name}</strong><small>{voice.note || "Narrator"}</small></span><PlayButton src={voice.previewUrl} label={`${voice.name} voice`}/></div>)}</div>}
        <div className="fin-subhead"><span>Script</span><button type="button" className="fin-link" onClick={writeFromScenes} disabled={writing || disabled}>{writing ? "Reading your scenes…" : hasText ? "Write it again from my photos" : "Write it from my photos"}</button></div>
        {note && <ProblemNote problem={note}/>}
        {sound.voiceMode === "film"
          ? <div><label className="fin-field"><textarea rows={5} value={sound.film} onChange={(event) => setSound({ film: event.target.value })} placeholder="One narration for the whole film. Use “Write it from my photos”, or type your own." disabled={disabled}/><small className={lineCount(sound.film) > maxFilmWords ? "fin-over" : ""}>{lineCount(sound.film)} words · about {maxFilmWords} fit in {totalSeconds} seconds</small></label><button type="button" className="fin-link fin-more" disabled={disabled} onClick={() => openTray("film")}>{tray === "film" ? "Close" : "More options"}</button>{tray === "film" && <Tray target="film" index={0} current={sound.film}/>}</div>
          : <div className="fin-lines">{Array.from({ length: count }, (_, index) => <div className="fin-line" key={index}>{sceneThumbs[index] ? <img src={sceneThumbs[index]} alt=""/> : <span className="fin-n">{index + 1}</span>}<span><textarea rows={3} value={sound.lines[index] || ""} onChange={(event) => { const next = [...sound.lines]; while (next.length < count) next.push(""); next[index] = event.target.value; setSound({ lines: next }); }} placeholder={`Scene ${index + 1}`} disabled={disabled}/><small className={lineCount(sound.lines[index] || "") > maxWords ? "fin-over" : ""}>{lineCount(sound.lines[index] || "")} words · up to {maxWords} fit in {sceneSeconds} s</small><button type="button" className="fin-link fin-more" disabled={disabled} onClick={() => openTray(String(index))}>{tray === String(index) ? "Close" : "More options"}</button>{tray === String(index) && <Tray target="scene" index={index} current={sound.lines[index] || ""}/>}</span></div>)}</div>}
      </>}
    </section>

    <section className="fin-block">
      <header><div><strong>Sound effects</strong><small>Water, wind, a crackling fire — only sounds the scene really has.</small></div><button type="button" className={sound.sfxOn ? "fin-switch on" : "fin-switch"} onClick={() => setSound({ sfxOn: !sound.sfxOn })} aria-pressed={sound.sfxOn} aria-label="Sound effects" disabled={disabled}><i/></button></header>
      {sound.sfxOn && <>
        <div className="fin-subhead"><span>Sounds per scene</span><button type="button" className="fin-link" onClick={writeFromScenes} disabled={writing || disabled}>{writing ? "Reading your scenes…" : "Find them from my photos"}</button></div>
        {note && sound.voiceMode === "off" && <ProblemNote problem={note}/>}
        <div className="fin-lines">{Array.from({ length: count }, (_, index) => <label className="fin-line" key={index}>{sceneThumbs[index] ? <img src={sceneThumbs[index]} alt=""/> : <span className="fin-n">{index + 1}</span>}<span><input value={sound.sfx[index] || ""} onChange={(event) => { const next = [...sound.sfx]; while (next.length < count) next.push(""); next[index] = event.target.value; setSound({ sfx: next }); }} placeholder="None — leave empty for a quiet scene" disabled={disabled}/></span></label>)}</div>
      </>}
    </section>
  </div>;
}

/* ---------- a preview of the listing cards over the first photo ---------- */

export function CardsPreview({ photo, branding, opening, closing, vertical }: { photo?: string; branding: OverlayBranding; opening: boolean; closing: boolean; vertical?: boolean }) {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const logoUrl = (branding as OverlayBranding & { agentLogo?: string }).agentLogo || "";
  useEffect(() => { if (!photo) { setImage(null); return; } const next = new Image(); next.crossOrigin = "anonymous"; next.onload = () => setImage(next); next.onerror = () => setImage(null); next.src = photo; }, [photo]);
  useEffect(() => { if (!logoUrl || logoUrl === "yes") { setLogo(null); return; } const next = new Image(); next.onload = () => setLogo(next); next.onerror = () => setLogo(null); next.src = logoUrl; }, [logoUrl]);
  const width = vertical ? 540 : 960, height = vertical ? 960 : 540;
  useEffect(() => {
    const draw = (canvas: HTMLCanvasElement | null, now: number, o: boolean, c: boolean) => {
      const context = canvas?.getContext("2d"); if (!canvas || !context) return;
      context.fillStyle = "#1b1d21"; context.fillRect(0, 0, width, height);
      if (image) { const scale = Math.max(width / image.width, height / image.height); context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale); }
      drawListingOverlays(context, width, height, now, 10, branding, o, c, { logo: logo as never });
    };
    draw(canvases.current[0], 2.4, true, false);
    draw(canvases.current[1], 8.4, false, true);
  });
  if (!opening && !closing) return null;
  return <div className={vertical ? "fin-preview tall" : "fin-preview"}>
    {opening && <figure><canvas ref={(node) => { canvases.current[0] = node; }} width={width} height={height}/><figcaption>Opening card · first seconds</figcaption></figure>}
    {closing && <figure><canvas ref={(node) => { canvases.current[1] = node; }} width={width} height={height}/><figcaption>Closing card · last seconds</figcaption></figure>}
  </div>;
}

/* A small frame of a scene photo for the AI writer: a data URL under ~200 KB. */
export async function smallPhoto(source: string, side = 640): Promise<string> {
  const image = new Image(); image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("A photo could not be read.")); image.src = source; });
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function FinalSection({ title, note, children, number }: { title: string; note?: string; children: ReactNode; number?: string }) {
  return <div className="fin-panel"><div className="fin-panel-head">{number && <span>{number}</span>}<div><h3>{title}</h3>{note && <p>{note}</p>}</div></div>{children}</div>;
}
