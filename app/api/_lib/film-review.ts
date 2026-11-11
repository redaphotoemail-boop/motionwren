/* AI review of a finished film. Two reviewers, each with its own on/off
   switch (Admin → Engines → Film quality check):
   · Cloudflare Workers AI: cheap, inside the Cloudflare plan.
   · Claude: sharper eyes, costs a little more. When both are on, Claude
     only double-checks what Cloudflare flagged.
   A reviewer looks at a few stills and names anything that looks like an AI
   artifact: bent lines, moved or invented objects, melting, smearing.
   It only advises; what happens next (re-making the scene) is decided in
   render-jobs.ts.
   A second task, the reality check, compares each still with the uploaded
   photograph it came from and flags anything the video added, removed, or
   changed versus the photograph — the thing that would misrepresent the
   property. The camera may pan, zoom, or crop; only the contents are
   compared, never the framing. */

export const REVIEW_CLOUDFLARE_KEY = "ai_review_cloudflare";
export const REVIEW_CLAUDE_KEY = "ai_review_claude";
const CF_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const CLAUDE_MODEL = "claude-sonnet-5-5";
import { COST_RATES } from "../../cost-model";
const CF_REVIEW_CENTS = COST_RATES.reviewCloudflareCents;
const CLAUDE_REVIEW_CENTS = COST_RATES.reviewClaudeCents;

/* A source photograph too large to send to the vision model is skipped for
   the reality check (same 1.4 MB cap the production code uses when it inlines
   a scene photo). The artifact check still runs for that still. */
export const REALITY_SOURCE_MAX_BYTES = 1_400_000;

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<{ response?: string } | string> };
export type Finding = { at: number; issue: string };
export type AiReview = { status: "pass" | "flag" | "error"; reviewer: "cloudflare" | "claude" | "cloudflare+claude"; findings: Finding[]; reviewedAt: number; error?: string; costCents?: number; realityFindings?: number; realityError?: string };

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

/* Reality check: the source photograph is described first, then each video
   frame is compared with that description. Camera movement, cropping,
   lighting, and sharpness are not problems — only things the video added,
   removed, or changed versus the photograph. */
const REALITY_DESCRIBE = `Describe this real-estate photograph in one short paragraph: the room and its layout, the furniture, fixtures, finishes, windows and doors, and what is visible outside the windows. List only what is actually visible, under 60 words.`;
const REALITY_CHECK = (inventory: string) => `This is a frame from a video made from the photograph described below. The camera may have panned, zoomed, or cropped the photograph — that is fine and is not a problem. Compare the frame with the description and flag it ONLY if something in the frame was added, removed, or changed versus the photograph: furniture, fixtures, finishes, walls, windows, doors, layout, or anything outside the windows. Do not flag camera movement, cropping, lighting, or sharpness. Answer with exactly one line: "OK" if nothing was added, removed, or changed, or "ISSUE: <what changed, under 15 words>". Description: ${inventory}`;

