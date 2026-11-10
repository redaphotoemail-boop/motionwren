/* Security-headers unit tests: every Worker response carries the six
   headers, existing headers survive, conflicting values are overwritten,
   and status/body pass through unchanged. Plain node, no database, no
   provider. The module is bundled with esbuild first, the way
   tests/studio-ads does it. */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(mkdtempSync(join(tmpdir(), "mw-headers-")), "lib.mjs");
await build({ entryPoints: [join(HERE, "..", "..", "worker", "security-headers.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, logLevel: "warning" });
const { SECURITY_HEADERS, withSecurityHeaders } = await import(pathToFileURL(OUT).href);

/* 1. All six headers land on a plain response, with the exact values. */
{
  const out = withSecurityHeaders(new Response("hello", { status: 200, headers: { "Content-Type": "text/plain" } }));
  check("1a HSTS is set", out.headers.get("Strict-Transport-Security") === "max-age=63072000; includeSubDomains; preload", out.headers.get("Strict-Transport-Security") || "");
  check("1b nosniff is set", out.headers.get("X-Content-Type-Options") === "nosniff", "");
  check("1c framing is same-origin only", out.headers.get("X-Frame-Options") === "SAMEORIGIN", out.headers.get("X-Frame-Options") || "");
  check("1d referrer policy is set", out.headers.get("Referrer-Policy") === "strict-origin-when-cross-origin", "");
  check("1e camera/mic/location are off", out.headers.get("Permissions-Policy") === "camera=(), microphone=(), geolocation=()", out.headers.get("Permissions-Policy") || "");
  check("1f CSP is present", typeof out.headers.get("Content-Security-Policy") === "string" && (out.headers.get("Content-Security-Policy") || "").length > 0, "");
}

/* 2. The CSP says what the app needs and nothing it does not. */
{
  const csp = SECURITY_HEADERS["Content-Security-Policy"];
  check("2a CSP defaults to self", csp.includes("default-src 'self'"), "");
  check("2b CSP allows the inline scripts and styles the app has", csp.includes("script-src 'self' 'unsafe-inline'") && csp.includes("style-src 'self' 'unsafe-inline'"), "");
  check("2c CSP allows Google Fonts and nothing else external", csp.includes("https://fonts.googleapis.com") && csp.includes("https://fonts.gstatic.com") && !csp.includes("accounts.google"), "");
  check("2d CSP blocks plugins and outside framing", csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'self'"), "");
  check("2e CSP keeps navigation and forms same-origin", csp.includes("form-action 'self'") && csp.includes("base-uri 'self'"), "");
}

/* 3. Existing headers survive; conflicting security values are overwritten. */
{
  const out = withSecurityHeaders(new Response("{}", { status: 201, headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600", "X-Frame-Options": "DENY" } }));
  check("3a content type survives", out.headers.get("Content-Type") === "application/json", "");
  check("3b cache control survives", out.headers.get("Cache-Control") === "private, max-age=3600", "");
  check("3c a conflicting framing value is overwritten, not kept", out.headers.get("X-Frame-Options") === "SAMEORIGIN", out.headers.get("X-Frame-Options") || "");
  check("3d status passes through", out.status === 201, String(out.status));
  check("3e body passes through", (await out.text()) === "{}", "");
}

/* 4. The original response is untouched. */
{
  const original = new Response("x", { status: 200 });
  withSecurityHeaders(original);
  check("4a the original gains no headers", original.headers.get("Strict-Transport-Security") === null && original.headers.get("Content-Security-Policy") === null, "");
}

/* 5. The module and the Worker entry agree on the header set. */
{
  const entry = readFileSync(join(HERE, "..", "..", "worker", "index.ts"), "utf8");
  check("5a the Worker entry applies the headers", entry.includes("withSecurityHeaders"), "");
  check("5b the Worker entry imports the module", entry.includes("security-headers"), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
