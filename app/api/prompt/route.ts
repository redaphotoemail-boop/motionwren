import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ENDPOINT = "https://api.replicate.com/v1/models/meta/meta-llama-3-8b-instruct/predictions";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Connect Replicate before using the prompt director." }, { status: 503 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const vision = String(body.vision || "").trim().slice(0, 2000);
    if (vision.length < 8) return NextResponse.json({ error: "Describe your vision in at least a few words." }, { status: 400 });
    const context = `Content type: ${String(body.category || "product")}. Camera choice: ${String(body.motion || "mixed")}. Pace: ${String(body.speed || "slow")}. Frame: ${String(body.aspect || "horizontal")}. Sound direction: ${String(body.sound || "none")}.`;
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=25" },
      body: JSON.stringify({ input: {
        prompt: `Turn this plain-language vision into one production-ready prompt for a professional image-to-video generator.\n\nVISION: ${vision}\n\nSETTINGS: ${context}\n\nReturn only the finished prompt, 90-150 words. Start directly with the visual direction—do not add a title, introduction, provider name, model name, or phrases such as "Here is the prompt." Write in present tense. Specify subject action, environmental motion, camera behavior, timing, lighting, depth, realism, continuity, and what must remain stable. If sound is requested, include concise music, ambience, and synchronized sound-effect direction. Never invent brand names, text, products, people, or story facts not supplied by the user.`,
        system_prompt: "You are a precise cinematic prompt director. Convert simple ideas into controlled, realistic video-generation instructions. Output only the final prompt and never mention an AI provider or model name.",
        max_tokens: 300,
        temperature: 0.45,
      } }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: (data.detail as string) || "The prompt director could not start." }, { status: response.status });
    if (data.status === "succeeded") return NextResponse.json({ status: "succeeded", prompt: Array.isArray(data.output) ? data.output.join("") : String(data.output || "") });
    return NextResponse.json({ id: data.id, status: data.status });
  } catch { return NextResponse.json({ error: "The prompt could not be created." }, { status: 500 }); }
}
