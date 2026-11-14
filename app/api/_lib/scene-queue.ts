import { MAX_ATTEMPTS, STALE_SCENE_MS, engineInputFor, frameKey, loadManifest, normalizeManifest, outputKey, saveManifest, type ProductionManifest } from "./production";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution } from "../../engine-providers";
import { engineCost, engineUpscales, filmSceneDurations, type StudioEngineKey } from "../../engine-catalog";
import { ProviderError, acquireLease, backoff, createPrediction, maxActive, readProviderState, releaseLease, writeProviderState } from "./provider";

/* The scene queue. Every multi-scene video (client orders and Studio videos)
   is made here, one step at a time, by whoever looks at the job: the
   engine's completion callback, the once-a-minute heartbeat, or a page that
   shows the video. Each step:
     1. checks the scenes that are with the engine;
     2. stops the video only if a scene has used up its tries (finished
        scenes are kept, and a manager can resume);
     3. joins the scenes once every one is ready;
     4. otherwise sends the next scenes in order — only as many as the
        configured concurrency allows across ALL videos, and never while the
        engine has asked us to wait.
   A step holds a short lease on the job, and each scene is marked "being
   sent" in the database before the engine is called, so two callbacks, a
   double click or a heartbeat can never send the same scene twice. All state
   is stored (D1 job row + R2 manifest), so a refresh, a redeploy or a restart
   just means the next step carries on. */

export const QUEUE_KINDS = new Set(["studio-series", "studio-single", "customer-series", "ad-series"]);
const PENDING_TIMEOUT_MS = 3 * 60 * 1000;   // a send with no confirmed ID after this is sent again
const JOB_TIME_LIMIT_MS = 6 * 60 * 60 * 1000; // a video still unfinished after this is stopped (credit restored)
const COPY_WINDOW_MS = 50 * 60 * 1000;       // engine copies of finished scenes expire after about an hour
const MAX_TRANSIENT_WAITS = 8;                // network/5xx hiccups in a row before it counts as a failed try

export type QueueRow = {
  id: string; ownerId: string; kind: string; status: string; predictionIds: string; segmentUrls: string;
  stitchPredictionId: string | null; createdAt: number; updatedAt: number; webhookToken?: string | null;
};
type QueueEnv = { DB: D1Database; BUCKET: R2Bucket };
type Lookup = (token: string, id: string) => Promise<Record<string, unknown>>;
export type QueueHooks = {
  lookup: Lookup;
  cancel: (token: string, id: string) => Promise<void>;
  outputUrl: (value: unknown) => string | null;
  fail: (message: string) => Promise<void>;
  assemble: (segments: string[], manifest: ProductionManifest) => Promise<void>;
};

/* Scene IDs and outputs, one entry per scene ("" / null = none yet). Jobs
   made before the queue kept a compact list of outputs; their outputs are
   found again from the engine. */
export function alignedScenes(row: Pick<QueueRow, "predictionIds" | "segmentUrls">, count: number) {
  const ids = (JSON.parse(row.predictionIds || "[]") as string[]).map((value) => value || "");
  while (ids.length < count) ids.push("");
  const raw = JSON.parse(row.segmentUrls || "[]") as (string | null)[];
  const segments = raw.length === count ? raw.map((value) => value || null) : Array.from({ length: count }, () => null as string | null);
  return { ids: ids.slice(0, count), segments };
}

