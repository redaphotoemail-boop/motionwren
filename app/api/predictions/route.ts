import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin, jsonError } from "../_lib/account";
import { preferredDurationForEngine, type StudioEngineKey } from "../../engine-catalog";

const ENDPOINTS: Record<StudioEngineKey, string> = {
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

const ENGINE_KEYS = new Set<StudioEngineKey>(["kling3", "geminiOmni", "veo31Lite", "hailuo23", "runway45", "wan22", "wan25", "wan27", "wan3", "seedance1fast"]);

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const cookieStore = await cookies();
    const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
    if (!token) return NextResponse.json({ error: "The Replicate API token has not been connected yet." }, { status: 503 });
    const body = await request.json();
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) return NextResponse.json({ error: "A valid source image is required." }, { status: 400 });
    if (body.image.length > 1_500_000) return NextResponse.json({ error: "The prepared image is too large. Use a smaller JPEG." }, { status: 413 });
    if (body.transition && (typeof body.last_image !== "string" || !body.last_image.startsWith("data:image/"))) return NextResponse.json({ error: "A valid last frame is required." }, { status: 400 });
    if (body.transition && body.last_image.length > 1_500_000) return NextResponse.json({ error: "The prepared last frame is too large. Use a smaller JPEG." }, { status: 413 });
    if (typeof body.prompt !== "string" || body.prompt.trim().length < 20) return NextResponse.json({ error: "A clear motion prompt is required." }, { status: 400 });
    const requestedEngine = body.engine === "fast" ? "wan22" : body.engine === "studio" ? "wan25" : body.engine;
    const engine: StudioEngineKey = ENGINE_KEYS.has(requestedEngine) ? requestedEngine : "kling3";
    const transition = body.transition === true;
    const requestedDuration = Number(body.duration) || (body.num_frames === 121 ? 10 : 5);
    const resolution = body.resolution === "1080p" ? "1080p" : body.resolution === "720p" ? "720p" : "480p";
    const duration = preferredDurationForEngine(engine, Math.max(3, Math.min(15, Math.round(requestedDuration))), resolution);
    const aspectRatio = body.aspect_ratio === "9:16" ? "9:16" : "16:9";
    const negativePrompt = "warping, morphing, flicker, unstable geometry, fake text, distorted hands, broken continuity, invented objects, unwanted object movement, shake, jitter";
    let input: Record<string, unknown>;
    if (transition) input = {
      first_frame: body.image,
      last_frame: body.last_image,
      prompt: body.prompt.slice(0, 4000),
      duration,
      resolution: resolution === "480p" ? "720p" : resolution,
      enable_prompt_expansion: false,
      negative_prompt: "people entering, hands touching objects, object interaction, independent object movement, morphing, warping, melting, invented objects, new elements, geometry changes, flicker, shake, jitter, handheld motion, cuts",
    };
    else if (engine === "kling3") input = {
      start_image: body.image,
      prompt: body.prompt.slice(0, 4000),
      duration,
      mode: resolution === "1080p" ? "pro" : "standard",
      aspect_ratio: aspectRatio,
      generate_audio: body.audio === true,
      negative_prompt: negativePrompt,
    };
    else if (engine === "geminiOmni") input = {
      image: body.image,
      prompt: `${body.prompt.slice(0, 3800)} ${body.audio === true ? "Generate restrained synchronized ambience." : "No dialogue, no music, and no sound effects."}`,
      resolution: resolution === "480p" ? "720p" : resolution,
      aspect_ratio: aspectRatio,
    };
    else if (engine === "veo31Lite") input = {
      image: body.image,
      prompt: `${body.prompt.slice(0, 3800)} ${body.audio === true ? "Generate restrained synchronized ambience." : "No dialogue, no music, and no sound effects."}`,
      resolution: resolution === "480p" ? "720p" : resolution,
      duration: duration,
      aspect_ratio: aspectRatio,
    };
    else if (engine === "hailuo23") input = {
      first_frame_image: body.image,
      prompt: body.prompt.slice(0, 4000),
      duration: duration,
      resolution: resolution === "1080p" ? "1080p" : "768p",
      prompt_optimizer: false,
    };
    else if (engine === "runway45") input = {
      image: body.image,
      prompt: body.prompt.slice(0, 4000),
      duration,
      aspect_ratio: aspectRatio,
    };
    else if (engine === "wan22") input = {
      image: body.image,
      prompt: body.prompt.slice(0, 4000),
      resolution: resolution === "1080p" ? "720p" : resolution,
      aspect_ratio: aspectRatio,
      num_frames: duration >= 10 ? 121 : 81,
      frames_per_second: 16,
      interpolate_output: false,
      go_fast: true,
      disable_safety_checker: false,
    };
    else if (engine === "wan25") input = { image: body.image, prompt: body.prompt.slice(0, 4000), resolution, duration, enable_prompt_expansion: true, negative_prompt: negativePrompt };
    else if (engine === "wan27") input = { first_frame: body.image, prompt: body.prompt.slice(0, 4000), resolution: resolution === "480p" ? "720p" : resolution, duration, enable_prompt_expansion: true, negative_prompt: negativePrompt };
    else if (engine === "wan3") input = { image: body.image, prompt: body.prompt.slice(0, 4000), resolution, aspect_ratio: aspectRatio, duration, enable_prompt_expansion: true, negative_prompt: negativePrompt };
    else input = { image: body.image, prompt: body.prompt.slice(0, 4000), resolution, aspect_ratio: aspectRatio, duration, fps: 24, camera_fixed: false };
    if (Number.isInteger(body.seed) && body.seed >= 0) input.seed = body.seed;
    const response = await fetch(transition ? ENDPOINTS.wan27 : ENDPOINTS[engine], {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: transition ? "respond-async" : "wait=25" },
      body: JSON.stringify({ input }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: (data.detail as string) || (data.error as string) || "Replicate rejected the generation." }, { status: response.status });
    return NextResponse.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
