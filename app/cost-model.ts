/* What a video costs to make, for the manager's Spend page. Pure maths (no
   imports) so the page, the API and the tests all agree.

   The video engine's cost is what production recorded for the video when it
   started (the engine's list price × seconds of scenes). Music and editing are
   estimates from the providers' list prices, set here in one place. The
   providers' own billing pages stay the final word. */

export const COST_RATES = {
  /** ElevenLabs Music, dollars per minute of music (Starter plan list price). */
  musicPerMinute: 0.30,
  /** Seconds of music made beyond the film's length (the editor asks for +1.5 s). */
  musicExtraSeconds: 1.5,
  /** Cloudflare container time for the final edit, dollars per film (about 2–3 minutes of 1 vCPU / 6 GiB). */
  editPerFilm: 0.01,
  /** AI quality review, cents per film (estimates from list prices; the free mechanical check costs nothing).
      Cloudflare Workers AI: 4 stills on its vision model. Claude: 4 stills in one request. */
  reviewCloudflareCents: 0.5,
  reviewClaudeCents: 3,
  /** Fixed monthly plans, dollars. */
  cloudflareWorkersPaid: 5,
  elevenLabsStarter: 5,
  /** Music minutes included in the ElevenLabs Starter plan each month. */
  elevenLabsIncludedMinutes: 16,
  /** Standard card processing: percent of the price plus a fixed fee per charge, dollars. */
  cardPercent: 2.9,
  cardFixed: 0.30,
};

/* Projected card fees for orders at list price (nothing is charged until payments are connected). */
export const cardFeeCents = (priceCents: number, orders: number) => Math.round(priceCents * COST_RATES.cardPercent / 100 + orders * COST_RATES.cardFixed * 100);

/* Job kinds finished by the editing container (music + crossfades). */
export const EDITED_KINDS = ["customer-series", "studio-series"] as const;
const edited = (kind: string) => (EDITED_KINDS as readonly string[]).includes(kind);

export type CostLines = { videoCents: number; musicCents: number; editCents: number; reviewCents: number; totalCents: number };

const totalOf = (videoCents: number, musicCents: number, editCents: number, reviewCents = 0): CostLines => ({ videoCents, musicCents, editCents, reviewCents, totalCents: videoCents + musicCents + editCents + reviewCents });
export const musicCentsForSeconds = (seconds: number) => Math.round((seconds / 60) * COST_RATES.musicPerMinute * 100);

/* One video. Music and editing are only counted once the film was edited. */
export function videoCosts(job: { kind: string; status: string; costCents: number; duration: number; reviewCents?: number }): CostLines {
  const done = edited(job.kind) && job.status === "succeeded";
  return totalOf(
    Math.max(0, Math.round(job.costCents || 0)),
    done ? musicCentsForSeconds((job.duration || 0) + COST_RATES.musicExtraSeconds) : 0,
    done ? Math.round(COST_RATES.editPerFilm * 100) : 0,
    Math.max(0, Math.round(job.reviewCents || 0)),
  );
}

/* Totals from the database's per-segment sums (see /api/admin/costs). */
export type CostAggregate = { videos: number; finished: number; edited: number; videoCents: number; musicSeconds: number; priceCents: number; reviewCents?: number };

export function aggregateCosts(a: CostAggregate): CostLines & { videos: number; finished: number; perFinishedCents: number; priceCents: number; musicSeconds: number } {
  const lines = totalOf(Math.round(a.videoCents), musicCentsForSeconds(a.musicSeconds), Math.round(a.edited * COST_RATES.editPerFilm * 100), Math.round(a.reviewCents || 0));
  return { ...lines, videos: a.videos, finished: a.finished, perFinishedCents: a.finished ? Math.round(lines.totalCents / a.finished) : 0, priceCents: Math.round(a.priceCents), musicSeconds: Math.round(a.musicSeconds) };
}
