/* The spending guard's rules, as pure maths (no imports) so the server, the
   Spend page and the tests all agree.

   Limits are in cents. A limit of 0 means "no limit". Spending is what films
   recorded when they started (engine price, plus any re-make or upscale added
   later) plus the quality check and the editing estimate.

   At 100% of a limit everything that spends money stops: new films, scenes not
   yet sent to the engine, re-makes, upscales and quality checks. Scenes the
   engine already has finish (they are paid for). Raising the limit, or the
   day/month rolling over, starts everything again by itself. */

export type GuardSettings = {
  /** Spend more than this in a calendar month and everything stops. 0 = no limit. */
  monthlyCents: number;
  /** Same, for one day (America/New_York). 0 = no limit. */
  dailyCents: number;
  /** A film that costs more than this asks for a yes first (Studio). 0 = never ask. */
  perFilmCents: number;
  /** The one-tap switch: nothing that spends money runs until it is turned off. */
  paused: boolean;
};

export const GUARD_DEFAULTS: GuardSettings = { monthlyCents: 30000, dailyCents: 3000, perFilmCents: 500, paused: false };

/** Alerts are sent when spending reaches these shares of a limit; the last one is the stop. */
export const GUARD_ALERT_STEPS = [50, 80, 100] as const;

export type GuardLevel = 0 | 50 | 80 | 100;

export function guardLevel(spentCents: number, limitCents: number): GuardLevel {
  if (!(limitCents > 0)) return 0;
  const share = (spentCents / limitCents) * 100;
  return share >= 100 ? 100 : share >= 80 ? 80 : share >= 50 ? 50 : 0;
}

/* Keeps a saved settings object sane: whole non-negative cents, a real boolean. */
export function cleanSettings(input: Partial<Record<keyof GuardSettings, unknown>> | null | undefined): GuardSettings {
  const cents = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? Math.round(n) : fallback;
  };
  return {
    monthlyCents: cents(input?.monthlyCents, GUARD_DEFAULTS.monthlyCents),
    dailyCents: cents(input?.dailyCents, GUARD_DEFAULTS.dailyCents),
    perFilmCents: cents(input?.perFilmCents, GUARD_DEFAULTS.perFilmCents),
    paused: input?.paused === true,
  };
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export { dollars as guardDollars };

export type GuardDecision =
  | { allow: true; needsConfirm: boolean; monthLevel: GuardLevel; dayLevel: GuardLevel }
  | { allow: false; why: "paused" | "daily" | "monthly"; message: string; monthLevel: GuardLevel; dayLevel: GuardLevel };

/* Decides whether something that costs `estimateCents` (0 = work already paid for,
   such as the next scene of a film that has started) may go ahead. */
export function decideSpend(input: { settings: GuardSettings; monthCents: number; dayCents: number; estimateCents?: number }): GuardDecision {
  const { settings, monthCents, dayCents } = input;
  const estimate = Math.max(0, Math.round(input.estimateCents || 0));
  const monthLevel = guardLevel(monthCents, settings.monthlyCents);
  const dayLevel = guardLevel(dayCents, settings.dailyCents);
  if (settings.paused) return { allow: false, why: "paused", message: "Spending is paused. Nothing that costs money will start until you turn it back on.", monthLevel, dayLevel };
  if (settings.dailyCents > 0 && (dayCents >= settings.dailyCents || (estimate > 0 && dayCents + estimate > settings.dailyCents))) {
    return { allow: false, why: "daily", message: `Today's limit of ${dollars(settings.dailyCents)} is reached (${dollars(dayCents)} spent${estimate ? `, this would add ${dollars(estimate)}` : ""}). It starts again tomorrow, or raise the limit.`, monthLevel, dayLevel };
  }
  if (settings.monthlyCents > 0 && (monthCents >= settings.monthlyCents || (estimate > 0 && monthCents + estimate > settings.monthlyCents))) {
    return { allow: false, why: "monthly", message: `This month's limit of ${dollars(settings.monthlyCents)} is reached (${dollars(monthCents)} spent${estimate ? `, this would add ${dollars(estimate)}` : ""}). It starts again next month, or raise the limit.`, monthLevel, dayLevel };
  }
  return { allow: true, needsConfirm: settings.perFilmCents > 0 && estimate > settings.perFilmCents, monthLevel, dayLevel };
}

/* The start of today and of this month in New York, as UTC milliseconds. */
const ZONE = "America/New_York";
export function periodStarts(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = local - Math.floor(now / 1000) * 1000; // how far New York's clock is from UTC right now
  const dayLocal = Date.UTC(get("year"), get("month") - 1, get("day"));
  const monthLocal = Date.UTC(get("year"), get("month") - 1, 1);
  return { dayStart: dayLocal - offset, monthStart: monthLocal - offset, dayKey: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`, monthKey: `${get("year")}-${String(get("month")).padStart(2, "0")}` };
}

