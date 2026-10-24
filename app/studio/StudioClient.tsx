"use client";

import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

type MotionKey = "push" | "orbit" | "slide" | "focus" | "pull" | "mixed" | "custom";
type SpeedKey = "slow" | "medium" | "fast";
type AspectKey = "horizontal" | "vertical" | "cinematic";
type EngineKey = "wan22" | "wan25" | "wan26flash" | "wan26" | "wan3" | "seedance25" | "seedance15" | "runway45" | "runway4turbo" | "minimaxh3" | "geminiomni" | "kling3";
type ResolutionKey = "360p" | "480p" | "720p" | "768p" | "1080p" | "2k" | "4k";
type JobStatus = "idle" | "preparing" | "starting" | "processing" | "finishing" | "succeeded" | "failed";
type OutputFormat = "mp4" | "webm";
type ClipFrames = 49 | 81 | 121;
type StorySeconds = 20 | 35 | 50;
type PropertyRecipe = "classic" | "social" | "luxury";
type SeriesShot = { id: string; name: string; source: string; prompt: string; motion: MotionKey; status: JobStatus; output: string; outputFormat?: OutputFormat; error: string };
type HistoryItem = { id: string; prompt: string; engine: EngineKey; category: string; resolution: string; aspect: AspectKey; duration: number; costCents: number; createdAt: number; videoUrl: string; downloadUrl: string };
type RealEstateBranding = { listingEnabled: boolean; listingTitle: string; listingBeds: string; listingBaths: string; listingSquareFeet: string; listingPrice: string; listingMessage: string; agentEnabled: boolean; agentName: string; agentEmail: string; agentPhone: string; agentLogo: string; agentLogoName: string };
type RealEstateBrandingProps = RealEstateBranding & { setListingEnabled: (value: boolean) => void; setListingTitle: (value: string) => void; setListingBeds: (value: string) => void; setListingBaths: (value: string) => void; setListingSquareFeet: (value: string) => void; setListingPrice: (value: string) => void; setListingMessage: (value: string) => void; setAgentEnabled: (value: boolean) => void; setAgentName: (value: string) => void; setAgentEmail: (value: string) => void; setAgentPhone: (value: string) => void; acceptAgentLogo: (file?: File) => void; removeAgentLogo: () => void };

function formatWholeNumber(value: string) { const digits = value.replace(/\D/g, "").slice(0, 9); return digits ? Number(digits).toLocaleString("en-US") : ""; }
function formatCurrency(value: string) { const number = formatWholeNumber(value); return number ? `$${number}` : ""; }
function formatBaths(value: string) { const clean = value.replace(/[^\d.]/g, ""); const [whole = "", ...decimals] = clean.split("."); return `${whole.slice(0, 2)}${decimals.length ? `.${decimals.join("").slice(0, 1)}` : ""}`; }
function formatPhone(value: string) { const digits = value.replace(/\D/g, "").slice(0, 10); if (digits.length < 4) return digits; if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`; return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`; }

const engineOptions: Array<{ key: EngineKey; label: string; note: string }> = [
  { key: "wan22", label: "WAN 2.2 Fast · Original", note: "Your original fast, economical engine" },
  { key: "wan25", label: "WAN 2.5 Studio · Original", note: "Your original quality engine with audio" },
  { key: "wan26flash", label: "WAN 2.6 Flash", note: "Faster modern generation" },
  { key: "wan26", label: "WAN 2.6 Studio", note: "Higher quality with native audio" },
  { key: "wan3", label: "WAN 3.0 · New", note: "Newest cinematic model · up to 1080p" },
  { key: "seedance25", label: "Seedance 2.5 · Real estate recommended", note: "Best overall property stability · up to 30-second generation" },
  { key: "seedance15", label: "Seedance 1.5 Pro · 1080p", note: "Native Full HD · optional synchronized audio" },
  { key: "runway45", label: "Runway Gen-4.5", note: "Premium cinematic image-to-video · native 720p" },
  { key: "runway4turbo", label: "Runway Gen-4 Turbo · Lower cost", note: "Fast image-to-video · native 720p · $0.05/sec" },
  { key: "minimaxh3", label: "MiniMax H3", note: "Multimodal image-to-video · 768P or 2K" },
  { key: "geminiomni", label: "Gemini Omni 1.1 Flash", note: "Fast Google video · native synchronized audio" },
  { key: "kling3", label: "Kling 3.0", note: "Cinematic motion · optional native audio" },
];
function engineHasAudio(engine: EngineKey) { return engine === "wan25" || engine === "wan26flash" || engine === "wan26" || engine === "seedance25" || engine === "seedance15" || engine === "geminiomni" || engine === "kling3"; }
const resolutionOptions: Record<EngineKey, Array<{ value: ResolutionKey; label: string }>> = {
  wan22: [{ value: "480p", label: "480p draft" }, { value: "720p", label: "720p HD" }],
  wan25: [{ value: "480p", label: "480p draft" }, { value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }],
  wan26flash: [{ value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }],
  wan26: [{ value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }],
  wan3: [{ value: "480p", label: "480p draft" }, { value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }],
  seedance25: [{ value: "480p", label: "480p draft" }, { value: "720p", label: "720p HD" }],
  seedance15: [{ value: "480p", label: "480p draft" }, { value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }],
  runway45: [{ value: "720p", label: "720p HD" }],
  runway4turbo: [{ value: "720p", label: "720p HD" }],
  minimaxh3: [{ value: "768p", label: "768P" }, { value: "2k", label: "2K" }],
  geminiomni: [{ value: "360p", label: "360p fast draft" }, { value: "720p", label: "720p HD" }, { value: "1080p", label: "1080p Full HD" }, { value: "4k", label: "4K" }],
  kling3: [{ value: "720p", label: "720p standard" }, { value: "1080p", label: "1080p pro" }, { value: "4k", label: "4K" }],
};
function supportsThreeSeconds(engine: EngineKey) { return ["wan26flash", "wan26", "wan3", "seedance15", "kling3"].includes(engine); }
function effectiveSeconds(engine: EngineKey, frames: ClipFrames) { return engine === "geminiomni" ? 10 : frames === 49 ? 3 : frames === 121 ? 10 : 5; }
function engineLabel(engine: EngineKey | string) {
  if (engine === "fast") return "WAN 2.2 Fast · Original";
  if (engine === "studio") return "WAN 2.5 Studio · Original";
  return engineOptions.find((item) => item.key === engine)?.label || engine;
}
function estimateCost(engine: EngineKey, resolution: ResolutionKey, frames: ClipFrames, audioEnabled = false) {
  const seconds = effectiveSeconds(engine, frames);
  if (engine === "wan22") return resolution === "720p" ? 0.11 : 0.05;
  if (engine === "wan26flash") return seconds * (resolution === "1080p" ? 0.075 : 0.05);
  if (engine === "wan3") return seconds * (resolution === "1080p" ? 0.10 : resolution === "720p" ? 0.05 : 0.025);
  if (engine === "seedance25") return seconds * (resolution === "720p" ? 0.2312 : 0.1028);
  if (engine === "seedance15") return seconds * (resolution === "1080p" ? (audioEnabled ? 0.12 : 0.06) : resolution === "720p" ? (audioEnabled ? 0.052 : 0.026) : (audioEnabled ? 0.025 : 0.013));
  if (engine === "runway45") return seconds * 0.12;
  if (engine === "runway4turbo") return seconds * 0.05;
  if (engine === "minimaxh3") return seconds * (resolution === "2k" ? 0.13 : 0.08);
  if (engine === "geminiomni") return seconds * (resolution === "4k" ? 0.45 : resolution === "1080p" ? 0.23 : resolution === "720p" ? 0.15 : 0.05);
  if (engine === "kling3") return seconds * (resolution === "4k" ? 0.42 : resolution === "1080p" ? (audioEnabled ? 0.336 : 0.224) : (audioEnabled ? 0.252 : 0.168));
  return seconds * (resolution === "1080p" ? 0.15 : resolution === "720p" ? 0.10 : 0.05);
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
  product: "Premium commercial product cinematography, realistic optics, refined lighting, subtle natural parallax, stable geometry and controlled movement.",
  food: "High-end editorial food commercial, appetizing natural texture, warm directional highlights, realistic macro optics and elegant restrained motion.",
  interior: "Polished architectural commercial, realistic perspective, stable straight lines, natural light and smooth professional camera movement.",
  people: "Premium lifestyle commercial, natural expression and body movement, realistic skin texture, stable facial identity and cinematic restraint.",
};
const guardrail = "Preserve the exact subject, composition, colors, proportions, packaging, text, logo and background. No morphing, melting, warping, floating objects, added objects, flicker, sudden movement, fake text or surreal effects.";
const realEstateMovements: Record<MotionKey, string> = {
  push: "The camera moves slowly in a straight push-in toward the property scene",
  slide: "The camera moves slowly in a horizontal lateral slide across the property scene",
  orbit: "The camera moves slowly in a subtle three-quarter orbit around the property scene",
  focus: "The camera remains stationary while the lens performs a slow, gentle focus shift within the property scene",
  pull: "The camera moves slowly in a straight pull-back away from the property scene",
  mixed: "The camera selects and combines only the smooth camera movements that best fit the property scene",
  custom: "The camera performs only the custom-selected camera movement through the property scene",
};
const realEstateBasePrompt = "Capture an extremely realistic real estate interior or exterior scene. The property and every object remain completely stationary; there is no movement of people, furniture, or anything else in or around the house. The camera's gentle motion creates a sense of stability, while the static environment provides a clear view of the property's layout and features. Lighting is natural and fixed, with no artificial changes, dramatic changes, flicker, or moving shadows. Depth is achieved only through the camera's perspective and the existing mid-range and distant layers. Maintain strict realism: furniture, décor, curtains, doors, windows, plants, trees, water, reflections, appliances, lights, vehicles, architectural elements, outdoor features, and decorative items remain completely still and unchanged. No people or animals enter or move. Preserve the exact geometry, materials, straight lines, proportions, composition, and staging with photorealistic real-world optics. Keep the original photographic detail and texture tack-sharp from edge to edge. No painterly smoothing, dreamlike softness, invented detail, lens breathing, focus pulsing, depth-of-field blur, or AI reconstruction. Camera travel must remain extremely restrained—less than two percent of the frame—with no acceleration or sudden perspective change. Create a buttery-smooth video with no shake, no warping, and perfect stabilization. ONLY THE CAMERA MOVES. NOTHING ELSE MOVES.";
function realEstatePrompt(motion: MotionKey) { return `REAL ESTATE CAMERA-ONLY PRESET — NON-NEGOTIABLE. ${realEstateMovements[motion]}. ${realEstateBasePrompt}`; }

