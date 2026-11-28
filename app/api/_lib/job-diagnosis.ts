/* What went wrong with a video, in plain words, for the manager's Production
   page: the problems (each with the fix that applies), and a timeline with a
   time on every line. Pure: it reads what production already saved (the
   job, its scenes, the engine reports, the quality re-makes) and changes nothing. */
import type { IssueCode } from "../../problem-words";

export type DiagJob = { id: string; kind: string; status: string; error?: string | null; createdAt: number; updatedAt: number; costCents: number };
export type DiagScene = { state: string; attempt: number; nextAt: number; error: string; startedAt: number; readyAt: number; saved: boolean; expired: boolean };
export type DiagReport = { savedAt: number; scene: number; attempt: number; engine: string; why: string; status: string; error: string; queuedSeconds: number | null; runningSeconds: number | null };
export type DiagFix = { round: number; scenes: number[]; why: string; cents: number; engine: string; at: number };

export type FixAction = { action: "resume" | "retry-scene" | "reassemble"; scene?: number; label: string; note?: string };
export type Issue = { code: IssueCode; why: string; at: number; scene?: number; fix: FixAction | null };
export type TimelineEvent = { at: number; text: string; bad?: boolean };

const STUCK_AFTER_MS = 20 * 60 * 1000;
const ACTIVE = ["starting", "generating", "stitching", "saving"];
const min = (ms: number) => ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const engineName = (key: string) => ({ wan3: "Wan 3.0", h3: "H3", h3lite: "H3 Lite", hailuo23: "Hailuo 2.3", vidu3turbo: "Vidu Turbo", magi2: "Magi 2", kling3: "Kling 3.0" } as Record<string, string>)[key] || key || "the engine";

/* The engine's message in words the manager can act on. */
export function plainWhy(error: string, report?: DiagReport) {
  const text = String(error || report?.error || "");
  const timing = report ? [report.queuedSeconds != null ? `waited ${Math.round(report.queuedSeconds)} s to start` : "", report.runningSeconds != null ? `ran ${Math.round(report.runningSeconds)} s` : "never started running"].filter(Boolean).join(", ") : "";
  let reason: string;
  if (/credit|payment|billing|insufficient/i.test(text)) reason = "The engine account ran out of credit.";
  else if (/throttl|rate limit|burst|429/i.test(text)) reason = "The engine was busy and asked us to slow down.";
  else if (/did not finish|within \d+ minutes|stalled|processing/i.test(text) || report?.why === "stalled") reason = `The engine left the scene “processing” too long${report ? ` (${engineName(report.engine)})` : ""}.`;
  else if (/sensitive|nsfw|flagged|content policy|safety/i.test(text)) reason = "The engine refused the photo as sensitive content.";
  else if (/could not be reached|network|timeout|timed out|5\d\d/i.test(text)) reason = "The engine did not answer.";
  else if (/picked up again/i.test(text)) reason = "The video was interrupted before it finished.";
  else if (/photo|image|fetch|download|link|url/i.test(text)) reason = "The engine could not read the photo.";
  else reason = text ? text.replace(/\s+/g, " ").slice(0, 160) : "The engine did not give a reason.";
  return timing ? `${reason} (${timing})` : reason;
}

