import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "d77b1f2e-92d3-4bc7-98b7-186275e85f20";
const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // Server heartbeat: moves along videos in production once a minute.
  triggers: { crons: ["* * * * *"] },
  // The composer: our own ffmpeg final edit (one music track, true
  // crossfades, exact length), one container per film. See composer/.
  containers: [
    {
      class_name: "Composer",
      image: "./composer/Dockerfile",
      // 1 vCPU, 3 GiB, 8 GB disk. Billing counts the memory reserved, not used:
      // the editor peaked near 0.6 GiB (Cloudflare metrics, Nov 2026), so the
      // old 6 GiB "standard-2" paid for twice what it needs. Same CPU speed.
      instance_type: { vcpu: 1, memory_mib: 3072, disk_mb: 8000 },
      max_instances: 20,
    },
  ],
  // Cloudflare Workers AI: the film quality review (app/api/_lib/film-review.ts). Declared here so every deploy keeps it.
  ai: { binding: "AI" },
  // Stripe prices for the Single, Five-pack and Pro checkouts (not secrets).
  // These are the MotionWren sandbox (test mode) prices; swap in the live
  // price IDs when Stripe goes live. The secret key and the webhook signing
  // secret stay in Cloudflare's dashboard as secrets.
  vars: {
    STRIPE_PRICE_SINGLE: "price_1UfZpnIypmSMFeRmJ3YQ8sex",
    STRIPE_PRICE_FIVE_PACK: "price_1UfZpoIypmSMFeRmzeA5rVtT",
    STRIPE_PRICE_PRO: "price_1UfZppIypmSMFeRm9NGQjsPe",
  },
  durable_objects: { bindings: [{ name: "COMPOSER", class_name: "Composer" }] },
  migrations: [{ tag: "composer-v1", new_sqlite_classes: ["Composer"] }],
  // Local development runs without Docker; films there use the backup joiner.
  dev: { enable_containers: false },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