const clean = (text: string) => text.replace(/[^\p{L}\p{N} ,.;:'()%/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 140);

export async function cloudflareRun(env: unknown, image: Uint8Array, prompt: string, maxTokens = 60): Promise<string> {
  const input = { image: [...image], prompt, max_tokens: maxTokens };
  const binding = (env as { AI?: AiBinding } | null)?.AI;
  if (binding) {
    const call = async () => { const out = await binding.run(CF_MODEL, input); return String(typeof out === "string" ? out : out?.response || ""); };
    try { return await call(); }
    catch (error) {
      // Meta's vision model asks for its licence to be accepted once per account (a one-time "agree").
      if (!/agree|licen[cs]e|5016/i.test(String(error instanceof Error ? error.message : error))) throw error;
      await binding.run(CF_MODEL, { prompt: "agree" });
      return call();
    }
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${secret("CF_ACCOUNT_ID")}/ai/run/${CF_MODEL}`, { method: "POST", headers: { Authorization: `Bearer ${secret("CF_AI_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json().catch(() => null) as { result?: { response?: string }; errors?: { message?: string }[] } | null;
  if (!response.ok) throw new Error(data?.errors?.[0]?.message || `Workers AI answered HTTP ${response.status}.`);
  return String(data?.result?.response || "");
}

async function reviewWithCloudflare(env: unknown, stills: Uint8Array[], times: number[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const [index, still] of stills.entries()) {
    const text = (await cloudflareRun(env, still, `${QUESTION} Answer with exactly one line: "OK" if the frame looks clean and realistic, or "ISSUE: <what is wrong, under 15 words>".`)).trim();
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

/* Reality check on Cloudflare: two vision calls per pair — one to describe
   the source photograph, one to compare the video frame with it. A pair
   that errors is skipped; it never sinks the review. */
async function reviewRealityWithCloudflare(env: unknown, sources: (Uint8Array | null)[], stills: Uint8Array[], times: number[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const [index, still] of stills.entries()) {
    const source = sources[index];
    if (!source || source.byteLength > REALITY_SOURCE_MAX_BYTES) continue;
    try {
      const inventory = (await cloudflareRun(env, source, REALITY_DESCRIBE, 160)).trim();
      const text = (await cloudflareRun(env, still, REALITY_CHECK(inventory))).trim();
      const match = /ISSUE:?\s*(.+)$/im.exec(text);
      if (match) findings.push({ at: times[index], issue: `Reality: ${clean(match[1])}` });
    } catch { /* one bad pair never sinks the review */ }
  }
  return findings;
}

async function reviewRealityWithClaude(sources: (Uint8Array | null)[], stills: Uint8Array[], times: number[]): Promise<Finding[]> {
  const content: Record<string, unknown>[] = [];
  let pair = 0;
  stills.forEach((still, index) => {
    const source = sources[index];
    if (!source || source.byteLength > REALITY_SOURCE_MAX_BYTES) return;
    pair += 1;
    content.push({ type: "text", text: `Pair ${pair} (at ${times[index].toFixed(1)} s):` });
    content.push({ type: "text", text: "Source photograph:" });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(source) } });
    content.push({ type: "text", text: "Video frame:" });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(still) } });
  });
  if (!pair) return [];
  content.push({ type: "text", text: `Compare each video frame with its source photograph. The camera may have panned, zoomed, or cropped the photograph — that is fine and is not a problem. Flag a pair ONLY if something in the frame was added, removed, or changed versus the photograph: furniture, fixtures, finishes, walls, windows, doors, layout, or anything outside the windows. Do not flag camera movement, cropping, lighting, or sharpness.\nReply with JSON only: {"issues":[{"frame":<pair number>,"issue":"<what changed, under 15 words>"}]}. Use {"issues":[]} when every frame matches its photograph.` });
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": secret("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 600, messages: [{ role: "user", content }] }) });
  const data = await response.json().catch(() => null) as { content?: { text?: string }[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message || `Claude answered HTTP ${response.status}.`);
  const text = data?.content?.map((part) => part.text || "").join("") || "";
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  const parsed = json ? JSON.parse(json) as { issues?: { frame?: number; issue?: string }[] } : { issues: [] };
  const pairTimes = times.filter((_, index) => sources[index] && sources[index]!.byteLength <= REALITY_SOURCE_MAX_BYTES);
  return (parsed.issues || []).filter((item) => item.issue && Number.isInteger(item.frame) && item.frame! >= 1 && item.frame! <= pair).map((item) => ({ at: pairTimes[item.frame! - 1], issue: `Reality: ${clean(String(item.issue))}` }));
}

export async function reviewStills(env: unknown, stills: Uint8Array[], times: number[], use: { cloudflare: boolean; claude: boolean }, sources?: (Uint8Array | null)[]): Promise<AiReview> {
  const connected = reviewersConnected(env);
  const useCf = use.cloudflare && connected.cloudflare;
  const useClaude = use.claude && connected.claude;
  const base = { reviewedAt: Date.now() };
  if (!useCf && !useClaude) return { ...base, status: "error", reviewer: use.claude && !use.cloudflare ? "claude" : "cloudflare", findings: [], error: use.claude && !use.cloudflare ? "Claude is switched on but no Anthropic key is set." : "Cloudflare Workers AI is switched on but not connected." };
  try {
    let findings: Finding[] = [];
    let costCents = 0;
    if (useCf) { findings = await reviewWithCloudflare(env, stills, times); costCents += CF_REVIEW_CENTS; }
    if (useClaude && (!useCf || findings.length)) { findings = await reviewWithClaude(stills, times); costCents += CLAUDE_REVIEW_CENTS; } // Claude double-checks what Cloudflare flagged
    let realityFindings = 0;
    let realityError: string | undefined;
    const pairs = (sources || []).filter((source, index) => index < stills.length && source && source.byteLength <= REALITY_SOURCE_MAX_BYTES).length;
    if (pairs > 0) {
      try {
        let reality: Finding[] = [];
        if (useCf) { reality = await reviewRealityWithCloudflare(env, sources || [], stills, times); costCents += 2 * CF_REVIEW_CENTS; }
        if (useClaude && (!useCf || reality.length)) { reality = await reviewRealityWithClaude(sources || [], stills, times); costCents += CLAUDE_REVIEW_CENTS; } // Claude double-checks what Cloudflare flagged
        findings = [...findings, ...reality];
        realityFindings = reality.length;
      } catch (error) { realityError = String(error instanceof Error ? error.message : error).slice(0, 300); }
    }
    return { ...base, status: findings.length ? "flag" : "pass", reviewer: useCf && useClaude ? "cloudflare+claude" : useCf ? "cloudflare" : "claude", findings, costCents, realityFindings, ...(realityError ? { realityError } : {}) };
  } catch (error) {
    return { ...base, status: "error", reviewer: useCf ? "cloudflare" : "claude", findings: [], error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
}
