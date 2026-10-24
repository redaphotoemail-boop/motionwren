"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../ui-icon";
import { engineCost, preferredDurationForEngine, studioEngine, studioEngines, type StudioEngineKey, type StudioResolution } from "../engine-catalog";

type MotionKey = "push" | "orbit" | "slide" | "focus" | "pull" | "mixed" | "custom";
type SpeedKey = "slow" | "medium" | "fast";
type AspectKey = "horizontal" | "vertical" | "cinematic";
type EngineKey = StudioEngineKey;
type JobStatus = "idle" | "preparing" | "starting" | "processing" | "finishing" | "succeeded" | "failed";
type OutputFormat = "mp4" | "webm";
type SeriesShot = { id: string; name: string; source: string; prompt: string; motion: MotionKey; status: JobStatus; output: string; outputFormat?: OutputFormat; error: string };
type TransitionFrame = { id: string; name: string; source: string };
type RenderJob = { id: string; kind: string; status: string; progress: string; completed: number; total: number; error?: string; historyId?: string; videoUrl?: string; downloadUrl?: string };
type HistoryItem = { id: string; prompt: string; engine: string; category: string; resolution: string; aspect: AspectKey; duration: number; costCents: number; createdAt: number; videoUrl: string; downloadUrl: string };
type RealEstateBranding = { listingEnabled: boolean; listingTitle: string; listingBeds: string; listingBaths: string; listingSquareFeet: string; listingPrice: string; listingMessage: string; agentEnabled: boolean; agentName: string; agentEmail: string; agentPhone: string; agentLogo: string; agentLogoName: string };
type RealEstateBrandingProps = RealEstateBranding & { setListingEnabled: (value: boolean) => void; setListingTitle: (value: string) => void; setListingBeds: (value: string) => void; setListingBaths: (value: string) => void; setListingSquareFeet: (value: string) => void; setListingPrice: (value: string) => void; setListingMessage: (value: string) => void; setAgentEnabled: (value: boolean) => void; setAgentName: (value: string) => void; setAgentEmail: (value: string) => void; setAgentPhone: (value: string) => void; acceptAgentLogo: (file?: File) => void; removeAgentLogo: () => void };

function formatWholeNumber(value: string) { const digits = value.replace(/\D/g, "").slice(0, 9); return digits ? Number(digits).toLocaleString("en-US") : ""; }
function formatCurrency(value: string) { const number = formatWholeNumber(value); return number ? `$${number}` : ""; }
function formatBaths(value: string) { const clean = value.replace(/[^\d.]/g, ""); const [whole = "", ...decimals] = clean.split("."); return `${whole.slice(0, 2)}${decimals.length ? `.${decimals.join("").slice(0, 1)}` : ""}`; }
function formatPhone(value: string) { const digits = value.replace(/\D/g, "").slice(0, 10); if (digits.length < 4) return digits; if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`; return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`; }

function estimateCost(engine: EngineKey, resolution: "480p" | "720p" | "1080p", frames: 81 | 121) {
  const seconds = frames === 121 ? 10 : 5;
  return engineCost(engine, resolution, seconds);
}

const motions: Array<{ key: MotionKey; label: string; note: string; prompt: string }> = [
  { key: "push", label: "Slow push-in", note: "Premium reveal", prompt: "The camera performs a very slow, controlled cinematic push-in toward the main subject." },
  { key: "slide", label: "Lateral slide", note: "Reveal details", prompt: "The camera makes a smooth, restrained lateral slide from left to right with natural parallax." },
  { key: "orbit", label: "Subtle orbit", note: "Dimensional hero", prompt: "The camera makes a very subtle three-quarter orbit around the main subject while preserving its exact form." },
  { key: "focus", label: "Focus shift", note: "Macro texture", prompt: "The camera stays nearly still while focus shifts gently from the foreground to the main subject." },
  { key: "pull", label: "Slow pull-back", note: "Reveal context", prompt: "The camera slowly and smoothly pulls back to reveal more of the original scene." },
  { key: "mixed", label: "AI mixed movement", note: "Best fit for the scene", prompt: "Analyze the subject, composition, depth and action, then choose and combine the most appropriate cinematic camera movements for this exact scenario. Keep transitions between movements smooth, intentional and physically believable; avoid random or excessive motion." },
  { key: "custom", label: "Custom motion", note: "Write your own", prompt: "" },
];
const autoMovement: MotionKey[] = ["push", "slide", "focus", "orbit", "pull"];
const qualityPrompts = {
  interior: "Polished architectural commercial, realistic perspective, stable straight lines, natural light and smooth professional camera movement.",
  people: "Premium lifestyle commercial, natural expression and body movement, realistic skin texture, stable facial identity and cinematic restraint.",
};
const guardrail = "Preserve the exact subject, composition, colors, proportions, packaging, text, logo and background. No morphing, melting, warping, floating objects, added objects, flicker, sudden movement, fake text or surreal effects.";
const multiShotStabilityLock = "MULTI-SHOT QUALITY AND STABILITY LOCK — NON-NEGOTIABLE. Match the polished commercial quality and control of the single-shot preset. The camera must move as if mounted on a precision motorized cinema dolly or stabilized robotic gimbal. Motion is perfectly smooth, level, deliberate and continuous with gentle acceleration and deceleration. Absolutely no handheld look, walking motion, footsteps, body sway, bobbing, bouncing, shake, vibration, micro-jitter, sudden correction, uneven speed or horizon drift. Allow only the selected camera movement and any subject movement explicitly requested in the scene direction; create no unintended subject, object or background movement. Preserve subject identity, geometry, proportions, materials, lighting, color grade, lens character, scale, spatial relationships and framing from the first frame through the last frame and consistently across the full series. No morphing, warping, flicker, melting, floating elements, invented objects or continuity changes. The result must feel buttery smooth, photorealistic and professionally stabilized.";
const realEstateMovements: Record<MotionKey, string> = {
  push: "The camera moves slowly in a straight push-in toward the property scene",
  slide: "The camera moves slowly in a horizontal lateral slide across the property scene",
  orbit: "The camera moves slowly in a subtle three-quarter orbit around the property scene",
  focus: "The camera remains stationary while the lens performs a slow, gentle focus shift within the property scene",
  pull: "The camera moves slowly in a straight pull-back away from the property scene",
  mixed: "The camera selects and combines only the smooth camera movements that best fit the property scene",
  custom: "The camera performs only the custom-selected camera movement through the property scene",
};
const realEstateBasePrompt = "Capture an extremely realistic real estate interior or exterior scene. The property and every object remain completely stationary; there is no movement of people, furniture, or anything else in or around the house. The camera's gentle motion creates a sense of stability, while the static environment provides a clear view of the property's layout and features. Lighting is natural and fixed, with no artificial changes, dramatic changes, flicker, or moving shadows. Depth is achieved only through the camera's perspective and the existing mid-range and distant layers. Maintain strict realism: furniture, décor, curtains, doors, windows, plants, trees, water, reflections, appliances, lights, vehicles, architectural elements, outdoor features, and decorative items remain completely still and unchanged. No people or animals enter or move. Preserve the exact geometry, materials, straight lines, proportions, composition, and staging with photorealistic real-world optics. Create a very buttery-smooth video with no shake, no warping, and perfect stabilization. ONLY THE CAMERA MOVES. NOTHING ELSE MOVES.";
function realEstatePrompt(motion: MotionKey) {
  return `REAL ESTATE CAMERA-ONLY PRESET — NON-NEGOTIABLE. ${realEstateMovements[motion]}. ${realEstateBasePrompt}`;
}

function fadeWindow(time: number, start: number, end: number, fade = .65) {
  if (time < start || time > end) return 0;
  return Math.max(0, Math.min(1, (time - start) / fade, (end - time) / fade));
}
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, minSize: number) {
  let size = startSize;
  while (size > minSize) { context.font = `600 ${size}px Arial, sans-serif`; if (context.measureText(text).width <= maxWidth) break; size -= 2; }
  return size;
}
async function loadOverlayLogo(source: string) {
  if (!source) return null;
  const image = new Image(); image.src = source;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The logo could not be prepared.")); });
  return image;
}
async function renderRealEstateOverlays(sourceUrl: string, branding: RealEstateBranding, opening: boolean, closing: boolean): Promise<{ url: string; blob: Blob; format: OutputFormat } | null> {
  const listingFacts = [branding.listingBeds && `${branding.listingBeds} beds`, branding.listingBaths && `${branding.listingBaths} baths`, branding.listingSquareFeet && `${branding.listingSquareFeet} sq ft`].filter(Boolean).join(" · ");
  const showOpening = opening && branding.listingEnabled && Boolean(branding.listingTitle.trim() || listingFacts || branding.listingPrice.trim() || branding.listingMessage.trim());
  const showClosing = closing && branding.agentEnabled && Boolean(branding.agentLogo || branding.agentName.trim() || branding.agentEmail.trim() || branding.agentPhone.trim());
  if (!showOpening && !showClosing) return null;
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot finish the listing overlays. Use a current Chrome, Edge, or Safari browser.");
  const response = await fetch(sourceUrl.startsWith("blob:") ? sourceUrl : `/api/download?url=${encodeURIComponent(sourceUrl)}&name=source.mp4`);
  if (!response.ok) throw new Error("The generated video could not be prepared for its listing overlays.");
  const sourceObjectUrl = URL.createObjectURL(await response.blob());
  const video = document.createElement("video"); video.src = sourceObjectUrl; video.playsInline = true; video.preload = "auto";
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("The generated video could not be opened for finishing.")); });
  const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext("2d"); if (!context) throw new Error("This browser could not render the listing overlays.");
  const logo = await loadOverlayLogo(branding.agentLogo);
  const videoStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
  const stream = canvas.captureStream(30); videoStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
  let audioContext: AudioContext | null = null;
  if (!stream.getAudioTracks().length) {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) { audioContext = new AudioContextClass(); const mediaSource = audioContext.createMediaElementSource(video); const audioDestination = audioContext.createMediaStreamDestination(); mediaSource.connect(audioDestination); audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track)); await audioContext.resume(); }
  }
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"].find((item) => MediaRecorder.isTypeSupported(item));
  if (!mime) { URL.revokeObjectURL(sourceObjectUrl); throw new Error("This browser does not support branded video export."); }
  const format: OutputFormat = mime.startsWith("video/mp4") ? "mp4" : "webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 }); const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const finished = new Promise<Blob>((resolve, reject) => { recorder.onerror = () => reject(new Error("The listing overlay export failed.")); recorder.onstop = () => resolve(new Blob(chunks, { type: mime })); });
  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const width = canvas.width; const height = canvas.height; const margin = Math.round(width * .055); const now = video.currentTime; const duration = video.duration;
    const openingAlpha = showOpening ? fadeWindow(now, 0, Math.min(3.25, Math.max(2.4, duration * .55))) : 0;
    if (openingAlpha > 0) {
      context.save(); context.globalAlpha = openingAlpha; const panelWidth = Math.min(width * .68, width - margin * 2); const panelHeight = Math.min(height * .34, 260); const y = height - margin - panelHeight;
      const gradient = context.createLinearGradient(margin, y, margin + panelWidth, y); gradient.addColorStop(0, "rgba(12,12,10,.88)"); gradient.addColorStop(1, "rgba(12,12,10,.35)"); context.fillStyle = gradient; context.fillRect(margin, y, panelWidth, panelHeight);
      context.fillStyle = "#ffffff"; const titleSize = fitText(context, branding.listingTitle.trim(), panelWidth - margin, Math.round(width * .035), 22); context.font = `600 ${titleSize}px Arial, sans-serif`; context.fillText(branding.listingTitle.trim(), margin * 1.45, y + panelHeight * .34);
      context.fillStyle = "rgba(255,255,255,.82)"; context.font = `400 ${Math.max(18, Math.round(width * .017))}px Arial, sans-serif`; if (listingFacts) context.fillText(listingFacts, margin * 1.45, y + panelHeight * .55);
      context.fillStyle = "#f3b08e"; context.font = `600 ${Math.max(19, Math.round(width * .019))}px Arial, sans-serif`; if (branding.listingPrice.trim()) context.fillText(branding.listingPrice.trim(), margin * 1.45, y + panelHeight * .73);
      context.fillStyle = "rgba(255,255,255,.82)"; context.font = `400 ${Math.max(16, Math.round(width * .014))}px Arial, sans-serif`; if (branding.listingMessage.trim()) context.fillText(branding.listingMessage.trim(), margin * 1.45, y + panelHeight * .88); context.restore();
    }
    const closingStart = Math.max(0, duration - Math.min(2.8, duration * .46)); const closingAlpha = showClosing ? Math.max(0, Math.min(1, (now - closingStart) / .8)) : 0;
    if (closingAlpha > 0) {
      context.save(); context.globalAlpha = closingAlpha; context.fillStyle = "rgba(12,12,10,.82)"; context.fillRect(0, 0, width, height);
      const cardWidth = Math.min(width * .76, 980); const cardHeight = Math.min(height * .47, 390); const x = (width - cardWidth) / 2; const y = (height - cardHeight) / 2; context.fillStyle = "rgba(255,255,255,.96)"; context.fillRect(x, y, cardWidth, cardHeight);
      let textX = x + cardWidth * .12; if (logo) { const box = cardHeight * .48; const scale = Math.min(box / logo.width, box / logo.height); const logoW = logo.width * scale; const logoH = logo.height * scale; context.drawImage(logo, x + cardWidth * .09, y + (cardHeight - logoH) / 2, logoW, logoH); textX = x + cardWidth * .42; }
      context.fillStyle = "#191916"; context.font = `600 ${Math.max(24, Math.round(width * .032))}px Arial, sans-serif`; if (branding.agentName.trim()) context.fillText(branding.agentName.trim(), textX, y + cardHeight * .38);
      context.fillStyle = "#625d54"; context.font = `400 ${Math.max(17, Math.round(width * .016))}px Arial, sans-serif`; if (branding.agentEmail.trim()) context.fillText(branding.agentEmail.trim(), textX, y + cardHeight * .58); if (branding.agentPhone.trim()) context.fillText(branding.agentPhone.trim(), textX, y + cardHeight * .72); context.restore();
    }
    if (!video.ended && !video.paused) requestAnimationFrame(draw);
  };
  recorder.start(250); await video.play(); draw(); await new Promise<void>((resolve) => { video.onended = () => { recorder.stop(); resolve(); }; });
  const blob = await finished; URL.revokeObjectURL(sourceObjectUrl); stream.getTracks().forEach((track) => track.stop()); await audioContext?.close();
  return { url: URL.createObjectURL(blob), blob, format };
}

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Your browser could not prepare this image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  let quality = 0.9; let result = canvas.toDataURL("image/jpeg", quality);
  while (result.length > 1_250_000 && quality > 0.5) { quality -= 0.1; result = canvas.toDataURL("image/jpeg", quality); }
  if (result.length > 1_400_000) throw new Error("This image remains too large. Export a JPEG under 1 MB and try again.");
  return result;
}
const speedPrompts: Record<SpeedKey, string> = {
  slow: "Use slow, elegant motion with restrained subject movement and a cinematic, unhurried pace.",
  medium: "Use a natural medium pace with clear, controlled movement and balanced energy.",
  fast: "Use fast, energetic motion with crisp timing while maintaining stable geometry, continuity and realistic physics.",
};
const aspectPrompts: Record<AspectKey, string> = {
  horizontal: "Compose for a clean 16:9 horizontal frame.",
  vertical: "Compose specifically for a 9:16 vertical social frame, keeping the main action safely centered.",
  cinematic: "Compose with a cinematic 2.39:1 crop-safe layout inside the 16:9 output, with wide negative space and no critical detail near the top or bottom crop.",
};
const visualStyles: Array<{ key: AspectKey; label: string; note: string; icon: "home" | "quality" | "finish" | "motion"; prompt: string }> = [
  { key: "vertical", label: "Vertical property reel", note: "Social-ready 9:16", icon: "motion", prompt: "Edit as a concise vertical property reel with an elegant social-first pace, centered composition and clear architectural reveals." },
  { key: "cinematic", label: "Luxury cinematic", note: "Premium and atmospheric", icon: "quality", prompt: "Edit as a refined luxury architectural film with restrained pacing, premium visual rhythm, generous negative space and elegant cinematic composition." },
  { key: "horizontal", label: "Classic listing film", note: "Clear and timeless", icon: "home", prompt: "Edit as a clean classic listing film with a calm, trustworthy pace, clear room-to-room coverage and an easy-to-follow property presentation." },
];
function buildPrompt(motion: MotionKey, details: string, category: keyof typeof qualityPrompts, continuity = "", speed: SpeedKey = "slow", aspect: AspectKey = "horizontal", sound = "", seriesStability = false) {
  const cleanDetails = details.replace(/^Prompt for you:\s*/i, "").trim();
  const stylePrompt = visualStyles.find((item) => item.key === aspect)?.prompt || visualStyles[2].prompt;
  if (category === "interior") return [realEstatePrompt(motion), stylePrompt, seriesStability ? multiShotStabilityLock : "", sound, "The audio direction must not cause or imply visual object movement. FINAL ENFORCEMENT: only the stabilized camera moves; the entire property and every object remain absolutely motionless from the first frame through the last frame."].filter(Boolean).join(" ");
  return [cleanDetails, motions.find((item) => item.key === motion)?.prompt || "", stylePrompt, speedPrompts[speed], aspectPrompts[aspect], qualityPrompts[category], continuity, seriesStability ? multiShotStabilityLock : "", sound, guardrail].filter(Boolean).join(" ");
}

