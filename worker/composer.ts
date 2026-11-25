/* The composer container (composer/Dockerfile + composer/server.mjs): our
   own ffmpeg final edit, one instance per film. The site talks to it only
   through this Durable Object (app/api/_lib/composer.ts); it is never on the
   internet. Keys it needs come from this Worker's secrets. */
import { Container } from "@cloudflare/containers";
import { sleepDecision } from "./sleep-decision";

type ComposerEnv = {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MUSIC_MODEL?: string;
  REPLICATE_API_TOKEN?: string;
};

/* Safety net: if no request has reached this container for this long, it is
   put to sleep even when a reply looks unfinished. The site checks in every
   minute while a film is being edited, so a real edit never gets near it. */
const STUCK_AFTER_MS = 30 * 60 * 1000;
export const SLEEP_PATH = "/__motionwren/sleep";
const FEATURE_HEADER = "x-motionwren-feature"; // must match app/api/_lib/composer.ts

export class Composer extends Container<ComposerEnv> {
  defaultPort = 8080;
  // Asleep (and not billed) 5 minutes after the last check-in; the site
  // checks in every minute while a film is being edited.
  sleepAfter = "5m";
  enableInternet = true;
  private lastRequestAt = Date.now();

  private lastSavedUse = 0;

  override async containerFetch(...args: Parameters<Container<ComposerEnv>["containerFetch"]>): Promise<Response> {
    this.lastRequestAt = Date.now();
    // Remembered across restarts (at most once a minute) so the watchdog never puts a machine in use to sleep.
    if (this.lastRequestAt - this.lastSavedUse > 60_000) {
      this.lastSavedUse = this.lastRequestAt;
      this.ctx.storage.put("lastUseAt", this.lastRequestAt).catch(() => undefined);
    }
    return super.containerFetch(...args);
  }

  /* The watchdog's knock (app/api/_lib/editor-machines.ts). It is answered here and never reaches the machine,
     so it never starts one. It stops the machine only when no request has reached it for `idle` ms
     (30 minutes at least) and no reply is still being sent. Every other request is passed on unchanged. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== SLEEP_PATH) {
      // The feature this machine works for (film editing, photo reading…), as a label Cloudflare keeps with its
      // usage, so Finance can split the machines' cost by feature. Only takes effect when the machine starts.
      const feature = request.headers.get(FEATURE_HEADER) || "";
      if (/^[a-z-]{1,32}$/.test(feature)) (this as unknown as { labels: Record<string, string> }).labels = { feature };
      return super.fetch(request);
    }
    const running = Boolean(this.ctx.container?.running);
    if (!running) return Response.json({ running: false, stopped: false, reason: "asleep" });
    const saved = Number(await this.ctx.storage.get("lastUseAt")) || 0;
    const lastUse = Math.max(saved, this.lastSavedUse ? this.lastRequestAt : 0);
    const inflight = (this as unknown as { inflightRequests: number }).inflightRequests;
    const decision = sleepDecision({ running, lastUse, lastRequestAt: this.lastRequestAt, inflight, idleMs: Number(url.searchParams.get("idle")) || 0, now: Date.now() });
    if (!decision.stop) return Response.json({ running: true, stopped: false, reason: decision.reason });
    console.log(`Composer: watchdog put an idle machine to sleep (last use ${lastUse ? Math.round((Date.now() - lastUse) / 60000) + " min ago" : "unknown"}).`);
    await this.stop();
    return Response.json({ running: true, stopped: true, reason: decision.reason });
  }

  /* The library keeps a container awake while any reply is still being read.
     A reply nobody finished reading kept machines on for days (Nov 2026 bill),
     so after STUCK_AFTER_MS with no new request the count is reset. */
  isActivityExpired(): boolean {
    const self = this as unknown as { inflightRequests: number; sleepAfterMs: number };
    if (self.inflightRequests > 0 && Date.now() - this.lastRequestAt > STUCK_AFTER_MS) {
      console.log(`Composer: ${self.inflightRequests} unfinished repl(ies) after ${STUCK_AFTER_MS / 60000} min idle; letting the container sleep.`);
      self.inflightRequests = 0;
    }
    if (self.inflightRequests > 0) { this.renewActivityTimeout(); return false; }
    return self.sleepAfterMs <= Date.now();
  }

  constructor(ctx: ConstructorParameters<typeof Container<ComposerEnv>>[0], env: ComposerEnv) {
    super(ctx, env);
    const pick = (value: string | undefined) => value || "";
    this.envVars = {
      ELEVENLABS_API_KEY: pick(env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY),
      ELEVENLABS_MUSIC_MODEL: pick(env.ELEVENLABS_MUSIC_MODEL || process.env.ELEVENLABS_MUSIC_MODEL),
      REPLICATE_API_TOKEN: pick(env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN),
    };
  }
}
