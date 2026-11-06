/* AI review of a finished film. Two reviewers, each with its own on/off
   switch (Admin → Engines → Film quality check):
   · Cloudflare Workers AI: cheap, inside the Cloudflare plan.
   · Claude: sharper eyes, costs a little more. When both are on, Claude
     only double-checks what Cloudflare flagged.
   A reviewer looks at a few stills and names anything that looks like an AI
   artifact: bent lines, moved or invented objects, melting, smearing.
   It only advises; what happens next (re-making the scene) is decided in
   render-jobs.ts. */

export const REVIEW_CLOUDFLARE_KEY = "ai_review_cloudflare";
export const REVIEW_CLAUDE_KEY = "ai_review_claude";
const CF_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const CLAUDE_MODEL = "claude-sonnet-5-5";

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<{ response?: string } | string> };
export type Finding = { at: number; issue: string };
export type AiReview = { status: "pass" | "flag" | "error"; reviewer: "cloudflare" | "claude" | "cloudflare+claude"; findings: Finding[]; reviewedAt: number; error?: string };

const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;

export function reviewersConnected(env: unknown) {
  return {
    cloudflare: Boolean((env as { AI?: AiBinding } | null)?.AI) || Boolean(secret("CF_ACCOUNT_ID") && secret("CF_AI_TOKEN")),
    claude: Boolean(secret("ANTHROPIC_API_KEY")),
  };
}

export async function reviewSettings(env: { DB: D1Database }) {
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM platform_settings WHERE key IN (?1, ?2)").bind(REVIEW_CLOUDFLARE_KEY, REVIEW_CLAUDE_KEY).all<{ key: string; value: string }>();
    const on = (key: string) => rows.results.some((row) => row.key === key && row.value === "on");
    return { cloudflare: on(REVIEW_CLOUDFLARE_KEY), claude: on(REVIEW_CLAUDE_KEY) };
  } catch { return { cloudflare: false, claude: false }; }
}

export async function aiReviewOn(env: { DB: D1Database }) {
  const settings = await reviewSettings(env);
  return settings.cloudflare || settings.claude;
}

const QUESTION = `This is a frame from a real-estate promo video that was made from a still photograph by an AI video model. Only the camera should move; the room must stay exactly as photographed. Look for AI video artifacts: straight lines (walls, door frames, rooflines, window frames) that bend or wave, objects that look moved, duplicated, invented or melting, smeared or hazy patches, distorted cars, furniture or faces. Be strict but do not invent problems.`;

const clean = (text: string) => text.replace(/[^\p{L}\p{N} ,.;:'()%/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 140);

async function cloudflareRun(env: unknown, image: Uint8Array): Promise<string> {
  const input = { image: [...image], prompt: `${QUESTION} Answer with exactly one line: "OK" if the frame looks clean and realistic, or "ISSUE: <what is wrong, under 15 words>".`, max_tokens: 60 };
  const binding = (env as { AI?: AiBinding } | null)?.AI;
  if (binding) { const out = await binding.run(CF_MODEL, input); return String(typeof out === "string" ? out : out?.response || ""); }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${secret("CF_ACCOUNT_ID")}/ai/run/${CF_MODEL}`, { method: "POST", headers: { Authorization: `Bearer ${secret("CF_AI_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json().catch(() => null) as { result?: { response?: string }; errors?: { message?: string }[] } | null;
  if (!response.ok) throw new Error(data?.errors?.[0]?.message || `Workers AI answered HTTP ${response.status}.`);
  return String(data?.result?.response || "");
}

async function reviewWithCloudflare(env: unknown, stills: Uint8Array[], times: number[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const [index, still] of stills.entries()) {
    const text = (await cloudflareRun(env, still)).trim();
    const match = /ISSUE:?\s*(.+)$/im.exec(text);
    if (match) findings.push({ at: times[index], issue: clean(match[1]) });
  }
  return findings;
}

const toBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

async function reviewWithClaude(stills: Uint8Array[], times: number[]): Promise<Finding[]> {
  const content: Record<string, unknown>[] = [];
  stills.forEach((still, index) => {
    content.push({ type: "text", text: `Frame ${index + 1} (at ${times[index].toFixed(1)} s):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(still) } });
  });
  content.push({ type: "text", text: `${QUESTION}\nReply with JSON only: {"issues":[{"frame":<number>,"issue":"<what is wrong, under 15 words>"}]}. Use {"issues":[]} when every frame is clean.` });
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": secret("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 400, messages: [{ role: "user", content }] }) });
  const data = await response.json().catch(() => null) as { content?: { text?: string }[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message || `Claude answered HTTP ${response.status}.`);
  const text = data?.content?.map((part) => part.text || "").join("") || "";
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  const parsed = json ? JSON.parse(json) as { issues?: { frame?: number; issue?: string }[] } : { issues: [] };
  return (parsed.issues || []).filter((item) => item.issue && Number.isInteger(item.frame) && item.frame! >= 1 && item.frame! <= stills.length).map((item) => ({ at: times[item.frame! - 1], issue: clean(String(item.issue)) }));
}

export async function reviewStills(env: unknown, stills: Uint8Array[], times: number[], use: { cloudflare: boolean; claude: boolean }): Promise<AiReview> {
  const connected = reviewersConnected(env);
  const useCf = use.cloudflare && connected.cloudflare;
  const useClaude = use.claude && connected.claude;
  const base = { reviewedAt: Date.now() };
  if (!useCf && !useClaude) return { ...base, status: "error", reviewer: use.claude && !use.cloudflare ? "claude" : "cloudflare", findings: [], error: use.claude && !use.cloudflare ? "Claude is switched on but no Anthropic key is set." : "Cloudflare Workers AI is switched on but not connected." };
  try {
    let findings: Finding[] = [];
    if (useCf) findings = await reviewWithCloudflare(env, stills, times);
    if (useClaude && (!useCf || findings.length)) findings = await reviewWithClaude(stills, times); // Claude double-checks what Cloudflare flagged
    return { ...base, status: findings.length ? "flag" : "pass", reviewer: useCf && useClaude ? "cloudflare+claude" : useCf ? "cloudflare" : "claude", findings };
  } catch (error) {
    return { ...base, status: "error", reviewer: useCf ? "cloudflare" : "claude", findings: [], error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
}
