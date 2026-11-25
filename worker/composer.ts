/* The composer container (composer/Dockerfile + composer/server.mjs): our
   own ffmpeg final edit, one instance per film. The site talks to it only
   through this Durable Object (app/api/_lib/composer.ts); it is never on the
   internet. Keys it needs come from this Worker's secrets. */
import { Container } from "@cloudflare/containers";

type ComposerEnv = {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MUSIC_MODEL?: string;
  REPLICATE_API_TOKEN?: string;
};

/* Safety net: if no request has reached this container for this long, it is
   put to sleep even when a reply looks unfinished. The site checks in every
   minute while a film is being edited, so a real edit never gets near it. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

export class Composer extends Container<ComposerEnv> {
  defaultPort = 8080;
  // Asleep (and not billed) 5 minutes after the last check-in; the site
  // checks in every minute while a film is being edited.
  sleepAfter = "5m";
  enableInternet = true;
  private lastRequestAt = Date.now();

  override async containerFetch(...args: Parameters<Container<ComposerEnv>["containerFetch"]>): Promise<Response> {
    this.lastRequestAt = Date.now();
    return super.containerFetch(...args);
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