function cleanGeneratedPrompt(value: string) {
  const clean = value
    .replace(/^\s*(?:here(?:'s| is)\s+)?(?:the\s+)?(?:production-ready\s+)?(?:image-to-video\s+)?prompt(?:\s+(?:from|for)\s+[\w.-]+)?\s*[:\-–—]?\s*/i, "")
    .replace(/\bWan(?:\s*\d+(?:\.\d+)*)?\b/gi, "the video engine")
    .trim();
  return `Prompt for you:\n\n${clean}`;
}

async function extractLastFrame(file: File): Promise<{ frame: string; preview: string }> {
  const preview = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata"; video.muted = true; video.playsInline = true; video.src = preview;
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("This video could not be opened.")); });
  if (!Number.isFinite(video.duration) || video.duration <= 0) { URL.revokeObjectURL(preview); throw new Error("This video has no readable duration."); }
  video.currentTime = Math.max(0, video.duration - 0.08);
  await new Promise<void>((resolve, reject) => { video.onseeked = () => resolve(); video.onerror = () => reject(new Error("The final frame could not be extracted.")); });
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("The final frame could not be prepared.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { frame: canvas.toDataURL("image/jpeg", .9), preview };
}
async function prepareUpscaleVideo(file: File): Promise<{ data: string; preview: string; duration: number }> {
  const preview = URL.createObjectURL(file);
  const video = document.createElement("video"); video.preload = "metadata"; video.src = preview;
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("This video could not be opened.")); });
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("This video could not be prepared.")); reader.readAsDataURL(file); });
  return { data, preview, duration: Number.isFinite(video.duration) ? video.duration : 0 };
}
async function prepareFrame(source: string, aspect: AspectKey, _engine: EngineKey): Promise<string> {
  void _engine;
  const target = aspect === "vertical" ? 9 / 16 : aspect === "cinematic" ? 2.39 : 16 / 9;
  const image = new Image(); image.src = source;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The selected frame could not be prepared.")); });
  const original = image.naturalWidth / image.naturalHeight;
  let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
  if (original > target) { sw = image.naturalHeight * target; sx = (image.naturalWidth - sw) / 2; }
  else { sh = image.naturalWidth / target; sy = (image.naturalHeight - sh) / 2; }
  const canvas = document.createElement("canvas"); canvas.width = Math.min(1280, Math.round(sw)); canvas.height = Math.round(canvas.width / target);
  const context = canvas.getContext("2d"); if (!context) throw new Error("The selected frame could not be prepared.");
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .9);
}
async function startPrediction(image: string, prompt: string, resolution: "480p" | "720p" | "1080p", frames: 81 | 121, seed: string, engine: EngineKey, aspect: AspectKey, duration?: number, audio = false) {
  const response = await fetch("/api/predictions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, prompt, resolution, num_frames: frames, duration, audio, seed: seed ? Number(seed) : null, engine, aspect_ratio: aspect === "vertical" ? "9:16" : "16:9" }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not start the generation."); return data;
}
async function waitForPrediction(id: string, onProcessing: () => void, options: { timeoutMs?: number; canceled?: () => boolean } = {}): Promise<string> {
  const startedAt = Date.now(); const timeoutMs = options.timeoutMs ?? 12 * 60 * 1000;
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
    if (options.canceled?.()) { await fetch(`/api/predictions/${id}`, { method: "DELETE" }).catch(() => undefined); throw new Error("Generation stopped."); }
    if (Date.now() - startedAt >= timeoutMs) { await fetch(`/api/predictions/${id}`, { method: "DELETE" }).catch(() => undefined); throw new Error(`This scene exceeded ${Math.round(timeoutMs / 60000)} minutes and was stopped. Retry the scene.`); }
    const response = await fetch(`/api/predictions/${id}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to check generation status.");
    if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
    if (data.status === "failed" || data.status === "canceled") throw new Error(data.error || "The generation did not complete.");
    onProcessing();
  }
}
async function waitForRenderJob(id: string, onUpdate: (job: RenderJob) => void): Promise<RenderJob> {
  for (;;) {
    const response = await fetch(`/api/transitions/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.job) throw new Error(data.error || "The saved render job could not be checked.");
    const job = data.job as RenderJob; onUpdate(job);
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(job.error || "The render job did not complete.");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
}
async function waitForPrompt(id: string): Promise<string> {
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const response = await fetch(`/api/predictions/${id}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to check the prompt.");
    if (data.status === "succeeded") return Array.isArray(data.output) ? data.output.join("") : String(data.output || "");
    if (data.status === "failed" || data.status === "canceled") throw new Error(data.error || "The prompt was not completed.");
  }
}

function requestedEngine(): EngineKey {
  if (typeof window === "undefined") return "kling3";
  const requested = new URLSearchParams(window.location.search).get("engine");
  return studioEngines.some((item) => item.key === requested) ? requested as EngineKey : "kling3";
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null); const seriesInputRef = useRef<HTMLInputElement>(null); const extendInputRef = useRef<HTMLInputElement>(null); const upscaleInputRef = useRef<HTMLInputElement>(null); const firstFrameInputRef = useRef<HTMLInputElement>(null); const lastFrameInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"single" | "series" | "transition" | "extend" | "history" | "upscale">("single"); const [source, setSource] = useState(""); const [fileName, setFileName] = useState("");
  const [firstFrame, setFirstFrame] = useState(""); const [firstFrameName, setFirstFrameName] = useState(""); const [middleFrames, setMiddleFrames] = useState<TransitionFrame[]>([]); const [lastFrame, setLastFrame] = useState(""); const [lastFrameName, setLastFrameName] = useState(""); const [transitionOutput, setTransitionOutput] = useState(""); const [transitionStatus, setTransitionStatus] = useState<JobStatus>("idle"); const [transitionError, setTransitionError] = useState(""); const [transitionProgress, setTransitionProgress] = useState(""); const [transitionMode, setTransitionMode] = useState<"ai" | "clean">("ai"); const [activeTransitionJob, setActiveTransitionJob] = useState("");
  const [motion, setMotion] = useState<MotionKey>("push"); const [shots, setShots] = useState<SeriesShot[]>([]);
  const [seriesPromptMode, setSeriesPromptMode] = useState<"scene" | "shared">("scene");
  const [secondsPerImage, setSecondsPerImage] = useState<3 | 5 | "auto">("auto");
  const [continuity, setContinuity] = useState("Maintain the same architecture, geometry, lighting, materials, lens character and color across every scene.");
  const [category, setCategory] = useState<keyof typeof qualityPrompts>("interior");
  const [speed, setSpeed] = useState<SpeedKey>("slow");
  const [aspect, setAspect] = useState<AspectKey>("horizontal"); const [engine, setEngine] = useState<EngineKey>("kling3");
  const [soundEnabled, setSoundEnabled] = useState(false); const [soundDirection, setSoundDirection] = useState("Subtle cinematic music, natural ambience, and restrained synchronized sound effects.");
  const [voiceoverEnabled, setVoiceoverEnabled] = useState(false); const [voiceoverText, setVoiceoverText] = useState("");
  const [listingEnabled, setListingEnabled] = useState(false); const [listingTitle, setListingTitle] = useState(""); const [listingBeds, setListingBeds] = useState(""); const [listingBaths, setListingBaths] = useState(""); const [listingSquareFeet, setListingSquareFeet] = useState(""); const [listingPrice, setListingPrice] = useState(""); const [listingMessage, setListingMessage] = useState("");
  const [agentEnabled, setAgentEnabled] = useState(false); const [agentName, setAgentName] = useState(""); const [agentEmail, setAgentEmail] = useState(""); const [agentPhone, setAgentPhone] = useState(""); const [agentLogo, setAgentLogo] = useState(""); const [agentLogoName, setAgentLogoName] = useState("");
  const [details, setDetails] = useState("Keep the subject completely stable. Add only subtle highlight movement and natural depth of field.");
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("1080p"); const [frames, setFrames] = useState<81 | 121>(81); const [seed, setSeed] = useState("");
  const [status, setStatus] = useState<JobStatus>("idle"); const [output, setOutput] = useState(""); const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4"); const [error, setError] = useState(""); const [seriesGenerating, setSeriesGenerating] = useState(false); const [seriesCanceling, setSeriesCanceling] = useState(false); const [seriesElapsed, setSeriesElapsed] = useState(0); const seriesCancelRef = useRef(false); const activeSeriesJobsRef = useRef(new Set<string>());
  const [stitchedOutput, setStitchedOutput] = useState(""); const [stitchedFormat, setStitchedFormat] = useState<OutputFormat>("mp4"); const [stitching, setStitching] = useState(false); const [stitchError, setStitchError] = useState("");
  const [extendSource, setExtendSource] = useState(""); const [extendPreview, setExtendPreview] = useState(""); const [extendName, setExtendName] = useState(""); const [extendOutput, setExtendOutput] = useState(""); const [extendOutputFormat, setExtendOutputFormat] = useState<OutputFormat>("mp4");
  const [connected, setConnected] = useState<boolean | null>(null); const [token, setToken] = useState(""); const [tokenError, setTokenError] = useState(""); const [savingToken, setSavingToken] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]); const [historyLoading, setHistoryLoading] = useState(true); const [historyMessage, setHistoryMessage] = useState("");
  const [upscaleSource, setUpscaleSource] = useState(""); const [upscalePreview, setUpscalePreview] = useState(""); const [upscaleName, setUpscaleName] = useState(""); const [upscaleDuration, setUpscaleDuration] = useState(0); const [upscaleTarget, setUpscaleTarget] = useState<"1080p" | "4k">("1080p"); const [upscaleFps, setUpscaleFps] = useState<30 | 60>(30); const [upscaleOutput, setUpscaleOutput] = useState(""); const [upscaleStatus, setUpscaleStatus] = useState<JobStatus>("idle"); const [upscaleError, setUpscaleError] = useState("");
  const selectedEngine = studioEngine(engine);
  const audioPrompt = selectedEngine.audio ? [soundEnabled ? `Generate synchronized music, ambience and sound effects: ${soundDirection}` : "", voiceoverEnabled && voiceoverText.trim() ? `Include a clear professional voiceover that says exactly: "${voiceoverText.trim()}". Keep narration intelligible above the music and effects.` : ""].filter(Boolean).join(" ") : "";
  const requestedSecondsPerImage = secondsPerImage === "auto" ? (shots.length >= 5 ? 3 : 5) : secondsPerImage; const effectiveSecondsPerImage = preferredDurationForEngine(engine, requestedSecondsPerImage, resolution); const seriesAudioRequested = soundEnabled || voiceoverEnabled; const finalPrompt = buildPrompt(motion, details, category, "", speed, aspect, audioPrompt); const extensionPrompt = buildPrompt(motion, `Continue the scene naturally from this exact final frame. ${details}`, category, "Preserve seamless continuity with the preceding clip: same subject, lighting, color grade, lens, environment and direction of action.", speed, aspect, audioPrompt); const price = estimateCost(engine, resolution, frames); const completedShots = shots.filter((shot) => shot.status === "succeeded").length; const failedShots = shots.filter((shot) => shot.status === "failed").length; const activeShots = shots.filter((shot) => ["starting", "processing", "finishing"].includes(shot.status)).length; const seriesDurations = shots.map(() => effectiveSecondsPerImage); const stitchedDuration = Math.max(1, seriesDurations.reduce((total, seconds) => total + seconds, 0) - Math.max(0, shots.length - 1)); const seriesCost = seriesDurations.reduce((total, seconds) => total + engineCost(engine, resolution, seconds), 0);
  const branding: RealEstateBranding = { listingEnabled, listingTitle, listingBeds, listingBaths, listingSquareFeet, listingPrice, listingMessage, agentEnabled, agentName, agentEmail, agentPhone, agentLogo, agentLogoName };
  const brandingProps: RealEstateBrandingProps = { ...branding, setListingEnabled, setListingTitle, setListingBeds, setListingBaths, setListingSquareFeet, setListingPrice, setListingMessage, setAgentEnabled, setAgentName, setAgentEmail, setAgentPhone, acceptAgentLogo, removeAgentLogo: () => { setAgentLogo(""); setAgentLogoName(""); } };
  useEffect(() => { fetch("/api/token").then((r) => r.json()).then((d) => setConnected(Boolean(d.connected))).catch(() => setConnected(false)); fetch("/api/admin/settings", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d.multiShotSecondsPerImage === 3 || d.multiShotSecondsPerImage === 5 || d.multiShotSecondsPerImage === "auto") setSecondsPerImage(d.multiShotSecondsPerImage); }).catch(() => undefined); }, []);
  useEffect(() => { const next = requestedEngine(); const timer = window.setTimeout(() => { setEngine(next); const available = studioEngine(next).resolutions; setResolution((current) => available.includes(current) ? current : available[available.length - 1]); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => { if (!seriesGenerating) return; const timer = window.setInterval(() => setSeriesElapsed((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [seriesGenerating]);
  useEffect(() => {
    fetch("/api/transitions", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (!data.job?.id) return;
      if (data.job.kind === "series-stitch") {
        setMode("series"); setStitching(true); setStitchError(data.job.progress || "Restoring the server-side stitch…");
        void waitForRenderJob(data.job.id, (job) => setStitchError(job.progress)).then((job) => {
          if (!job.videoUrl) throw new Error("The completed series has no saved video."); setStitchedOutput(job.videoUrl); setStitchedFormat("mp4"); setStitchError(""); void loadHistory();
        }).catch((error) => setStitchError(error instanceof Error ? error.message : "The stitched series could not be restored.")).finally(() => setStitching(false));
        return;
      }
      setMode("transition"); setActiveTransitionJob(data.job.id); setTransitionStatus(data.job.status === "stitching" || data.job.status === "saving" ? "finishing" : "processing"); setTransitionProgress(data.job.progress || "Restoring your active generation…");
      void waitForRenderJob(data.job.id, (job) => { setTransitionStatus(job.status === "stitching" || job.status === "saving" ? "finishing" : "processing"); setTransitionProgress(job.progress); }).then((job) => {
        if (!job.videoUrl) throw new Error("The completed job has no saved video."); setTransitionOutput(job.videoUrl); setTransitionStatus("succeeded"); setTransitionProgress("Complete and saved to History"); setActiveTransitionJob(""); void loadHistory();
      }).catch((error) => { setTransitionStatus("failed"); setTransitionError(error instanceof Error ? error.message : "The active job could not be restored."); setActiveTransitionJob(""); });
    }).catch(() => undefined);
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    try { const response = await fetch("/api/history"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setHistory(data.items || []); }
    catch { setHistoryMessage("History could not be loaded right now."); }
    finally { setHistoryLoading(false); }
  }
  async function saveHistory(sourceUrl: string, prompt: string, itemCategory = category, finishedBlob?: Blob, durationOverride?: number, costCentsOverride?: number) {
    setHistoryMessage("Saving this video to your private history…");
    try {
      let response: Response;
      const savedDuration = durationOverride || (frames === 121 ? 10 : 5); const savedCost = costCentsOverride ?? Math.round(price * 100);
      if (finishedBlob) { const form = new FormData(); form.append("video", finishedBlob, finishedBlob.type.includes("mp4") ? "motionwren.mp4" : "motionwren.webm"); form.append("prompt", prompt); form.append("engine", engine); form.append("category", itemCategory); form.append("resolution", resolution); form.append("aspect", aspect); form.append("duration", String(savedDuration)); form.append("costCents", String(savedCost)); response = await fetch("/api/history", { method: "POST", body: form }); }
      else response = await fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl, prompt, engine, category: itemCategory, resolution, aspect, duration: savedDuration, costCents: savedCost }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setHistory((current) => [data.item, ...current.filter((item) => item.id !== data.item.id)]); setHistoryMessage("Saved to history.");
    } catch { setHistoryMessage("The video generated, but its history copy could not be saved. Download it now."); }
  }
  async function finishSeries(sourceUrls?: string[]) {
    const urls = sourceUrls || shots.filter((shot) => shot.status === "succeeded" && shot.output).map((shot) => shot.output);
    if (urls.length < 2) return setStitchError("Generate at least two successful scenes before stitching the final video.");
    setStitching(true); setStitchError(""); setStitchedOutput("");
    try {
      if (urls.some((url) => url.startsWith("blob:"))) throw new Error("The original generated clips are required for reliable server stitching. Regenerate this series once with the updated version.");
      const response = await fetch("/api/stitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: urls, prompt: `Complete a ${stitchedDuration}-second stitched multi-shot series at ${effectiveSecondsPerImage} seconds per image. ${multiShotStabilityLock}`, category: `stitched series · ${category}`, resolution, aspect, crossfadeSeconds: 1, duration: stitchedDuration, audioMode: seriesAudioRequested ? "single_master" : "silent", audioDirection: soundEnabled ? soundDirection : "", voiceoverScript: voiceoverEnabled ? voiceoverText : "", costCents: Math.round(seriesCost * 100) }) });
      const data = await response.json(); if (!response.ok || !data.job?.id) throw new Error(data.error || "Server stitching could not start.");
      const completed = await waitForRenderJob(data.job.id, (job) => setStitchError(job.progress));
      if (!completed.videoUrl) throw new Error("The server finished without a saved video.");
      setStitchedOutput(completed.videoUrl); setStitchedFormat("mp4"); setStitchError(""); void loadHistory();
    }
    catch (err) { setStitchError(err instanceof Error ? err.message : "The full series could not be stitched."); }
    finally { setStitching(false); }
  }

  async function acceptFile(file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setError("Choose an image smaller than 20 MB.");
    setError(""); setStatus("preparing");
    try { setSource(await compressImage(file)); setFileName(file.name); setStatus("idle"); setOutput(""); } catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "The image could not be prepared."); }
  }
  async function acceptTransitionFrame(position: "first" | "last", file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setTransitionError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setTransitionError("Choose an image smaller than 20 MB.");
    setTransitionError(""); setTransitionStatus("preparing");
    try { const prepared = await compressImage(file); if (position === "first") { setFirstFrame(prepared); setFirstFrameName(file.name); } else { setLastFrame(prepared); setLastFrameName(file.name); } setTransitionOutput(""); setTransitionStatus("idle"); }
    catch (err) { setTransitionStatus("failed"); setTransitionError(err instanceof Error ? err.message : "The frame could not be prepared."); }
  }
  function addMiddleFrame() {
    if (middleFrames.length >= 6 || ["preparing","starting","processing","finishing"].includes(transitionStatus)) return;
    setMiddleFrames((current) => [...current, { id: `keyframe-${Date.now()}-${current.length}`, name: "", source: "" }]); setTransitionOutput("");
  }
  async function acceptMiddleFrame(id: string, file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setTransitionError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setTransitionError("Choose an image smaller than 20 MB.");
    setTransitionError(""); setTransitionStatus("preparing");
    try { const prepared = await compressImage(file); setMiddleFrames((current) => current.map((frame) => frame.id === id ? { ...frame, source: prepared, name: file.name } : frame)); setTransitionOutput(""); setTransitionStatus("idle"); }
    catch (err) { setTransitionStatus("failed"); setTransitionError(err instanceof Error ? err.message : "The frame could not be prepared."); }
  }
  function moveMiddleFrame(index: number, direction: -1 | 1) {
    setMiddleFrames((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); setTransitionOutput("");
  }
  async function acceptSeriesFiles(files: FileList | File[]) {
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, 12 - shots.length));
    if (!selected.length) return setError("Choose JPG, PNG or WebP images."); if (selected.some((file) => file.size > 20 * 1024 * 1024)) return setError("Every image must be smaller than 20 MB.");
    setError(""); setStatus("preparing");
    try {
      const prepared = await Promise.all(selected.map(async (file, index) => ({ id: `${Date.now()}-${index}`, name: file.name, source: await compressImage(file), prompt: "", motion: autoMovement[(shots.length + index) % autoMovement.length], status: "idle" as JobStatus, output: "", error: "" })));
      setShots((current) => [...current, ...prepared]); setStatus("idle");
    } catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "One of the images could not be prepared."); }
  }
  async function acceptExtensionFile(file?: File) {
    if (!file) return; if (!file.type.startsWith("video/")) return setError("Choose an MP4, MOV or WebM video."); if (file.size > 100 * 1024 * 1024) return setError("Choose a video smaller than 100 MB.");
    setError(""); setStatus("preparing"); setExtendOutput("");
    try { if (extendPreview) URL.revokeObjectURL(extendPreview); const prepared = await extractLastFrame(file); setExtendSource(prepared.frame); setExtendPreview(prepared.preview); setExtendName(file.name); setStatus("idle"); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "The video could not be prepared."); }
  }
  async function acceptUpscaleFile(file?: File) {
    if (!file) return; if (!file.type.startsWith("video/")) return setUpscaleError("Choose an MP4, MOV or WebM video."); if (file.size > 20 * 1024 * 1024) return setUpscaleError("Choose a video under 20 MB.");
    setUpscaleError(""); setUpscaleStatus("preparing"); setUpscaleOutput("");
    try { if (upscalePreview) URL.revokeObjectURL(upscalePreview); const prepared = await prepareUpscaleVideo(file); setUpscaleSource(prepared.data); setUpscalePreview(prepared.preview); setUpscaleDuration(prepared.duration); setUpscaleName(file.name); setUpscaleStatus("idle"); }
    catch (err) { setUpscaleStatus("failed"); setUpscaleError(err instanceof Error ? err.message : "The video could not be prepared."); }
  }
  async function acceptAgentLogo(file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setError("Choose a PNG, JPG or WebP logo."); if (file.size > 5 * 1024 * 1024) return setError("Choose a logo smaller than 5 MB.");
    setError(""); const reader = new FileReader(); reader.onload = () => { setAgentLogo(String(reader.result || "")); setAgentLogoName(file.name); }; reader.onerror = () => setError("The logo could not be prepared."); reader.readAsDataURL(file);
  }
  function addScene() {
    if (shots.length >= 12 || seriesGenerating) return;
    setShots((current) => [...current, { id: `scene-${Date.now()}-${current.length}`, name: "No image selected", source: "", prompt: "", motion: autoMovement[current.length % autoMovement.length], status: "idle", output: "", error: "" }]);
  }
  async function acceptSceneFile(id: string, file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setError("Choose an image smaller than 20 MB.");
    setError(""); setStatus("preparing");
    try { const prepared = await compressImage(file); updateShot(id, { source: prepared, name: file.name, output: "", status: "idle", error: "" }); setStatus("idle"); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "The image could not be prepared."); }
  }
  async function generate() {
    if (!source) return setError("Upload an image first."); if (finalPrompt.trim().length < 20) return setError("Add a clear motion description.");
    setError(""); setOutput(""); setStatus("starting");
    try { const framedSource = await prepareFrame(source, aspect, engine); const job = await startPrediction(framedSource, finalPrompt, resolution, frames, seed, engine, aspect, undefined, soundEnabled || voiceoverEnabled); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setStatus("processing")); setStatus("finishing"); const branded = category === "interior" ? await renderRealEstateOverlays(result, branding, true, true) : null; setOutput(branded?.url || result); setOutputFormat(branded?.format || "mp4"); setStatus("succeeded"); await saveHistory(result, finalPrompt, category, branded?.blob); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "Could not generate the clip."); }
  }
  async function generateSeries(retryFailedOnly = false) {
    if (!shots.length) return setError("Add at least one scene first.");
    const missingImage = shots.findIndex((shot) => !shot.source); if (missingImage >= 0) return setError(`Add an image to scene ${missingImage + 1}.`);
    const missingPrompt = category !== "interior" && seriesPromptMode === "scene" ? shots.findIndex((shot) => shot.prompt.trim().length < 12) : -1;
    if (missingPrompt >= 0) return setError(`Write a clear prompt for scene ${missingPrompt + 1}.`);
    if (category !== "interior" && seriesPromptMode === "shared" && details.trim().length < 12) return setError("Write one clear prompt for the full series.");
    const targets = retryFailedOnly ? shots.filter((shot) => shot.status === "failed") : shots;
    if (!targets.length) return setError("There are no failed scenes to retry.");
    setError(""); setStitchError(""); setStitchedOutput(""); setSeriesElapsed(0); setSeriesGenerating(true); setSeriesCanceling(false); seriesCancelRef.current = false; activeSeriesJobsRef.current.clear();
    if (!retryFailedOnly) setShots((current) => current.map((shot) => ({ ...shot, status: "idle", output: "", error: "" })));
    const finishedById = new Map(shots.filter((shot) => retryFailedOnly && shot.status === "succeeded" && shot.output).map((shot) => [shot.id, shot.output])); let cursor = 0; const failures: string[] = [];
    async function worker() {
      for (;;) {
        const targetIndex = cursor; cursor += 1; const shot = targets[targetIndex]; if (!shot || seriesCancelRef.current) return;
        const shotIndex = shots.findIndex((item) => item.id === shot.id);
        setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "starting", output: retryFailedOnly ? item.output : "", error: "" } : item));
        try {
  const sceneDirection = seriesPromptMode === "scene" ? shot.prompt : details; const sceneAudio = soundEnabled && !voiceoverEnabled && shotIndex === 0; const scenePrompt = buildPrompt(shot.motion, sceneDirection, category, continuity, speed, aspect, sceneAudio ? audioPrompt : "", true); const framedSource = await prepareFrame(shot.source, aspect, engine); if (seriesCancelRef.current) throw new Error("Generation stopped.");
          const sceneDuration = seriesDurations[shotIndex] || (frames === 121 ? 10 : 5); const job = await startPrediction(framedSource, scenePrompt, resolution, frames, seed, engine, aspect, sceneDuration, sceneAudio); if (job.id) activeSeriesJobsRef.current.add(job.id);
          const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "processing" } : item)), { timeoutMs: 8 * 60 * 1000, canceled: () => seriesCancelRef.current });
          if (job.id) activeSeriesJobsRef.current.delete(job.id); setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "finishing" } : item));
          const branded = category === "interior" ? await renderRealEstateOverlays(result, branding, shotIndex === 0, shotIndex === shots.length - 1) : null; const finishedUrl = branded?.url || result; finishedById.set(shot.id, result); setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "succeeded", output: finishedUrl, outputFormat: branded?.format || "mp4" } : item)); await saveHistory(result, scenePrompt, `series · ${category}`, branded?.blob, sceneDuration, Math.round(engineCost(engine, resolution, sceneDuration) * 100));
        } catch (err) { const message = err instanceof Error ? err.message : "This scene failed."; failures.push(`${shot.name}: ${message}`); setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "failed", error: message } : item)); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, () => worker()));
    const orderedUrls = shots.map((shot) => finishedById.get(shot.id) || "").filter(Boolean); if (!seriesCancelRef.current && orderedUrls.length === shots.length && orderedUrls.length > 1) await finishSeries(orderedUrls);
    if (seriesCancelRef.current) { const targetIds = new Set(targets.map((shot) => shot.id)); setShots((current) => current.map((shot) => targetIds.has(shot.id) && shot.status !== "succeeded" ? { ...shot, status: "failed", error: "Stopped before completion." } : shot)); setError("Generation stopped. Completed scenes were kept; retry the stopped scenes when ready."); } else if (failures.length) setError(`${failures.length} scene${failures.length === 1 ? "" : "s"} did not finish. Completed scenes were kept. Retry only the failed scenes below.`);
    setSeriesGenerating(false); setSeriesCanceling(false); activeSeriesJobsRef.current.clear();
  }
  function stopSeries() { seriesCancelRef.current = true; setSeriesCanceling(true); Promise.allSettled(Array.from(activeSeriesJobsRef.current, (id) => fetch(`/api/predictions/${id}`, { method: "DELETE" }))); }
  async function generateExtension() {
    if (!extendSource) return setError("Upload the clip you want to extend first.");
    setError(""); setExtendOutput(""); setStatus("starting");
    try { const framedSource = await prepareFrame(extendSource, aspect, engine); const job = await startPrediction(framedSource, extensionPrompt, resolution, frames, seed, engine, aspect, undefined, soundEnabled || voiceoverEnabled); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setStatus("processing")); setStatus("finishing"); const branded = category === "interior" ? await renderRealEstateOverlays(result, branding, true, true) : null; setExtendOutput(branded?.url || result); setExtendOutputFormat(branded?.format || "mp4"); setStatus("succeeded"); await saveHistory(result, extensionPrompt, `extension · ${category}`, branded?.blob); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "Could not extend the scene."); }
  }
  async function generateTransition() {
    if (!firstFrame || !lastFrame) return setTransitionError("Add both the first frame and the last frame.");
    if (middleFrames.some((frame) => !frame.source)) return setTransitionError("Add an image to every numbered frame or remove the empty frame.");
    if (finalPrompt.trim().length < 20) return setTransitionError("Add a clear transition or camera direction.");
    setTransitionError(""); setTransitionOutput(""); setTransitionProgress(""); setTransitionStatus("starting");
    try {
      const orderedFrames = [{ id: "first", name: firstFrameName, source: firstFrame }, ...middleFrames, { id: "last", name: lastFrameName, source: lastFrame }];
      const preparedFrames = await Promise.all(orderedFrames.map((frame) => prepareFrame(frame.source, aspect, "studio")));
      const selectedMovement = motions.find((item) => item.key === motion)?.prompt || "Choose the simplest physically believable camera path between the supplied frames.";
      const transitionPrompt = `STRICT KEYFRAME-TO-KEYFRAME CAMERA TRANSITION — NON-NEGOTIABLE. The supplied images are mandatory physical endpoints, not loose references. Begin on the starting frame exactly and finish on the ending frame exactly. ${selectedMovement} Create only a smooth camera path through one unchanged real three-dimensional space. Every subject, product, prop and background object is rigid, untouched and completely stationary. Nothing reaches, touches, bends, opens, acts, transforms, appears, disappears or moves independently. Never introduce hands, people, animals, tools, liquid, smoke, particles, text or any element absent from the supplied endpoints. The camera never interacts with the subject. Preserve exact identity, silhouette, shape, texture, color, materials, typography, lighting, scale, geometry and spatial relationships. No morphing, melting, warping, replacement, duplication, invention, teleporting, surreal action, flicker, shake, jitter, jump or cut. Motion is physically plausible, level, buttery smooth and perfectly stabilized. Arrive naturally and settle precisely on the supplied destination frame.`;
      const pairCount = preparedFrames.length - 1; setTransitionProgress(transitionMode === "clean" ? "Starting a guaranteed clean dissolve…" : `Submitting ${pairCount} controlled transitions…`);
      const response = await fetch("/api/transitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: preparedFrames, mode: transitionMode, prompt: transitionPrompt, resolution, aspect, duration: frames === 121 ? 10 : 5, seed: seed ? Number(seed) : null }) });
      const data = await response.json(); if (!response.ok || !data.job?.id) throw new Error(data.error || "The multi-frame job could not start.");
      setActiveTransitionJob(data.job.id); setTransitionStatus("processing");
      const completed = await waitForRenderJob(data.job.id, (job) => { setTransitionStatus(job.status === "stitching" || job.status === "saving" ? "finishing" : "processing"); setTransitionProgress(job.progress); });
      if (!completed.videoUrl) throw new Error("The completed job has no saved video.");
      setTransitionOutput(completed.videoUrl); setTransitionStatus("succeeded"); setTransitionProgress("Complete and saved to History"); setActiveTransitionJob(""); void loadHistory();
    } catch (err) { setActiveTransitionJob(""); setTransitionStatus("failed"); setTransitionError(err instanceof Error ? err.message : "Could not generate the frame transition."); }
  }
  async function stopTransition() {
    if (!activeTransitionJob) return;
    await fetch(`/api/transitions/${activeTransitionJob}`, { method: "DELETE" }).catch(() => undefined);
    setActiveTransitionJob(""); setTransitionStatus("failed"); setTransitionError("Generation stopped. Completed provider segments were not regenerated or charged again by the site.");
  }
  async function upscaleVideo() {
    if (!upscaleSource) return setUpscaleError("Upload a video to upscale first.");
    setUpscaleError(""); setUpscaleOutput(""); setUpscaleStatus("starting");
    try { const response = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video: upscaleSource, targetResolution: upscaleTarget, targetFps: upscaleFps }) }); const job = await response.json(); if (!response.ok) throw new Error(job.error || "Could not start the upscaler."); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setUpscaleStatus("processing")); setUpscaleOutput(result); setUpscaleStatus("succeeded"); }
    catch (err) { setUpscaleStatus("failed"); setUpscaleError(err instanceof Error ? err.message : "The video could not be upscaled."); }
  }
  function updateShot(id: string, change: Partial<SeriesShot>) { setShots((current) => current.map((shot) => shot.id === id ? { ...shot, ...change } : shot)); }
  function moveShot(index: number, direction: -1 | 1) { setStitchedOutput(""); setStitchError(""); setShots((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  async function removeHistoryItem(id: string) { if (!window.confirm("Remove this saved video from history?")) return; const response = await fetch(`/api/history/${id}/video`, { method: "DELETE" }); if (response.ok) setHistory((current) => current.filter((item) => item.id !== id)); else setHistoryMessage("That saved video could not be removed."); }
  async function connectReplicate() { setSavingToken(true); setTokenError(""); try { const response = await fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "The token could not be saved."); setConnected(true); setToken(""); } catch (err) { setTokenError(err instanceof Error ? err.message : "The token could not be saved."); } finally { setSavingToken(false); } }
  function selectMode(nextMode: Mode) {
    if (nextMode === "transition") {
      setEngine("wan27");
      if (resolution === "480p") setResolution("1080p");
    }
    setMode(nextMode);
  }

  return <main>
    <header className="topbar"><a className="brand" href="/admin"><span className="brand-mark">MW</span><span>MOTIONWREN</span></a><div className="studio-nav"><a href="/admin"><Icon name="dashboard" size={15}/>Owner</a><a href="/dashboard"><Icon name="projects" size={15}/>Clients</a><div className="model-pill"><span className="dot" /> Studio</div></div></header>
    {connected === false && <section className="connect-bar"><div><strong>Connect Replicate to generate</strong><span>Your token is stored in a secure, private browser cookie and is never displayed again.</span></div><div className="token-form"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="r8_••••••••••••••••••••" autoComplete="off" /><button onClick={connectReplicate} disabled={savingToken || !token}>{savingToken ? "Connecting…" : "Connect"}</button></div>{tokenError && <p className="token-error">{tokenError}</p>}</section>}
    {connected === true && <div className="connected-bar"><span><i /> Replicate connected</span><button onClick={async () => { await fetch("/api/token", { method: "DELETE" }); setConnected(false); }}>Disconnect</button></div>}
    <section className="hero"><p className="eyebrow">VIDEO STUDIO</p><h1>{mode === "single" ? "Create a polished property video." : mode === "series" ? "Create a complete property sequence." : mode === "transition" ? "Move smoothly between your frames." : mode === "extend" ? "Continue your existing scene." : mode === "upscale" ? "Finish your video at a higher resolution." : "Your saved videos."}</h1><p className="subhead">Upload your images, choose a style, and generate.</p></section>
    <div className="mode-switch"><button className={mode === "single" ? "active" : ""} onClick={() => selectMode("single")}><strong>Single shot</strong><small>One image</small></button><button className={mode === "series" ? "active" : ""} onClick={() => selectMode("series")}><strong>Multi-shot series</strong><small>Several images</small></button><button className={mode === "transition" ? "active" : ""} onClick={() => selectMode("transition")}><strong>Frame transition</strong><small>Exact keyframes</small></button><button className={mode === "extend" ? "active" : ""} onClick={() => selectMode("extend")}><strong>Extend scene</strong><small>Continue a clip</small></button><button className={mode === "upscale" ? "active" : ""} onClick={() => selectMode("upscale")}><strong>Upscale</strong><small>Higher resolution</small></button><button className={mode === "history" ? "active" : ""} onClick={() => { selectMode("history"); loadHistory(); }}><strong>History</strong><small>Saved videos</small></button></div>
    {!(["upscale", "history"] as Mode[]).includes(mode) && <div className="mobile-generation-bar"><div><Icon name="quality" size={18}/><span>Engine</span></div><select aria-label="Video generation engine" value={engine} onChange={(event) => { const next = event.target.value as EngineKey; setEngine(next); const nextEngine = studioEngine(next); if (!nextEngine.resolutions.includes(resolution)) setResolution(nextEngine.resolutions[nextEngine.resolutions.length - 1]); }}>{studioEngines.map((item) => <option key={item.key} value={item.key}>{item.shortName}</option>)}</select><a href="#generation-settings">Details</a></div>}
    {mode === "single" ? <section className="workspace">
      <div className="panel source-panel"><Heading number="01" title="Source image" note="The first frame of your shot"/><button className={`dropzone ${source ? "has-image" : ""}`} onClick={() => inputRef.current?.click()} onDrop={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); acceptFile(e.dataTransfer.files[0]); }} onDragOver={(e) => e.preventDefault()}>{source ? <><img src={source} alt="Uploaded source preview" /><span className="replace">Replace image</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Drop an image here</strong><small>or click to browse · JPG, PNG, WebP · 20 MB max</small></div>}</button><input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e: ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0])}/>{fileName && <div className="file-row"><span>{fileName}</span><button onClick={() => { setSource(""); setFileName(""); setOutput(""); }}>Remove</button></div>}</div>
      <DirectionPanel motion={motion} setMotion={setMotion} category={category} setCategory={setCategory} speed={speed} setSpeed={setSpeed} aspect={aspect} setAspect={setAspect} engine={engine} setEngine={setEngine} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} soundDirection={soundDirection} setSoundDirection={setSoundDirection} voiceoverEnabled={voiceoverEnabled} setVoiceoverEnabled={setVoiceoverEnabled} voiceoverText={voiceoverText} setVoiceoverText={setVoiceoverText} connected={connected} details={details} setDetails={setDetails} resolution={resolution} setResolution={setResolution} frames={frames} setFrames={setFrames} seed={seed} setSeed={setSeed} branding={brandingProps} showMotion/>
      <div className="panel output-panel"><Heading number="03" title="Generate" note="Review before your final edit"/><div className="output-stage">{output ? <video src={output} controls autoPlay loop playsInline/> : <div className="empty-output"><span>▶</span><strong>Your clip will appear here</strong><small>Successful clips are saved automatically to History.</small></div>}{["preparing", "starting", "processing", "finishing"].includes(status) && <div className="processing"><span className="spinner"/><strong>{status === "preparing" ? "Preparing image" : status === "starting" ? "Starting generation" : status === "finishing" ? "Adding smooth listing overlays" : "Generating video"}</strong><small>{status === "finishing" ? "Burning the opening and closing cards into your video." : "This can take one to three minutes."}</small></div>}</div>{error && <div className="error">{error}</div>}<button className="generate" onClick={generate} disabled={!connected || !source || ["preparing", "starting", "processing", "finishing"].includes(status)}>{!connected ? "Connect Replicate first" : status === "finishing" ? "Finishing overlays…" : status === "starting" || status === "processing" ? "Generating…" : "Generate clip"}<span>→</span></button>{output && <a className="download" href={output.startsWith("blob:") ? output : `/api/download?url=${encodeURIComponent(output)}&name=motionwren-video.mp4`} download={output.startsWith("blob:") ? `motionwren-listing.${outputFormat}` : undefined}>Download {outputFormat.toUpperCase()} directly</a>}{historyMessage && <p className="history-message">{historyMessage}</p>}<div className="cost-line"><span>Estimated generation cost</span><strong>${price.toFixed(2)} per video</strong></div></div>
    </section> : mode === "series" ? <section className="series-area">
      <div className="series-methods">
        <button className={seriesPromptMode === "scene" ? "active recommended" : ""} onClick={() => setSeriesPromptMode("scene")} disabled={seriesGenerating}>
          <span>PROFESSIONAL · RECOMMENDED</span><strong>One prompt per scene</strong><small>Direct every shot independently for the highest control and quality.</small>
        </button>
        <button className={seriesPromptMode === "shared" ? "active" : ""} onClick={() => setSeriesPromptMode("shared")} disabled={seriesGenerating}>
          <span>QUICK SERIES</span><strong>One prompt, multiple images</strong><small>Apply the same direction to every image in the sequence.</small>
        </button>
      </div>
      <div className="series-setup-bar"><label><span className="label">Shot type</span><select value={category} onChange={(event) => setCategory(event.target.value as keyof typeof qualityPrompts)} disabled={seriesGenerating}><option value="interior">Real estate</option><option value="people">Lifestyle</option></select></label><div className="series-timing-readout"><span className="label">Scene timing</span><strong>{secondsPerImage === "auto" ? `Automatic · ${effectiveSecondsPerImage}s per image` : `${effectiveSecondsPerImage} seconds per image`}</strong><small>Controlled from Owner Dashboard</small></div><div className="stability-badge"><span>✓</span><div><strong>Stability lock on</strong><small>Smooth camera motion, fixed geometry and no unwanted object movement.</small></div></div>{seriesAudioRequested && <div className="stability-badge"><span>♫</span><div><strong>One master soundtrack</strong><small>Music is carried across the complete edit instead of changing per scene.</small></div></div>}</div>
      {category === "interior" && <div className="panel series-listing-panel"><Heading number="RE" title="Real Estate listing details" note="Optional opening property information and closing agent card"/><RealEstateBrandingPanel {...brandingProps}/></div>}
      <div className="series-workspace">
        <div className="panel series-source">
          <Heading number="01" title={seriesPromptMode === "scene" ? "Build your scenes" : "Add your shot images"} note={seriesPromptMode === "scene" ? "Each scene gets its own image, prompt and movement" : "One direction will be applied to every image"}/>
          {seriesPromptMode === "scene" ? <>
            <div className="scene-stack">{shots.map((shot, index) => <article className="scene-card" key={shot.id}>
              <div className="scene-number"><span>SCENE</span><strong>{String(index + 1).padStart(2, "0")}</strong><em>REORDER</em><div><button onClick={() => moveShot(index, -1)} disabled={index === 0 || seriesGenerating} aria-label="Move scene earlier" title="Move scene earlier">↑</button><button onClick={() => moveShot(index, 1)} disabled={index === shots.length - 1 || seriesGenerating} aria-label="Move scene later" title="Move scene later">↓</button></div></div>
              <label className={`scene-image ${shot.source ? "filled" : ""}`} htmlFor={`scene-file-${shot.id}`}>{shot.source ? <img src={shot.source} alt={`Scene ${index + 1}`}/> : <><span>＋</span><small>Add image</small></>}</label>
              <input id={`scene-file-${shot.id}`} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => acceptSceneFile(shot.id, e.target.files?.[0])}/>
              <div className="scene-direction">
                {category === "interior" ? <div className="real-estate-scene-lock"><strong>Single-shot Real Estate preset baked in</strong><span>The same camera-only, motionless-property prompt is applied here, plus the stronger multi-shot stability and continuity lock.</span></div> : <><PromptDirector compact targetId={`scene-prompt-${shot.id}`} category={category} motion={shot.motion} speed={speed} aspect={aspect} soundEnabled={soundEnabled && selectedEngine.audio} soundDirection={soundDirection} connected={connected} setDetails={(prompt) => updateShot(shot.id, { prompt })}/><label><span className="label">Scene prompt</span><DictationTextarea id={`scene-prompt-${shot.id}`} rows={4} value={shot.prompt} onValue={(prompt) => updateShot(shot.id, { prompt })} placeholder="Describe the natural action, mood and camera movement for this lifestyle scene." disabled={seriesGenerating} ariaLabel={`Scene ${index + 1} prompt`}/></label></>}
                <div className="scene-controls"><label><span className="label">Camera movement</span><select value={shot.motion} onChange={(e) => updateShot(shot.id, { motion: e.target.value as MotionKey })} disabled={seriesGenerating}>{motions.filter((item) => item.key !== "custom").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><div className="scene-file-name"><span>IMAGE</span><strong>{shot.name}</strong></div></div>
                {shot.status !== "idle" && <small className={`shot-status ${shot.status}`}>{shot.status === "succeeded" ? "Ready to download" : shot.status === "failed" ? shot.error : shot.status === "starting" ? "Starting…" : shot.status === "finishing" ? "Applying overlays…" : "Generating…"}</small>}
              </div>
              <button className="remove-scene" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))} disabled={seriesGenerating} aria-label={`Remove scene ${index + 1}`}>×</button>
            </article>)}</div>
            <button className="add-scene" onClick={addScene} disabled={seriesGenerating || shots.length >= 12}><span>＋</span>{shots.length ? "Add another scene" : "Add your first scene"}</button>
          </> : <>
            <button className="series-dropzone" onClick={() => seriesInputRef.current?.click()} onDrop={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); acceptSeriesFiles(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()} disabled={seriesGenerating || shots.length >= 12}><span className="upload-icon">＋</span><strong>{shots.length ? "Add more images" : "Select all images for your sequence"}</strong><small>Up to 12 · each image becomes one scene in the finished video</small></button>
            <input ref={seriesInputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files && acceptSeriesFiles(e.target.files)}/>
            {category === "interior" ? <div className="real-estate-scene-lock shared-prompt"><strong>Single-shot Real Estate preset baked into every image</strong><span>Each scene receives the same motionless-property rules, its selected camera movement, and the stronger multi-shot stability and continuity lock.</span></div> : <><PromptDirector targetId="shared-direction-details" category={category} motion="mixed" speed={speed} aspect={aspect} soundEnabled={soundEnabled && selectedEngine.audio} soundDirection={soundDirection} connected={connected} setDetails={setDetails}/><label className="shared-prompt"><span className="label">Prompt for every image</span><DictationTextarea id="shared-direction-details" rows={6} value={details} onValue={setDetails} placeholder="Describe the action and visual direction that should apply to all images." ariaLabel="Prompt for every image"/></label></>}
            <div className="shot-list">{shots.map((shot, index) => <article className="shot-card" key={shot.id}><div className="shot-thumb"><img src={shot.source} alt=""/><span>{String(index + 1).padStart(2, "0")}</span></div><div className="shot-info"><strong>{shot.name}</strong><label><span>Camera movement</span><select value={shot.motion} onChange={(e) => updateShot(shot.id, { motion: e.target.value as MotionKey })} disabled={seriesGenerating}>{motions.filter((item) => item.key !== "custom").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>{shot.status !== "idle" && <small className={`shot-status ${shot.status}`}>{shot.status === "succeeded" ? "Ready" : shot.status === "failed" ? shot.error : shot.status === "starting" ? "Starting…" : shot.status === "finishing" ? "Finishing…" : "Generating…"}</small>}</div><div className="shot-order"><span>ORDER</span><div><button onClick={() => moveShot(index, -1)} disabled={index === 0 || seriesGenerating} aria-label="Move scene earlier" title="Move scene earlier">↑</button><button onClick={() => moveShot(index, 1)} disabled={index === shots.length - 1 || seriesGenerating} aria-label="Move scene later" title="Move scene later">↓</button></div><button className="remove-shot" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))} disabled={seriesGenerating} aria-label={`Remove scene ${index + 1}`}>×</button></div></article>)}</div>
          </>}
        </div>
        <div className="panel quality-panel"><Heading number="02" title="Production settings" note="Only the controls that affect the final result"/>
          <div className="quality-callout"><strong>Recommended setup</strong><p>Kling 3.0 · 1080p · restrained camera movement.</p><button onClick={() => { setEngine("kling3"); setResolution("1080p"); setSeriesPromptMode("scene"); }}>Apply</button></div>
          <EngineSelector engine={engine} setEngine={setEngine} resolution={resolution} setResolution={setResolution}/>
          <VisualStyleControl aspect={aspect} setAspect={setAspect}/><FrameControl aspect={aspect} setAspect={setAspect}/>
          <label className="series-quality-field"><span className="label">Quality</span><select value={resolution} onChange={(e) => setResolution(e.target.value as ResolutionKey)}>{selectedEngine.resolutions.map((item) => <option value={item} key={item}>{item === "1080p" ? "1080p Full HD" : item === "720p" ? "720p HD" : "480p draft"}</option>)}</select><small className="quality-price">Estimated engine cost: ${seriesCost.toFixed(2)} for the full sequence</small></label>
          {effectiveSecondsPerImage !== requestedSecondsPerImage && <div className="quality-callout"><strong>{selectedEngine.shortName} uses {effectiveSecondsPerImage}-second scenes at {resolution}.</strong><p>Your {requestedSecondsPerImage}-second preference was adjusted automatically so the provider does not reject or silently change the generation.</p></div>}
          {category === "interior" && <div className="real-estate-lock"><strong>Camera-only movement is locked on</strong><span>All property objects and environmental elements remain completely still in every scene.</span></div>}
          <SpeedControl speed={speed} setSpeed={setSpeed}/>
          {selectedEngine.audio && <div className="sound-card"><button className={soundEnabled ? "sound-toggle active" : "sound-toggle"} onClick={() => setSoundEnabled(!soundEnabled)}><span><strong>Music & sound effects</strong><small>Generated and synchronized with the video</small></span><i>{soundEnabled ? "ON" : "OFF"}</i></button>{soundEnabled && <label><span className="label">Sound direction</span><DictationTextarea rows={3} value={soundDirection} onValue={setSoundDirection} ariaLabel="Sound direction"/></label>}<button className={voiceoverEnabled ? "sound-toggle active voiceover-toggle" : "sound-toggle voiceover-toggle"} onClick={() => setVoiceoverEnabled(!voiceoverEnabled)}><span><strong>Voiceover</strong><small>Add spoken narration to the generated video</small></span><i>{voiceoverEnabled ? "ON" : "OFF"}</i></button>{voiceoverEnabled && <label><span className="label">Voiceover script</span><DictationTextarea rows={4} value={voiceoverText} onValue={setVoiceoverText} placeholder="Type or dictate exactly what the narrator should say." ariaLabel="Voiceover script"/></label>}</div>}
          <details><summary>Advanced controls</summary><div className="field-row advanced"><label><span className="label">Continuity direction</span><DictationTextarea rows={4} value={continuity} onValue={setContinuity} placeholder="What must remain visually consistent across all scenes?" ariaLabel="Continuity direction"/></label><label><span className="label">Seed</span><input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Random" inputMode="numeric"/></label></div></details>
        </div>
        <div className="panel series-output"><Heading number="03" title="Generate the series" note={`Creates one finished ${stitchedDuration}-second video`}/><div className="series-summary"><div><span>Length</span><strong>{stitchedDuration}s</strong></div><div><span>Scenes</span><strong>{completedShots}/{shots.length}</strong></div><div><span>Engine cost</span><strong>${seriesCost.toFixed(2)}</strong></div></div>{seriesGenerating && <div className="queue-progress" role="status" aria-live="polite"><strong>{seriesCanceling ? "Stopping active scenes…" : `${activeShots} generating · ${completedShots} ready`}</strong><span>Elapsed {Math.floor(seriesElapsed / 60)}:{String(seriesElapsed % 60).padStart(2, "0")} · each scene stops automatically after 8 minutes</span></div>}{error && <div className="error">{error}</div>}<div className="series-actions"><button className="generate" onClick={() => generateSeries(false)} disabled={!connected || shots.length < 2 || seriesGenerating || status === "preparing"}>{!connected ? "Connect Replicate first" : stitching ? "Finishing the video…" : seriesGenerating ? `${completedShots} of ${shots.length} ready · ${activeShots} generating` : `Generate ${stitchedDuration}-second video`}<span>→</span></button>{seriesGenerating && <button type="button" className="cancel-series" onClick={stopSeries} disabled={seriesCanceling}>{seriesCanceling ? "Stopping…" : "Stop generation"}</button>}{!seriesGenerating && failedShots > 0 && <button type="button" className="retry-series" onClick={() => generateSeries(true)}>Retry {failedShots} failed scene{failedShots === 1 ? "" : "s"}</button>}</div>{historyMessage && <p className="history-message">{historyMessage}</p>}<p className="queue-note">Two scenes process at once. Completed scenes are kept if another fails. The final MP4 is joined on the server with true one-second crossfades and saved to History.</p><div className="stitched-result"><span className="label">FINAL VIDEO</span>{stitchedOutput ? <><video src={stitchedOutput} controls playsInline/><a className="download" href={stitchedOutput} download={`motionwren-full-series.${stitchedFormat}`}>Download complete {stitchedFormat.toUpperCase()}</a></> : <><strong>{stitching ? "Adding crossfades and assembling your video…" : "Your combined video will appear here"}</strong><small>Scenes stay in your chosen order and are joined with a smooth visual overlap.</small>{completedShots === shots.length && shots.length > 1 && !seriesGenerating && <button type="button" className="stitch-button" onClick={() => finishSeries()} disabled={stitching}>{stitching ? "Finishing…" : "Stitch full video"}</button>}</>}{stitchError && <p className="error">{stitchError}</p>}</div><details className="individual-clips"><summary>Individual scene downloads</summary><div className="series-results">{shots.filter((shot) => shot.output).map((shot, index) => <article key={shot.id}><video src={shot.output} controls loop playsInline/><div><strong>Scene {index + 1} · {shot.name}</strong><a href={shot.output.startsWith("blob:") ? shot.output : `/api/download?url=${encodeURIComponent(shot.output)}&name=motionwren-scene-${index + 1}.mp4`} download={shot.output.startsWith("blob:") ? `motionwren-scene-${index + 1}.${shot.outputFormat || "webm"}` : undefined}>Download {(shot.outputFormat || "mp4").toUpperCase()}</a></div></article>)}</div></details></div>
      </div>
    </section> : mode === "extend" ? <section className="workspace extension-workspace">
      <div className="panel source-panel"><Heading number="01" title="Clip to extend" note="We use its exact final frame"/><button className={`dropzone ${extendPreview ? "has-image" : ""}`} onClick={() => extendInputRef.current?.click()}>{extendPreview ? <><video src={extendPreview} controls playsInline/><span className="replace">Replace clip</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Upload the previous clip</strong><small>MP4, MOV or WebM · 100 MB max</small></div>}</button><input ref={extendInputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => acceptExtensionFile(e.target.files?.[0])}/>{extendName && <div className="file-row"><span>{extendName}</span><button onClick={() => { if (extendPreview) URL.revokeObjectURL(extendPreview); setExtendPreview(""); setExtendSource(""); setExtendName(""); setExtendOutput(""); }}>Remove</button></div>}</div>
      <DirectionPanel motion={motion} setMotion={setMotion} category={category} setCategory={setCategory} speed={speed} setSpeed={setSpeed} aspect={aspect} setAspect={setAspect} engine={engine} setEngine={setEngine} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} soundDirection={soundDirection} setSoundDirection={setSoundDirection} voiceoverEnabled={voiceoverEnabled} setVoiceoverEnabled={setVoiceoverEnabled} voiceoverText={voiceoverText} setVoiceoverText={setVoiceoverText} connected={connected} details={details} setDetails={setDetails} resolution={resolution} setResolution={setResolution} frames={frames} setFrames={setFrames} seed={seed} setSeed={setSeed} branding={brandingProps} showMotion/>
      <div className="panel output-panel"><Heading number="03" title="Generate extension" note="A new clip begins from the extracted final frame"/><div className="output-stage">{extendOutput ? <video src={extendOutput} controls autoPlay loop playsInline/> : extendSource ? <img className="extension-frame" src={extendSource} alt="Extracted final frame used for extension"/> : <div className="empty-output"><span>▶</span><strong>Your extended clip will appear here</strong><small>Upload a clip to prepare its final frame.</small></div>}{["preparing","starting","processing","finishing"].includes(status) && <div className="processing"><span className="spinner"/><strong>{status === "preparing" ? "Extracting final frame" : status === "starting" ? "Starting extension" : status === "finishing" ? "Adding smooth listing overlays" : "Extending scene"}</strong><small>{status === "finishing" ? "Burning the opening and closing cards into your video." : "This can take one to three minutes."}</small></div>}</div>{error && <div className="error">{error}</div>}<button className="generate" onClick={generateExtension} disabled={!connected || !extendSource || ["preparing","starting","processing","finishing"].includes(status)}>{!connected ? "Connect Replicate first" : status === "finishing" ? "Finishing overlays…" : status === "starting" || status === "processing" ? "Extending…" : "Extend scene"}<span>→</span></button>{extendOutput && <a className="download" href={extendOutput.startsWith("blob:") ? extendOutput : `/api/download?url=${encodeURIComponent(extendOutput)}&name=motionwren-extension.mp4`} download={extendOutput.startsWith("blob:") ? `motionwren-extension.${extendOutputFormat}` : undefined}>Download extension directly</a>}{historyMessage && <p className="history-message">{historyMessage}</p>}<div className="cost-line"><span>Estimated generation cost</span><strong>${price.toFixed(2)} per extension</strong></div></div>
    </section> : mode === "transition" ? <section className="transition-area">
      <div className="panel transition-frames"><Heading number="01" title="Build the frame path" note="Add frames in the exact order the camera should travel"/><div className="transition-frame-grid">
        <div><span className="transition-label">FIRST FRAME <b>START</b></span><button className={`dropzone transition-drop ${firstFrame ? "has-image" : ""}`} onClick={() => firstFrameInputRef.current?.click()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); acceptTransitionFrame("first", event.dataTransfer.files[0]); }} onDragOver={(event) => event.preventDefault()}>{firstFrame ? <><img src={firstFrame} alt="First frame preview"/><span className="replace">Replace first frame</span></> : <div className="drop-copy"><span className="upload-icon">1</span><strong>Drag first frame here</strong><small>or click to browse</small></div>}</button><input ref={firstFrameInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptTransitionFrame("first", event.target.files?.[0])}/>{firstFrameName && <div className="file-row"><span>{firstFrameName}</span><button onClick={() => { setFirstFrame(""); setFirstFrameName(""); setTransitionOutput(""); }}>Remove</button></div>}</div>
        <div className="transition-arrow" aria-hidden="true"><span>→</span><small>MOVE TO</small></div>
        {middleFrames.map((frame, index) => <div className="middle-frame-wrap" key={frame.id}><span className="transition-label">FRAME {index + 2} <b>KEYFRAME</b></span><label className={`dropzone transition-drop ${frame.source ? "has-image" : ""}`} htmlFor={`transition-frame-${frame.id}`} onDrop={(event) => { event.preventDefault(); acceptMiddleFrame(frame.id, event.dataTransfer.files[0]); }} onDragOver={(event) => event.preventDefault()}>{frame.source ? <><img src={frame.source} alt={`Transition frame ${index + 2}`}/><span className="replace">Replace frame</span></> : <div className="drop-copy"><span className="upload-icon">{index + 2}</span><strong>Drag frame here</strong><small>or click to browse</small></div>}</label><input id={`transition-frame-${frame.id}`} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptMiddleFrame(frame.id, event.target.files?.[0])}/><div className="keyframe-actions"><button onClick={() => moveMiddleFrame(index, -1)} disabled={index === 0}>← Earlier</button><button onClick={() => moveMiddleFrame(index, 1)} disabled={index === middleFrames.length - 1}>Later →</button><button onClick={() => { setMiddleFrames((current) => current.filter((item) => item.id !== frame.id)); setTransitionOutput(""); }}>Remove</button></div></div>)}
        {middleFrames.length > 0 && <div className="transition-arrow" aria-hidden="true"><span>→</span><small>MOVE TO</small></div>}
        <div><span className="transition-label">LAST FRAME <b>FINISH</b></span><button className={`dropzone transition-drop ${lastFrame ? "has-image" : ""}`} onClick={() => lastFrameInputRef.current?.click()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); acceptTransitionFrame("last", event.dataTransfer.files[0]); }} onDragOver={(event) => event.preventDefault()}>{lastFrame ? <><img src={lastFrame} alt="Last frame preview"/><span className="replace">Replace last frame</span></> : <div className="drop-copy"><span className="upload-icon">2</span><strong>Drag last frame here</strong><small>or click to browse</small></div>}</button><input ref={lastFrameInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptTransitionFrame("last", event.target.files?.[0])}/>{lastFrameName && <div className="file-row"><span>{lastFrameName}</span><button onClick={() => { setLastFrame(""); setLastFrameName(""); setTransitionOutput(""); }}>Remove</button></div>}</div>
      </div><button className="add-keyframe" onClick={addMiddleFrame} disabled={middleFrames.length >= 6 || ["preparing","starting","processing","finishing"].includes(transitionStatus)}>+ Add another frame</button><p className="transition-help">Each numbered frame becomes a strict destination. Only the camera may move between frames. Subjects and objects stay rigid and untouched—no hands, invented action, morphing, or added elements. Use frames from the same real space with a believable camera path.</p><div className="series-methods transition-methods"><button className={transitionMode === "ai" ? "active recommended" : ""} onClick={() => setTransitionMode("ai")} disabled={Boolean(activeTransitionJob)}><span>REALISTIC CAMERA PATH</span><strong>Natural AI movement</strong><small>Uses true first-and-last-frame control for related views of the same scene.</small></button><button className={transitionMode === "clean" ? "active" : ""} onClick={() => setTransitionMode("clean")} disabled={Boolean(activeTransitionJob)}><span>NO INVENTED ACTION</span><strong>Guaranteed clean dissolve</strong><small>Best for unrelated images. Nothing is generated, touched, morphed, or moved.</small></button></div></div>
      <DirectionPanel motion={motion} setMotion={setMotion} category={category} setCategory={setCategory} speed={speed} setSpeed={setSpeed} aspect={aspect} setAspect={setAspect} engine={engine} setEngine={setEngine} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} soundDirection={soundDirection} setSoundDirection={setSoundDirection} voiceoverEnabled={voiceoverEnabled} setVoiceoverEnabled={setVoiceoverEnabled} voiceoverText={voiceoverText} setVoiceoverText={setVoiceoverText} connected={connected} details={details} setDetails={setDetails} resolution={resolution} setResolution={setResolution} frames={frames} setFrames={setFrames} seed={seed} setSeed={setSeed} branding={brandingProps} showMotion/>
      <div className="panel output-panel"><Heading number="03" title="Generate transitions" note="Every frame is treated as an exact destination"/><div className="output-stage">{transitionOutput ? <video src={transitionOutput} controls autoPlay loop playsInline/> : <div className="empty-output"><span>1 → 2 → 3</span><strong>Your multi-frame video will appear here</strong><small>Add frames in order. Every adjacent pair becomes one controlled transition.</small></div>}{["preparing","starting","processing","finishing"].includes(transitionStatus) && <div className="processing"><span className="spinner"/><strong>{transitionStatus === "preparing" ? "Preparing frames" : transitionStatus === "starting" ? "Starting transition sequence" : transitionStatus === "finishing" ? "Joining and saving on the server" : transitionMode === "clean" ? "Creating a clean dissolve" : "Generating strict frame transitions"}</strong><small>{transitionProgress || "Your job is saved and will resume after a refresh."}</small></div>}</div>{transitionError && <div className="error">{transitionError}</div>}<button className="generate" onClick={generateTransition} disabled={!connected || !firstFrame || !lastFrame || middleFrames.some((frame) => !frame.source) || ["preparing","starting","processing","finishing"].includes(transitionStatus)}>{!connected ? "Connect Replicate first" : ["starting","processing","finishing"].includes(transitionStatus) ? transitionProgress || "Generating transitions…" : transitionMode === "clean" ? `Create clean ${middleFrames.length + 2}-frame dissolve` : `Generate ${middleFrames.length + 2}-frame sequence`}<span>→</span></button>{activeTransitionJob && <button type="button" className="cancel-series" onClick={stopTransition}>Stop generation</button>}{transitionOutput && <a className="download" href={transitionOutput} download>Download MP4 directly</a>}{historyMessage && <p className="history-message">{historyMessage}</p>}<div className="cost-line"><span>Estimated generation cost</span><strong>{transitionMode === "clean" ? "Less than $0.01 processing" : `$${(((middleFrames.length + 1) * (frames === 121 ? 10 : 5) * .15)).toFixed(2)} total · ${middleFrames.length + 1} transition${middleFrames.length === 0 ? "" : "s"}`}</strong></div></div>
    </section> : mode === "history" ? <section className="history-area" aria-live="polite">
      <div className="history-heading"><div><span className="label">PRIVATE VIDEO MEMORY</span><h2>Generation history</h2><p>Successful videos are saved here for this browser, with their prompt, settings and estimated generation cost.</p></div><button onClick={loadHistory} disabled={historyLoading}>{historyLoading ? "Refreshing…" : "Refresh"}</button></div>
      {historyMessage && <p className="history-message history-wide">{historyMessage}</p>}
      {historyLoading ? <div className="history-empty">Loading saved videos…</div> : history.length ? <div className="history-grid">{history.map((item) => <article className="history-card" key={item.id}><video src={item.videoUrl} controls preload="metadata" playsInline/><div className="history-card-body"><div className="history-meta"><span>{item.engine === "fast" ? "Wan 2.2 Fast" : item.engine === "studio" ? "Wan 2.5" : studioEngines.find((candidate) => candidate.key === item.engine)?.name || item.engine}</span><span>{item.resolution}</span><span>{item.aspect}</span><span>{item.duration}s</span></div><p>{item.prompt}</p><div className="history-card-footer"><div><strong>${(item.costCents / 100).toFixed(2)}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><div><a href={item.downloadUrl}>Download</a><button onClick={() => removeHistoryItem(item.id)}>Remove</button></div></div></div></article>)}</div> : <div className="history-empty"><strong>No saved videos yet.</strong><span>Your next successful generation will appear here automatically.</span></div>}
    </section> : <section className="workspace upscale-workspace">
      <div className="panel source-panel"><Heading number="01" title="Video to upscale" note="Short clips work best"/><button className={`dropzone ${upscalePreview ? "has-image" : ""}`} onClick={() => upscaleInputRef.current?.click()}>{upscalePreview ? <><video src={upscalePreview} controls playsInline/><span className="replace">Replace video</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Upload a finished video</strong><small>MP4, MOV or WebM · 20 MB max</small></div>}</button><input ref={upscaleInputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => acceptUpscaleFile(event.target.files?.[0])}/>{upscaleName && <div className="file-row"><span>{upscaleName}{upscaleDuration ? ` · ${upscaleDuration.toFixed(1)}s` : ""}</span><button onClick={() => { if (upscalePreview) URL.revokeObjectURL(upscalePreview); setUpscalePreview(""); setUpscaleSource(""); setUpscaleName(""); setUpscaleOutput(""); }}>Remove</button></div>}</div>
      <div className="panel upscale-controls"><Heading number="02" title="Choose the finish" note="Upscaling improves resolution, not the original composition"/><div className="segmented-control"><span className="label">Target resolution</span><div><button className={upscaleTarget === "1080p" ? "active" : ""} onClick={() => setUpscaleTarget("1080p")}><strong>1080p</strong><small>Best value</small></button><button className={upscaleTarget === "4k" ? "active" : ""} onClick={() => setUpscaleTarget("4k")}><strong>4K</strong><small>Maximum detail</small></button></div></div><div className="segmented-control"><span className="label">Frame rate</span><div><button className={upscaleFps === 30 ? "active" : ""} onClick={() => setUpscaleFps(30)}><strong>30 FPS</strong><small>Natural</small></button><button className={upscaleFps === 60 ? "active" : ""} onClick={() => setUpscaleFps(60)}><strong>60 FPS</strong><small>Smoother</small></button></div></div><div className="upscale-cost"><span>Approximate processing cost</span><strong>{upscaleDuration ? `$${((upscaleDuration / 5) * .747).toFixed(2)}` : "$0.75 per 5 seconds"}</strong><small>Actual processing cost varies with input and output settings.</small></div><p className="upscale-note">Use 1080p for most web and social delivery. Choose 4K only when you need the extra resolution.</p></div>
      <div className="panel output-panel"><Heading number="03" title="Upscaled video" note="Compare, review and download"/><div className="output-stage">{upscaleOutput ? <video src={upscaleOutput} controls autoPlay loop playsInline/> : <div className="empty-output"><span>◇</span><strong>Your enhanced video will appear here</strong><small>Upload a clip and choose the target quality.</small></div>}{["preparing","starting","processing"].includes(upscaleStatus) && <div className="processing"><span className="spinner"/><strong>{upscaleStatus === "preparing" ? "Preparing video" : upscaleStatus === "starting" ? "Starting enhancement" : "Upscaling video"}</strong><small>Higher resolutions can take several minutes.</small></div>}</div>{upscaleError && <div className="error">{upscaleError}</div>}<button className="generate" onClick={upscaleVideo} disabled={!connected || !upscaleSource || ["preparing","starting","processing"].includes(upscaleStatus)}>{!connected ? "Connect Replicate first" : upscaleStatus === "starting" || upscaleStatus === "processing" ? "Upscaling…" : `Upscale to ${upscaleTarget === "4k" ? "4K" : "1080p"}`}<span>→</span></button>{upscaleOutput && <a className="download" href={`/api/download?url=${encodeURIComponent(upscaleOutput)}&name=motionwren-upscaled-${upscaleTarget}.mp4`}>Download upscaled MP4</a>}</div>
    </section>}
    {mode === "single" && <section className="prompt-strip"><div><span className="label">Final prompt sent to the video engine</span><p>{finalPrompt}</p></div><button onClick={() => navigator.clipboard.writeText(finalPrompt)}>Copy</button></section>}
    <footer><span>MOTIONWREN</span><p>Your token remains private. Successful generations are saved to your private History.</p></footer>
  </main>;
}

function Heading({ number, title, note }: { number: string; title: string; note: string }) { return <div className="panel-heading"><span>{number}</span><div><h2>{title}</h2><p>{note}</p></div></div>; }
type ResolutionKey = StudioResolution;
type DirectionProps = { motion: MotionKey; setMotion: (v: MotionKey) => void; category: keyof typeof qualityPrompts; setCategory: (v: keyof typeof qualityPrompts) => void; speed: SpeedKey; setSpeed: (v: SpeedKey) => void; aspect: AspectKey; setAspect: (v: AspectKey) => void; engine: EngineKey; setEngine: (v: EngineKey) => void; soundEnabled: boolean; setSoundEnabled: (v: boolean) => void; soundDirection: string; setSoundDirection: (v: string) => void; voiceoverEnabled: boolean; setVoiceoverEnabled: (v: boolean) => void; voiceoverText: string; setVoiceoverText: (v: string) => void; connected: boolean | null; details: string; setDetails: (v: string) => void; resolution: ResolutionKey; setResolution: (v: ResolutionKey) => void; frames: 81 | 121; setFrames: (v: 81 | 121) => void; seed: string; setSeed: (v: string) => void; branding: RealEstateBrandingProps; showMotion: boolean };

function SpeedControl({ speed, setSpeed }: { speed: SpeedKey; setSpeed: (v: SpeedKey) => void }) { return <div className="segmented-control"><span className="label">Motion speed</span><div>{(["slow","medium","fast"] as SpeedKey[]).map((item) => <button key={item} className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}><strong>{item}</strong><small>{item === "slow" ? "Cinematic" : item === "medium" ? "Natural" : "Energetic"}</small></button>)}</div></div>; }
function FrameControl({ aspect, setAspect }: { aspect: AspectKey; setAspect: (v: AspectKey) => void }) { const options: Array<[AspectKey,string,string]> = [["horizontal","16:9","Horizontal"],["vertical","9:16","Social"],["cinematic","2.39","Crop-safe"]]; return <div className="segmented-control frame-control"><span className="label">Frame size</span><div>{options.map(([key,ratio,note]) => <button key={key} className={aspect === key ? "active" : ""} onClick={() => setAspect(key)}><strong>{ratio}</strong><small>{note}</small></button>)}</div>{aspect === "cinematic" && <p>Important action stays safe for a wide 2.39:1 cinematic crop.</p>}</div>; }

function VisualStyleControl({ aspect, setAspect }: { aspect: AspectKey; setAspect: (v: AspectKey) => void }) { return <div className="visual-style-control"><div className="choice-heading"><span className="label">Video style</span><strong>Choose the feel</strong></div><div>{visualStyles.map((item) => <button type="button" key={item.key} className={aspect === item.key ? "active" : ""} onClick={() => setAspect(item.key)} aria-pressed={aspect === item.key}><Icon name={item.icon} size={20}/><span><strong>{item.label}</strong><small>{item.note}</small></span></button>)}</div></div>; }

function EngineSelector({ engine, setEngine, resolution, setResolution }: { engine: EngineKey; setEngine: (value: EngineKey) => void; resolution: ResolutionKey; setResolution: (value: ResolutionKey) => void }) {
  function choose(next: EngineKey) {
    setEngine(next);
    const available = studioEngine(next).resolutions;
    if (!available.includes(resolution)) setResolution(available[available.length - 1]);
  }
  const selected = studioEngine(engine);
  return <section className="studio-engine-selector" id="generation-settings">
    <div className="engine-selector-heading"><div><span className="label">ENGINE · OWNER ONLY</span><strong>Generation model</strong></div></div>
    <label className="engine-select"><select value={engine} onChange={(event) => choose(event.target.value as EngineKey)} aria-label="Actual generation engine">{studioEngines.map((item) => <option key={item.key} value={item.key}>{item.name}{item.badge ? ` · ${item.badge}` : ""}</option>)}</select></label>
    <div className="engine-model-grid" aria-label="Available generation engines">{studioEngines.map((item) => <button type="button" key={item.key} className={item.key === engine ? "engine-model active" : "engine-model"} onClick={() => choose(item.key)} aria-pressed={item.key === engine}><span><strong>{item.shortName}</strong>{item.badge && <em>{item.badge}</em>}</span><p>{item.description}</p><div><small>{item.resolutions.join(" · ")}</small><small>{item.audio ? "Native audio" : "Video only"}</small></div><b>{item.bestFor}</b></button>)}</div>
    <div className="selected-engine-summary"><div><strong>{selected.shortName}</strong>{selected.badge && <em>{selected.badge}</em>}</div><p>{selected.description}</p><small>{selected.resolutions.join(" · ")} · {selected.audio ? "native audio" : "video only"} · {selected.bestFor}</small></div>
  </section>;
}

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResultLike> };
type RecognitionLike = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; onresult: ((event: RecognitionEventLike) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type RecognitionConstructor = new () => RecognitionLike;

function DictationTextarea({ value, onValue, rows = 4, placeholder, disabled, id, ariaLabel }: { value: string; onValue: (value: string) => void; rows?: number; placeholder?: string; disabled?: boolean; id?: string; ariaLabel?: string }) {
  const [listening, setListening] = useState(false); const [hint, setHint] = useState(""); const recognitionRef = useRef<RecognitionLike | null>(null);
  useEffect(() => () => recognitionRef.current?.stop(), []);
  function toggleDictation() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setHint("Voice dictation is not supported in this browser. You can still type normally."); return; }
    const recognition = new Recognition(); let committed = value.trim();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => { let interim = ""; let finalText = ""; for (let index = event.resultIndex; index < event.results.length; index += 1) { const text = event.results[index][0].transcript; if (event.results[index].isFinal) finalText += text; else interim += text; } if (finalText) committed = `${committed} ${finalText}`.trim(); onValue(`${committed} ${interim}`.trim()); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognition.onerror = () => { setListening(false); setHint("Voice dictation stopped. Tap the microphone to try again."); };
    recognitionRef.current = recognition; setHint("Listening… speak naturally, then tap the microphone to stop."); setListening(true); recognition.start();
  }
  return <div className="dictation-field"><textarea id={id} rows={rows} value={value} onChange={(event) => onValue(event.target.value)} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel}/><button type="button" className={listening ? "dictation-button listening" : "dictation-button"} onClick={toggleDictation} disabled={disabled} aria-label={listening ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={listening} title={listening ? "Stop dictation" : "Dictate with your microphone"}>🎤</button>{listening && <span className="listening-indicator"><i/> Listening—speak now</span>}{hint && !listening && <small className="dictation-hint">{hint}</small>}</div>;
}

function PromptDirector(props: Pick<DirectionProps,"category"|"motion"|"speed"|"aspect"|"soundEnabled"|"soundDirection"|"connected"|"setDetails"> & { compact?: boolean; targetId: string }) {
  const [vision, setVision] = useState(""); const [working, setWorking] = useState(false); const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  function revealPrompt() { const target = document.getElementById(props.targetId); target?.scrollIntoView({ behavior: "smooth", block: "center" }); window.setTimeout(() => target?.focus(), 450); }
  async function createPrompt() {
    if (vision.trim().length < 8) return setMessage("Describe your idea in a few words first.");
    setWorking(true); setMessage(""); setReady(false);
    try {
      const response = await fetch("/api/prompt", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ vision, category:props.category, motion:props.motion, speed:props.speed, aspect:props.aspect, sound:props.soundEnabled ? props.soundDirection : "none" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const result = data.status === "succeeded" ? data.prompt : await waitForPrompt(data.id);
      if (!result.trim()) throw new Error("The prompt director returned an empty result.");
      props.setDetails(cleanGeneratedPrompt(result)); setMessage("Your prompt is ready and has been transferred to the prompt field below."); setReady(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The prompt could not be created."); }
    finally { setWorking(false); }
  }
  return <div className={props.compact ? "prompt-director compact" : "prompt-director"}><div><span className="ai-badge">✦ AI CINEMATIC PROMPT BUILDER</span><strong>Speak or type your idea.</strong><p>{props.compact ? "Turn your scene idea into a professional generation prompt." : "Describe your vision in normal words. Your movement, speed, frame and sound settings are added automatically."}</p></div><DictationTextarea rows={props.compact ? 2 : 4} value={vision} onValue={setVision} ariaLabel="Describe your video idea" placeholder="Example: The camera slowly circles the subject while warm light reveals its texture. Keep the subject perfectly stable."/><button onClick={createPrompt} disabled={!props.connected || working || vision.trim().length < 8}>{working ? "Creating cinematic prompt…" : "Generate cinematic prompt"}<span>✦</span></button>{message && <small className={ready ? "prompt-ready-message" : ""}>{message}</small>}{ready && <button type="button" className="prompt-jump" onClick={revealPrompt}><span>↓</span> See your generated prompt</button>}</div>;
}

function RealEstateBrandingPanel(props: RealEstateBrandingProps) {
  return <section className="listing-overlays" aria-label="Real Estate listing overlays">
    <div className="overlay-heading"><span>LISTING OVERLAYS</span><strong>Property information and agent contact</strong><p>These are added after generation, so the text and logo stay sharp and do not interfere with the locked camera-only prompt.</p></div>
    <div className="overlay-option">
      <button type="button" className={props.listingEnabled ? "overlay-toggle active" : "overlay-toggle"} onClick={() => props.setListingEnabled(!props.listingEnabled)} aria-pressed={props.listingEnabled}><span><strong>Opening property information</strong><small>Fades in at the start, then dissolves smoothly.</small></span><i>{props.listingEnabled ? "ON" : "OFF"}</i></button>
      {props.listingEnabled && <div className="overlay-fields"><label><span className="label">Property name or address</span><input value={props.listingTitle} onChange={(event) => props.setListingTitle(event.target.value)} placeholder="21 Beacon Street, Boston"/></label><div className="listing-facts-grid"><label><span className="label">Beds</span><input inputMode="numeric" value={props.listingBeds} onChange={(event) => props.setListingBeds(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="3"/></label><label><span className="label">Baths</span><input inputMode="decimal" value={props.listingBaths} onChange={(event) => props.setListingBaths(formatBaths(event.target.value))} placeholder="2.5"/></label><label><span className="label">Square feet</span><input inputMode="numeric" value={props.listingSquareFeet} onChange={(event) => props.setListingSquareFeet(formatWholeNumber(event.target.value))} placeholder="2,140"/></label></div><div className="listing-price-grid"><label><span className="label">Price</span><input inputMode="numeric" value={props.listingPrice} onChange={(event) => props.setListingPrice(formatCurrency(event.target.value))} placeholder="$1,250,000"/></label><label><span className="label">Optional short message</span><input value={props.listingMessage} onChange={(event) => props.setListingMessage(event.target.value)} placeholder="Open house Sunday" maxLength={80}/></label></div></div>}
    </div>
    <div className="overlay-option">
      <button type="button" className={props.agentEnabled ? "overlay-toggle active" : "overlay-toggle"} onClick={() => props.setAgentEnabled(!props.agentEnabled)} aria-pressed={props.agentEnabled}><span><strong>Closing agent card</strong><small>Fades in over the final shot with your logo and contact information.</small></span><i>{props.agentEnabled ? "ON" : "OFF"}</i></button>
      {props.agentEnabled && <div className="overlay-fields"><label className="logo-upload"><span className="label">Agent or brokerage logo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => props.acceptAgentLogo(event.target.files?.[0])}/><span>{props.agentLogoName || "PNG, JPG or WebP · 5 MB max"}</span></label>{props.agentLogo && <div className="logo-preview"><img src={props.agentLogo} alt="Uploaded agent or brokerage logo preview"/><button type="button" onClick={props.removeAgentLogo}>Remove logo</button></div>}<div className="field-row"><label><span className="label">Agent name</span><input value={props.agentName} onChange={(event) => props.setAgentName(event.target.value)} placeholder="Jordan Lee"/></label><label><span className="label">Phone number</span><input type="tel" inputMode="tel" value={props.agentPhone} onChange={(event) => props.setAgentPhone(formatPhone(event.target.value))} placeholder="617-555-0142"/></label></div><label><span className="label">Email address</span><input type="email" value={props.agentEmail} onChange={(event) => props.setAgentEmail(event.target.value)} placeholder="jordan@realty.com"/></label></div>}
    </div>
    <p className="overlay-note">Single shots use both selected overlays. In a multi-shot series, the property information is added to the first clip and the agent card to the final clip.</p>
  </section>;
}

function DirectionPanel(props: DirectionProps) {
  const selected = studioEngine(props.engine);
  const estimatedCost = estimateCost(props.engine, props.resolution, props.frames);
  return <div className="panel direction-panel"><Heading number="02" title={`Direct the ${props.showMotion ? "shot" : "series"}`} note={props.motion === "mixed" ? "AI will choose the best movement combination" : "One deliberate movement works best"}/>
    <EngineSelector engine={props.engine} setEngine={props.setEngine} resolution={props.resolution} setResolution={props.setResolution}/>
    <div className="field-row primary-settings"><label><span className="label">Shot type</span><select value={props.category} onChange={(e) => props.setCategory(e.target.value as keyof typeof qualityPrompts)}><option value="interior">Real estate</option><option value="people">Lifestyle</option></select></label><label><span className="label">Quality</span><select value={props.resolution} onChange={(e) => props.setResolution(e.target.value as ResolutionKey)}>{selected.resolutions.map((item) => <option value={item} key={item}>{item === "1080p" ? "1080p Full HD" : item === "720p" ? "720p HD" : "480p draft"}</option>)}</select><small className="quality-price">Estimated engine cost: ${estimatedCost.toFixed(2)}</small></label></div>
    {props.showMotion && <><label className="label">Camera movement</label><div className="motion-grid">{motions.map((item) => <button key={item.key} className={props.motion === item.key ? "motion active" : "motion"} onClick={() => props.setMotion(item.key)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</div></>}
    {props.category !== "interior" && <PromptDirector targetId="direction-details" category={props.category} motion={props.motion} speed={props.speed} aspect={props.aspect} soundEnabled={props.soundEnabled && selected.audio} soundDirection={props.soundDirection} connected={props.connected} setDetails={props.setDetails}/>}
    <VisualStyleControl aspect={props.aspect} setAspect={props.setAspect}/><SpeedControl speed={props.speed} setSpeed={props.setSpeed}/><FrameControl aspect={props.aspect} setAspect={props.setAspect}/>
    {props.category === "interior" && <><div className="real-estate-lock"><strong>Camera-only movement is permanently locked on</strong><span>Your proven static-property prompt is automatically baked into every Real Estate generation. Only the selected camera movement changes.</span></div><RealEstateBrandingPanel {...props.branding}/></>}
    {selected.audio && <div className="sound-card"><button className={props.soundEnabled ? "sound-toggle active" : "sound-toggle"} onClick={() => props.setSoundEnabled(!props.soundEnabled)}><span><strong>Music & sound effects</strong><small>Generated and synchronized with the video</small></span><i>{props.soundEnabled ? "ON" : "OFF"}</i></button>{props.soundEnabled && <label><span className="label">Sound direction</span><DictationTextarea rows={3} value={props.soundDirection} onValue={props.setSoundDirection} placeholder="Describe music, ambience and synchronized effects." ariaLabel="Sound direction"/></label>}<button className={props.voiceoverEnabled ? "sound-toggle active voiceover-toggle" : "sound-toggle voiceover-toggle"} onClick={() => props.setVoiceoverEnabled(!props.voiceoverEnabled)}><span><strong>Voiceover</strong><small>Add spoken narration to this video</small></span><i>{props.voiceoverEnabled ? "ON" : "OFF"}</i></button>{props.voiceoverEnabled && <label><span className="label">Voiceover script</span><DictationTextarea rows={4} value={props.voiceoverText} onValue={props.setVoiceoverText} placeholder="Type or dictate exactly what the narrator should say." ariaLabel="Voiceover script"/><small className="voiceover-note">AI speech can vary slightly. Review the spoken wording before final delivery.</small></label>}</div>}
    {props.category === "interior" ? <label><span className="label">Locked Real Estate generation prompt</span><textarea className="locked-prompt" value={realEstatePrompt(props.motion)} rows={11} readOnly aria-label="Locked Real Estate generation prompt"/></label> : <label><span className="label">Direction details</span><DictationTextarea id="direction-details" value={props.details} onValue={props.setDetails} rows={6} placeholder="Describe only what should move and what must remain stable." ariaLabel="Direction details"/></label>}
    <details><summary>Advanced controls</summary><div className="field-row advanced"><label><span className="label">Length</span><select value={props.frames} onChange={(e) => props.setFrames(Number(e.target.value) as 81 | 121)}><option value={81}>5 seconds</option><option value={121}>10 seconds</option></select></label><label><span className="label">Seed</span><input value={props.seed} onChange={(e) => props.setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Random" inputMode="numeric"/></label></div></details>
  </div>;
}
