import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const CAPTION_MODEL = "https://api.replicate.com/v1/models/lucataco/moondream2";
const WRITER_ENDPOINT = "https://api.replicate.com/v1/models/meta/meta-llama-3-8b-instruct/predictions";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Connect Replicate before using automatic image direction." }, { status: 503 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const image = String(body.image || "");
    if (!image.startsWith("data:image/") || image.length > 1_500_000) return NextResponse.json({ error: "Upload a valid source image first." }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" };
    const modelResponse = await fetch(CAPTION_MODEL, { headers: { Authorization: `Bearer ${token}` } });
    const model = await modelResponse.json() as { latest_version?: { id?: string } };
    const version = model.latest_version?.id;
    if (!modelResponse.ok || !version) return NextResponse.json({ error: "Image analysis is temporarily unavailable." }, { status: 502 });

    const captionResponse = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers, body: JSON.stringify({ version, input: { image, prompt: "Analyze this image for cinematic image-to-video direction. Describe the main subject, composition, depth layers, lighting, atmosphere, textures, any visible action, and which elements must remain perfectly stable. Do not identify or invent brands, people, text, or facts." } }) });
    const captionData = await captionResponse.json() as Record<string, unknown>;
    if (!captionResponse.ok || captionData.status !== "succeeded") return NextResponse.json({ error: "The image analysis did not finish. Please try again." }, { status: 502 });
    const caption = Array.isArray(captionData.output) ? captionData.output.join("") : String(captionData.output || "");
    if (!caption.trim()) return NextResponse.json({ error: "The image analysis returned no usable direction." }, { status: 502 });

    const settings = `Content type: ${String(body.category || "product")}. Movement: ${String(body.motion || "mixed")}. Speed: ${String(body.speed || "slow")}. Frame: ${String(body.aspect || "horizontal")}. Optional user direction: ${String(body.vision || "none").slice(0, 1000)}.`;
    const writerResponse = await fetch(WRITER_ENDPOINT, { method: "POST", headers, body: JSON.stringify({ input: {
      prompt: `Create one production-ready image-to-video prompt from this visual analysis.\n\nIMAGE ANALYSIS: ${caption}\n\nSETTINGS: ${settings}\n\nReturn only the finished prompt in 100-160 words. Start directly with the visual direction. Use present tense. Select physically believable camera and environmental movement that fits the actual image. Protect subject identity, geometry, composition, logos, packaging and text. Do not add a title, introduction, provider name or model name. Do not invent anything not supported by the image or user direction.`,
      system_prompt: "You are a cinematic director who converts image analysis into controlled, realistic image-to-video prompts. Output only the final prompt.",
      max_tokens: 360,
      temperature: 0.4,
    } }) });
    const writerData = await writerResponse.json() as Record<string, unknown>;
    if (!writerResponse.ok) return NextResponse.json({ error: (writerData.detail as string) || "The automatic prompt could not be created." }, { status: writerResponse.status });
    if (writerData.status === "succeeded") return NextResponse.json({ status: "succeeded", prompt: Array.isArray(writerData.output) ? writerData.output.join("") : String(writerData.output || "") });
    return NextResponse.json({ id: writerData.id, status: writerData.status });
  } catch { return NextResponse.json({ error: "The image could not be analyzed." }, { status: 500 }); }
}