async function persist(env: QueueEnv, jobId: string, ids: string[], segments: (string | null)[]) {
  await env.DB.prepare(`UPDATE render_jobs SET prediction_ids = ?, segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(ids), JSON.stringify(segments), Date.now(), jobId).run();
}

/* Scenes with the engine right now, across every video in production. */
async function activeScenes(env: QueueEnv, exceptJob: string) {
  const rows = await env.DB.prepare(`SELECT id, prediction_ids AS p, segment_urls AS s FROM render_jobs WHERE status = 'generating' AND id != ?`).bind(exceptJob).all<{ id: string; p: string; s: string }>();
  let count = 0;
  for (const row of rows.results) {
    const ids = JSON.parse(row.p || "[]") as string[];
    const segments = JSON.parse(row.s || "[]") as (string | null)[];
    const aligned = segments.length === ids.length;
    ids.forEach((id, index) => { if (id && !id.startsWith("resume-") && !(aligned && segments[index])) count += 1; });
  }
  return count;
}

/* Copies a finished scene into our storage, so it can still be joined after
   the engine's copy expires (a one-at-a-time film can take over an hour). */
async function keepScene(env: QueueEnv, jobId: string, index: number, url: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("The finished scene could not be copied.");
  const size = Number(response.headers.get("content-length")) || 0;
  const body = size ? response.body : await response.arrayBuffer();
  await env.BUCKET.put(outputKey(jobId, index), body, { httpMetadata: { contentType: response.headers.get("content-type") || "video/mp4" } });
  return outputKey(jobId, index);
}

export async function alertManagers(env: QueueEnv, title: string, message: string) {
  const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin'`).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));
  const day = new Date().toISOString().slice(0, 10);
  for (const admin of admins.results) {
    await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'provider_alert', ?, ?, NULL, ?)`).bind(`provider:${title}:${day}:${admin.id}`, admin.id, title, message.slice(0, 500), Date.now()).run().catch(() => undefined);
  }
}

export async function stepSceneQueue(env: QueueEnv, jobId: string, token: string, webhookUrl: string | undefined, hooks: QueueHooks, loadRow: () => Promise<QueueRow | null>) {
  const lease = await acquireLease(env, `job-lock:${jobId}`, 60 * 1000);
  if (!lease) return; // another step is moving this job right now
  try {
    const row = await loadRow();
    if (!row || row.status !== "generating") return;
    const loaded = await loadManifest(env, jobId);
    if (!loaded) return;
    const manifest = normalizeManifest(loaded);
    const count = manifest.inputs.length;
    const { ids, segments } = alignedScenes(row, count);
    const now = Date.now();

    // 1. Scenes with the engine.
    const failScene = (index: number, message: string) => {
      ids[index] = "";
      manifest.lastErrors[index] = message.slice(0, 300);
      if (manifest.attempts[index] >= MAX_ATTEMPTS) { manifest.states[index] = "failed"; manifest.reasons[index] = ""; return; }
      manifest.states[index] = "retry";
      manifest.reasons[index] = "retry";
      manifest.nextAt[index] = now + backoff(manifest.attempts[index], 15 * 1000, 2 * 60 * 1000);
    };
    await Promise.all(ids.map(async (id, index) => {
      if (!id || segments[index]) return;
      if (id.startsWith("resume-")) { ids[index] = ""; manifest.states[index] = "queued"; manifest.nextAt[index] = 0; return; }
      if (id.startsWith("pending-")) {
        // Being sent. If the send never confirmed (the step was cut off), send again.
        if (now - Number(id.split("-").pop()) > PENDING_TIMEOUT_MS) { ids[index] = ""; manifest.states[index] = "retry"; manifest.nextAt[index] = now; manifest.lastErrors[index] = "The engine did not confirm the scene; it is sent again."; }
        return;
      }
      let result: Record<string, unknown>;
      try { result = await hooks.lookup(token, id); } catch { return; } // a failed check is "check again later"
      const status = String(result.status);
      if (status === "succeeded") {
        const url = hooks.outputUrl(result.output);
        if (url) { segments[index] = url; manifest.states[index] = "ready"; manifest.reasons[index] = ""; manifest.outputs[index] = url; manifest.readyAt[index] = now; }
        else failScene(index, "The engine finished without a usable video.");
        return;
      }
      const failed = status === "failed" || status === "canceled";
      const stale = !failed && manifest.startedAt[index] > 0 && now - manifest.startedAt[index] > STALE_SCENE_MS;
      if (stale) await hooks.cancel(token, id).catch(() => undefined);
      if (failed || stale) failScene(index, failed ? String(result.error || "The scene did not finish.") : "The scene took too long and was started again.");
    }));

    // Photo-move scenes need no engine: the photo itself is the scene and the editor makes the move.
    manifest.photoMoves?.forEach((move, index) => {
      const photo = manifest.photos?.[index];
      if (!move || !photo || segments[index]) return;
      ids[index] = ""; segments[index] = photo.link; manifest.states[index] = "ready"; manifest.reasons[index] = ""; manifest.outputs[index] = photo.link; manifest.readyAt[index] = now;
    });

    // Keep our own copy of finished scenes (at most two per step).
    let copies = 0;
    for (let index = 0; index < count && copies < 2; index += 1) {
      if (manifest.photoMoves?.[index] || manifest.states[index] !== "ready" || manifest.saved[index] || !manifest.outputs[index] || now - manifest.readyAt[index] > COPY_WINDOW_MS) continue;
      copies += 1;
      try { manifest.saved[index] = await keepScene(env, jobId, index, manifest.outputs[index]); } catch { /* tried again next step */ }
    }

    // 2. A scene out of tries stops the video (finished scenes are kept).
    const failedIndex = manifest.states.findIndex((state) => state === "failed");
    const tooLong = now - row.createdAt > JOB_TIME_LIMIT_MS;
    if (failedIndex >= 0 || tooLong) {
      await saveManifest(env, jobId, manifest);
      await persist(env, jobId, ids, segments);
      await hooks.fail(tooLong && failedIndex < 0 ? "Production took too long and was stopped." : `Scene ${failedIndex + 1} could not be made after ${manifest.attempts[failedIndex]} tries: ${manifest.lastErrors[failedIndex]}`);
      return;
    }

    // 3. Every scene ready: join them (or save a single clip).
    if (segments.every(Boolean)) {
      // First make sure we hold our own copy of EVERY finished scene. The engine's links die after about an hour, and only two
      // scenes are copied per step, so a long film could reach the joiner with most scenes uncopied; if joining then failed or
      // was resumed later, those scenes were gone and the film could not be finished. (Copies are made in parallel.)
      const missing = segments.map((_, index) => index).filter((index) => !manifest.photoMoves?.[index] && !manifest.saved[index] && manifest.outputs[index] && now - manifest.readyAt[index] <= COPY_WINDOW_MS);
      await Promise.all(missing.map(async (index) => { try { manifest.saved[index] = await keepScene(env, jobId, index, manifest.outputs[index]); } catch { /* the engine's link is still used */ } }));
      await saveManifest(env, jobId, manifest);
      await persist(env, jobId, ids, segments);
      await hooks.assemble(segments as string[], manifest);
      return;
    }

    // 4. Send the next scenes, in order, within the provider's limits.
    const provider = await readProviderState(env);
    const blocked = provider.pausedUntil > now ? "credit" : provider.throttledUntil > now ? "throttle" : "";
    const due = ids.map((id, index) => index).filter((index) => !ids[index] && !segments[index] && ["queued", "retry"].includes(manifest.states[index]) && manifest.nextAt[index] <= now);
    if (blocked) {
      for (const index of due) manifest.reasons[index] = blocked;
    } else if (due.length) {
      const providerLease = await acquireLease(env, "provider-lock", 30 * 1000);
      if (providerLease) {
        try {
          let active = await activeScenes(env, jobId) + ids.filter((id, index) => id && !segments[index]).length;
          const limit = await maxActive(env);
          for (const index of due) {
            if (active >= limit) { manifest.reasons[index] = ""; break; }
            // Mark the scene as being sent before calling the engine.
            ids[index] = `pending-${index}-${Date.now()}`;
            manifest.states[index] = "submitting";
            await persist(env, jobId, ids, segments);
            try {
              const attempt = manifest.attempts[index] + 1;
              const input = await engineInputFor(env, token, jobId, manifest, index, attempt);
              ids[index] = await createPrediction(token, manifest.endpoint, input, webhookUrl);
              if (provider.lowCredit || provider.pausedUntil) await writeProviderState(env, { lowCredit: false, pausedUntil: 0 }).catch(() => undefined); // the engine took a request: the credit warning is over
              manifest.attempts[index] = attempt;
              manifest.startedAt[index] = Date.now();
              manifest.states[index] = "creating";
              manifest.reasons[index] = "";
              manifest.waits[index] = 0;
              active += 1;
              await persist(env, jobId, ids, segments);
              await saveManifest(env, jobId, manifest);
            } catch (error) {
              ids[index] = "";
              const problem = error instanceof ProviderError ? error : new ProviderError("transient", error instanceof Error ? error.message : "The scene could not be sent.");
              const stamp = { lastError: problem.message.slice(0, 300), lastErrorAt: Date.now() };
              manifest.lastErrors[index] = problem.message.slice(0, 300);
              manifest.states[index] = "retry";
              if (problem.kind === "throttled") {
                // The engine asked us to wait: wait as long as it says (at least 10 s), for every video.
                manifest.waits[index] += 1;
                const wait = Math.max(problem.retryAfterMs, 10 * 1000) + Math.round(Math.random() * 3000) + Math.min(60 * 1000, (manifest.waits[index] - 1) * 5000);
                manifest.nextAt[index] = Date.now() + wait;
                manifest.reasons[index] = "throttle";
                await writeProviderState(env, { ...stamp, throttledUntil: Date.now() + wait, lowCredit: provider.lowCredit || /credit/i.test(problem.message) });
                break;
              }
              if (problem.kind === "credit") {
                manifest.states[index] = "queued";
                manifest.nextAt[index] = Date.now() + 5 * 60 * 1000;
                manifest.reasons[index] = "credit";
                await writeProviderState(env, { ...stamp, pausedUntil: Date.now() + 5 * 60 * 1000, lowCredit: true });
                await alertManagers(env, "Video engine needs credit", "Production is paused because the video engine account is out of credit. Videos are kept in line and continue automatically once credit is added.");
                break;
              }
              if (problem.kind === "transient") {
                manifest.waits[index] += 1;
                manifest.nextAt[index] = Date.now() + backoff(manifest.waits[index], 15 * 1000, 5 * 60 * 1000);
                manifest.reasons[index] = "retry";
                if (manifest.waits[index] >= MAX_TRANSIENT_WAITS) { manifest.waits[index] = 0; manifest.attempts[index] += 1; if (manifest.attempts[index] >= MAX_ATTEMPTS) manifest.states[index] = "failed"; }
                await writeProviderState(env, stamp);
                break;
              }
              // Refused: a failed try of this scene (the next try hands the photo over another way).
              manifest.attempts[index] += 1;
              manifest.nextAt[index] = Date.now() + 5 * 1000;
              manifest.reasons[index] = "retry";
              if (manifest.attempts[index] >= MAX_ATTEMPTS) manifest.states[index] = "failed";
              await writeProviderState(env, stamp);
            }
          }
        } finally { await releaseLease(env, "provider-lock", providerLease); }
      }
    }
    await saveManifest(env, jobId, manifest);
    await persist(env, jobId, ids, segments);
  } finally {
    await releaseLease(env, `job-lock:${jobId}`, lease);
  }
}

/* Stitch inputs: the engine's copy while it is fresh, otherwise our own. */
export function stitchSources(manifest: ProductionManifest, segments: string[], origin: string, jobId: string, webhookToken: string | null | undefined) {
  const now = Date.now();
  const saved = manifest.saved || [];
  const readyAt = manifest.readyAt || [];
  return segments.map((url, index) => saved[index] && origin && webhookToken && (!readyAt[index] || now - readyAt[index] > 45 * 60 * 1000)
    ? `${origin}/api/job-frames/${jobId}/out-${String(index + 1).padStart(2, "0")}.mp4?token=${webhookToken}`
    : url);
}

/* ---------- manager actions (same queue, same protections) ---------- */

export type JobAction = "resume" | "retry-scene" | "regenerate-scene" | "reassemble";

/* Changes which scenes the queue will (re)make, under the job's lease, then
   hands the job back to the queue. Never calls the engine itself, so a
   double click cannot create duplicate engine jobs. */
export async function applyJobAction(env: QueueEnv, row: QueueRow, action: JobAction, scene: number | null, switchTo?: StudioEngineKey): Promise<{ ok: true; redo: number } | { error: string }> {
  const lease = await acquireLease(env, `job-lock:${row.id}`, 60 * 1000);
  if (!lease) return { error: "This video is being updated right now. Try again in a few seconds." };
  try {
    const loaded = await loadManifest(env, row.id);
    if (!loaded) return { error: "This video was made before it could be resumed. Please start a new one." };
    const manifest = normalizeManifest(loaded);
    const count = manifest.inputs.length;
    const { ids, segments } = alignedScenes(row, count);
    if (row.kind.startsWith("studio-")) {
      for (let index = 0; index < count; index += 1) if (!await env.BUCKET.head(frameKey(row.id, index))) return { error: "This video's photos are no longer stored. Please start a new one." };
    }
    const now = Date.now();
    const usable = (index: number) => Boolean(segments[index]) && (Boolean(manifest.photoMoves?.[index])) || Boolean(segments[index]) && (now - manifest.readyAt[index] < 45 * 60 * 1000 || Boolean(manifest.saved[index]));
    const redone: number[] = [];
    const redoScene = (index: number) => {
      redone.push(index);
      ids[index] = ""; segments[index] = null;
      manifest.states[index] = "queued"; manifest.attempts[index] = 0; manifest.waits[index] = 0; manifest.nextAt[index] = 0; manifest.reasons[index] = "";
      manifest.outputs[index] = ""; manifest.saved[index] = ""; manifest.readyAt[index] = 0; manifest.lastErrors[index] = "";
    };
    let redo = 0;
    if (action === "resume") {
      if (row.status !== "failed") return { error: "Only a stopped video can be resumed." };
      for (let index = 0; index < count; index += 1) {
        if (usable(index)) continue;
        if (ids[index] && !segments[index] && !ids[index].startsWith("pending-") && !ids[index].startsWith("resume-") && manifest.states[index] === "creating") continue; // still with the engine
        redoScene(index); redo += 1;
      }
    } else if (action === "retry-scene" || action === "regenerate-scene") {
      if (scene === null || scene < 0 || scene >= count) return { error: "Choose a scene." };
      if (action === "retry-scene" && usable(scene)) return { error: "That scene is already made." };
      if (["generating", "starting"].includes(row.status) && manifest.states[scene] === "creating") return { error: "That scene is being made right now." };
      redoScene(scene); redo = 1;
      for (let index = 0; index < count; index += 1) if (index !== scene && !usable(index) && !(ids[index] && manifest.states[index] === "creating")) { redoScene(index); redo += 1; }
    } else if (action === "reassemble") {
      if (!segments.every((value, index) => value && usable(index))) return { error: "Every scene must be made before the film can be joined again." };
    }
    if (["stitching", "saving"].includes(row.status)) return { error: "This video is being finished right now." };
    // A backup engine: the scenes still to be made are asked of another engine (finished scenes are kept).
    let newCost: number | null = null;
    if (switchTo && action === "resume") {
      const job = await env.DB.prepare(`SELECT aspect, cost_cents AS costCents FROM render_jobs WHERE id = ?`).bind(row.id).first<{ aspect: string; costCents: number }>();
      const resolution = engineResolution(switchTo);
      const seconds = filmSceneDurations(switchTo, resolution).find((option) => option >= manifest.sceneSeconds) || Math.max(...filmSceneDurations(switchTo, resolution));
      for (const index of redone) {
        const old = manifest.inputs[index] || {};
        const link = manifest.photos?.[index]?.link;
        if (!link) return { error: "This order's photos are not on record, so a backup engine cannot be used." };
        manifest.inputs[index] = buildEngineInput(switchTo, { imageUrl: link, prompt: String(old.prompt || ""), duration: seconds, resolution, aspectRatio: job?.aspect === "vertical" ? "9:16" : "16:9" });
        if (manifest.photos?.[index]) manifest.photos[index].file = undefined;
        if (manifest.photoMoves) manifest.photoMoves[index] = ""; // this scene is now an engine clip
      }
      const perScene = (job?.costCents || 0) / Math.max(1, count);
      newCost = Math.round(perScene * (count - redone.length) + engineCost(switchTo, resolution, seconds) * redone.length * 100);
      manifest.engine = switchTo;
      if (engineUpscales(switchTo, resolution)) manifest.upscale = { to: "1080p" }; else delete manifest.upscale;
      manifest.endpoint = ENGINE_ENDPOINTS[switchTo];
    }
    manifest.stitchAttempts = 0;
    if (manifest.upscale) manifest.upscale = { to: "1080p" }; // a re-made film is upscaled again
    // A fresh edit (the film's music is kept, so a re-made film sounds the same).
    if (manifest.edit) manifest.edit = { ...manifest.edit, key: undefined, tries: 0, startedAt: 0, lastError: "", usedBackupJoiner: false };
    await saveManifest(env, row.id, manifest);
    // Back into production (a finished film gets a new version in History).
    await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', cost_cents = COALESCE(?, cost_cents), prediction_ids = ?, segment_urls = ?, stitch_prediction_id = NULL, history_id = NULL, error = NULL, updated_at = ? WHERE id = ?`).bind(newCost, JSON.stringify(ids), JSON.stringify(segments), now, row.id).run();
    await env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE render_job_id = ? AND status IN ('failed', 'cancelled', 'completed')`).bind(now, row.id).run();
    return { ok: true, redo };
  } finally {
    await releaseLease(env, `job-lock:${row.id}`, lease);
  }
}
