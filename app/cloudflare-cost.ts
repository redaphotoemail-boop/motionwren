/* What Cloudflare costs us this month, by category. Pure maths (no imports) so the page, the API and the tests agree.
   Included amounts and prices are Cloudflare's published Workers Paid plan rates; Cloudflare's own billing page stays
   the final word. Dollars. */

export const PLAN_DOLLARS = 5; // the Workers Paid plan, per month

export type CategoryKey = "requests" | "cpu" | "d1Read" | "d1Write" | "d1Storage" | "r2Storage" | "r2A" | "r2B" | "ai" | "containers";
export type CategoryDef = { key: CategoryKey; group: string; label: string; unit: string; included: number; perUnit: number; unitSize: number; note?: string };

/* perUnit is dollars for every `unitSize` units beyond the included amount. */
export const CATEGORIES: CategoryDef[] = [
  { key: "requests", group: "Website and orders", label: "Requests", unit: "requests", included: 10_000_000, perUnit: 0.30, unitSize: 1_000_000 },
  { key: "cpu", group: "Website and orders", label: "Processing time", unit: "ms", included: 30_000_000, perUnit: 0.02, unitSize: 1_000_000 },
  { key: "d1Read", group: "Database", label: "Rows read", unit: "rows", included: 25_000_000_000, perUnit: 0.001, unitSize: 1_000_000 },
  { key: "d1Write", group: "Database", label: "Rows written", unit: "rows", included: 50_000_000, perUnit: 1.00, unitSize: 1_000_000 },
  { key: "d1Storage", group: "Database", label: "Stored data", unit: "GB", included: 5, perUnit: 0.75, unitSize: 1 },
  { key: "r2Storage", group: "Photos and videos", label: "Stored files", unit: "GB", included: 10, perUnit: 0.015, unitSize: 1, note: "Size right now, as an estimate of the month's GB-months." },
  { key: "r2A", group: "Photos and videos", label: "Saves and lists", unit: "operations", included: 1_000_000, perUnit: 4.50, unitSize: 1_000_000 },
  { key: "r2B", group: "Photos and videos", label: "Reads", unit: "operations", included: 10_000_000, perUnit: 0.36, unitSize: 1_000_000 },
  { key: "ai", group: "AI", label: "Photo and film checks", unit: "neurons", included: 0, perUnit: 0.011, unitSize: 1_000, note: "The first 10,000 each day are free." },
  { key: "containers", group: "Editing server", label: "Editing time (estimate)", unit: "GiB-hours", included: 25, perUnit: 0.0000025 * 3600, unitSize: 1, note: "Estimated from this month's finished films at about 4 minutes each on 6 GiB." },
];

export const AI_FREE_PER_DAY = 10_000;
export const CONTAINER_GIB_HOURS_PER_FILM = (6 * 4 * 60) / 3600; // 6 GiB for about 4 minutes

export type Usage = Partial<Record<CategoryKey, number>>;
export type Priced = CategoryDef & { used: number | null; share: number; overageCents: number };

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/* Workers AI: the daily free allowance is taken off each day before adding up. */
export const aiBillableNeurons = (perDay: number[]) => perDay.reduce((sum, day) => sum + Math.max(0, num(day) - AI_FREE_PER_DAY), 0);

export function priceCategory(def: CategoryDef, used: number | null | undefined): Priced {
  if (used === null || used === undefined) return { ...def, used: null, share: 0, overageCents: 0 };
  const amount = num(used);
  const over = Math.max(0, amount - def.included);
  const share = def.included > 0 ? Math.min(100, Math.round((amount / def.included) * 100)) : amount > 0 ? 100 : 0;
  return { ...def, used: amount, share, overageCents: Math.round((over / def.unitSize) * def.perUnit * 10000) / 100 };
}

export function priceAll(usage: Usage) {
  const rows = CATEGORIES.map((def) => priceCategory(def, usage[def.key]));
  const overageCents = rows.reduce((sum, row) => sum + row.overageCents, 0);
  return { rows, overageCents: Math.round(overageCents * 100) / 100, totalCents: Math.round((PLAN_DOLLARS * 100 + overageCents) * 100) / 100 };
}

/* Which R2 operations are "saves and lists" (Class A) and which are "reads" (Class B). Deletes and aborts are free. */
const CLASS_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration"]);
const CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
export const r2Class = (action: string): "A" | "B" | null => (CLASS_A.has(action) ? "A" : CLASS_B.has(action) ? "B" : null);
