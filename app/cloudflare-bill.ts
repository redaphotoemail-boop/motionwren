/* What Cloudflare will bill us this billing period, by Cloudflare product and by MotionWren feature.
   Pure maths and grouping, so the page, the API and the tests agree (tests/cloudflare-bill.test.mjs).

   Sources, best first:
   - Cloudflare's own billable usage (the same figures as its invoice), when the read-only token has Billing Read.
   - Otherwise our own pricing of Cloudflare's usage analytics at its published rates (marked as an estimate).
   Editing-machine cost is split between features by the machine time each feature really used (every machine
   carries a feature label since Nov 25, 2026; time before that shows as "before tracking began"). */

export const PLAN_CENTS = 500; // Workers Paid, per month

/* Which MotionWren feature an editing machine belongs to, from its name (app/api/_lib/composer.ts machineStub). */
export function machineFeature(name: string) {
  if (name.startsWith("movement-")) return "photo-reading";
  if (name.startsWith("wrencut-")) return "wrencut-reading";
  if (name.startsWith("wrenprev-")) return "template-preview";
  if (name.startsWith("music-check-") || name.startsWith("music-sample-")) return "music";
  if (name.startsWith("build-check-")) return "checks";
  return "film-editing";
}

export const FEATURES: Record<string, { label: string; note: string }> = {
  "film-editing": { label: "Film editing", note: "Joining scenes, transitions, music and finishing on the editing machines" },
  "photo-reading": { label: "Camera movement reading", note: "Reading each photo before production to choose its movement" },
  "wrencut-reading": { label: "WrenCut reference reading", note: "Reading a reference video into a template" },
  "template-preview": { label: "Template previews", note: "Making the preview film of a template" },
  music: { label: "Music checks and samples", note: "The Production page music check and template music samples" },
  checks: { label: "Editor health checks", note: "Checking which editor code a new machine runs" },
  untagged: { label: "Editing machines before tracking began", note: "Machine time from before each machine was labelled with its feature (Nov 25, 2026)" },
  ai: { label: "AI photo reading and film review", note: "Cloudflare's AI models reading photos and checking finished films" },
  storage: { label: "Storing photos and films", note: "Uploaded photos, scenes and finished films" },
  images: { label: "Image resizing", note: "Resized photos and thumbnails on the site" },
  website: { label: "Website, orders and the every-minute check", note: "Pages, orders, the database and the check that moves films along every minute" },
  other: { label: "Other Cloudflare services", note: "" },
  plan: { label: "Workers Paid plan", note: "The fixed monthly plan" },
};

/* Cloudflare's product name (as its billing names it) to the feature it pays for. Containers are split separately. */
export function productFeature(product: string): string {
  const p = product.toLowerCase();
  if (/container/.test(p)) return "machines";
  if (/workers ai|\bai\b|neuron/.test(p)) return "ai";
  if (/\br2\b|object storage/.test(p)) return "storage";
  if (/image/.test(p)) return "images";
  if (/workers|d1|durable|kv|queue|log|observab|trace|pages|analytics|vectorize|hyperdrive/.test(p)) return "website";
  return "other";
}

/* The editing machines' list price for a stretch of usage (Cloudflare Containers rates). Dollars. */
export function machineDollars(sum: { allocatedMemory?: number; cpuTimeSec?: number; allocatedDisk?: number }) {
  return (Number(sum.allocatedMemory) || 0) / 1024 ** 3 * 0.0000025 + (Number(sum.cpuTimeSec) || 0) * 0.00002 + (Number(sum.allocatedDisk) || 0) / 1e9 * 0.00000007;
}

export type ProductLine = { name: string; cents: number };
export type FeatureLine = { key: string; label: string; note: string; cents: number; estimate: boolean; split: boolean };

/* Splits the machines' billed cents between features in proportion to each feature's measured machine time
   (priced at list rates), so the parts always add up to the billed amount. */
export function splitMachines(billedCents: number, byFeature: Record<string, number>) {
  const total = Object.values(byFeature).reduce((a, b) => a + Math.max(0, b), 0);
  const out: Record<string, number> = {};
  if (billedCents <= 0) return out;
  if (total <= 0) { out.untagged = billedCents; return out; }
  let given = 0;
  const keys = Object.keys(byFeature).filter((key) => byFeature[key] > 0).sort((a, b) => byFeature[b] - byFeature[a]);
  keys.forEach((key, index) => {
    const part = index === keys.length - 1 ? Math.round((billedCents - given) * 100) / 100 : Math.round(billedCents * (byFeature[key] / total) * 100) / 100;
    out[key] = part; given += part;
  });
  return out;
}

export function byFeature(products: ProductLine[], machineUse: Record<string, number>, estimate: boolean, planCents = PLAN_CENTS): FeatureLine[] {
  const cents: Record<string, number> = {};
  let machineCents = 0;
  for (const line of products) {
    const key = productFeature(line.name);
    if (key === "machines") machineCents += line.cents;
    else cents[key] = (cents[key] || 0) + line.cents;
  }
  const split = splitMachines(machineCents, machineUse);
  for (const [key, value] of Object.entries(split)) cents[key] = (cents[key] || 0) + value;
  if (planCents > 0) cents.plan = planCents;
  return Object.entries(cents)
    .filter(([, value]) => value > 0.004)
    .map(([key, value]) => ({ key, label: FEATURES[key]?.label || key, note: FEATURES[key]?.note || "", cents: Math.round(value * 100) / 100, estimate, split: key in split && Object.keys(split).length > 1 }))
    .sort((a, b) => b.cents - a.cents);
}

/* Where the period is going: the bill so far, and the bill at the end of the period if usage keeps this pace. */
export function projection(usageCents: number, periodStart: number, periodEnd: number, now: number, planCents = PLAN_CENTS) {
  const length = Math.max(1, periodEnd - periodStart);
  const elapsed = Math.min(length, Math.max(60 * 60 * 1000, now - periodStart)); // at least an hour, so day one is not wild
  const projectedUsage = usageCents * (length / elapsed);
  return { soFarCents: Math.round((planCents + usageCents) * 100) / 100, projectedCents: Math.round((planCents + projectedUsage) * 100) / 100, share: Math.min(100, Math.round((elapsed / length) * 100)) };
}

/* The current billing period when Cloudflare does not say: the same day of the month as `anchorDay`. */
export function periodAround(now: Date, anchorDay: number) {
  const day = Math.min(28, Math.max(1, anchorDay));
  let start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day);
  if (start > now.getTime()) start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day);
  const s = new Date(start);
  const end = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, day);
  return { start, end };
}
