/* AI review of a finished film (the manager's on/off switch, Admin → Engines).
   A vision model looks at a few stills and says whether the film looks
   professional: straight lines, nothing moved or warped, nothing melting.
   It only advises: the film is delivered either way and the managers are told.
   Runs on Cloudflare Workers AI through an `AI` binding when one exists. */

export const AI_REVIEW_KEY = "ai_quality_review";
const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<{ response?: string } | string> };
export type AiReview = { status: "pass" | "flag" | "error"; issues: string[]; model: string; reviewedAt: number; error?: string };

export async function aiReviewOn(env: { DB: D1Database }): Promise<boolean> {
  try { return (await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(AI_REVIEW_KEY).first<{ value?: string }>())?.value === "on"; }
  catch { return false; }
}

export const aiReviewAvailable = (env: unknown) => Boolean((env as { AI?: AiBinding } | null)?.AI);

const QUESTION = `You are checking one frame from a real-estate promo video made from a still photo. Look for AI video artifacts only: bent or wavy straight lines (walls, door frames, rooflines), objects that look moved, warped, duplicated or melting, smeared or hazy areas, faces or cars that look wrong. Answer with exactly one line: "OK" if the frame looks clean and realistic, or "ISSUE: <what is wrong, under 15 words>".`;

export async function reviewStills(env: unknown, stills: Uint8Array[]): Promise<AiReview> {
  const ai = (env as { AI?: AiBinding } | null)?.AI;
  const base = { model: MODEL, reviewedAt: Date.now() };
  if (!ai) return { ...base, status: "error", issues: [], error: "Cloudflare Workers AI is not connected." };
  try {
    const issues: string[] = [];
    for (const [index, still] of stills.entries()) {
      const out = await ai.run(MODEL, { image: [...still], prompt: QUESTION, max_tokens: 60 });
      const text = String(typeof out === "string" ? out : out?.response || "").trim();
      const match = /^ISSUE:?\s*(.+)$/im.exec(text);
      if (match) issues.push(`Frame ${index + 1}: ${match[1].slice(0, 140)}`);
    }
    return { ...base, status: issues.length ? "flag" : "pass", issues };
  } catch (error) {
    return { ...base, status: "error", issues: [], error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
}
