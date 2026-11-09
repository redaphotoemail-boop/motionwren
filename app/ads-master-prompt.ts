/* Studio Ads "Fix It In 20 Seconds" master-prompt template: the locked
   short-form product-demo prompt (TikTok first, repost to Reels) from
   ~/workspace/your_files/video-creation-master-prompt.md.
   The structure, the rules and the legal DO / DON'T below are copied from
   that file in its own words — never paraphrased. The file's "Starting
   slate" (niche + 5 test products) is context, NOT template content: no
   product name or price is baked in here; the 7 fill-in fields are filled
   per ad. The "Check before submitting" list is a human QA step, not a
   generation instruction, so it is not part of the prompt text.
   Server- and client-safe: no imports from app/api/_lib, no Worker
   bindings, so plain node can test it — the same rule as ads-creative.ts.
   It does NOT touch ADS_THEME: the cinematic premium prompt stays exactly
   as it is, and this template is layered in its place only when picked. */

import type { AdDuration } from "./ads-creative";

export type AdTemplateId = "cinematic" | "fix-it-20";

export const CINEMATIC_TEMPLATE_ID: AdTemplateId = "cinematic";
export const MASTER_PROMPT_TEMPLATE_ID: AdTemplateId = "fix-it-20";

/* The master prompt is 21–30 s. Studio Ads only offers 10 / 30 / 60 s,
   and a 10 s ad cannot hold the structure while a 60 s ad would stretch
   past the 30 s the prompt forbids — so a template ad is locked to 30 s. */
export const MASTER_PROMPT_DURATION: AdDuration = 30;

export const AD_TEMPLATES: { id: AdTemplateId; label: string; blurb: string }[] = [
  { id: "cinematic", label: "Cinematic premium", blurb: "Premium, cinematic commercial — the prompt layered on top today." },
  { id: "fix-it-20", label: "Fix It In 20 Seconds", blurb: "Short-form product demo, 21–30 s — hook, problem, demo, proof, one call to action, with the affiliate rules baked in." },
];

export function resolveAdTemplate(value: unknown): AdTemplateId {
  return value === "fix-it-20" ? "fix-it-20" : "cinematic";
}

export function resolveTemplateDuration(template: AdTemplateId, targetDuration: number): AdDuration {
  if (template === "fix-it-20") return MASTER_PROMPT_DURATION;
  return ([10, 30, 60] as const).includes(targetDuration as AdDuration) ? (targetDuration as AdDuration) : 10;
}

/* ---------- the 7 fill-in fields ---------- */

export type MasterPromptFields = {
  product: string;
  problem: string;
  whoFor: string;
  proof: string;
  price: string;
  honestDownside: string;
  callToAction: string;
};

export type MasterPromptFieldDef = {
  key: keyof MasterPromptFields;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline: boolean;
};

export const MASTER_PROMPT_FIELD_DEFS: MasterPromptFieldDef[] = [
  { key: "product", label: "Product", placeholder: "e.g. AI tracking gimbal", maxLength: 120, multiline: false },
  { key: "problem", label: "Problem it solves", placeholder: "The annoying, visible problem in plain words — what goes wrong without it", maxLength: 280, multiline: true },
  { key: "whoFor", label: "Who it's for", placeholder: "e.g. creators filming alone with a phone", maxLength: 200, multiline: false },
  { key: "proof", label: "Proof", placeholder: "One specific, checkable proof — a number, a before/after, a real result", maxLength: 280, multiline: false },
  { key: "price", label: "Price", placeholder: "e.g. $29.99", maxLength: 40, multiline: false },
  { key: "honestDownside", label: "Honest downside", placeholder: "One real limitation — say it, don't hide it", maxLength: 280, multiline: false },
  { key: "callToAction", label: "Call to action", placeholder: "One action only, e.g. tap the orange cart", maxLength: 200, multiline: false },
];

export function emptyMasterPromptFields(): MasterPromptFields {
  return { product: "", problem: "", whoFor: "", proof: "", price: "", honestDownside: "", callToAction: "" };
}

/* Clean raw input (from the form or the API) into the 7 fields: trim,
   cap each length, drop anything else. Unknown or missing input → empty. */
export function cleanMasterPromptFields(value: unknown): MasterPromptFields {
  const fields = emptyMasterPromptFields();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fields;
  const raw = value as Record<string, unknown>;
  for (const def of MASTER_PROMPT_FIELD_DEFS) {
    const item = raw[def.key];
    if (typeof item === "string") fields[def.key] = item.trim().slice(0, def.maxLength);
  }
  return fields;
}

export function parseMasterPromptFields(value: string): MasterPromptFields {
  try {
    return cleanMasterPromptFields(JSON.parse(value || "{}") as unknown);
  } catch {
    return emptyMasterPromptFields();
  }
}

/* ---------- the template text, verbatim from the master prompt file ---------- */

const MASTER_PROMPT_HEADER = `You are creating a short-form video (TikTok first, repost to Instagram Reels) from the supplied product images. Total length: 21–30 seconds. One idea per video. No logo, no intro, no title card.

Every video belongs to the series "Fix It In 20 Seconds."`;

/* Bracket text is the file's own hint for each fill-in. A field left empty
   keeps its bracket text in the prompt, so the structure stays complete
   and the gap is visible instead of silently dropped. */
const MASTER_PROMPT_FIELD_HINTS: Record<keyof MasterPromptFields, string> = {
  product: "[product name]",
  problem: "[the annoying, visible problem in plain words — what goes wrong without it]",
  whoFor: "[the buyer, e.g. creators filming alone with a phone]",
  proof: "[one specific, checkable proof — a number, a before/after, a real result]",
  price: "[price]",
  honestDownside: "[one real limitation — say it, don't hide it]",
  callToAction: "[one action only, e.g. \"tap the orange cart\"]",
};

