"use client";

/* Studio Ads — admin only. Create commercials for social media: pick an
   engine, a format, a length, images, actors, music and voiceover, then
   generate. Nothing here is client-facing; the page lives under /admin. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { studioEngines, type StudioEngineKey } from "../../engine-catalog";
import { AD_ASPECTS, AD_DURATIONS, adPlan, estimateAdCost, type AdAspect, type AdDuration } from "../../ads-creative";
import { AD_TEMPLATES, MASTER_PROMPT_FIELD_DEFS, buildMasterPromptPrompt, emptyMasterPromptFields, parseMasterPromptFields, resolveAdTemplate, resolveTemplateDuration, type AdTemplateId, type MasterPromptFields } from "../../ads-master-prompt";
import { AD_MUSIC_MOODS } from "../../ads-music-catalog";
import { LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_DURATION, LIBRARY_TEMPLATE_FIELD_DEFS, emptyRestaurantInteriorFields, isLibraryTemplateVisible, libraryTemplateEstimate, libraryTemplatePlan, parseLibraryEnabled, parseLibraryTemplateFields, type LibraryTemplateFields, type LibraryTemplateId } from "../../library-templates";
import { PageHead, money } from "../ui";

/* Studio Ads redesign — layout only. Every rule is scoped under
   .studio-ads, so no other admin page is touched. The shared classes
   (mgr-page, panel, field, btn, ...) keep their global meaning; this
   block only tunes spacing, rhythm, alignment and control styling
   inside this tab. Same palette, same type, same copy, same fields. */
