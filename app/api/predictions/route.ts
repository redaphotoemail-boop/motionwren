import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ENDPOINTS: Record<string, string> = {
  wan22: "https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions",
  wan25: "https://api.replicate.com/v1/models/wan-video/wan-2.5-i2v/predictions",
  wan26flash: "https://api.replicate.com/v1/models/wan-video/wan2.6-i2v-flash/predictions",
  wan26: "https://api.replicate.com/v1/models/wan-video/wan-2.6-i2v/predictions",
  wan3: "https://api.replicate.com/v1/models/alibaba/wan-3/predictions",
  seedance25: "https://api.replicate.com/v1/models/bytedance/seedance-2.5/predictions",
  seedance15: "https://api.replicate.com/v1/models/bytedance/seedance-1.5-pro/predictions",
  runway45: "https://api.replicate.com/v1/models/runwayml/gen-4.5/predictions",
  runway4turbo: "https://api.replicate.com/v1/models/runwayml/gen4-turbo/predictions",
  minimaxh3: "https://api.replicate.com/v1/models/minimax/h3/predictions",
  geminiomni: "https://api.replicate.com/v1/models/google/gemini-omni-1.1/predictions",
  kling3: "https://api.replicate.com/v1/models/kwaivgi/kling-v3-video/predictions",
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "The Replicate API token has not been connected yet." }, { status: 503 });
  try {
    const body = await request.json();
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) return NextResponse.json({ error: "A valid source image is required." }, { status: 400 });
    if (body.image.length > 1_500_000) return NextResponse.json({ error: "The prepared image is too large. Use a smaller JPEG." }, { status: 413 });
    if (typeof body.prompt !== "string" || body.prompt.trim().length < 20) return NextResponse.json({ error: "A clear motion prompt is required." }, { status: 400 });
    const engine = typeof body.engine === "string" && ENDPOINTS[body.engine] ? body.engine : "wan26flash";
    const requestedResolution = typeof body.resolution === "string" ? body.resolution : "720p";
    const resolution = ["360p", "480p", "720p", "768p", "1080p", "2k", "4k"].includes(requestedResolution) ? requestedResolution : "720p";
    const duration = body.num_frames === 49 ? 3 : body.num_frames === 121 ? 10 : 5;
    const negativePrompt = "warping, morphing, flicker, unstable geometry, fake text, distorted hands, broken continuity";
    let input: Record<string, unknown>;
    if (engine === "wan22") {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        resolution: resolution === "720p" ? "720p" : "480p",
        aspect_ratio: body.aspect_ratio === "9:16" ? "9:16" : "16:9",
        num_frames: body.num_frames === 121 ? 121 : 81,
        frames_per_second: 16,
        interpolate_output: false,
        go_fast: true,
        disable_safety_checker: false,
      };
    } else if (engine === "minimaxh3") {
      input = {
        first_frame_image: body.image,
        prompt: body.prompt.slice(0, 4000),
        resolution: resolution === "2k" ? "2K" : "768P",
        duration,
        ratio: "adaptive",
      };
    } else if (engine === "seedance25") {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        duration,
        resolution: resolution === "480p" ? "480p" : "720p",
        aspect_ratio: "adaptive",
        generate_audio: Boolean(body.audio_enabled),
        watermark: false,
        output_format: "mp4",
      };
    } else if (engine === "seedance15") {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        duration,
        resolution: ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p",
        aspect_ratio: body.aspect_ratio === "9:16" ? "9:16" : "16:9",
        fps: 24,
        camera_fixed: false,
        generate_audio: Boolean(body.audio_enabled),
      };
    } else if (engine === "runway45" || engine === "runway4turbo") {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        duration,
        aspect_ratio: body.aspect_ratio === "9:16" ? "9:16" : "16:9",
      };
    } else if (engine === "geminiomni") {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        resolution: ["360p", "720p", "1080p", "4k"].includes(resolution) ? resolution : "720p",
        aspect_ratio: body.aspect_ratio === "9:16" ? "9:16" : "16:9",
      };
    } else if (engine === "kling3") {
      input = {
        start_image: body.image,
        prompt: body.prompt.slice(0, 2500),
        negative_prompt: negativePrompt,
        mode: resolution === "4k" ? "4k" : resolution === "1080p" ? "pro" : "standard",
        duration,
        aspect_ratio: body.aspect_ratio === "9:16" ? "9:16" : "16:9",
        generate_audio: Boolean(body.audio_enabled),
      };
    } else {
      input = {
        image: body.image,
        prompt: body.prompt.slice(0, 4000),
        resolution: (engine === "wan26flash" || engine === "wan26") && resolution === "480p" ? "720p" : ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p",
        duration,
        enable_prompt_expansion: true,
        negative_prompt: negativePrompt,
      };
      if (engine === "wan26flash" || engine === "wan26") input.multi_shots = false;
      if (engine === "wan26flash") input.audio_enabled = Boolean(body.audio_enabled);
    }
    if (engine !== "geminiomni" && engine !== "kling3" && Number.isInteger(body.seed) && body.seed >= 0) input.seed = body.seed;
    const response = await fetch(ENDPOINTS[engine], {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=25" },
      body: JSON.stringify({ input }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: (data.detail as string) || (data.error as string) || "Replicate rejected the generation." }, { status: response.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "The generation request could not be processed." }, { status: 500 });
  }
}
