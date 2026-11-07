"use client";

/* Studio Ads — admin only. Create commercials for social media: pick an
   engine, a format, a length, images, actors, music and voiceover, then
   generate. Nothing here is client-facing; the page lives under /admin. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { studioEngines, type StudioEngineKey } from "../../engine-catalog";
import { AD_ASPECTS, AD_DURATIONS, adPlan, estimateAdCost, type AdAspect, type AdDuration } from "../../ads-creative";
import { AD_MUSIC_MOODS } from "../../ads-music-catalog";
import { PageHead, money } from "../ui";

type AdRow = {
  id: string; title: string; hook: string | null; prompt: string;
  scenePrompts: string; sceneImages: string; engine: string; resolution: string;
  aspect: string; targetDuration: number; subtitles: string; voiceoverScript: string;
  voiceId: string | null; musicMood: string | null; draft: number; status: string;
  renderJobId: string | null; finalHistoryId: string | null; costCents: number;
  createdAt: number; updatedAt: number;
};
type AdAsset = { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; sortOrder: number; createdAt: number };
type ActorPhoto = { id: string; angle: string; fileName: string; contentType: string; sizeBytes: number; sortOrder: number; createdAt: number };
type Actor = { id: string; name: string; notes: string; photos: ActorPhoto[]; createdAt: number; updatedAt: number };
type AdDetail = { ad: AdRow; assets: AdAsset[]; actors: Actor[]; job: { id: string; status: string; error: string | null; historyId: string | null; duration: number; costCents: number } | null; downloadUrl: string | null };
type Voice = { voiceId: string; name: string; category: string; description: string };

type SceneImage = { type: "source" | "actor"; id: string };

const parseJson = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value || "") as T; } catch { return fallback; } };
const statusLabel: Record<string, string> = { draft: "Draft", queued: "Queued", generating: "Creating scenes", stitching: "Finishing video", saving: "Preparing delivery", completed: "Ready", failed: "Needs attention" };

export default function StudioAdsPage() {
  const [tab, setTab] = useState<"create" | "actors" | "ads">("create");
  const [ads, setAds] = useState<AdRow[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [voices, setVoices] = useState<{ keyed: boolean; list: Voice[] }>({ keyed: false, list: [] });
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<AdDetail | null>(null);
  const [saving, setSaving] = useState(false);

  // Create / brief form.
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<StudioEngineKey>("wan3");
  const [aspect, setAspect] = useState<AdAspect>("vertical");
  const [duration, setDuration] = useState<AdDuration>(10);
  const [draft, setDraft] = useState(false);
  const [musicMood, setMusicMood] = useState<string | null>(null);
  const [voiceoverScript, setVoiceoverScript] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [subtitleSize, setSubtitleSize] = useState<"small" | "medium" | "large">("medium");
  const [subtitleText, setSubtitleText] = useState("");
  const [scenePrompts, setScenePrompts] = useState<string[]>([]);
  const [sceneImages, setSceneImages] = useState<SceneImage[]>([]);
  const [linkedActorIds, setLinkedActorIds] = useState<string[]>([]);

  // Actors tab form.
  const [actorName, setActorName] = useState("");
  const [actorNotes, setActorNotes] = useState("");

  const loadAll = useCallback(async () => {
    const [adsRes, actorsRes, voicesRes] = await Promise.all([
      fetch("/api/admin/studio-ads", { cache: "no-store" }),
      fetch("/api/admin/studio-ads/actors", { cache: "no-store" }),
      fetch("/api/admin/studio-ads/voices", { cache: "no-store" }),
    ]);
    if (adsRes.ok) setAds((await adsRes.json()).ads || []);
    if (actorsRes.ok) setActors((await actorsRes.json()).actors || []);
    if (voicesRes.ok) { const data = await voicesRes.json(); setVoices({ keyed: data.keyed === true, list: data.voices || [] }); }
    else setVoices({ keyed: false, list: [] });
    setLoaded(true);
  }, []);

  useEffect(() => { void Promise.resolve().then(() => loadAll()); }, [loadAll]);

  const loadDetail = useCallback(async (adId: string) => {
    const response = await fetch(`/api/admin/studio-ads/${adId}`, { cache: "no-store" });
    if (!response.ok) { setMessage("That ad could not be opened."); return; }
    const data = (await response.json()) as AdDetail;
    setDetail(data);
    const ad = data.ad;
    setTitle(ad.title); setHook(ad.hook || ""); setPrompt(ad.prompt);
    setEngine((ad.engine as StudioEngineKey) || "wan3");
    setAspect(ad.aspect === "horizontal" || ad.aspect === "square" ? ad.aspect : "vertical");
    setDuration(([10, 30, 60] as const).includes(ad.targetDuration as AdDuration) ? ad.targetDuration as AdDuration : 10);
    setDraft(ad.draft === 1);
    setMusicMood(ad.musicMood);
    setVoiceoverScript(ad.voiceoverScript || "");
    setVoiceId(ad.voiceId || "");
    const subs = parseJson(ad.subtitles, { on: false, position: "bottom", size: "medium", lines: [] }) as { on: boolean; position: "bottom" | "top"; size: "small" | "medium" | "large"; lines: { text: string }[] };
    setSubtitlesOn(subs.on === true); setSubtitlePosition(subs.position === "top" ? "top" : "bottom");
    setSubtitleSize(subs.size === "small" || subs.size === "large" ? subs.size : "medium");
    setSubtitleText((subs.lines || []).map((line) => line.text).join("\n"));
    setScenePrompts(parseJson<string[]>(ad.scenePrompts, []));
    setSceneImages(parseJson<SceneImage[]>(ad.sceneImages, []));
    setLinkedActorIds(data.actors.map((actor) => actor.id));
  }, []);

  const subtitleLines = useMemo(() => {
    const lines = subtitleText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const each = duration / lines.length;
    return lines.map((text, index) => ({ start: Math.round(index * each * 100) / 100, end: Math.round(Math.min(duration, (index + 1) * each) * 100) / 100, text }));
  }, [subtitleText, duration]);

  const imagePool = useMemo(() => {
    if (!detail) return [];
    const sources = detail.assets.map((asset) => ({ type: "source" as const, id: asset.id, label: asset.fileName }));
    const actorPhotos = detail.actors.flatMap((actor) => actor.photos.map((photo) => ({ type: "actor" as const, id: photo.id, label: `${actor.name} · ${photo.angle}` })));
    return [...sources, ...actorPhotos];
  }, [detail]);

  const effectiveImages = sceneImages.length ? sceneImages : (detail?.assets || []).map((asset) => ({ type: "source" as const, id: asset.id }));
  const plan = useMemo(() => adPlan(engine, "1080p", duration, Math.max(1, effectiveImages.length), draft), [engine, duration, effectiveImages.length, draft]);
  const estimate = useMemo(() => estimateAdCost(engine, "1080p", duration, Math.max(1, effectiveImages.length), draft), [engine, duration, effectiveImages.length, draft]);

  async function createAd() {
    if (title.trim().length < 2) { setMessage("Give the ad a title first."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/studio-ads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, hook, prompt, scenePrompts, sceneImages, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, draft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The ad could not be created.");
      setMessage(`Ad created. Estimated generation: ${money((result.estimateCents || 0) / 100)} — upload images below, then generate.`);
      await loadAll();
      await loadDetail(result.ad.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The ad could not be created."); }
    finally { setSaving(false); }
  }

  async function saveBrief() {
    if (!detail) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/studio-ads/${detail.ad.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, hook, prompt, scenePrompts, sceneImages, actorIds: linkedActorIds, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, draft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The ad could not be saved.");
      setMessage("Saved.");
      await loadAll();
      await loadDetail(detail.ad.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The ad could not be saved."); }
    finally { setSaving(false); }
  }

  async function uploadSource(files: FileList | null) {
    if (!detail || !files?.length) return;
    setSaving(true); setMessage("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/admin/studio-ads/${detail.ad.id}/assets`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "An image could not be uploaded.");
      }
      setMessage("Images uploaded.");
      await loadDetail(detail.ad.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "An image could not be uploaded."); }
    finally { setSaving(false); }
  }

  async function generate(asDraft: boolean) {
    if (!detail) return;
    setSaving(true); setMessage("");
    try {
      if (asDraft !== draft) {
        await fetch(`/api/admin/studio-ads/${detail.ad.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, hook, prompt, scenePrompts, sceneImages, actorIds: linkedActorIds, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, draft: asDraft }) });
      }
      const response = await fetch(`/api/admin/studio-ads/${detail.ad.id}/generate`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Production could not start.");
      setMessage(result.resumed ? "This ad is already being made." : "Production started. You can close this page; it keeps going.");
      await loadAll();
      await loadDetail(detail.ad.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Production could not start."); }
    finally { setSaving(false); }
  }

  async function deleteAd() {
    if (!detail || !window.confirm(`Delete "${detail.ad.title}"? Its source images go with it. Actors stay saved.`)) return;
    const response = await fetch(`/api/admin/studio-ads/${detail.ad.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || "The ad could not be deleted."); return; }
    setDetail(null); setMessage("Ad deleted.");
    await loadAll();
  }

  async function createActor() {
    if (actorName.trim().length < 2) { setMessage("Give the actor a name first."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/studio-ads/actors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: actorName, notes: actorNotes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The actor could not be saved.");
      setActorName(""); setActorNotes(""); setMessage(`Actor "${result.actor.name}" saved. Add their photos below.`);
      await loadAll();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The actor could not be saved."); }
    finally { setSaving(false); }
  }

  async function uploadActorPhoto(actorId: string, angle: string, files: FileList | null) {
    if (!files?.length) return;
    setSaving(true); setMessage("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("angle", angle);
        const response = await fetch(`/api/admin/studio-ads/actors/${actorId}/photos`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "A photo could not be uploaded.");
      }
      setMessage("Photo added to the actor.");
      await loadAll();
      if (detail) await loadDetail(detail.ad.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "A photo could not be uploaded."); }
    finally { setSaving(false); }
  }

  async function deleteActor(actor: Actor) {
    if (!window.confirm(`Delete actor "${actor.name}" and all their photos?`)) return;
    const response = await fetch(`/api/admin/studio-ads/actors/${actor.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || "The actor could not be deleted."); return; }
    setMessage("Actor deleted.");
    await loadAll();
  }

  const availableEngines = studioEngines.filter((item) => !item.unavailable);
  const squareCropped = aspect === "square" && (engine === "veo31Lite" || engine === "geminiOmni");

  return (
    <div className="mgr-page">
      <PageHead eyebrow="Manager · Admin only" title="Studio Ads" sub="Commercials and social ads — your tool, not a client product. Same engines as Studio, a different prompt: premium, cinematic, realistic, never childish or cheesy." />
      {message ? <p className="notice">{message}</p> : null}

      <div className="field-row" role="tablist" aria-label="Studio Ads sections">
        {(["create", "actors", "ads"] as const).map((value) => (
          <button key={value} type="button" className={`btn ${tab === value ? "btn-ink" : "btn-white"} btn-sm`} onClick={() => setTab(value)}>
            {value === "create" ? "Create" : value === "actors" ? `Actors (${actors.length})` : `Ads (${ads.length})`}
          </button>
        ))}
      </div>

      {tab === "create" ? (
        <div className="mgr-stack">
          <section className="panel">
            <div className="panel-head"><h2>{detail ? "The ad" : "New ad"}</h2><span className="muted small">Two upload places, one bill: images and actors share the same storage — a second area costs nothing extra.</span></div>
            <label className="field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Summer launch — 30 s reel" maxLength={120} /></label>
            <label className="field">Opening hook — the first 2 seconds<textarea value={hook} onChange={(event) => setHook(event.target.value)} placeholder="What must land before anyone scrolls past?" rows={2} maxLength={280} /></label>
            <label className="field">What is this ad about?<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="The product, the feeling, the story — in your words. The premium cinematic prompt is layered on top automatically." rows={3} maxLength={2000} /></label>
            <div className="field-row">
              <label className="field">Format
                <select value={aspect} onChange={(event) => setAspect(event.target.value as AdAspect)}>
                  {AD_ASPECTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">Length
                <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as AdDuration)}>
                  {AD_DURATIONS.map((value) => <option key={value} value={value}>{value} seconds</option>)}
                </select>
              </label>
              <label className="field">Engine
                <select value={engine} onChange={(event) => setEngine(event.target.value as StudioEngineKey)}>
                  {availableEngines.map((item) => <option key={item.key} value={item.key}>{item.name} — {money(item.pricePerSecond["1080p"] || 0)}/s at 1080p</option>)}
                </select>
              </label>
            </div>
            {squareCropped ? <p className="note">Square on this engine is made at 16:9 and center-cropped by the editor — pick Kling, Wan, Hailuo or Runway for a native square frame.</p> : null}
            <label className="field-toggle"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Draft render first — 480p, max 10 s, about a third of the full price, to check the idea before spending on the full render.</label>
            <p className="muted small">Plan: {plan.count} scene{plan.count === 1 ? "" : "s"} × {plan.sceneSeconds}s · Estimated generation {money(estimate)}{draft ? " (draft)" : ""} — ElevenLabs voiceover and music are billed by ElevenLabs, not here.</p>
            {!detail ? <button type="button" className="btn btn-ink" onClick={createAd} disabled={saving}>{saving ? "Creating…" : "Create ad"}</button> : null}
          </section>

          {detail ? (
            <>
              <section className="panel">
                <div className="panel-head"><h2>Images that become the video</h2><span className="muted small">JPG, PNG or WebP, up to 20 MB each, 20 per ad.</span></div>
                <label className="field">Upload source images<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { uploadSource(event.target.files); event.target.value = ""; }} /></label>
                {detail.assets.length ? (
                  <div className="engine-grid">
                    {detail.assets.map((asset) => (
                      <label key={asset.id} className="engine-card">
                        <input type="checkbox" checked={sceneImages.some((item) => item.type === "source" && item.id === asset.id)} onChange={(event) => setSceneImages(event.target.checked ? [...sceneImages, { type: "source", id: asset.id }] : sceneImages.filter((item) => !(item.type === "source" && item.id === asset.id)))} />
                        <strong>{asset.fileName}</strong>
                        <span className="muted small">{(asset.sizeBytes / 1024).toFixed(0)} KB · scene image</span>
                      </label>
                    ))}
                  </div>
                ) : <p className="muted">No source images yet — upload at least one to generate.</p>}
                <p className="note">Tick the images to use as scenes, in the order they were uploaded. Actor photos can join the scenes from the Actors tab.</p>
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Scenes</h2><span className="muted small">One prompt per scene for 30 s / 60 s ads — leave blank to use the ad prompt for that scene.</span></div>
                {Array.from({ length: plan.count }, (_, index) => (
                  <label key={index} className="field">Scene {index + 1} prompt
                    <input value={scenePrompts[index] || ""} onChange={(event) => { const next = [...scenePrompts]; next[index] = event.target.value; setScenePrompts(next); }} placeholder={index === 0 && hook ? `Hook: ${hook}` : "This scene, in your words"} maxLength={500} />
                  </label>
                ))}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Actors in this ad</h2><span className="muted small">Pick saved actors — their photos stay in the library for the next ad.</span></div>
                {actors.length ? actors.map((actor) => (
                  <label key={actor.id} className="choice-row">
                    <input type="checkbox" checked={linkedActorIds.includes(actor.id)} onChange={(event) => setLinkedActorIds(event.target.checked ? [...linkedActorIds, actor.id] : linkedActorIds.filter((id) => id !== actor.id))} />
                    <span><strong>{actor.name}</strong> <span className="muted small">· {actor.photos.length} photo{actor.photos.length === 1 ? "" : "s"}{actor.photos.length ? ` (${[...new Set(actor.photos.map((photo) => photo.angle))].join(", ")})` : ""}</span></span>
                  </label>
                )) : <p className="muted">No actors saved yet — add them on the Actors tab.</p>}
                {detail.actors.length && imagePool.some((item) => item.type === "actor") ? (
                  <div className="engine-grid">
                    {imagePool.filter((item) => item.type === "actor").map((item) => (
                      <label key={item.id} className="engine-card">
                        <input type="checkbox" checked={sceneImages.some((entry) => entry.type === "actor" && entry.id === item.id)} onChange={(event) => setSceneImages(event.target.checked ? [...sceneImages, { type: "actor", id: item.id }] : sceneImages.filter((entry) => !(entry.type === "actor" && entry.id === item.id)))} />
                        <strong>{item.label}</strong>
                        <span className="muted small">use as a scene image</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Sound</h2><span className="muted small">Music is made fresh for each ad; voiceover is read by ElevenLabs.</span></div>
                <label className="field">Music mood
                  <select value={musicMood || ""} onChange={(event) => setMusicMood(event.target.value || null)}>
                    <option value="">Auto — matched to the format</option>
                    {AD_MUSIC_MOODS.map((mood) => <option key={mood.id} value={mood.id}>{mood.name} — {mood.blurb}</option>)}
                  </select>
                </label>
                <label className="field">Voiceover script<textarea value={voiceoverScript} onChange={(event) => setVoiceoverScript(event.target.value)} placeholder="What the voice says, exactly. Leave empty for music only." rows={3} maxLength={5000} /></label>
                <label className="field">Voice
                  <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={!voices.keyed || !voices.list.length}>
                    <option value="">First voice on the account</option>
                    {voices.list.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}{voice.category ? ` · ${voice.category}` : ""}</option>)}
                  </select>
                </label>
                {!voices.keyed ? <p className="note">Voiceover needs the ElevenLabs key — add ELEVENLABS_API_KEY as a Worker secret and it appears here. Music uses the same key.</p> : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Subtitles</h2><span className="muted small">Burned into the picture. Leave the lines empty and they are timed from the voiceover script.</span></div>
                <label className="field-toggle"><input type="checkbox" checked={subtitlesOn} onChange={(event) => setSubtitlesOn(event.target.checked)} /> Burn subtitles into the video</label>
                {subtitlesOn ? (
                  <>
                    <div className="field-row">
                      <label className="field">Position
                        <select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value as "bottom" | "top")}>
                          <option value="bottom">Bottom</option>
                          <option value="top">Top</option>
                        </select>
                      </label>
                      <label className="field">Size
                        <select value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value as "small" | "medium" | "large")}>
                          <option value="small">Small</option>
                          <option value="medium">Medium</option>
                          <option value="large">Large</option>
                        </select>
                      </label>
                    </div>
                    <label className="field">Subtitle lines — one per line<textarea value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} placeholder={"One line per subtitle.\nThey are timed evenly across the ad."} rows={4} /></label>
                  </>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Make it</h2><span className="muted small">Status: {statusLabel[detail.ad.status] || detail.ad.status}{detail.job?.error ? ` — ${detail.job.error}` : ""}</span></div>
                <div className="field-row">
                  <button type="button" className="btn btn-white" onClick={saveBrief} disabled={saving}>Save changes</button>
                  <button type="button" className="btn btn-ink" onClick={() => generate(true)} disabled={saving || !detail.assets.length}>Generate draft — {money(estimateAdCost(engine, "480p", Math.min(10, duration) as AdDuration, Math.max(1, effectiveImages.length), true))}</button>
                  <button type="button" className="btn btn-ink" onClick={() => generate(false)} disabled={saving || !detail.assets.length}>Generate full — {money(estimate)}</button>
                  <button type="button" className="btn btn-danger" onClick={deleteAd} disabled={saving}>Delete ad</button>
                </div>
                {detail.downloadUrl && detail.ad.status === "completed" ? <p><a className="btn btn-white btn-sm" href={detail.downloadUrl}>Download finished ad</a></p> : null}
                {detail.job ? <p className="muted small">Job {detail.job.id.slice(0, 8)} · {detail.job.duration}s · generation {money(detail.job.costCents / 100)}</p> : null}
              </section>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "actors" ? (
        <div className="mgr-stack">
          <section className="panel">
            <div className="panel-head"><h2>Save an actor</h2><span className="muted small">Upload once — front, side, three-quarter, silhouette — and pick them for any future ad.</span></div>
            <label className="field">Name<input value={actorName} onChange={(event) => setActorName(event.target.value)} placeholder="e.g. Maya" maxLength={120} /></label>
            <label className="field">Notes<input value={actorNotes} onChange={(event) => setActorNotes(event.target.value)} placeholder="Who they are, what they are for (optional)" maxLength={500} /></label>
            <button type="button" className="btn btn-ink" onClick={createActor} disabled={saving}>Save actor</button>
          </section>
          {actors.map((actor) => (
            <ActorCard key={actor.id} actor={actor} onUpload={uploadActorPhoto} onDelete={() => deleteActor(actor)} busy={saving} />
          ))}
          {!actors.length && loaded ? <p className="muted">No actors saved yet.</p> : null}
        </div>
      ) : null}

      {tab === "ads" ? (
        <div className="mgr-stack">
          {ads.map((ad) => (
            <button key={ad.id} type="button" className="panel" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => { setTab("create"); loadDetail(ad.id); }}>
              <div className="panel-head"><h2>{ad.title}</h2><span className="muted small">{statusLabel[ad.status] || ad.status}</span></div>
              <p className="muted small">{ad.aspect} · {ad.targetDuration}s · {ad.engine} · {ad.draft === 1 ? "draft" : "full"} · generation {money(ad.costCents / 100)}</p>
            </button>
          ))}
          {!ads.length && loaded ? <p className="muted">No ads yet — make the first one on the Create tab.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ActorCard({ actor, onUpload, onDelete, busy }: { actor: Actor; onUpload: (actorId: string, angle: string, files: FileList | null) => void; onDelete: () => void; busy: boolean }) {
  const [angle, setAngle] = useState("front");
  return (
    <section className="panel">
      <div className="panel-head"><h2>{actor.name}</h2><span className="muted small">{actor.notes}</span></div>
      {actor.photos.length ? (
        <div className="engine-grid">
          {actor.photos.map((photo) => (
            <div key={photo.id} className="engine-card"><strong>{photo.angle}</strong><span className="muted small">{photo.fileName} · {(photo.sizeBytes / 1024).toFixed(0)} KB</span></div>
          ))}
        </div>
      ) : <p className="muted">No photos yet — add a front shot first, then a side and a three-quarter for the best face consistency.</p>}
      <div className="field-row">
        <label className="field">Angle
          <select value={angle} onChange={(event) => setAngle(event.target.value)}>
            <option value="front">Front</option>
            <option value="side">Side</option>
            <option value="three-quarter">Three-quarter</option>
            <option value="silhouette">Silhouette</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">Add a photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { onUpload(actor.id, angle, event.target.files); event.target.value = ""; }} /></label>
      </div>
      <button type="button" className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>Delete actor</button>
    </section>
  );
}