const SA_STYLES = `
.studio-ads.mgr-page { width: min(960px, 100% - 48px); gap: 28px; }
.studio-ads .mgr-stack { gap: 28px; }
.studio-ads .panel { display: grid; gap: 20px; align-content: start; padding: clamp(28px, 4vw, 40px); border-radius: 24px; }
.studio-ads .panel-head { margin-bottom: 0; align-items: flex-start; }
.studio-ads .panel-head h2 { font-size: 22px; }
.studio-ads .panel-head .muted { max-width: 48ch; text-align: right; line-height: 1.55; }
.studio-ads .panel > .muted { margin: 0; }
.studio-ads .panel .btn { margin-top: 0; }
.studio-ads .panel .note { margin-top: 0; }
.studio-ads .notice { margin-top: 0; }
.studio-ads .sa-tabs { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--surface); box-shadow: var(--lift); max-width: 100%; }
.studio-ads .sa-tabs .btn { flex: 1 1 0; box-shadow: none; min-height: 44px; padding: 12px 20px; white-space: nowrap; }
.studio-ads .sa-picker { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--surface); box-shadow: var(--lift); max-width: 100%; }
.studio-ads .sa-picker .btn { flex: 1 1 0; box-shadow: none; min-height: 44px; padding: 12px 20px; white-space: nowrap; }
.studio-ads .sa-picker .btn-white { background: transparent; color: var(--muted); }
.studio-ads .sa-picker .btn-white:hover { background: var(--paper); color: var(--ink); }
.studio-ads .sa-picker .btn-ink:hover { background: #000; }
.studio-ads .sa-prompt-preview summary { cursor: pointer; font: 600 14px/1.5 var(--body); color: var(--ink-2); }
.studio-ads .sa-prompt-preview pre { margin: 12px 0 0; padding: 16px; border-radius: 14px; background: var(--paper); white-space: pre-wrap; overflow-wrap: anywhere; font: 400 13px/1.6 var(--body); color: var(--ink-2); }
.studio-ads .sa-tabs .btn-white { background: transparent; color: var(--muted); }
.studio-ads .sa-tabs .btn-white:hover { background: var(--paper); color: var(--ink); }
.studio-ads .sa-tabs .btn-ink:hover { background: #000; }
.studio-ads .field { gap: 10px; }
.studio-ads .field-row { display: flex; flex-wrap: wrap; gap: 12px; }
.studio-ads .field-row > .field { flex: 1 1 200px; min-width: 0; }
.studio-ads .field input, .studio-ads .field select { min-height: 52px; }
.studio-ads .field textarea { line-height: 1.55; }
.studio-ads label.field-toggle { position: static; transform: none; display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; border-radius: 16px; background: var(--paper); color: var(--ink-2); font: 500 15px/1.55 var(--body); cursor: pointer; }
.studio-ads label.field-toggle input[type="checkbox"] { flex: none; width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--ink); cursor: pointer; }
.studio-ads .sa-list { display: grid; gap: 10px; }
.studio-ads .choice-row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 14px; background: var(--paper); }
.studio-ads .choice-row input[type="checkbox"] { flex: none; width: 20px; height: 20px; margin: 0; accent-color: var(--ink); }
.studio-ads .engine-grid { gap: 12px; }
.studio-ads label.engine-card { flex-direction: row; align-items: flex-start; gap: 12px; padding: 16px 18px; }
.studio-ads label.engine-card input[type="checkbox"] { flex: none; width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--ink); }
.studio-ads label.engine-card > span { display: grid; gap: 2px; min-width: 0; }
.studio-ads label.engine-card strong { font: 600 15px/1.4 var(--body); overflow-wrap: anywhere; }
.studio-ads label.engine-card .muted { font-size: 13px; }
.studio-ads .sa-actions { align-items: center; }
.studio-ads .sa-actions .btn-danger { margin-left: auto; }
.studio-ads button.panel { width: 100%; text-align: left; cursor: pointer; transition: box-shadow .2s var(--ease); }
.studio-ads button.panel:hover { box-shadow: var(--lift); }
.studio-ads .mgr-stack > p.muted { padding: 40px 20px; text-align: center; }
@media (max-width: 640px) {
  .studio-ads.mgr-page { width: calc(100% - 32px); }
  .studio-ads .panel { padding: 24px 20px; }
  .studio-ads .panel-head { flex-direction: column; gap: 6px; }
  .studio-ads .panel-head .muted { text-align: left; max-width: none; }
  .studio-ads .panel > .btn { width: 100%; }
  .studio-ads .sa-tabs { width: 100%; }
  .studio-ads .sa-tabs .btn { padding: 12px 10px; font-size: 13px; }
  .studio-ads .sa-picker { width: 100%; }
  .studio-ads .sa-picker .btn { padding: 12px 10px; font-size: 13px; }
  .studio-ads .field-row > .field { flex: 1 1 100%; }
  .studio-ads .engine-grid { grid-template-columns: 1fr; }
  .studio-ads .sa-actions .btn { flex: 1 1 100%; }
  .studio-ads .sa-actions .btn-danger { margin-left: 0; }
}
@media (min-width: 641px) and (max-width: 900px) {
  .studio-ads .engine-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

type AdRow = {
  id: string; title: string; hook: string | null; prompt: string;
  scenePrompts: string; sceneImages: string; template: string; templateFields: string; engine: string; resolution: string;
  aspect: string; targetDuration: number; subtitles: string; voiceoverScript: string;
  voiceId: string | null; musicMood: string | null; elevenlabsOn: number; draft: number; status: string;
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
  const [template, setTemplate] = useState<AdTemplateId>("cinematic");
  const [prevDuration, setPrevDuration] = useState<AdDuration>(10);
  const [templateFields, setTemplateFields] = useState<MasterPromptFields>(emptyMasterPromptFields());
  const [libraryTemplate, setLibraryTemplate] = useState<LibraryTemplateId>("none");
  const [libraryFields, setLibraryFields] = useState<LibraryTemplateFields>(emptyRestaurantInteriorFields());
  const [libraryEnabled, setLibraryEnabled] = useState<Record<string, boolean>>({});
  const [prevAspect, setPrevAspect] = useState<AdAspect>("vertical");
  const [prevMusicMood, setPrevMusicMood] = useState<string | null>(null);
  const [hook, setHook] = useState("");
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<StudioEngineKey>("wan3");
  const [aspect, setAspect] = useState<AdAspect>("vertical");
  const [duration, setDuration] = useState<AdDuration>(10);
  const [draft, setDraft] = useState(false);
  const [musicMood, setMusicMood] = useState<string | null>(null);
  const [elevenlabsOn, setElevenlabsOn] = useState(false);
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
    const [adsRes, actorsRes, voicesRes, libraryRes] = await Promise.all([
      fetch("/api/admin/studio-ads", { cache: "no-store" }),
      fetch("/api/admin/studio-ads/actors", { cache: "no-store" }),
      fetch("/api/admin/studio-ads/voices", { cache: "no-store" }),
      fetch("/api/admin/library-studio", { cache: "no-store" }),
    ]);
    if (adsRes.ok) setAds((await adsRes.json()).ads || []);
    if (actorsRes.ok) setActors((await actorsRes.json()).actors || []);
    if (voicesRes.ok) { const data = await voicesRes.json(); setVoices({ keyed: data.keyed === true, list: data.voices || [] }); }
    else setVoices({ keyed: false, list: [] });
    // A failed library fetch leaves every template visible, as before.
    if (libraryRes.ok) { const data = await libraryRes.json(); setLibraryEnabled(parseLibraryEnabled(data.enabled ?? "")); }
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
    const adTemplate = resolveAdTemplate(ad.template);
    setTemplate(adTemplate);
    setTemplateFields(parseMasterPromptFields(ad.templateFields || ""));
    const library = parseLibraryTemplateFields(ad.templateFields || "");
    setLibraryTemplate(library.libraryTemplate);
    setLibraryFields(library.fields);
    setEngine((ad.engine as StudioEngineKey) || "wan3");
    setAspect(ad.aspect === "horizontal" || ad.aspect === "square" ? ad.aspect : "vertical");
    setDuration(resolveTemplateDuration(adTemplate, ad.targetDuration));
    setDraft(ad.draft === 1);
    setMusicMood(ad.musicMood);
    // A library template ad opens locked to its recorded structure: the
    // effective length is 17 s regardless of the stored length.
    if (library.libraryTemplate !== "none") {
      setAspect("vertical");
      setMusicMood("luxe");
      setPrevDuration(10);
      setDuration(10);
    }
    setElevenlabsOn(ad.elevenlabsOn === 1);
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

  /* A library template locks the length to its recorded 17 s, whatever
     the Length select holds — subtitles, plan and estimate all use the
     effective length. With no library template, today exactly. */
  const effectiveDuration = libraryTemplate !== "none" ? LIBRARY_TEMPLATE_DURATION : duration;
  const visibleLibraryTemplates = useMemo(() => LIBRARY_TEMPLATES.filter((item) => isLibraryTemplateVisible(item.id, libraryEnabled)), [libraryEnabled]);

  const subtitleLines = useMemo(() => {
    const lines = subtitleText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const each = effectiveDuration / lines.length;
    return lines.map((text, index) => ({ start: Math.round(index * each * 100) / 100, end: Math.round(Math.min(effectiveDuration, (index + 1) * each) * 100) / 100, text }));
  }, [subtitleText, effectiveDuration]);

  const imagePool = useMemo(() => {
    if (!detail) return [];
    const sources = detail.assets.map((asset) => ({ type: "source" as const, id: asset.id, label: asset.fileName }));
    const actorPhotos = detail.actors.flatMap((actor) => actor.photos.map((photo) => ({ type: "actor" as const, id: photo.id, label: `${actor.name} · ${photo.angle}` })));
    return [...sources, ...actorPhotos];
  }, [detail]);

  const effectiveImages = sceneImages.length ? sceneImages : (detail?.assets || []).map((asset) => ({ type: "source" as const, id: asset.id }));
  const plan = useMemo(() => libraryTemplate !== "none"
    ? libraryTemplatePlan(engine, "1080p", Math.max(1, effectiveImages.length), draft)
    : adPlan(engine, "1080p", duration, Math.max(1, effectiveImages.length), draft),
    [libraryTemplate, engine, duration, effectiveImages.length, draft]);
  const estimate = useMemo(() => libraryTemplate !== "none"
    ? libraryTemplateEstimate(engine, Math.max(1, effectiveImages.length), draft)
    : estimateAdCost(engine, "1080p", duration, Math.max(1, effectiveImages.length), draft),
    [libraryTemplate, engine, duration, effectiveImages.length, draft]);
  const draftEstimate = useMemo(() => libraryTemplate !== "none"
    ? libraryTemplateEstimate(engine, Math.max(1, effectiveImages.length), true)
    : estimateAdCost(engine, "480p", Math.min(10, duration) as AdDuration, Math.max(1, effectiveImages.length), true),
    [libraryTemplate, engine, duration, effectiveImages.length]);

  const filledMasterPrompt = useMemo(() => template === "fix-it-20" ? buildMasterPromptPrompt(templateFields) : "", [template, templateFields]);

  /* Picking the template locks the length to 30 s (the master prompt is
     21–30 s — 10 s cannot hold its structure, 60 s would stretch past
     it). Switching back restores the length picked before. */
  const selectTemplate = (next: AdTemplateId) => {
    if (next === template) return;
    if (next === "fix-it-20") { setPrevDuration(duration); setDuration(30); }
    else setDuration(prevDuration);
    setTemplate(next);
  };

  /* Picking a library template locks the format to vertical and the
     music mood to Luxe & warm (its recorded structure) and disables the
     theme, format, length and music picks. Switching back to None
     restores the format, length and music mood picked before. */
  const selectLibraryTemplate = (next: LibraryTemplateId) => {
    if (next === libraryTemplate) return;
    if (next !== "none") {
      setPrevAspect(aspect); setPrevDuration(duration); setPrevMusicMood(musicMood);
      setAspect("vertical"); setMusicMood("luxe");
    } else {
      setAspect(prevAspect); setDuration(prevDuration); setMusicMood(prevMusicMood);
    }
    setLibraryTemplate(next);
  };

  // One object for the template_fields column: the master-prompt fields,
  // the library template id, and the library fields.
  const mergedTemplateFields = { ...templateFields, libraryTemplate, ...libraryFields };

  async function createAd() {
    if (title.trim().length < 2) { setMessage("Give the ad a title first."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/studio-ads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, hook, prompt, template, templateFields: mergedTemplateFields, scenePrompts, sceneImages, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, elevenlabsOn, draft }),
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
        body: JSON.stringify({ title, hook, prompt, template, templateFields: mergedTemplateFields, scenePrompts, sceneImages, actorIds: linkedActorIds, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, elevenlabsOn, draft }),
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
        await fetch(`/api/admin/studio-ads/${detail.ad.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, hook, prompt, template, templateFields: mergedTemplateFields, scenePrompts, sceneImages, actorIds: linkedActorIds, engine, aspect, targetDuration: duration, subtitles: { on: subtitlesOn, position: subtitlePosition, size: subtitleSize, lines: subtitleLines }, voiceoverScript, voiceId: voiceId || null, musicMood, elevenlabsOn, draft: asDraft }) });
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
    <div className="mgr-page studio-ads">
      <style>{SA_STYLES}</style>
      <PageHead eyebrow="Manager · Admin only" title="Studio Ads" sub="Commercials and social ads — your tool, not a client product. Same engines as Studio, a different prompt: premium, cinematic, realistic, never childish or cheesy." />
      {message ? <p className="notice">{message}</p> : null}

      <div className="sa-tabs" role="tablist" aria-label="Studio Ads sections">
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
            <label className="field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Summer launch — 30 s reel" maxLength={120} /></label>
            <div className="field"><span>Template</span>
              <div className="sa-picker" role="radiogroup" aria-label="Prompt template">
                {AD_TEMPLATES.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={template === item.id} disabled={libraryTemplate !== "none"} className={`btn ${template === item.id ? "btn-ink" : "btn-white"} btn-sm`} onClick={() => selectTemplate(item.id)}>{item.label}</button>
                ))}
              </div>
              <span className="muted small">{AD_TEMPLATES.find((item) => item.id === template)?.blurb}</span>
            </div>
            <div className="field"><span>Library template</span>
              <div className="sa-picker" role="radiogroup" aria-label="Library template">
                <button type="button" role="radio" aria-checked={libraryTemplate === "none"} className={`btn ${libraryTemplate === "none" ? "btn-ink" : "btn-white"} btn-sm`} onClick={() => selectLibraryTemplate("none")}>None</button>
                {visibleLibraryTemplates.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={libraryTemplate === item.id} className={`btn ${libraryTemplate === item.id ? "btn-ink" : "btn-white"} btn-sm`} onClick={() => selectLibraryTemplate(item.id)}>{item.name}</button>
                ))}
              </div>
              <span className="muted small">{libraryTemplate === "none" ? "No library template — the ad is made exactly as set up here." : LIBRARY_TEMPLATES.find((item) => item.id === libraryTemplate)?.blurb}</span>
            </div>
            {libraryTemplate !== "none" ? (
              <>
                {LIBRARY_TEMPLATE_FIELD_DEFS.map((def) => (
                  <label key={def.key} className="field"><span>{def.label}</span>
                    <input value={libraryFields[def.key]} onChange={(event) => setLibraryFields({ ...libraryFields, [def.key]: event.target.value })} placeholder={def.placeholder} maxLength={def.maxLength} />
                  </label>
                ))}
              </>
            ) : null}
            {template === "fix-it-20" ? (
              <>
                {MASTER_PROMPT_FIELD_DEFS.map((def) => (
                  <label key={def.key} className="field"><span>{def.label}</span>
                    {def.multiline ? (
                      <textarea value={templateFields[def.key]} onChange={(event) => setTemplateFields({ ...templateFields, [def.key]: event.target.value })} placeholder={def.placeholder} rows={2} maxLength={def.maxLength} />
                    ) : (
                      <input value={templateFields[def.key]} onChange={(event) => setTemplateFields({ ...templateFields, [def.key]: event.target.value })} placeholder={def.placeholder} maxLength={def.maxLength} />
                    )}
                  </label>
                ))}
                <details className="sa-prompt-preview">
                  <summary>See the full prompt this template will send</summary>
                  <pre>{filledMasterPrompt}</pre>
                </details>
              </>
            ) : null}
            <label className="field"><span>Opening hook — the first 2 seconds</span><textarea value={hook} onChange={(event) => setHook(event.target.value)} placeholder="What must land before anyone scrolls past?" rows={2} maxLength={280} /></label>
            <label className="field"><span>What is this ad about?</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={template === "fix-it-20" ? "Anything else the video should show or say — the Fix It In 20 Seconds structure is layered on top automatically." : "The product, the feeling, the story — in your words. The premium cinematic prompt is layered on top automatically."} rows={3} maxLength={2000} /></label>
            <div className="field-row">
              <label className="field"><span>Format</span>
                <select value={aspect} disabled={libraryTemplate !== "none"} onChange={(event) => setAspect(event.target.value as AdAspect)}>
                  {AD_ASPECTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="field"><span>Length</span>
                <select value={duration} disabled={template === "fix-it-20" || libraryTemplate !== "none"} onChange={(event) => setDuration(Number(event.target.value) as AdDuration)}>
                  {AD_DURATIONS.map((value) => <option key={value} value={value}>{value} seconds</option>)}
                </select>
              </label>
              <label className="field"><span>Engine</span>
                <select value={engine} onChange={(event) => setEngine(event.target.value as StudioEngineKey)}>
                  {availableEngines.map((item) => <option key={item.key} value={item.key}>{item.name} — {money(item.pricePerSecond["1080p"] || 0)}/s at 1080p</option>)}
                </select>
              </label>
            </div>
            {template === "fix-it-20" ? <p className="note">Fix It In 20 Seconds is 21–30 s — the length is locked to 30 s. Switch back to Cinematic premium to pick another length.</p> : null}
            {libraryTemplate !== "none" ? <p className="note">{LIBRARY_TEMPLATES.find((item) => item.id === libraryTemplate)?.name} is 17 s vertical — the length and format are locked. Switch back to None to pick your own.</p> : null}
            {squareCropped ? <p className="note">Square on this engine is made at 16:9 and center-cropped by the editor — pick Kling, Wan, Hailuo or Runway for a native square frame.</p> : null}
            <label className="field-toggle"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Draft render first — 480p, max 10 s, about a third of the full price, to check the idea before spending on the full render.</label>
            {template === "fix-it-20" && draft ? <p className="note">A draft is 10 s at 480p — it previews the opening only (hook, problem, start of the demo), not the full 21–30 s structure. The full structure is only in the 30 s render.</p> : null}
            {libraryTemplate !== "none" && draft ? <p className="note">A draft is 10 s at 480p — the first 4 scenes only, not the full 17 s structure.</p> : null}
            <p className="muted small">Plan: {plan.count} scene{plan.count === 1 ? "" : "s"} × {plan.sceneSeconds}s · Estimated generation {money(estimate)}{draft ? " (draft)" : ""}{elevenlabsOn ? " — ElevenLabs voiceover and music are billed by ElevenLabs, not here." : ""}</p>
            {!detail ? <button type="button" className="btn btn-ink" onClick={createAd} disabled={saving}>{saving ? "Creating…" : "Create ad"}</button> : null}
          </section>

          {detail ? (
            <>
              <section className="panel">
                <div className="panel-head"><h2>Images that become the video</h2><span className="muted small">JPG, PNG or WebP, up to 20 MB each, 20 per ad.</span></div>
                <label className="field"><span>Upload source images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { uploadSource(event.target.files); event.target.value = ""; }} /></label>
                {detail.assets.length ? (
                  <div className="engine-grid">
                    {detail.assets.map((asset) => (
                      <label key={asset.id} className="engine-card">
                        <input type="checkbox" checked={sceneImages.some((item) => item.type === "source" && item.id === asset.id)} onChange={(event) => setSceneImages(event.target.checked ? [...sceneImages, { type: "source", id: asset.id }] : sceneImages.filter((item) => !(item.type === "source" && item.id === asset.id)))} />
                        <span><strong>{asset.fileName}</strong>
                        <span className="muted small">{(asset.sizeBytes / 1024).toFixed(0)} KB · scene image</span></span>
                      </label>
                    ))}
                  </div>
                ) : <p className="muted">No source images yet — upload at least one to generate.</p>}
                <p className="note">Tick the images to use as scenes, in the order they were uploaded. Actor photos can join the scenes from the Actors tab.</p>
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Scenes</h2><span className="muted small">One prompt per scene for 30 s / 60 s ads — leave blank to use the ad prompt for that scene.</span></div>
                {Array.from({ length: plan.count }, (_, index) => (
                  <label key={index} className="field"><span>Scene {index + 1} prompt</span>
                    <input value={scenePrompts[index] || ""} onChange={(event) => { const next = [...scenePrompts]; next[index] = event.target.value; setScenePrompts(next); }} placeholder={index === 0 && hook ? `Hook: ${hook}` : "This scene, in your words"} maxLength={500} />
                  </label>
                ))}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Actors in this ad</h2><span className="muted small">Pick saved actors — their photos stay in the library for the next ad.</span></div>
                {actors.length ? (
                  <div className="sa-list">
                    {actors.map((actor) => (
                      <label key={actor.id} className="choice-row">
                        <input type="checkbox" checked={linkedActorIds.includes(actor.id)} onChange={(event) => setLinkedActorIds(event.target.checked ? [...linkedActorIds, actor.id] : linkedActorIds.filter((id) => id !== actor.id))} />
                        <span><strong>{actor.name}</strong> <span className="muted small">· {actor.photos.length} photo{actor.photos.length === 1 ? "" : "s"}{actor.photos.length ? ` (${[...new Set(actor.photos.map((photo) => photo.angle))].join(", ")})` : ""}</span></span>
                      </label>
                    ))}
                  </div>
                ) : <p className="muted">No actors saved yet — add them on the Actors tab.</p>}
                {detail.actors.length && imagePool.some((item) => item.type === "actor") ? (
                  <div className="engine-grid">
                    {imagePool.filter((item) => item.type === "actor").map((item) => (
                      <label key={item.id} className="engine-card">
                        <input type="checkbox" checked={sceneImages.some((entry) => entry.type === "actor" && entry.id === item.id)} onChange={(event) => setSceneImages(event.target.checked ? [...sceneImages, { type: "actor", id: item.id }] : sceneImages.filter((entry) => !(entry.type === "actor" && entry.id === item.id)))} />
                        <span><strong>{item.label}</strong>
                        <span className="muted small">use as a scene image</span></span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Sound</h2><span className="muted small">{elevenlabsOn ? "Music is made fresh for each ad; voiceover is read by ElevenLabs." : "Off — the ad uses the sound the video engine already made."}</span></div>
                <label className="field-toggle"><input type="checkbox" checked={elevenlabsOn} onChange={(event) => setElevenlabsOn(event.target.checked)} /> ElevenLabs sound — voiceover and music from ElevenLabs, on top of the sound the video already has. Off uses just the sound the video engine made.</label>
                <label className="field"><span>Music mood</span>
                  <select value={musicMood || ""} onChange={(event) => setMusicMood(event.target.value || null)} disabled={!elevenlabsOn || libraryTemplate !== "none"}>
                    <option value="">Auto — matched to the format</option>
                    {AD_MUSIC_MOODS.map((mood) => <option key={mood.id} value={mood.id}>{mood.name} — {mood.blurb}</option>)}
                  </select>
                </label>
                <label className="field"><span>Voiceover script</span><textarea value={voiceoverScript} onChange={(event) => setVoiceoverScript(event.target.value)} placeholder="What the voice says, exactly. Leave empty for music only." rows={3} maxLength={5000} disabled={!elevenlabsOn} /></label>
                <label className="field"><span>Voice</span>
                  <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={!elevenlabsOn || !voices.keyed || !voices.list.length}>
                    <option value="">First voice on the account</option>
                    {voices.list.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}{voice.category ? ` · ${voice.category}` : ""}</option>)}
                  </select>
                </label>
                {elevenlabsOn && !voices.keyed ? <p className="note">Voiceover needs the ElevenLabs key — add ELEVENLABS_API_KEY as a Worker secret and it appears here. Music uses the same key.</p> : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Subtitles</h2><span className="muted small">Burned into the picture. Leave the lines empty and they are timed from the voiceover script.</span></div>
                <label className="field-toggle"><input type="checkbox" checked={subtitlesOn} onChange={(event) => setSubtitlesOn(event.target.checked)} /> Burn subtitles into the video</label>
                {subtitlesOn ? (
                  <>
                    <div className="field-row">
                      <label className="field"><span>Position</span>
                        <select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value as "bottom" | "top")}>
                          <option value="bottom">Bottom</option>
                          <option value="top">Top</option>
                        </select>
                      </label>
                      <label className="field"><span>Size</span>
                        <select value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value as "small" | "medium" | "large")}>
                          <option value="small">Small</option>
                          <option value="medium">Medium</option>
                          <option value="large">Large</option>
                        </select>
                      </label>
                    </div>
                    <label className="field"><span>Subtitle lines — one per line</span><textarea value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} placeholder={"One line per subtitle.\nThey are timed evenly across the ad."} rows={4} /></label>
                  </>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-head"><h2>Make it</h2><span className="muted small">Status: {statusLabel[detail.ad.status] || detail.ad.status}{detail.job?.error ? ` — ${detail.job.error}` : ""}</span></div>
                <div className="field-row sa-actions">
                  <button type="button" className="btn btn-white" onClick={saveBrief} disabled={saving}>Save changes</button>
                  <button type="button" className="btn btn-white" onClick={() => generate(true)} disabled={saving || !detail.assets.length}>Generate draft — {money(draftEstimate)}</button>
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
            <label className="field"><span>Name</span><input value={actorName} onChange={(event) => setActorName(event.target.value)} placeholder="e.g. Maya" maxLength={120} /></label>
            <label className="field"><span>Notes</span><input value={actorNotes} onChange={(event) => setActorNotes(event.target.value)} placeholder="Who they are, what they are for (optional)" maxLength={500} /></label>
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
        <label className="field"><span>Angle</span>
          <select value={angle} onChange={(event) => setAngle(event.target.value)}>
            <option value="front">Front</option>
            <option value="side">Side</option>
            <option value="three-quarter">Three-quarter</option>
            <option value="silhouette">Silhouette</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field"><span>Add a photo</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { onUpload(actor.id, angle, event.target.files); event.target.value = ""; }} /></label>
      </div>
      <button type="button" className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>Delete actor</button>
    </section>
  );
}
