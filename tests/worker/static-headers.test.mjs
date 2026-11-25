/* Static files (public/) are served by Cloudflare before the Worker runs, so they get their security headers from
   public/_headers. This keeps that file equal to the Worker's own list. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECURITY_HEADERS } from "../../worker/security-headers.ts";
const file = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8").split("\n");
assert.ok(file.includes("/*"));
for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.ok(file.includes(`  ${name}: ${value}`), `${name} is missing or different in public/_headers`);
console.log(`PASS static files carry the same ${Object.keys(SECURITY_HEADERS).length} security headers as the Worker`);