const MASTER_PROMPT_STRUCTURE = `## Second-by-second structure (do not change the order)

- **0–3s HOOK** — Show the RESULT or the PROBLEM in frame 1, already moving. Three layers at once: (1) a spoken line of 6–12 words naming the pain or the result, (2) the same words as bold on-screen text, (3) the product or the problem visible and moving. Never start with a logo, a greeting, or "hey guys."
- **3–8s PROBLEM** — Show the problem happening in real life. Make the viewer feel it: shaky footage, bad audio, missed shot, wasted time. One short line: what it costs them.
- **8–20s DEMO** — The product actually fixing the problem, on screen for most of the video. Real product footage as the base — the product must be visibly doing the job, not just talked about. Keep the camera moving; change something on screen every 2–4 seconds (cut, zoom, angle, caption). No feature list, no talking head without the demo.
- **20–25s PROOF** — One proof moment: the before/after split, the result on screen, or the specific number. Then the honest downside in one short line — it builds trust and it is the reason people believe the rest.
- **25–30s CALL TO ACTION** — One offer, one action, then END IMMEDIATELY after the payoff. No lingering outro, no "like and follow" pile-up. Last frame should match the first frame so the video loops seamlessly.`;

const MASTER_PROMPT_RULES = `## Rules for every video

1. Hook in the first 3 seconds or the video fails — the product or the result must be visible in frame 1.
2. Show, don't tell. Demonstration beats description 3–5x. If a shot doesn't show the product working, cut it.
3. One problem, one product, one offer, one call to action. Never two.
4. Open loop: tease the result early ("watch what happens when I turn it on") and pay it off late — never give the ending away in the hook.
5. Captions on everything. Short lines, big text, readable on mute.
6. Sound: natural sound or a simple voiceover, never a generic music bed over silence.
7. Honest only: real product footage, real results, one real downside. Never fake a testimonial, never invent a result, never promise what the product doesn't do.
8. Length: 21–30 seconds. If the story needs more, split it into Part 1 / Part 2 — never stretch one video past 30 seconds.
9. End on the payoff, then stop. No outro.`;

const MASTER_PROMPT_LEGAL = `## Legal & platform rules — DO / DON'T (baked in, non-negotiable)

DO:
- Show the REAL product in the video — showing a product you link as an affiliate is the whole model, and it is allowed (including big brands like Nike). Use your own footage/photos of the real product.
- Disclose the affiliate link ON SCREEN in the video (#ad, or "I earn a commission if you buy") — not buried in a caption. The FTC requires a clear, conspicuous disclosure of any material connection.
- Label any AI-generated realistic person, voice, or scene with TikTok's AI-generated label. TikTok auto-detects AI content anyway (C2PA) — unlabeled AI gets removed or suppressed, repeat violations can suspend the account.
- Keep real product footage as the base. AI only for motion, voiceover, editing, captions, and script help (TikTok exempts that kind of AI help from labeling).
- Make only claims the real product actually delivers. One honest downside in every video.

DON'T:
- NEVER let an AI person/avatar claim it used, tried, or liked the product. The FTC's fake reviews rule (16 CFR Part 465, in effect Oct 2024) bans fake testimonials including AI-generated ones and testimonials from people who don't exist — penalties up to $53,088 per violation.
- NEVER fake what the product does — no AI changes to its size, color, material, performance, or effects; no fabricated before/after results. TikTok Shop bans this, and overpromising also means returns and commission clawbacks.
- NEVER imply a brand sponsors or endorses you when it doesn't. No "Nike paid me," no logo use suggesting partnership, no brand ad footage or music.
- NEVER hide the affiliate relationship, and NEVER buy followers or views (FTC rule + platform bans).
- NEVER build for TikTok Creator Rewards with fully AI videos — AI-only / virtual-influencer accounts are banned from view payouts. Affiliate commissions still work, but labeled AI posts get less distribution.
- NEVER make earnings or income claims in a video.`;

const MASTER_PROMPT_SERIES = `## Series rule

Every video belongs to the same repeatable series: "Fix It In 20 Seconds." Same opening pattern, same promise — a real problem, fixed on camera in 20 seconds. Viewers follow for the next problem solved, not for one product.`;

/* The filled template: the 7 fields, then the structure, the rules, the
   legal DO / DON'T and the series rule — in the file's order. This is the
   theme text for a template ad: it sits where ADS_THEME sits for a
   cinematic ad (first in every scene prompt, and as the render job's
   stored prompt). */
export function buildMasterPromptPrompt(fields: MasterPromptFields): string {
  const filled = (key: keyof MasterPromptFields, label: string) =>
    `${label}: ${fields[key].trim() || MASTER_PROMPT_FIELD_HINTS[key]}`;
  return [
    MASTER_PROMPT_HEADER,
    "",
    filled("product", "PRODUCT"),
    filled("problem", "PROBLEM IT SOLVES"),
    filled("whoFor", "WHO IT'S FOR"),
    filled("proof", "PROOF"),
    filled("price", "PRICE"),
    filled("honestDownside", "HONEST DOWNSIDE"),
    filled("callToAction", "CALL TO ACTION"),
    "",
    MASTER_PROMPT_STRUCTURE,
    "",
    MASTER_PROMPT_RULES,
    "",
    MASTER_PROMPT_LEGAL,
    "",
    MASTER_PROMPT_SERIES,
  ].join("\n");
}

/* The unfilled template — the structure, rules and legal text with the
   file's bracket hints still in the fill-in block. */
export const MASTER_PROMPT_TEMPLATE = buildMasterPromptPrompt(emptyMasterPromptFields());
