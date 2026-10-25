import { studioEngine, type StudioEngineKey, type StudioResolution } from "./engine-catalog";

/* Replicate endpoints and per-engine input shapes for customer production.
   These mirror app/api/predictions/route.ts (the owner studio lab), which
   stays untouched — this module lets the customer generate path use the
   manager's selected engine without duplicating the map inside it. The one
   difference from the lab: the customer path passes a hosted image URL
   (its uploaded asset served back to the provider), not a data URL. URL
   acceptance is proven for Kling (today's customer path); other engines
   need one live render each to confirm their models accept a URL here. */

export const ENGINE_ENDPOINTS: Record<StudioEngineKey, string> = {
  kling3: "https://api.replicate.com/v1/models/kwaivgi/kling-v3-video/predictions",
  geminiOmni: "https://api.replicate.com/v1/models/google/gemini-omni-1.1/predictions",
  veo31Lite: "https://api.replicate.com/v1/models/google/veo-3.1-lite/predictions",
  hailuo23: "https://api.replicate.com/v1/models/minimax/hailuo-2.3/predictions",
  runway45: "https://api.replicate.com/v1/models/runwayml/gen-4.5/predictions",
  wan22: "https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions",
  wan25: "https://api.replicate.com/v1/models/wan-video/wan-2.5-i2v/predictions",
  wan27: "https://api.replicate.com/v1/models/wan-video/wan-2.7-i2v/predictions",
  wan3: "https://api.replicate.com/v1/models/alibaba/wan-3/predictions",
  seedance1fast: "https://api.replicate.com/v1/models/bytedance/seedance-1-pro-fast/predictions",
};

export const ENGINE_KEYS: StudioEngineKey[] = ["kling3", "geminiOmni", "veo31Lite", "hailuo23", "runway45", "wan22", "wan25", "wan27", "wan3", "seedance1fast"];

export function isEngineKey(value: unknown): value is StudioEngineKey {
  return typeof value === "string" && (ENGINE_KEYS as string[]).includes(value);
}

const NEGATIVE = "warping, morphing, flicker, unstable geometry, fake text, distorted hands, broken continuity, invented objects, unwanted object movement, shake, jitter";
/* The customer path's original Kling negative prompt (real-estate static
   locks), kept verbatim so the default engine's output does not change. */
const KLING_NEGATIVE = "object movement, people moving, hands, touching, furniture movement, curtain movement, plant movement, water movement, reflection movement, lighting changes, warped walls, bending lines, altered architecture, morphing, melting, duplication, invented objects, disappearing objects, flicker, shake, jitter, handheld movement, walking bounce, horizon drift";

/* Highest resolution the engine supports (1080p when available). The
   customer path used to force 1080p; engines like Runway 4.5 (720p only)
   and Wan 2.2 Fast (720p max) must snap down instead of failing. */
export function engineResolution(engine: StudioEngineKey): StudioResolution {
  const supported = studioEngine(engine).resolutions;
  return supported.includes("1080p") ? "1080p" : supported[supported.length - 1];
}

export type EngineInputOptions = { imageUrl: string; prompt: string; duration: number; resolution: StudioResolution; aspectRatio: "16:9" | "9:16" };

export function buildEngineInput(engine: StudioEngineKey, options: EngineInputOptions): Record<string, unknown> {
  const prompt = options.prompt.slice(0, 4000);
  const noAudio = "No dialogue, no music, and no sound effects.";
  if (engine === "kling3") return { start_image: options.imageUrl, prompt, duration: options.duration, mode: options.resolution === "1080p" ? "pro" : "standard", aspect_ratio: options.aspectRatio, generate_audio: false, negative_prompt: KLING_NEGATIVE };
  if (engine === "geminiOmni") return { image: options.imageUrl, prompt: `${options.prompt.slice(0, 3800)} ${noAudio}`, resolution: options.resolution === "480p" ? "720p" : options.resolution, aspect_ratio: options.aspectRatio };
  if (engine === "veo31Lite") return { image: options.imageUrl, prompt: `${options.prompt.slice(0, 3800)} ${noAudio}`, resolution: options.resolution === "480p" ? "720p" : options.resolution, duration: options.duration, aspect_ratio: options.aspectRatio };
  if (engine === "hailuo23") return { first_frame_image: options.imageUrl, prompt, duration: options.duration, resolution: options.resolution === "1080p" ? "1080p" : "768p", prompt_optimizer: false };
  if (engine === "runway45") return { image: options.imageUrl, prompt, duration: options.duration, aspect_ratio: options.aspectRatio };
  if (engine === "wan22") return { image: options.imageUrl, prompt, resolution: options.resolution === "1080p" ? "720p" : options.resolution, aspect_ratio: options.aspectRatio, num_frames: options.duration >= 10 ? 121 : 81, frames_per_second: 16, interpolate_output: false, go_fast: true, disable_safety_checker: false };
  if (engine === "wan25") return { image: options.imageUrl, prompt, resolution: options.resolution, duration: options.duration, enable_prompt_expansion: true, negative_prompt: NEGATIVE };
  if (engine === "wan27") return { first_frame: options.imageUrl, prompt, resolution: options.resolution === "480p" ? "720p" : options.resolution, duration: options.duration, enable_prompt_expansion: true, negative_prompt: NEGATIVE };
  if (engine === "wan3") return { image: options.imageUrl, prompt, resolution: options.resolution, aspect_ratio: options.aspectRatio, duration: options.duration, enable_prompt_expansion: true, negative_prompt: NEGATIVE };
  return { image: options.imageUrl, prompt, resolution: options.resolution, aspect_ratio: options.aspectRatio, duration: options.duration, fps: 24, camera_fixed: false };
}
