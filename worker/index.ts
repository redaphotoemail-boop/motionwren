/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { heartbeatKey } from "../app/api/_lib/heartbeat";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  REPLICATE_API_TOKEN?: string;
  PUBLIC_ORIGIN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  /* Once a minute (triggers.crons in vite.config.ts): move along every video
     in production, so none depends on a provider callback arriving or on a
     page being open. Runs inside this Worker; nothing is exposed. */
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const secret = env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN;
    if (!secret) return;
    const origin = env.PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN || "https://motionwren.com";
    const request = new Request(`${origin}/api/heartbeat`, { method: "POST", headers: { "x-motionwren-heartbeat": await heartbeatKey(secret) } });
    ctx.waitUntil(Promise.resolve(handler.fetch(request, env, ctx)).then(() => undefined, () => undefined));
  },
};

export default worker;