function fadeWindow(time: number, start: number, end: number, fade = .65) { if (time < start || time > end) return 0; return Math.max(0, Math.min(1, (time - start) / fade, (end - time) / fade)); }
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, minSize: number) { let size = startSize; while (size > minSize) { context.font = `600 ${size}px Arial, sans-serif`; if (context.measureText(text).width <= maxWidth) break; size -= 2; } return size; }
async function loadOverlayLogo(source: string) { if (!source) return null; const image = new Image(); image.src = source; await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The logo could not be prepared.")); }); return image; }
async function renderRealEstateOverlays(sourceUrl: string, branding: RealEstateBranding, opening: boolean, closing: boolean): Promise<{ url: string; blob: Blob; format: OutputFormat } | null> {
  const listingFacts = [branding.listingBeds && `${branding.listingBeds} beds`, branding.listingBaths && `${branding.listingBaths} baths`, branding.listingSquareFeet && `${branding.listingSquareFeet} sq ft`].filter(Boolean).join(" · ");
  const showOpening = opening && branding.listingEnabled && Boolean(branding.listingTitle.trim() || listingFacts || branding.listingPrice.trim() || branding.listingMessage.trim());
  const showClosing = closing && branding.agentEnabled && Boolean(branding.agentLogo || branding.agentName.trim() || branding.agentEmail.trim() || branding.agentPhone.trim());
  if (!showOpening && !showClosing) return null;
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot finish the listing overlays. Use a current Chrome, Edge, or Safari browser.");
  const response = await fetch(sourceUrl.startsWith("blob:") ? sourceUrl : `/api/download?url=${encodeURIComponent(sourceUrl)}&name=source.mp4`);
  if (!response.ok) throw new Error("The generated video could not be prepared for its listing overlays.");
  const sourceObjectUrl = URL.createObjectURL(await response.blob()); const video = document.createElement("video"); video.src = sourceObjectUrl; video.playsInline = true; video.preload = "auto";
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("The generated video could not be opened for finishing.")); });
  const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const context = canvas.getContext("2d"); if (!context) throw new Error("This browser could not render the listing overlays.");
  const logo = await loadOverlayLogo(branding.agentLogo); const videoStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.(); const stream = canvas.captureStream(30); videoStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
  let audioContext: AudioContext | null = null; if (!stream.getAudioTracks().length) { const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (AudioContextClass) { audioContext = new AudioContextClass(); const mediaSource = audioContext.createMediaElementSource(video); const audioDestination = audioContext.createMediaStreamDestination(); mediaSource.connect(audioDestination); audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track)); await audioContext.resume(); } }
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"].find((item) => MediaRecorder.isTypeSupported(item)); if (!mime) { URL.revokeObjectURL(sourceObjectUrl); throw new Error("This browser does not support branded video export."); }
  const format: OutputFormat = mime.startsWith("video/mp4") ? "mp4" : "webm"; const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 }); const chunks: Blob[] = []; recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); }; const finished = new Promise<Blob>((resolve, reject) => { recorder.onerror = () => reject(new Error("The listing overlay export failed.")); recorder.onstop = () => resolve(new Blob(chunks, { type: mime })); });
  const draw = () => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(video, 0, 0, canvas.width, canvas.height); const width = canvas.width; const height = canvas.height; const margin = Math.round(width * .055); const now = video.currentTime; const duration = video.duration; const openingAlpha = showOpening ? fadeWindow(now, 0, Math.min(3.25, Math.max(2.4, duration * .55))) : 0;
    if (openingAlpha > 0) { context.save(); context.globalAlpha = openingAlpha; const panelWidth = Math.min(width * .68, width - margin * 2); const panelHeight = Math.min(height * .34, 260); const y = height - margin - panelHeight; const gradient = context.createLinearGradient(margin, y, margin + panelWidth, y); gradient.addColorStop(0, "rgba(12,12,10,.88)"); gradient.addColorStop(1, "rgba(12,12,10,.35)"); context.fillStyle = gradient; context.fillRect(margin, y, panelWidth, panelHeight); context.fillStyle = "#ffffff"; const titleSize = fitText(context, branding.listingTitle.trim(), panelWidth - margin, Math.round(width * .035), 22); context.font = `600 ${titleSize}px Arial, sans-serif`; context.fillText(branding.listingTitle.trim(), margin * 1.45, y + panelHeight * .34); context.fillStyle = "rgba(255,255,255,.82)"; context.font = `400 ${Math.max(18, Math.round(width * .017))}px Arial, sans-serif`; if (listingFacts) context.fillText(listingFacts, margin * 1.45, y + panelHeight * .55); context.fillStyle = "#f3b08e"; context.font = `600 ${Math.max(19, Math.round(width * .019))}px Arial, sans-serif`; if (branding.listingPrice.trim()) context.fillText(branding.listingPrice.trim(), margin * 1.45, y + panelHeight * .73); context.fillStyle = "rgba(255,255,255,.82)"; context.font = `400 ${Math.max(16, Math.round(width * .014))}px Arial, sans-serif`; if (branding.listingMessage.trim()) context.fillText(branding.listingMessage.trim(), margin * 1.45, y + panelHeight * .88); context.restore(); }
    const closingStart = Math.max(0, duration - Math.min(2.8, duration * .46)); const closingAlpha = showClosing ? Math.max(0, Math.min(1, (now - closingStart) / .8)) : 0; if (closingAlpha > 0) { context.save(); context.globalAlpha = closingAlpha; context.fillStyle = "rgba(12,12,10,.82)"; context.fillRect(0, 0, width, height); const cardWidth = Math.min(width * .76, 980); const cardHeight = Math.min(height * .47, 390); const x = (width - cardWidth) / 2; const y = (height - cardHeight) / 2; context.fillStyle = "rgba(255,255,255,.96)"; context.fillRect(x, y, cardWidth, cardHeight); let textX = x + cardWidth * .12; if (logo) { const box = cardHeight * .48; const scale = Math.min(box / logo.width, box / logo.height); const logoW = logo.width * scale; const logoH = logo.height * scale; context.drawImage(logo, x + cardWidth * .09, y + (cardHeight - logoH) / 2, logoW, logoH); textX = x + cardWidth * .42; } context.fillStyle = "#191916"; context.font = `600 ${Math.max(24, Math.round(width * .032))}px Arial, sans-serif`; if (branding.agentName.trim()) context.fillText(branding.agentName.trim(), textX, y + cardHeight * .38); context.fillStyle = "#625d54"; context.font = `400 ${Math.max(17, Math.round(width * .016))}px Arial, sans-serif`; if (branding.agentEmail.trim()) context.fillText(branding.agentEmail.trim(), textX, y + cardHeight * .58); if (branding.agentPhone.trim()) context.fillText(branding.agentPhone.trim(), textX, y + cardHeight * .72); context.restore(); } if (!video.ended && !video.paused) requestAnimationFrame(draw); };
  recorder.start(250); await video.play(); draw(); await new Promise<void>((resolve) => { video.onended = () => { recorder.stop(); resolve(); }; }); const blob = await finished; URL.revokeObjectURL(sourceObjectUrl); stream.getTracks().forEach((track) => track.stop()); await audioContext?.close(); return { url: URL.createObjectURL(blob), blob, format };
}

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Your browser could not prepare this image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  let quality = 0.96; let result = canvas.toDataURL("image/jpeg", quality);
  while (result.length > 1_350_000 && quality > 0.7) { quality -= 0.04; result = canvas.toDataURL("image/jpeg", quality); }
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
function buildPrompt(motion: MotionKey, details: string, category: keyof typeof qualityPrompts, continuity = "", speed: SpeedKey = "slow", aspect: AspectKey = "horizontal", sound = "") {
  const cleanDetails = details.replace(/^Prompt for you:\s*/i, "").trim();
  if (category === "interior") return [realEstatePrompt(motion), sound, "The audio direction must not cause or imply visual object movement. FINAL ENFORCEMENT: only the stabilized camera moves; the entire property and every object remain absolutely motionless from the first frame through the last frame."].filter(Boolean).join(" ");
  return [cleanDetails, motions.find((item) => item.key === motion)?.prompt || "", speedPrompts[speed], aspectPrompts[aspect], qualityPrompts[category], continuity, sound, guardrail].filter(Boolean).join(" ");
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
async function prepareFrame(source: string, aspect: AspectKey, engine: EngineKey): Promise<string> {
  const target = aspect === "vertical" ? 9 / 16 : aspect === "cinematic" && engine !== "wan22" ? 2.39 : 16 / 9;
  const image = new Image(); image.src = source;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The selected frame could not be prepared.")); });
  const original = image.naturalWidth / image.naturalHeight;
  let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
  if (original > target) { sw = image.naturalHeight * target; sx = (image.naturalWidth - sw) / 2; }
  else { sh = image.naturalWidth / target; sy = (image.naturalHeight - sh) / 2; }
  const canvas = document.createElement("canvas"); canvas.width = Math.min(1600, Math.round(sw)); canvas.height = Math.round(canvas.width / target);
  const context = canvas.getContext("2d"); if (!context) throw new Error("The selected frame could not be prepared.");
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  let quality = .95; let result = canvas.toDataURL("image/jpeg", quality);
  while (result.length > 1_400_000 && quality > .7) { quality -= .04; result = canvas.toDataURL("image/jpeg", quality); }
  return result;
}
async function startPrediction(image: string, prompt: string, resolution: ResolutionKey, frames: ClipFrames, seed: string, engine: EngineKey, aspect: AspectKey, audioEnabled: boolean) {
  const response = await fetch("/api/predictions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, prompt, resolution, num_frames: frames, seed: seed ? Number(seed) : null, engine, aspect_ratio: aspect === "vertical" ? "9:16" : "16:9", audio_enabled: audioEnabled }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not start the generation."); return data;
}
async function startStitch(videos: string[]) {
  const response = await fetch("/api/stitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not start final video assembly."); return data;
}
async function waitForPrediction(id: string, onProcessing: () => void, maxWaitMs = 20 * 60 * 1000): Promise<string> {
  if (!id) throw new Error("Replicate did not return a generation identifier.");
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) throw new Error("This job is taking unusually long. It was stopped in the studio so the controls are available again. Check Replicate before retrying to avoid a duplicate charge.");
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
    const response = await fetch(`/api/predictions/${id}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to check generation status.");
    if (data.status === "succeeded") { const result = Array.isArray(data.output) ? data.output[0] : data.output; if (typeof result !== "string" || !result) throw new Error("Replicate completed the job without a downloadable video."); return result; }
    if (data.status === "failed" || data.status === "canceled") throw new Error(data.error || "The generation did not complete.");
    onProcessing();
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

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null); const seriesInputRef = useRef<HTMLInputElement>(null); const extendInputRef = useRef<HTMLInputElement>(null); const upscaleInputRef = useRef<HTMLInputElement>(null);
  const draggedShotId = useRef<string | null>(null);
  const [mode, setMode] = useState<"single" | "series" | "extend" | "history" | "upscale">("single"); const [source, setSource] = useState(""); const [fileName, setFileName] = useState("");
  const [motion, setMotion] = useState<MotionKey>("push"); const [shots, setShots] = useState<SeriesShot[]>([]);
  const [seriesPromptMode, setSeriesPromptMode] = useState<"scene" | "shared">("scene"); const [propertyRecipe, setPropertyRecipe] = useState<PropertyRecipe>("classic");
  const [continuity, setContinuity] = useState("Maintain consistent premium lighting, color grade, lens character, subject appearance and visual tone across every scene.");
  const [category, setCategory] = useState<keyof typeof qualityPrompts>("interior");
  const [speed, setSpeed] = useState<SpeedKey>("slow");
  const [aspect, setAspect] = useState<AspectKey>("horizontal"); const [engine, setEngine] = useState<EngineKey>("seedance25");
  const [soundEnabled, setSoundEnabled] = useState(false); const [soundDirection, setSoundDirection] = useState("Subtle cinematic music, natural ambience, and restrained synchronized sound effects.");
  const [voiceoverEnabled, setVoiceoverEnabled] = useState(false); const [voiceoverText, setVoiceoverText] = useState("");
  const [listingEnabled, setListingEnabled] = useState(false); const [listingTitle, setListingTitle] = useState(""); const [listingBeds, setListingBeds] = useState(""); const [listingBaths, setListingBaths] = useState(""); const [listingSquareFeet, setListingSquareFeet] = useState(""); const [listingPrice, setListingPrice] = useState(""); const [listingMessage, setListingMessage] = useState("");
  const [agentEnabled, setAgentEnabled] = useState(false); const [agentName, setAgentName] = useState(""); const [agentEmail, setAgentEmail] = useState(""); const [agentPhone, setAgentPhone] = useState(""); const [agentLogo, setAgentLogo] = useState(""); const [agentLogoName, setAgentLogoName] = useState("");
  const [details, setDetails] = useState("Keep the subject completely stable. Add only subtle highlight movement and natural depth of field.");
  const [resolution, setResolution] = useState<ResolutionKey>("720p"); const [frames, setFrames] = useState<ClipFrames>(81); const [storySeconds, setStorySeconds] = useState<StorySeconds>(35); const [seed, setSeed] = useState("");
  const [status, setStatus] = useState<JobStatus>("idle"); const [output, setOutput] = useState(""); const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4"); const [error, setError] = useState(""); const [seriesGenerating, setSeriesGenerating] = useState(false); const [seriesStage, setSeriesStage] = useState(""); const [seriesOutput, setSeriesOutput] = useState(""); const [seriesOutputFormat, setSeriesOutputFormat] = useState<OutputFormat>("mp4");
  const [extendSource, setExtendSource] = useState(""); const [extendPreview, setExtendPreview] = useState(""); const [extendName, setExtendName] = useState(""); const [extendOutput, setExtendOutput] = useState(""); const [extendOutputFormat, setExtendOutputFormat] = useState<OutputFormat>("mp4");
  const [connected, setConnected] = useState<boolean | null>(null); const [token, setToken] = useState(""); const [tokenError, setTokenError] = useState(""); const [savingToken, setSavingToken] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]); const [historyLoading, setHistoryLoading] = useState(true); const [historyMessage, setHistoryMessage] = useState("");
  const [upscaleSource, setUpscaleSource] = useState(""); const [upscalePreview, setUpscalePreview] = useState(""); const [upscaleName, setUpscaleName] = useState(""); const [upscaleDuration, setUpscaleDuration] = useState(0); const [upscaleTarget, setUpscaleTarget] = useState<"1080p" | "4k">("1080p"); const [upscaleFps, setUpscaleFps] = useState<30 | 60>(30); const [upscaleOutput, setUpscaleOutput] = useState(""); const [upscaleStatus, setUpscaleStatus] = useState<JobStatus>("idle"); const [upscaleError, setUpscaleError] = useState("");
  const audioRequested = soundEnabled || (voiceoverEnabled && Boolean(voiceoverText.trim()));
  const audioPrompt = engineHasAudio(engine) ? [soundEnabled ? `Generate synchronized music, ambience and sound effects: ${soundDirection}` : engine === "geminiomni" ? "No music or dialogue; keep the native audio track quiet and natural." : "", voiceoverEnabled && voiceoverText.trim() ? `Include a clear professional voiceover that says exactly: "${voiceoverText.trim()}". Keep narration intelligible above the music and effects.` : ""].filter(Boolean).join(" ") : "";
  const finalPrompt = buildPrompt(motion, details, category, "", speed, aspect, audioPrompt); const extensionPrompt = buildPrompt(motion, `Continue the scene naturally from this exact final frame. ${details}`, category, "Preserve seamless continuity with the preceding clip: same subject, lighting, color grade, lens, environment and direction of action.", speed, aspect, audioPrompt); const price = estimateCost(engine, resolution, frames, audioRequested); const completedShots = shots.filter((shot) => shot.status === "succeeded").length;
  const storyAllowance: Record<StorySeconds, number> = { 20: 5, 35: 10, 50: 15 }; const maxStoryShots = storyAllowance[storySeconds]; const clipSeconds = mode === "series" ? 3 : effectiveSeconds(engine, frames); const plannedStorySeconds = shots.length * clipSeconds; const storyPlanReady = shots.length > 0 && shots.length <= maxStoryShots;
  const branding: RealEstateBranding = { listingEnabled, listingTitle, listingBeds, listingBaths, listingSquareFeet, listingPrice, listingMessage, agentEnabled, agentName, agentEmail, agentPhone, agentLogo, agentLogoName };
  const brandingProps: RealEstateBrandingProps = { ...branding, setListingEnabled, setListingTitle, setListingBeds, setListingBaths, setListingSquareFeet, setListingPrice, setListingMessage, setAgentEnabled, setAgentName, setAgentEmail, setAgentPhone, acceptAgentLogo, removeAgentLogo: () => { setAgentLogo(""); setAgentLogoName(""); } };
  useEffect(() => { fetch("/api/token").then((r) => r.json()).then((d) => setConnected(Boolean(d.connected))).catch(() => setConnected(false)); }, []);
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => { if (mode === "series") { setFrames(49); if (!supportsThreeSeconds(engine)) { setEngine("seedance15"); setResolution("1080p"); } } else if (engine === "geminiomni") setFrames(121); else if (frames === 49 && !supportsThreeSeconds(engine)) setFrames(81); }, [mode, engine, frames]);
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus("preparing");
        const response = await fetch(`/api/jobs/${jobId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The client project could not be opened.");
        const job = data.job as { projectName: string; packageSeconds: StorySeconds; style: PropertyRecipe; notes: string; assets: Array<{ id: string; fileName: string; url: string }> };
        const imported = await Promise.all(job.assets.map(async (asset, index) => {
          const assetResponse = await fetch(asset.url);
          if (!assetResponse.ok) throw new Error(`Photo ${index + 1} could not be loaded.`);
          const file = new File([await assetResponse.blob()], asset.fileName);
          return { id: asset.id, name: asset.fileName, source: await compressImage(file), prompt: "", motion: autoMovement[index % autoMovement.length], status: "idle" as JobStatus, output: "", error: "" };
        }));
        if (cancelled) return;
        setMode("series"); setSeriesPromptMode("scene"); setStorySeconds(job.packageSeconds); setShots(imported); setListingTitle(job.projectName); setListingEnabled(Boolean(job.projectName)); setDetails(job.notes || "Preserve the exact property and create a restrained professional listing film."); applyPropertyRecipe(job.style || "classic"); setStatus("idle"); setHistoryMessage(`Client project ${jobId.slice(0, 8).toUpperCase()} loaded with ${imported.length} photos.`);
      } catch (cause) { if (!cancelled) { setStatus("failed"); setError(cause instanceof Error ? cause.message : "The client project could not be opened."); } }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    try { const response = await fetch("/api/history"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setHistory(data.items || []); }
    catch { setHistoryMessage("History could not be loaded right now."); }
    finally { setHistoryLoading(false); }
  }
  async function saveHistory(sourceUrl: string, prompt: string, itemCategory: string = category, costOverride: number = price) {
    setHistoryMessage("Saving this video to your private history…");
    try {
      const response = await fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl, prompt, engine, category: itemCategory, resolution, aspect, duration: effectiveSeconds(engine, frames), costCents: Math.round(costOverride * 100) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setHistory((current) => [data.item, ...current.filter((item) => item.id !== data.item.id)]); setHistoryMessage("Saved to history.");
    } catch { setHistoryMessage("The video generated, but its history copy could not be saved. Download it now."); }
  }

  async function acceptFile(file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setError("Choose an image smaller than 20 MB.");
    setError(""); setStatus("preparing");
    try { setSource(await compressImage(file)); setFileName(file.name); setStatus("idle"); setOutput(""); } catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "The image could not be prepared."); }
  }
  async function acceptSeriesFiles(files: FileList | File[]) {
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, maxStoryShots - shots.length));
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
  function addScene() {
    if (shots.length >= maxStoryShots || seriesGenerating) return;
    setShots((current) => [...current, { id: `scene-${Date.now()}-${current.length}`, name: "No image selected", source: "", prompt: "", motion: autoMovement[current.length % autoMovement.length], status: "idle", output: "", error: "" }]);
  }
  async function acceptSceneFile(id: string, file?: File) {
    if (!file) return; if (!file.type.startsWith("image/")) return setError("Choose a JPG, PNG or WebP image."); if (file.size > 20 * 1024 * 1024) return setError("Choose an image smaller than 20 MB.");
    setError(""); setStatus("preparing");
    try { const prepared = await compressImage(file); updateShot(id, { source: prepared, name: file.name, output: "", status: "idle", error: "" }); setStatus("idle"); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "The image could not be prepared."); }
  }
  function acceptAgentLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a PNG, JPG or WebP logo.");
    if (file.size > 5 * 1024 * 1024) return setError("Choose a logo smaller than 5 MB.");
    setError("");
    const reader = new FileReader();
    reader.onload = () => { setAgentLogo(String(reader.result || "")); setAgentLogoName(file.name); };
    reader.onerror = () => setError("The logo could not be prepared.");
    reader.readAsDataURL(file);
  }
  async function generate() {
    if (!source) return setError("Upload an image first."); if (finalPrompt.trim().length < 20) return setError("Add a clear motion description.");
    setError(""); setOutput(""); setStatus("starting");
    try { const framedSource = await prepareFrame(source, aspect, engine); const job = await startPrediction(framedSource, finalPrompt, resolution, frames, seed, engine, aspect, audioRequested); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setStatus("processing")); setStatus("finishing"); const branded = category === "interior" ? await renderRealEstateOverlays(result, branding, true, true) : null; setOutput(branded?.url || result); setOutputFormat(branded?.format || "mp4"); setStatus("succeeded"); await saveHistory(result, finalPrompt); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "Could not generate the clip."); }
  }
  async function generateSeries() {
    if (!shots.length) return setError("Add at least one scene first.");
    if (shots.length > maxStoryShots) return setError(`The ${storySeconds}-second version allows up to ${maxStoryShots} images. Remove ${shots.length - maxStoryShots} image${shots.length - maxStoryShots === 1 ? "" : "s"}.`);
    const missingImage = shots.findIndex((shot) => !shot.source); if (missingImage >= 0) return setError(`Add an image to scene ${missingImage + 1}.`);
    const missingPrompt = category !== "interior" && seriesPromptMode === "scene" ? shots.findIndex((shot) => shot.prompt.trim().length < 12) : -1;
    if (missingPrompt >= 0) return setError(`Write a clear prompt for scene ${missingPrompt + 1}.`);
    if (category !== "interior" && seriesPromptMode === "shared" && details.trim().length < 12) return setError("Write one clear prompt for the full series.");
    setError(""); setSeriesOutput(""); setSeriesStage("Preparing the scene queue…"); setSeriesGenerating(true); setShots((current) => current.map((shot) => ({ ...shot, status: "idle", output: "", error: "" })));
    const completedVideos: string[] = [];
    try {
      for (const [shotIndex, shot] of shots.entries()) {
        setSeriesStage(`Generating scene ${shotIndex + 1} of ${shots.length}…`);
        setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "starting", error: "" } : item));
        const sceneDirection = seriesPromptMode === "scene" ? shot.prompt : details;
        const scenePrompt = buildPrompt(shot.motion, sceneDirection, category, continuity, speed, aspect, audioPrompt);
        try {
          const framedSource = await prepareFrame(shot.source, aspect, engine);
          const job = await startPrediction(framedSource, scenePrompt, resolution, frames, seed, engine, aspect, audioRequested);
          const immediate = Array.isArray(job.output) ? job.output[0] : job.output;
          const result = job.status === "succeeded" && typeof immediate === "string" ? immediate : await waitForPrediction(job.id, () => setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "processing" } : item)));
          completedVideos.push(result);
          setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "succeeded", output: result, outputFormat: "mp4" } : item));
          await saveHistory(result, scenePrompt, `series scene ${shotIndex + 1} · ${category}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : "This shot failed.";
          setShots((current) => current.map((item) => item.id === shot.id ? { ...item, status: "failed", error: message } : item));
          throw new Error(`Stopped at scene ${shotIndex + 1} (${shot.name}): ${message}`);
        }
      }

      let assembled = completedVideos[0];
      if (!assembled) throw new Error("No completed scene was available for final assembly.");
      if (completedVideos.length > 1) {
        setSeriesStage(`All ${completedVideos.length} scenes are ready. Stitching the final story…`);
        const stitchJob = await startStitch(completedVideos);
        const immediate = Array.isArray(stitchJob.output) ? stitchJob.output[0] : stitchJob.output;
        assembled = stitchJob.status === "succeeded" && typeof immediate === "string" ? immediate : await waitForPrediction(stitchJob.id, () => setSeriesStage("Stitching the clips into one final video…"), 10 * 60 * 1000);
      }
      setSeriesOutput(assembled); setSeriesOutputFormat("mp4");
      setSeriesStage("Your complete stitched story is ready. Finishing optional property cards…");
      if (category === "interior") {
        try {
          const branded = await renderRealEstateOverlays(assembled, branding, true, true);
          if (branded) { setSeriesOutput(branded.url); setSeriesOutputFormat(branded.format); }
        } catch {
          setHistoryMessage("Your complete stitched video is ready below. This browser skipped the optional property cards, but your video was not lost.");
        }
      }
      setSeriesStage("Your complete stitched story is ready to play and download.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The series could not be completed.");
      setSeriesStage(completedVideos.length ? `${completedVideos.length} completed scene${completedVideos.length === 1 ? " is" : "s are"} still available below. You can safely review or download them before retrying.` : "The queue stopped before a scene completed.");
    } finally {
      setSeriesGenerating(false);
    }
  }
  async function generateExtension() {
    if (!extendSource) return setError("Upload the clip you want to extend first.");
    setError(""); setExtendOutput(""); setStatus("starting");
    try { const framedSource = await prepareFrame(extendSource, aspect, engine); const job = await startPrediction(framedSource, extensionPrompt, resolution, frames, seed, engine, aspect, audioRequested); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setStatus("processing")); setStatus("finishing"); const branded = category === "interior" ? await renderRealEstateOverlays(result, branding, true, true) : null; setExtendOutput(branded?.url || result); setExtendOutputFormat(branded?.format || "mp4"); setStatus("succeeded"); await saveHistory(result, extensionPrompt, `extension · ${category}`); }
    catch (err) { setStatus("failed"); setError(err instanceof Error ? err.message : "Could not extend the scene."); }
  }
  async function upscaleVideo() {
    if (!upscaleSource) return setUpscaleError("Upload a video to upscale first.");
    setUpscaleError(""); setUpscaleOutput(""); setUpscaleStatus("starting");
    try { const response = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video: upscaleSource, targetResolution: upscaleTarget, targetFps: upscaleFps }) }); const job = await response.json(); if (!response.ok) throw new Error(job.error || "Could not start the upscaler."); const result = job.status === "succeeded" ? (Array.isArray(job.output) ? job.output[0] : job.output) : await waitForPrediction(job.id, () => setUpscaleStatus("processing")); setUpscaleOutput(result); setUpscaleStatus("succeeded"); }
    catch (err) { setUpscaleStatus("failed"); setUpscaleError(err instanceof Error ? err.message : "The video could not be upscaled."); }
  }
  function updateShot(id: string, change: Partial<SeriesShot>) { setShots((current) => current.map((shot) => shot.id === id ? { ...shot, ...change } : shot)); }
  function applyPropertyRecipe(recipe: PropertyRecipe) {
    const recipeSettings: Record<PropertyRecipe, { aspect: AspectKey; speed: SpeedKey; motions: MotionKey[]; continuity: string }> = {
      classic: { aspect: "horizontal", speed: "slow", motions: ["push", "slide", "pull", "focus"], continuity: "Preserve the exact architecture, room dimensions, finishes, furniture, lighting and color grade. Use restrained, stabilized camera motion suitable for an MLS listing film." },
      social: { aspect: "vertical", speed: "medium", motions: ["push", "slide", "orbit", "pull"], continuity: "Preserve the exact property while keeping the strongest architectural feature centered and crop-safe for vertical social video." },
      luxury: { aspect: "cinematic", speed: "slow", motions: ["pull", "slide", "focus", "orbit"], continuity: "Create a quiet luxury property film with extremely slow camera travel, consistent warm-neutral grading, tack-sharp materials and absolutely unchanged architecture." },
    };
    const selected = recipeSettings[recipe]; setPropertyRecipe(recipe); setAspect(selected.aspect); setSpeed(selected.speed); setCategory("interior"); setShots((current) => current.map((shot, index) => ({ ...shot, motion: selected.motions[index % selected.motions.length] }))); setContinuity(selected.continuity);
  }
  function moveShot(index: number, direction: -1 | 1) { setShots((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function moveShotTo(sourceId: string | null, targetId: string) { if (!sourceId || sourceId === targetId || seriesGenerating) return; setShots((current) => { const from = current.findIndex((shot) => shot.id === sourceId); const to = current.findIndex((shot) => shot.id === targetId); if (from < 0 || to < 0) return current; const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; }); }
  function startPointerReorder(event: ReactPointerEvent<HTMLElement>, shotId: string) { if (seriesGenerating) return; draggedShotId.current = shotId; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.closest("article")?.classList.add("dragging"); }
  function continuePointerReorder(event: ReactPointerEvent<HTMLElement>) { if (!draggedShotId.current) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-shot-id]"); if (target?.dataset.shotId) moveShotTo(draggedShotId.current, target.dataset.shotId); }
  function endPointerReorder(event: ReactPointerEvent<HTMLElement>) { draggedShotId.current = null; event.currentTarget.closest("article")?.classList.remove("dragging"); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  async function removeHistoryItem(id: string) { if (!window.confirm("Remove this saved video from history?")) return; const response = await fetch(`/api/history/${id}/video`, { method: "DELETE" }); if (response.ok) setHistory((current) => current.filter((item) => item.id !== id)); else setHistoryMessage("That saved video could not be removed."); }
  async function connectReplicate() { setSavingToken(true); setTokenError(""); try { const response = await fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "The token could not be saved."); setConnected(true); setToken(""); } catch (err) { setTokenError(err instanceof Error ? err.message : "The token could not be saved."); } finally { setSavingToken(false); } }

  return <main>
    <header className="topbar"><a className="brand" href="/studio"><span className="brand-mark">FM</span><span>FRAME MOTION STUDIO</span></a><div className="studio-nav"><a href="/dashboard">Production queue</a><div className="model-pill"><span className="dot" /> Frame Engine <span className="muted">Image → Video</span></div></div></header>
    {connected === false && <section className="connect-bar"><div><strong>Connect Replicate to generate</strong><span>Your token is stored in a secure, private browser cookie and is never displayed again.</span></div><div className="token-form"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="r8_••••••••••••••••••••" autoComplete="off" /><button onClick={connectReplicate} disabled={savingToken || !token}>{savingToken ? "Connecting…" : "Connect"}</button></div>{tokenError && <p className="token-error">{tokenError}</p>}</section>}
    {connected === true && <div className="connected-bar"><span><i /> Replicate connected</span><button onClick={async () => { await fetch("/api/token", { method: "DELETE" }); setConnected(false); }}>Disconnect</button></div>}
    <section className="hero"><p className="eyebrow">PRIVATE PROPERTY FILM STUDIO</p><h1>{mode === "single" ? "Turn one listing photograph into a controlled cinematic shot." : mode === "series" ? "Turn listing photos into one complete, branded property film." : mode === "extend" ? "Continue an existing scene from its exact final frame." : mode === "upscale" ? "Finish your property video at a cleaner, higher resolution." : "Return to every property film you have created."}</h1><p className="subhead">{mode === "series" ? "Upload 5–15 photos, choose a film direction, protect every architectural detail, and export one finished video." : "Upload. Direct the camera. Preserve the property. See the estimated cost before you generate."}</p><div className="hero-proof"><span><b>1080p</b> ready</span><span><b>3-sec</b> controlled scenes</span><span><b>16:9 + 9:16</b> formats</span><span><b>Property truth</b> lock</span></div></section>
    <div className="mode-switch"><button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}><strong>Single shot</strong><small>One image, one movement</small></button><button className={mode === "series" ? "active" : ""} onClick={() => setMode("series")}><strong>Multi-shot series</strong><small>Up to 15 clips · 3 seconds each</small></button><button className={mode === "extend" ? "active" : ""} onClick={() => setMode("extend")}><strong>Extend scene</strong><small>Continue from the final frame</small></button><button className={mode === "upscale" ? "active" : ""} onClick={() => setMode("upscale")}><strong>Upscale video</strong><small>Improve to 1080p or 4K</small></button><button className={mode === "history" ? "active" : ""} onClick={() => { setMode("history"); loadHistory(); }}><strong>History</strong><small>Your saved generations</small></button></div>
    {mode === "single" ? <section className="workspace">
      <div className="panel source-panel"><Heading number="01" title="Source image" note="The first frame of your shot"/><button className={`dropzone ${source ? "has-image" : ""}`} onClick={() => inputRef.current?.click()} onDrop={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); acceptFile(e.dataTransfer.files[0]); }} onDragOver={(e) => e.preventDefault()}>{source ? <><img src={source} alt="Uploaded source preview" /><span className="replace">Replace image</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Drop an image here</strong><small>or click to browse · JPG, PNG, WebP · 20 MB max</small></div>}</button><input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e: ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0])}/>{fileName && <div className="file-row"><span>{fileName}</span><button onClick={() => { setSource(""); setFileName(""); setOutput(""); }}>Remove</button></div>}</div>
      <DirectionPanel imageSource={source} motion={motion} setMotion={setMotion} category={category} setCategory={setCategory} speed={speed} setSpeed={setSpeed} aspect={aspect} setAspect={setAspect} engine={engine} setEngine={setEngine} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} soundDirection={soundDirection} setSoundDirection={setSoundDirection} voiceoverEnabled={voiceoverEnabled} setVoiceoverEnabled={setVoiceoverEnabled} voiceoverText={voiceoverText} setVoiceoverText={setVoiceoverText} connected={connected} details={details} setDetails={setDetails} resolution={resolution} setResolution={setResolution} frames={frames} setFrames={setFrames} seed={seed} setSeed={setSeed} branding={brandingProps} showMotion/>
      <div className="panel output-panel"><Heading number="03" title="Generate" note="Review before your final edit"/><div className="output-stage">{output ? <video src={output} controls autoPlay loop playsInline/> : <div className="empty-output"><span>▶</span><strong>Your clip will appear here</strong><small>Successful clips are saved automatically to History.</small></div>}{["preparing", "starting", "processing", "finishing"].includes(status) && <div className="processing"><span className="spinner"/><strong>{status === "preparing" ? "Preparing image" : status === "starting" ? "Starting generation" : status === "finishing" ? "Adding listing overlays" : "Generating video"}</strong><small>This can take one to three minutes.</small></div>}</div>{error && <div className="error">{error}</div>}<button className="generate" onClick={generate} disabled={!connected || !source || ["preparing", "starting", "processing", "finishing"].includes(status)}>{!connected ? "Connect Replicate first" : ["starting", "processing", "finishing"].includes(status) ? "Generating…" : "Generate clip"}<span>→</span></button>{output && <a className="download" href={output.startsWith("blob:") ? output : `/api/download?url=${encodeURIComponent(output)}&name=frame-motion-video.mp4`} download={output.startsWith("blob:") ? `frame-motion-video.${outputFormat}` : undefined}>Download {outputFormat.toUpperCase()} directly</a>}{historyMessage && <p className="history-message">{historyMessage}</p>}<div className="cost-line"><span>Estimated generation cost</span><strong>${price.toFixed(2)} per video</strong></div></div>
    </section> : mode === "series" ? <section className="series-area">
      <div className="series-methods">
        <button className={seriesPromptMode === "scene" ? "active recommended" : ""} onClick={() => setSeriesPromptMode("scene")} disabled={seriesGenerating}>
          <span>PROFESSIONAL · RECOMMENDED</span><strong>One prompt per scene</strong><small>Direct every shot independently for the highest control and quality.</small>
        </button>
        <button className={seriesPromptMode === "shared" ? "active" : ""} onClick={() => setSeriesPromptMode("shared")} disabled={seriesGenerating}>
          <span>QUICK SERIES</span><strong>One prompt, multiple images</strong><small>Apply the same direction to every image in the sequence.</small>
        </button>
      </div>
      <div className="property-standard"><div><span>PROPERTY FILM WORKFLOW</span><strong>Photos → directed motion → branding → one finished film</strong></div><div><span>Exact room geometry</span><span>Music & voiceover</span><span>Agent branding</span><span>One-click download</span></div></div>
      <div className="recipe-heading"><span className="label">Choose a film direction</span><p>Start with a professional recipe, then refine any individual scene.</p></div>
      <div className="property-recipes">
        <button className={propertyRecipe === "classic" ? "active" : ""} onClick={() => applyPropertyRecipe("classic")} disabled={seriesGenerating}><span>MLS READY</span><strong>Classic listing film</strong><small>Smooth room glides · 16:9 · restrained movement</small></button>
        <button className={propertyRecipe === "social" ? "active" : ""} onClick={() => applyPropertyRecipe("social")} disabled={seriesGenerating}><span>SOCIAL FIRST</span><strong>Vertical property reel</strong><small>Centered features · 9:16 · natural pace</small></button>
        <button className={propertyRecipe === "luxury" ? "active" : ""} onClick={() => applyPropertyRecipe("luxury")} disabled={seriesGenerating}><span>PREMIUM</span><strong>Luxury cinematic</strong><small>Slow reveals · wide frame · quiet elegance</small></button>
      </div>
      <div className="series-workspace">
        <div className="panel series-source">
          <Heading number="01" title={seriesPromptMode === "scene" ? "Build your scenes" : "Add your shot images"} note={seriesPromptMode === "scene" ? "Each scene gets its own image, prompt and movement" : "One direction will be applied to every image"}/>
          {seriesPromptMode === "scene" ? <>
            <div className="scene-stack">{shots.map((shot, index) => <article className="scene-card" key={shot.id} draggable={!seriesGenerating} onDragStart={(event) => { draggedShotId.current = shot.id; event.dataTransfer.effectAllowed = "move"; event.currentTarget.classList.add("dragging"); }} onDragEnd={(event) => { draggedShotId.current = null; event.currentTarget.classList.remove("dragging"); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); moveShotTo(draggedShotId.current, shot.id); }}>
              <div className="scene-number"><span>SCENE</span><strong>{String(index + 1).padStart(2, "0")}</strong><div><button onClick={() => moveShot(index, -1)} disabled={index === 0 || seriesGenerating} aria-label="Move scene up">↑</button><button onClick={() => moveShot(index, 1)} disabled={index === shots.length - 1 || seriesGenerating} aria-label="Move scene down">↓</button></div></div>
              <label className={`scene-image ${shot.source ? "filled" : ""}`} htmlFor={`scene-file-${shot.id}`}>{shot.source ? <img src={shot.source} alt={`Scene ${index + 1}`}/> : <><span>＋</span><small>Add image</small></>}</label>
              <input id={`scene-file-${shot.id}`} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => acceptSceneFile(shot.id, e.target.files?.[0])}/>
              <div className="scene-direction">
                {category !== "interior" && <PromptDirector compact imageSource={shot.source} targetId={`scene-prompt-${shot.id}`} category={category} motion={shot.motion} speed={speed} aspect={aspect} soundEnabled={soundEnabled && engineHasAudio(engine)} soundDirection={soundDirection} connected={connected} setDetails={(prompt) => updateShot(shot.id, { prompt })}/>}<label><span className="label">{category === "interior" ? "Locked real-estate prompt" : "Scene prompt"}</span>{category === "interior" ? <textarea className="locked-prompt" rows={6} value={realEstatePrompt(shot.motion)} readOnly/> : <DictationTextarea id={`scene-prompt-${shot.id}`} rows={4} value={shot.prompt} onValue={(prompt) => updateShot(shot.id, { prompt })} placeholder="Describe what happens in this scene. Example: The chocolate sphere remains perfectly formed while warm highlights travel slowly across its surface." disabled={seriesGenerating} ariaLabel={`Scene ${index + 1} prompt`}/>}</label>
                <div className="scene-controls"><label><span className="label">Camera movement</span><select value={shot.motion} onChange={(e) => updateShot(shot.id, { motion: e.target.value as MotionKey })} disabled={seriesGenerating}>{motions.filter((item) => item.key !== "custom").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><div className="scene-file-name"><span>IMAGE</span><strong>{shot.name}</strong></div></div>
                {shot.status !== "idle" && <small className={`shot-status ${shot.status}`}>{shot.status === "succeeded" ? "Ready to download" : shot.status === "failed" ? shot.error : shot.status === "starting" ? "Starting…" : shot.status === "finishing" ? "Adding overlays…" : "Generating…"}</small>}
              </div>
              <span className="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span><button className="remove-scene" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))} disabled={seriesGenerating} aria-label={`Remove scene ${index + 1}`}>×</button>
            </article>)}</div>
            <button className="add-scene" onClick={addScene} disabled={seriesGenerating || shots.length >= maxStoryShots}><span>＋</span>{shots.length ? "Add another scene" : "Add your first scene"}</button>
          </> : <>
            <button className="series-dropzone" onClick={() => seriesInputRef.current?.click()} onDrop={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); acceptSeriesFiles(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()} disabled={seriesGenerating || shots.length >= maxStoryShots}><span className="upload-icon">＋</span><strong>{shots.length ? "Add more images" : "Select all images for your sequence"}</strong><small>Up to {maxStoryShots} images · every image becomes a 3-second clip</small></button>
            <input ref={seriesInputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files && acceptSeriesFiles(e.target.files)}/>
            {category !== "interior" && <PromptDirector imageSource={shots[0]?.source} targetId="shared-direction-details" category={category} motion="mixed" speed={speed} aspect={aspect} soundEnabled={soundEnabled && engineHasAudio(engine)} soundDirection={soundDirection} connected={connected} setDetails={setDetails}/>}<label className="shared-prompt"><span className="label">{category === "interior" ? "Locked real-estate prompt" : "Prompt for every image"}</span>{category === "interior" ? <textarea className="locked-prompt" rows={6} value={realEstatePrompt("mixed")} readOnly/> : <DictationTextarea id="shared-direction-details" rows={6} value={details} onValue={setDetails} placeholder="Describe the action and visual direction that should apply to all images." ariaLabel="Prompt for every image"/>}</label>
            <div className="shot-list">{shots.map((shot, index) => <article className="shot-card" data-shot-id={shot.id} key={shot.id} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); moveShotTo(draggedShotId.current, shot.id); }}><div className="shot-thumb"><img src={shot.source} alt=""/><span>{String(index + 1).padStart(2, "0")}</span></div><div className="shot-info"><strong>{shot.name}</strong><div className="reorder-controls"><span className="reorder-grip" draggable={!seriesGenerating} onDragStart={(event) => { draggedShotId.current = shot.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", shot.id); event.currentTarget.closest("article")?.classList.add("dragging"); }} onDragEnd={(event) => { draggedShotId.current = null; event.currentTarget.closest("article")?.classList.remove("dragging"); }} onPointerDown={(event) => startPointerReorder(event, shot.id)} onPointerMove={continuePointerReorder} onPointerUp={endPointerReorder} onPointerCancel={endPointerReorder}>⠿ <b>DRAG TO REORDER</b></span><button type="button" onClick={() => moveShot(index, -1)} disabled={index === 0 || seriesGenerating} aria-label="Move image earlier">↑</button><button type="button" onClick={() => moveShot(index, 1)} disabled={index === shots.length - 1 || seriesGenerating} aria-label="Move image later">↓</button></div><label><span>Camera movement</span><select value={shot.motion} onChange={(e) => updateShot(shot.id, { motion: e.target.value as MotionKey })} disabled={seriesGenerating}>{motions.filter((item) => item.key !== "custom").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div><button className="remove-shot" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))} disabled={seriesGenerating}>×</button></article>)}</div>
          </>}
        </div>
        <div className="panel quality-panel"><Heading number="02" title="Professional controls" note="Settings shared across the sequence"/>
          <div className="quality-callout"><strong>Real-estate recommended preset</strong><p>Use Seedance 1.5 Pro at 1080p with restrained three-second movements and separate direction for every property image. WAN Flash prioritizes speed and can soften or alter fine interior details.</p><button onClick={() => { setEngine("seedance15"); setResolution("1080p"); setFrames(49); setSeriesPromptMode("scene"); setCategory("interior"); }}>Apply real-estate preset</button></div>
          <EnginePicker engine={engine} setEngine={setEngine} resolution={resolution} setResolution={setResolution} threeSecondOnly/>
          <FrameControl aspect={aspect} setAspect={setAspect}/>
          <div className="story-length"><span className="label">Choose your film length</span><div>{([20, 35, 50] as StorySeconds[]).map((seconds) => <button key={seconds} className={storySeconds === seconds ? "active" : ""} onClick={() => setStorySeconds(seconds)}><strong>{seconds}s</strong><small>{storyAllowance[seconds]} photo allowance</small></button>)}</div></div>
          <div className="fixed-clip-time"><strong>3 seconds per image</strong><span>Every uploaded photo generates one three-second video clip.</span></div>
          <div className={storyPlanReady ? "story-plan ready" : "story-plan"}><strong>{shots.length} of {maxStoryShots} images added</strong><span>{shots.length ? `Your current sequence creates approximately ${plannedStorySeconds} seconds of generated footage. Add up to ${maxStoryShots - shots.length} more image${maxStoryShots - shots.length === 1 ? "" : "s"}.` : `This version allows up to ${maxStoryShots} images. Add at least one image to begin.`}</span></div>
          <div className="field-row"><label><span className="label">Content type</span><select value={category} onChange={(e) => setCategory(e.target.value as keyof typeof qualityPrompts)}><option value="interior">Real estate · interior/exterior</option><option value="people">People / lifestyle</option></select></label><label><span className="label">2 · Quality and price per video</span><ResolutionSelect engine={engine} resolution={resolution} setResolution={setResolution} frames={frames} audioEnabled={audioRequested} totalLabel="Current price per scene"/></label></div>
          {category === "interior" && <><div className="real-estate-lock"><strong>Real-estate camera lock is active</strong><span>Only the camera may move. Property geometry, furniture, décor, lighting, landscaping and every object are locked in place.</span></div><RealEstateBrandingPanel {...brandingProps}/></>}
          <SpeedControl speed={speed} setSpeed={setSpeed}/>
          {engineHasAudio(engine) && <div className="sound-card"><button className={soundEnabled ? "sound-toggle active" : "sound-toggle"} onClick={() => setSoundEnabled(!soundEnabled)}><span><strong>Music & sound effects</strong><small>Generated and synchronized with the video</small></span><i>{soundEnabled ? "ON" : "OFF"}</i></button>{soundEnabled && <label><span className="label">Sound direction</span><DictationTextarea rows={3} value={soundDirection} onValue={setSoundDirection} ariaLabel="Sound direction"/></label>}<button className={voiceoverEnabled ? "sound-toggle active voiceover-toggle" : "sound-toggle voiceover-toggle"} onClick={() => setVoiceoverEnabled(!voiceoverEnabled)}><span><strong>Voiceover</strong><small>Add spoken narration to the generated video</small></span><i>{voiceoverEnabled ? "ON" : "OFF"}</i></button>{voiceoverEnabled && <label><span className="label">Voiceover script</span><DictationTextarea rows={4} value={voiceoverText} onValue={setVoiceoverText} placeholder="Type or dictate exactly what the narrator should say." ariaLabel="Voiceover script"/></label>}</div>}
          <label><span className="label">Continuity direction</span><DictationTextarea rows={5} value={continuity} onValue={setContinuity} placeholder="What must remain visually consistent across all scenes?" ariaLabel="Continuity direction"/></label>
          <details><summary>Advanced controls</summary><label><span className="label">Seed</span><input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder={engine === "geminiomni" ? "Not used by Gemini" : "Random"} inputMode="numeric" disabled={engine === "geminiomni"}/></label></details>
        </div>
        <div className="panel series-output"><Heading number="03" title="Generate the complete property film" note="Scenes generate in your chosen order, then stitch into one final video"/><div className="series-summary"><div><span>Images</span><strong>{shots.length}/{maxStoryShots}</strong></div><div><span>Generated footage</span><strong>≈ {plannedStorySeconds}s</strong></div><div><span>Generation estimate</span><strong>${(shots.length * price).toFixed(2)}</strong></div></div>{error && <div className="error">{error}</div>}{seriesStage && <div className={seriesGenerating ? "series-stage active" : "series-stage"}><span className={seriesGenerating ? "spinner" : "stage-check"}/><strong>{seriesStage}</strong></div>}<button className="generate" onClick={generateSeries} disabled={!connected || !storyPlanReady || seriesGenerating || status === "preparing"}>{!connected ? "Connect Replicate first" : seriesGenerating ? "Building your complete property film…" : !storyPlanReady ? "Add at least one image" : "Generate and stitch property film"}<span>→</span></button>{seriesOutput && <div className="final-series"><span>COMPLETE PROPERTY FILM</span><div className="final-compare">{shots[0]?.source && <div><small>FIRST LISTING PHOTO</small><img src={shots[0].source} alt="First listing photo"/></div>}<div><small>FINISHED FILM</small><video src={seriesOutput} controls playsInline/></div></div><a className="download" href={seriesOutput.startsWith("blob:") ? seriesOutput : `/api/download?url=${encodeURIComponent(seriesOutput)}&name=frame-motion-property-film.mp4`} download={seriesOutput.startsWith("blob:") ? `frame-motion-property-film.${seriesOutputFormat}` : undefined}>Download finished {seriesOutputFormat.toUpperCase()}</a></div>}{historyMessage && <p className="history-message">{historyMessage}</p>}<p className="queue-note">Every image generates a three-second property scene. The studio automatically stitches every scene into one branded, downloadable film in the exact order shown. Individual clips stay available below as backups.</p><div className="series-results">{shots.filter((shot) => shot.output).map((shot) => { const index = shots.findIndex((item) => item.id === shot.id); return <article key={shot.id}><video src={shot.output} controls loop playsInline/><div><strong>Scene {index + 1} · {shot.name}</strong><a href={`/api/download?url=${encodeURIComponent(shot.output)}&name=frame-motion-scene-${index + 1}.mp4`}>Download MP4</a></div></article>; })}</div></div>
      </div>
    </section> : mode === "extend" ? <section className="workspace extension-workspace">
      <div className="panel source-panel"><Heading number="01" title="Clip to extend" note="We use its exact final frame"/><button className={`dropzone ${extendPreview ? "has-image" : ""}`} onClick={() => extendInputRef.current?.click()}>{extendPreview ? <><video src={extendPreview} controls playsInline/><span className="replace">Replace clip</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Upload the previous clip</strong><small>MP4, MOV or WebM · 100 MB max</small></div>}</button><input ref={extendInputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => acceptExtensionFile(e.target.files?.[0])}/>{extendName && <div className="file-row"><span>{extendName}</span><button onClick={() => { if (extendPreview) URL.revokeObjectURL(extendPreview); setExtendPreview(""); setExtendSource(""); setExtendName(""); setExtendOutput(""); }}>Remove</button></div>}</div>
      <DirectionPanel imageSource={extendSource} motion={motion} setMotion={setMotion} category={category} setCategory={setCategory} speed={speed} setSpeed={setSpeed} aspect={aspect} setAspect={setAspect} engine={engine} setEngine={setEngine} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} soundDirection={soundDirection} setSoundDirection={setSoundDirection} voiceoverEnabled={voiceoverEnabled} setVoiceoverEnabled={setVoiceoverEnabled} voiceoverText={voiceoverText} setVoiceoverText={setVoiceoverText} connected={connected} details={details} setDetails={setDetails} resolution={resolution} setResolution={setResolution} frames={frames} setFrames={setFrames} seed={seed} setSeed={setSeed} branding={brandingProps} showMotion/>
      <div className="panel output-panel"><Heading number="03" title="Generate extension" note="A new clip begins from the extracted final frame"/><div className="output-stage">{extendOutput ? <video src={extendOutput} controls autoPlay loop playsInline/> : extendSource ? <img className="extension-frame" src={extendSource} alt="Extracted final frame used for extension"/> : <div className="empty-output"><span>▶</span><strong>Your extended clip will appear here</strong><small>Upload a clip to prepare its final frame.</small></div>}{["preparing","starting","processing","finishing"].includes(status) && <div className="processing"><span className="spinner"/><strong>{status === "preparing" ? "Extracting final frame" : status === "starting" ? "Starting extension" : status === "finishing" ? "Adding listing overlays" : "Extending scene"}</strong><small>This can take one to three minutes.</small></div>}</div>{error && <div className="error">{error}</div>}<button className="generate" onClick={generateExtension} disabled={!connected || !extendSource || ["preparing","starting","processing","finishing"].includes(status)}>{!connected ? "Connect Replicate first" : ["starting","processing","finishing"].includes(status) ? "Extending…" : "Extend scene"}<span>→</span></button>{extendOutput && <a className="download" href={extendOutput.startsWith("blob:") ? extendOutput : `/api/download?url=${encodeURIComponent(extendOutput)}&name=frame-motion-extension.mp4`} download={extendOutput.startsWith("blob:") ? `frame-motion-extension.${extendOutputFormat}` : undefined}>Download extension {extendOutputFormat.toUpperCase()}</a>}{historyMessage && <p className="history-message">{historyMessage}</p>}<div className="cost-line"><span>Estimated generation cost</span><strong>${price.toFixed(2)} per extension</strong></div></div>
    </section> : mode === "history" ? <section className="history-area" aria-live="polite">
      <div className="history-heading"><div><span className="label">PRIVATE VIDEO MEMORY</span><h2>Generation history</h2><p>Successful videos are saved here for this browser, with their prompt, settings and estimated generation cost.</p></div><button onClick={loadHistory} disabled={historyLoading}>{historyLoading ? "Refreshing…" : "Refresh"}</button></div>
      {historyMessage && <p className="history-message history-wide">{historyMessage}</p>}
      {historyLoading ? <div className="history-empty">Loading saved videos…</div> : history.length ? <div className="history-grid">{history.map((item) => <article className="history-card" key={item.id}><video src={item.videoUrl} controls preload="metadata" playsInline/><div className="history-card-body"><div className="history-meta"><span>{engineLabel(item.engine)}</span><span>{item.resolution}</span><span>{item.aspect}</span><span>{item.duration}s</span></div><p>{item.prompt}</p><div className="history-card-footer"><div><strong>${(item.costCents / 100).toFixed(2)}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><div><a href={item.downloadUrl}>Download</a><button onClick={() => removeHistoryItem(item.id)}>Remove</button></div></div></div></article>)}</div> : <div className="history-empty"><strong>No saved videos yet.</strong><span>Your next successful generation will appear here automatically.</span></div>}
    </section> : <section className="workspace upscale-workspace">
      <div className="panel source-panel"><Heading number="01" title="Video to upscale" note="Short clips work best"/><button className={`dropzone ${upscalePreview ? "has-image" : ""}`} onClick={() => upscaleInputRef.current?.click()}>{upscalePreview ? <><video src={upscalePreview} controls playsInline/><span className="replace">Replace video</span></> : <div className="drop-copy"><span className="upload-icon">↑</span><strong>Upload a finished video</strong><small>MP4, MOV or WebM · 20 MB max</small></div>}</button><input ref={upscaleInputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => acceptUpscaleFile(event.target.files?.[0])}/>{upscaleName && <div className="file-row"><span>{upscaleName}{upscaleDuration ? ` · ${upscaleDuration.toFixed(1)}s` : ""}</span><button onClick={() => { if (upscalePreview) URL.revokeObjectURL(upscalePreview); setUpscalePreview(""); setUpscaleSource(""); setUpscaleName(""); setUpscaleOutput(""); }}>Remove</button></div>}</div>
      <div className="panel upscale-controls"><Heading number="02" title="Choose the finish" note="Upscaling improves resolution, not the original composition"/><div className="segmented-control"><span className="label">Target resolution</span><div><button className={upscaleTarget === "1080p" ? "active" : ""} onClick={() => setUpscaleTarget("1080p")}><strong>1080p</strong><small>Best value</small></button><button className={upscaleTarget === "4k" ? "active" : ""} onClick={() => setUpscaleTarget("4k")}><strong>4K</strong><small>Maximum detail</small></button></div></div><div className="segmented-control"><span className="label">Frame rate</span><div><button className={upscaleFps === 30 ? "active" : ""} onClick={() => setUpscaleFps(30)}><strong>30 FPS</strong><small>Natural</small></button><button className={upscaleFps === 60 ? "active" : ""} onClick={() => setUpscaleFps(60)}><strong>60 FPS</strong><small>Smoother</small></button></div></div><div className="upscale-cost"><span>Approximate processing cost</span><strong>{upscaleDuration ? `$${((upscaleDuration / 5) * .747).toFixed(2)}` : "$0.75 per 5 seconds"}</strong><small>Actual processing cost varies with input and output settings.</small></div><p className="upscale-note">Use 1080p for most web and social delivery. Choose 4K only when you need the extra resolution.</p></div>
      <div className="panel output-panel"><Heading number="03" title="Upscaled video" note="Compare, review and download"/><div className="output-stage">{upscaleOutput ? <video src={upscaleOutput} controls autoPlay loop playsInline/> : <div className="empty-output"><span>◇</span><strong>Your enhanced video will appear here</strong><small>Upload a clip and choose the target quality.</small></div>}{["preparing","starting","processing"].includes(upscaleStatus) && <div className="processing"><span className="spinner"/><strong>{upscaleStatus === "preparing" ? "Preparing video" : upscaleStatus === "starting" ? "Starting enhancement" : "Upscaling video"}</strong><small>Higher resolutions can take several minutes.</small></div>}</div>{upscaleError && <div className="error">{upscaleError}</div>}<button className="generate" onClick={upscaleVideo} disabled={!connected || !upscaleSource || ["preparing","starting","processing"].includes(upscaleStatus)}>{!connected ? "Connect Replicate first" : upscaleStatus === "starting" || upscaleStatus === "processing" ? "Upscaling…" : `Upscale to ${upscaleTarget === "4k" ? "4K" : "1080p"}`}<span>→</span></button>{upscaleOutput && <a className="download" href={`/api/download?url=${encodeURIComponent(upscaleOutput)}&name=frame-motion-upscaled-${upscaleTarget}.mp4`}>Download upscaled MP4</a>}</div>
    </section>}
    {mode === "single" && <section className="prompt-strip"><div><span className="label">Final prompt sent to the video engine</span><p>{finalPrompt}</p></div><button onClick={() => navigator.clipboard.writeText(finalPrompt)}>Copy</button></section>}
    <footer><span>FRAME MOTION STUDIO</span><p>Your token remains private. Successful generations are saved to your private History.</p></footer>
  </main>;
}

function Heading({ number, title, note }: { number: string; title: string; note: string }) { return <div className="panel-heading"><span>{number}</span><div><h2>{title}</h2><p>{note}</p></div></div>; }
type DirectionProps = { imageSource?: string; motion: MotionKey; setMotion: (v: MotionKey) => void; category: keyof typeof qualityPrompts; setCategory: (v: keyof typeof qualityPrompts) => void; speed: SpeedKey; setSpeed: (v: SpeedKey) => void; aspect: AspectKey; setAspect: (v: AspectKey) => void; engine: EngineKey; setEngine: (v: EngineKey) => void; soundEnabled: boolean; setSoundEnabled: (v: boolean) => void; soundDirection: string; setSoundDirection: (v: string) => void; voiceoverEnabled: boolean; setVoiceoverEnabled: (v: boolean) => void; voiceoverText: string; setVoiceoverText: (v: string) => void; connected: boolean | null; details: string; setDetails: (v: string) => void; resolution: ResolutionKey; setResolution: (v: ResolutionKey) => void; frames: ClipFrames; setFrames: (v: ClipFrames) => void; seed: string; setSeed: (v: string) => void; branding: RealEstateBrandingProps; showMotion: boolean };

function SpeedControl({ speed, setSpeed }: { speed: SpeedKey; setSpeed: (v: SpeedKey) => void }) { return <div className="segmented-control"><span className="label">Motion speed</span><div>{(["slow","medium","fast"] as SpeedKey[]).map((item) => <button key={item} className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}><strong>{item}</strong><small>{item === "slow" ? "Cinematic" : item === "medium" ? "Natural" : "Energetic"}</small></button>)}</div></div>; }
function FrameControl({ aspect, setAspect }: { aspect: AspectKey; setAspect: (v: AspectKey) => void }) { const options: Array<[AspectKey,string,string]> = [["horizontal","16:9","Horizontal"],["vertical","9:16","Social"],["cinematic","2.39","Crop-safe"]]; return <div className="segmented-control frame-control"><span className="label">Frame size</span><div>{options.map(([key,ratio,note]) => <button key={key} className={aspect === key ? "active" : ""} onClick={() => setAspect(key)}><strong>{ratio}</strong><small>{note}</small></button>)}</div>{aspect === "cinematic" && <p>Important action stays safe for a wide 2.39:1 cinematic crop.</p>}</div>; }
function EnginePicker({ engine, setEngine, resolution, setResolution, threeSecondOnly = false }: { engine: EngineKey; setEngine: (value: EngineKey) => void; resolution: ResolutionKey; setResolution: (value: ResolutionKey) => void; threeSecondOnly?: boolean }) {
  function choose(next: EngineKey) {
    setEngine(next);
    if (!resolutionOptions[next].some((item) => item.value === resolution)) setResolution(resolutionOptions[next][0].value);
  }
  const choices = threeSecondOnly ? engineOptions.filter((item) => supportsThreeSeconds(item.key)) : engineOptions;
  return <div className="engine-choice"><span className="label">1 · Choose your video engine{threeSecondOnly ? " · supports 3-second clips" : ""}</span>{choices.map((item) => <button key={item.key} className={engine === item.key ? `active ${["wan3", "seedance25", "seedance15", "runway45", "runway4turbo", "geminiomni", "kling3"].includes(item.key) ? "studio" : ""}` : ""} onClick={() => choose(item.key)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</div>;
}

function ClipLengthSelect({ engine, frames, setFrames }: { engine: EngineKey; frames: ClipFrames; setFrames: (value: ClipFrames) => void }) {
  if (engine === "geminiomni") return <select value={121} disabled><option value={121}>10 seconds · fixed by Gemini</option></select>;
  return <select value={frames === 49 && !supportsThreeSeconds(engine) ? 81 : frames} onChange={(event) => setFrames(Number(event.target.value) as ClipFrames)}>{supportsThreeSeconds(engine) && <option value={49}>3 seconds · most stable motion</option>}<option value={81}>{engine === "wan22" ? "81 frames · about 5 seconds" : "5 seconds"}</option><option value={121}>{engine === "wan22" ? "121 frames · about 8 seconds" : "10 seconds"}</option></select>;
}

function ResolutionSelect({ engine, resolution, setResolution, frames, audioEnabled, totalLabel = "Estimated cost for this video" }: { engine: EngineKey; resolution: ResolutionKey; setResolution: (value: ResolutionKey) => void; frames: ClipFrames; audioEnabled: boolean; totalLabel?: string }) {
  return <><select value={resolution} onChange={(event) => setResolution(event.target.value as ResolutionKey)}>{resolutionOptions[engine].map((item) => <option key={item.value} value={item.value}>{item.label} · ${estimateCost(engine, item.value, frames, audioEnabled).toFixed(2)}</option>)}</select><small className="quality-price">{totalLabel}: ${estimateCost(engine, resolution, frames, audioEnabled).toFixed(2)}</small></>;
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

function PromptDirector(props: Pick<DirectionProps,"category"|"motion"|"speed"|"aspect"|"soundEnabled"|"soundDirection"|"connected"|"setDetails"|"imageSource"> & { compact?: boolean; targetId: string }) {
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
  async function createFromImage() {
    if (!props.imageSource) return setMessage("Upload the image first so it can be analyzed.");
    setWorking(true); setMessage(""); setReady(false);
    try { const response = await fetch("/api/auto-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: props.imageSource, vision, category: props.category, motion: props.motion, speed: props.speed, aspect: props.aspect }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); const result = data.status === "succeeded" ? data.prompt : await waitForPrompt(data.id); if (!result.trim()) throw new Error("The image analysis returned an empty prompt."); props.setDetails(cleanGeneratedPrompt(result)); setMessage("The image was analyzed and its prompt was transferred to the field below."); setReady(true); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The image could not be analyzed."); }
    finally { setWorking(false); }
  }
  return <div className={props.compact ? "prompt-director compact" : "prompt-director"}><div><span className="ai-badge">✦ AI CINEMATIC PROMPT BUILDER</span><strong>Describe it—or let the image decide.</strong><p>{props.compact ? "Speak, type, or analyze this scene image automatically." : "Speak or type your idea, or let AI analyze the uploaded image and create fitting cinematic direction automatically."}</p></div><DictationTextarea rows={props.compact ? 2 : 4} value={vision} onValue={setVision} ariaLabel="Describe your video idea" placeholder="Optional: add your own idea, or leave this blank and use Analyze image."/><div className="prompt-actions"><button onClick={createPrompt} disabled={!props.connected || working || vision.trim().length < 8}>{working ? "Working…" : "Use my idea"}<span>✦</span></button><button className="analyze-image" onClick={createFromImage} disabled={!props.connected || working || !props.imageSource}>{!props.imageSource ? "Upload image first" : "Analyze image automatically"}<span>◎</span></button></div>{message && <small className={ready ? "prompt-ready-message" : ""}>{message}</small>}{ready && <button type="button" className="prompt-jump" onClick={revealPrompt}><span>↓</span> See your generated prompt</button>}</div>;
}

function RealEstateBrandingPanel(props: RealEstateBrandingProps) {
  return <section className="listing-overlays">
    <div className="overlay-heading"><span>REALTOR VIDEO ADD-ONS</span><strong>Property details and agent branding</strong><p>Optional information is added cleanly after generation, so the real-estate scene remains protected.</p></div>
    <div className="overlay-option">
      <button type="button" className={props.listingEnabled ? "overlay-toggle active" : "overlay-toggle"} onClick={() => props.setListingEnabled(!props.listingEnabled)}><span><strong>Opening property information</strong><small>Address, key facts, price and a short message</small></span><i>{props.listingEnabled ? "ON" : "OFF"}</i></button>
      {props.listingEnabled && <div className="overlay-fields"><label><span className="label">Property address or title</span><input value={props.listingTitle} onChange={(e) => props.setListingTitle(e.target.value)} placeholder="18 Beacon Street, Boston"/></label><div className="listing-facts-grid"><label><span className="label">Beds</span><input value={props.listingBeds} onChange={(e) => props.setListingBeds(formatWholeNumber(e.target.value))} inputMode="numeric" placeholder="3"/></label><label><span className="label">Baths</span><input value={props.listingBaths} onChange={(e) => props.setListingBaths(formatBaths(e.target.value))} inputMode="decimal" placeholder="2.5"/></label><label><span className="label">Square feet</span><input value={props.listingSquareFeet} onChange={(e) => props.setListingSquareFeet(formatWholeNumber(e.target.value))} inputMode="numeric" placeholder="1,850"/></label></div><div className="listing-price-grid"><label><span className="label">Price</span><input value={props.listingPrice} onChange={(e) => props.setListingPrice(formatCurrency(e.target.value))} inputMode="numeric" placeholder="$1,250,000"/></label><label><span className="label">Optional message</span><input value={props.listingMessage} onChange={(e) => props.setListingMessage(e.target.value)} placeholder="Private showings available"/></label></div></div>}
    </div>
    <div className="overlay-option">
      <button type="button" className={props.agentEnabled ? "overlay-toggle active" : "overlay-toggle"} onClick={() => props.setAgentEnabled(!props.agentEnabled)}><span><strong>Closing realtor card</strong><small>Logo, agent name, phone and email</small></span><i>{props.agentEnabled ? "ON" : "OFF"}</i></button>
      {props.agentEnabled && <div className="overlay-fields"><label className="logo-upload"><span className="label">Agency or realtor logo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => props.acceptAgentLogo(e.target.files?.[0])}/><span>PNG with a transparent background works best · 5 MB max</span></label>{props.agentLogo && <div className="logo-preview"><img src={props.agentLogo} alt="Realtor logo preview"/><span>{props.agentLogoName}</span><button type="button" onClick={props.removeAgentLogo}>Remove</button></div>}<label><span className="label">Agent name</span><input value={props.agentName} onChange={(e) => props.setAgentName(e.target.value)} placeholder="Jordan Lee"/></label><div className="field-row"><label><span className="label">Phone</span><input value={props.agentPhone} onChange={(e) => props.setAgentPhone(formatPhone(e.target.value))} inputMode="tel" placeholder="617-555-0142"/></label><label><span className="label">Email</span><input value={props.agentEmail} onChange={(e) => props.setAgentEmail(e.target.value)} inputMode="email" placeholder="jordan@agency.com"/></label></div></div>}
    </div>
    <p className="overlay-note">In a series, property information appears on the first clip and the realtor card appears on the final clip.</p>
  </section>;
}

function DirectionPanel(props: DirectionProps) {
  return <div className="panel direction-panel"><Heading number="02" title={`Direct the ${props.showMotion ? "shot" : "series"}`} note={props.motion === "mixed" ? "AI will choose the best movement combination" : "One deliberate movement works best"}/>
    {props.showMotion && <><label className="label">Camera movement</label><div className="motion-grid">{motions.map((item) => <button key={item.key} className={props.motion === item.key ? "motion active" : "motion"} onClick={() => props.setMotion(item.key)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</div></>}
    {props.category !== "interior" && <PromptDirector imageSource={props.imageSource} targetId="direction-details" category={props.category} motion={props.motion} speed={props.speed} aspect={props.aspect} soundEnabled={props.soundEnabled && engineHasAudio(props.engine)} soundDirection={props.soundDirection} connected={props.connected} setDetails={props.setDetails}/>}<SpeedControl speed={props.speed} setSpeed={props.setSpeed}/><FrameControl aspect={props.aspect} setAspect={props.setAspect}/>
    <EnginePicker engine={props.engine} setEngine={props.setEngine} resolution={props.resolution} setResolution={props.setResolution}/>
    <div className="field-row"><label><span className="label">Shot type</span><select value={props.category} onChange={(e) => props.setCategory(e.target.value as keyof typeof qualityPrompts)}><option value="interior">Real estate · interior/exterior</option><option value="people">People / lifestyle</option></select></label><label><span className="label">2 · Quality and estimated price</span><ResolutionSelect engine={props.engine} resolution={props.resolution} setResolution={props.setResolution} frames={props.frames} audioEnabled={props.soundEnabled || (props.voiceoverEnabled && Boolean(props.voiceoverText.trim()))}/></label></div>
    {props.category === "interior" && <><div className="real-estate-lock"><strong>Real-estate camera lock is active</strong><span>Only the camera may move. Property geometry, furniture, décor, lighting, landscaping and every object are locked in place.</span></div><RealEstateBrandingPanel {...props.branding}/></>}
    {engineHasAudio(props.engine) && <div className="sound-card"><button className={props.soundEnabled ? "sound-toggle active" : "sound-toggle"} onClick={() => props.setSoundEnabled(!props.soundEnabled)}><span><strong>Music & sound effects</strong><small>Generated and synchronized with the video</small></span><i>{props.soundEnabled ? "ON" : "OFF"}</i></button>{props.soundEnabled && <label><span className="label">Sound direction</span><DictationTextarea rows={3} value={props.soundDirection} onValue={props.setSoundDirection} placeholder="Describe music, ambience and synchronized effects." ariaLabel="Sound direction"/></label>}<button className={props.voiceoverEnabled ? "sound-toggle active voiceover-toggle" : "sound-toggle voiceover-toggle"} onClick={() => props.setVoiceoverEnabled(!props.voiceoverEnabled)}><span><strong>Voiceover</strong><small>Add spoken narration to this video</small></span><i>{props.voiceoverEnabled ? "ON" : "OFF"}</i></button>{props.voiceoverEnabled && <label><span className="label">Voiceover script</span><DictationTextarea rows={4} value={props.voiceoverText} onValue={props.setVoiceoverText} placeholder="Type or dictate exactly what the narrator should say." ariaLabel="Voiceover script"/><small className="voiceover-note">AI speech can vary slightly. Review the spoken wording before final delivery.</small></label>}</div>}
    <label><span className="label">{props.category === "interior" ? "Locked real-estate prompt" : "Direction details"}</span>{props.category === "interior" ? <textarea id="direction-details" className="locked-prompt" value={realEstatePrompt(props.motion)} rows={7} readOnly/> : <DictationTextarea id="direction-details" value={props.details} onValue={props.setDetails} rows={6} placeholder="Describe only what should move and what must remain stable." ariaLabel="Direction details"/>}</label>
    <details><summary>Advanced controls</summary><div className="field-row advanced"><label><span className="label">Length</span><ClipLengthSelect engine={props.engine} frames={props.frames} setFrames={props.setFrames}/></label><label><span className="label">Seed</span><input value={props.seed} onChange={(e) => props.setSeed(e.target.value.replace(/\D/g, ""))} placeholder={props.engine === "geminiomni" ? "Not used by Gemini" : "Random"} inputMode="numeric" disabled={props.engine === "geminiomni"}/></label></div></details>
  </div>;
}
