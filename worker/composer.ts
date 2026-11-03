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

export class Composer extends Container<ComposerEnv> {
  defaultPort = 8080;
  // Kept warm while a film is being edited (the site checks in every minute).
  sleepAfter = "20m";
  enableInternet = true;

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
