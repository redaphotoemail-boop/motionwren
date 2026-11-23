/* The engine keeps its logs for about an hour, so the moment a scene stalls or fails we copy what it says
   (status, error, the end of its log, its own timings) into our database. A manager can read it later in Production. */
type ReportEnv = { DB: D1Database };

export type EngineReport = {
  savedAt: number; scene: number; attempt: number; predictionId: string; engine: string; model: string; why: string;
  status: string; error: string; logs: string; queuedSeconds: number | null; runningSeconds: number | null;
  createdAt: string; startedAt: string; completedAt: string;
};

const key = (jobId: string, scene: number, attempt: number) => `engine-report:${jobId}:${scene}:${attempt}`;
const seconds = (a?: unknown, b?: unknown) => { const x = Date.parse(String(a || "")); const y = Date.parse(String(b || "")); return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 100) / 10 : null; };

export async function saveEngineReport(env: ReportEnv, jobId: string, scene: number, attempt: number, engine: string, why: string, result: Record<string, unknown>) {
  const now = Date.now();
  const started = result.started_at, created = result.created_at, completed = result.completed_at;
  const report: EngineReport = {
    savedAt: now, scene, attempt, predictionId: String(result.id || ""), engine, model: String(result.model || ""), why,
    status: String(result.status || ""), error: String(result.error || "").slice(0, 500), logs: String(result.logs || "").slice(-5000),
    queuedSeconds: seconds(created, started || now), runningSeconds: started ? seconds(started, completed || new Date(now).toISOString()) : null,
    createdAt: String(created || ""), startedAt: String(started || ""), completedAt: String(completed || ""),
  };
  await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key(jobId, scene, attempt), JSON.stringify(report), now).run().catch(() => undefined);
  return report;
}

export async function readEngineReports(env: ReportEnv, jobId: string): Promise<EngineReport[]> {
  const rows = await env.DB.prepare("SELECT value FROM platform_settings WHERE key LIKE ?1 ORDER BY key").bind(`engine-report:${jobId}:%`).all<{ value: string }>().catch(() => null);
  return (rows?.results || []).map((row) => { try { return JSON.parse(row.value) as EngineReport; } catch { return null; } }).filter((item): item is EngineReport => Boolean(item));
}

/* One plain line for the alert and the scene note: what the engine last said. */
export function reportLine(report: EngineReport) {
  const lastLog = report.logs.trim().split("\n").filter(Boolean).pop() || "";
  const waited = report.queuedSeconds != null ? `waited ${Math.round(report.queuedSeconds)}s to start` : "";
  const ran = report.runningSeconds != null ? `ran ${Math.round(report.runningSeconds)}s` : "never started running";
  return [report.status, waited, ran, report.error ? `error: ${report.error.slice(0, 120)}` : "", lastLog ? `last log: ${lastLog.slice(0, 120)}` : "no log lines"].filter(Boolean).join(" · ");
}