export function diagnoseJob(job: DiagJob, scenes: DiagScene[], reports: DiagReport[], fixes: DiagFix[], now: number, engines?: { engine: string; firstEngine: string }): { issues: Issue[]; timeline: TimelineEvent[] } {
  const issues: Issue[] = [];
  const timeline: TimelineEvent[] = [{ at: job.createdAt, text: engines?.firstEngine ? `Started on ${engineName(engines.firstEngine)}` : "Started" }];
  if (engines?.engine && engines.firstEngine && engines.engine !== engines.firstEngine) timeline.push({ at: 0, bad: true, text: `Now on ${engineName(engines.engine)}: the quality check moved the re-made scenes there, so History names ${engineName(engines.engine)}.` });
  const active = ACTIVE.includes(job.status);
  const lastReport = (scene: number) => [...reports].filter((report) => report.scene === scene).sort((a, b) => b.savedAt - a.savedAt)[0];

  for (const report of [...reports].sort((a, b) => a.savedAt - b.savedAt)) {
    timeline.push({ at: report.savedAt, bad: true, text: `Scene ${report.scene + 1}, try ${report.attempt}, ${engineName(report.engine)}: ${report.why === "stalled" ? "stalled" : "failed"}. ${plainWhy(report.error, report)}` });
  }
  scenes.forEach((scene, index) => { if (scene.readyAt) timeline.push({ at: scene.readyAt, text: `Scene ${index + 1} made${scene.attempt > 1 ? ` (try ${scene.attempt})` : ""}` }); });
  for (const fix of fixes) timeline.push({ at: fix.at, bad: true, text: `Quality check made scene${fix.scenes.length === 1 ? "" : "s"} ${fix.scenes.map((n) => n + 1).join(", ")} again (round ${fix.round}${fix.engine ? `, ${engineName(fix.engine)}` : ""}${fix.cents ? `, about ${dollars(fix.cents)} extra` : ""}). ${fix.why.replace(/\s+/g, " ").slice(0, 200)}` });
  scenes.forEach((scene, index) => { if (scene.nextAt > now && active) timeline.push({ at: scene.nextAt, text: `Scene ${index + 1} tries again` }); });

  if (job.status === "succeeded") timeline.push({ at: job.updatedAt, text: `Finished, took ${min(job.updatedAt - job.createdAt)}, cost ${dollars(job.costCents)}` });
  else if (job.status === "failed") timeline.push({ at: job.updatedAt, bad: true, text: `Stopped. ${plainWhy(job.error || "")}` });
  else timeline.push({ at: job.updatedAt, text: "Last activity" });

  // --- problems ---
  if (job.status === "failed") {
    const todo = scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.state !== "ready" || scene.expired);
    const first = todo[0];
    const why = plainWhy(job.error || first?.scene.error || "", first ? lastReport(first.index) : undefined);
    const again = Math.max(1, todo.length);
    issues.push({
      code: "stopped", at: job.updatedAt, scene: first?.index, why: `${why}${todo.length ? ` ${todo.length === 1 ? `Scene ${first.index + 1} is` : `${todo.length} scenes are`} not made.` : ""}`,
      fix: todo.length || !scenes.length ? { action: "resume", label: "Fix: resume", note: `Finished scenes are kept; ${again} scene${again === 1 ? "" : "s"} made again.` } : { action: "reassemble", label: "Fix: join again", note: "Every scene is made; this joins them into the film again." },
    });
  } else if (active) {
    scenes.forEach((scene, index) => {
      if (["failed", "retry"].includes(scene.state) && scene.error) issues.push({ code: "waiting", at: scene.startedAt || job.updatedAt, scene: index, why: `Scene ${index + 1}, try ${scene.attempt} of 3. ${plainWhy(scene.error, lastReport(index))}${scene.nextAt > now ? ` Tries again at ${new Date(scene.nextAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.` : ""}`, fix: { action: "retry-scene", scene: index, label: "Fix: retry now" } });
    });
    if (now - job.updatedAt > STUCK_AFTER_MS && !scenes.some((scene) => scene.nextAt > now)) issues.push({ code: "stuck", at: job.updatedAt, why: `No change for ${min(now - job.updatedAt)}.`, fix: { action: "resume", label: "Fix: nudge" } });
  }

  // --- handled by itself (finished, or recovered while running) ---
  for (const report of reports.filter((item) => item.why === "stalled")) issues.push({ code: "stalled", at: report.savedAt, scene: report.scene, why: `Scene ${report.scene + 1} stalled on ${engineName(report.engine)} (try ${report.attempt}). ${plainWhy(report.error, report)}`, fix: null });
  if (fixes.length) {
    const cents = fixes.reduce((sum, fix) => sum + (fix.cents || 0), 0);
    issues.push({ code: "remade", at: fixes[fixes.length - 1].at || job.updatedAt, why: `${fixes.length} re-make${fixes.length === 1 ? "" : "s"} of scene${new Set(fixes.flatMap((fix) => fix.scenes)).size === 1 ? "" : "s"} ${[...new Set(fixes.flatMap((fix) => fix.scenes))].map((n) => n + 1).join(", ")}${cents ? `, about ${dollars(cents)} extra` : ""}. ${fixes[0].why.replace(/\s+/g, " ").slice(0, 160)}`, fix: null });
  }
  if (job.status === "succeeded") {
    const took = job.updatedAt - job.createdAt;
    const allowed = (5 + 3 * Math.max(1, scenes.length)) * 60_000;
    if (took > allowed) {
      const causes = [fixes.length ? `${fixes.length} quality re-make${fixes.length === 1 ? "" : "s"}` : "", reports.length ? `${reports.length} stalled or failed try${reports.length === 1 ? "" : "s"}` : "", scenes.some((scene) => scene.attempt > 1) ? "scenes retried" : ""].filter(Boolean);
      issues.push({ code: "slow", at: job.updatedAt, why: `Took ${min(took)} (normal is under ${min(allowed)}). ${causes.length ? `Cause: ${causes.join(", ")}.` : "No retries or re-makes were recorded, so the engine queue was slow."}`, fix: null });
    }
  }

  timeline.sort((a, b) => (a.at || Infinity) - (b.at || Infinity));
  return { issues, timeline };
}
