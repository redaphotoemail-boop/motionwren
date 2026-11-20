import assert from "node:assert/strict";
import { GUARD_DEFAULTS, cleanSettings, decideSpend, guardLevel, periodStarts } from "../app/spend-guard.ts";

const S = { monthlyCents: 30000, dailyCents: 3000, perFilmCents: 500, paused: false };

// Alert steps: 50, 80, 100 of a limit; no limit means no level.
assert.equal(guardLevel(1400, 3000), 0);
assert.equal(guardLevel(1500, 3000), 50);
assert.equal(guardLevel(2400, 3000), 80);
assert.equal(guardLevel(3000, 3000), 100);
assert.equal(guardLevel(99999, 0), 0);

// Under every limit: allowed, and no confirmation for a cheap film.
let d = decideSpend({ settings: S, monthCents: 1000, dayCents: 500, estimateCents: 200 });
assert.ok(d.allow && !d.needsConfirm);

// A film above the per-film amount asks first.
d = decideSpend({ settings: S, monthCents: 1000, dayCents: 500, estimateCents: 600 });
assert.ok(d.allow && d.needsConfirm);

// At the daily limit: everything stops, even work that is already paid for (estimate 0).
d = decideSpend({ settings: S, monthCents: 5000, dayCents: 3000, estimateCents: 0 });
assert.ok(!d.allow && d.why === "daily");

// A film that would cross the limit is refused before it starts, even though spending is still under it.
d = decideSpend({ settings: S, monthCents: 5000, dayCents: 2800, estimateCents: 300 });
assert.ok(!d.allow && d.why === "daily");
d = decideSpend({ settings: S, monthCents: 29900, dayCents: 100, estimateCents: 200 });
assert.ok(!d.allow && d.why === "monthly");

// Work already paid for (estimate 0) keeps going while under the limits, so a started film is not cut in half.
d = decideSpend({ settings: S, monthCents: 29999, dayCents: 2999, estimateCents: 0 });
assert.ok(d.allow);

// The pause switch stops everything, at any spend.
d = decideSpend({ settings: { ...S, paused: true }, monthCents: 0, dayCents: 0, estimateCents: 0 });
assert.ok(!d.allow && d.why === "paused");

// 0 = no limit.
d = decideSpend({ settings: { ...S, monthlyCents: 0, dailyCents: 0 }, monthCents: 9999999, dayCents: 9999999, estimateCents: 100000 });
assert.ok(d.allow && d.needsConfirm);

// Raising the limit lifts the stop by itself.
d = decideSpend({ settings: { ...S, dailyCents: 6000 }, monthCents: 5000, dayCents: 3000, estimateCents: 0 });
assert.ok(d.allow);

// Saved settings stay sane.
assert.deepEqual(cleanSettings(null), GUARD_DEFAULTS);
assert.deepEqual(cleanSettings({ monthlyCents: -5, dailyCents: "abc", perFilmCents: 250.4, paused: "yes" }), { ...GUARD_DEFAULTS, perFilmCents: 250 });
assert.equal(cleanSettings({ paused: true }).paused, true);

// Day and month start at midnight New York time (winter EST = UTC-5, summer EDT = UTC-4).
let p = periodStarts(Date.UTC(2026, 10, 20, 13, 7, 30)); // Nov 20 08:07 EST
assert.equal(p.dayKey, "2026-11-20"); assert.equal(p.monthKey, "2026-11");
assert.equal(p.dayStart, Date.UTC(2026, 10, 20, 5, 0, 0));
assert.equal(p.monthStart, Date.UTC(2026, 10, 1, 5, 0, 0));
p = periodStarts(Date.UTC(2026, 6, 4, 3, 30, 0)); // Jul 3 23:30 EDT is still July 3
assert.equal(p.dayKey, "2026-07-03");
assert.equal(p.dayStart, Date.UTC(2026, 6, 3, 4, 0, 0));
assert.equal(p.monthStart, Date.UTC(2026, 6, 1, 4, 0, 0));
p = periodStarts(Date.UTC(2026, 10, 1, 4, 30, 0)); // Nov 1 00:30 EDT (clocks change later that day)
assert.equal(p.monthKey, "2026-11");
assert.equal(p.monthStart, Date.UTC(2026, 10, 1, 4, 0, 0));

console.log("spend guard: all checks passed");
