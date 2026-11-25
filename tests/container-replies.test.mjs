/* Build check: every reply from an editing machine (Cloudflare Container) must be read or let go.

   Why: a machine stays awake, and billed, while a reply it sent is still unread. In November 2026 a few unread
   replies kept machines on for days (about 800 machine-hours). This check fails the build if new code calls a
   machine and can leave its reply unread on any way out of the function.

   It looks at every call to a machine (a fetch to http://composer, or through a machine stub) and follows the
   reply: before it is read (.json(), .text(), .arrayBuffer(), release(...), body cancel, or returned to a caller
   that stores it), no return or throw may leave it behind. Calls whose reply goes back to a caller (editFile,
   makeMusicSample) are followed to every caller too. Plain node, no packages: it runs in the Cloudflare build. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith(".d.ts")) files.push(path);
  }
};
walk(join(root, "app"));
walk(join(root, "worker"));

const problems = [];
let calls = 0;
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const consumes = (line, v) => new RegExp(`\\b${esc(v)}\\??\\.(json|text|arrayBuffer|blob|formData)\\(|release\\(\\s*${esc(v)}\\b|\\b${esc(v)}\\??\\.body\\??\\.(cancel|pipeTo|getReader)\\(|return\\s+${esc(v)}\\b|storeResponse\\(.*\\b${esc(v)}\\b|storeFinishedFilm\\(.*\\b${esc(v)}\\b|upscaleFilm\\(.*\\b${esc(v)}\\b`).test(line);
const leaves = (line) => /\b(return|throw)\b/.test(line);
const endOfFunction = (line) => /^(export\s+)?(async\s+)?function\b|^}\s*$|^export\s/.test(line);

/* Follows a reply held in `v` from line i: it must be read before any way out. */
function follow(rel, lines, i, v, what) {
  for (let j = i + 1; j < lines.length && j < i + 80; j++) {
    const line = lines[j];
    if (consumes(line, v)) return;
    if (leaves(line)) { problems.push(`${rel}:${j + 1}: the reply from ${what} (line ${i + 1}) can be left unread here. Read it, or call release(${v}) first.`); return; }
    if (endOfFunction(line)) break;
  }
  problems.push(`${rel}:${i + 1}: the reply from ${what} is never read. Read it, or wrap the call in release(...).`);
}

const HANDS_BACK = ["editFile", "makeMusicSample"]; // helpers that return a machine's reply to their caller

for (const path of files) {
  const rel = relative(root, path);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    const isMachineCall = /\.fetch\(/.test(code) && (/http:\/\/composer/.test(code) || /\bstub\(/.test(code) || /\btarget\.fetch\(/.test(code));
    const isDefinition = /String\(input\)\.replace\("http:\/\/composer"/.test(code) || /real\.fetch\(input, /.test(code);
    if (isMachineCall && !isDefinition) {
      calls++;
      if (/release\(\s*await\b/.test(code)) return; // let go on the spot
      const held = /(?:const|let)\s+(\w+)\s*=\s*await\b/.exec(code) || /^\s*(\w+)\s*=\s*await\b/.exec(code);
      if (!held) { problems.push(`${rel}:${i + 1}: a machine is called but its reply is not kept or let go. Assign it and read it, or wrap the call in release(...).`); return; }
      follow(rel, lines, i, held[1], "the editing machine");
    }
    for (const helper of HANDS_BACK) {
      if (!new RegExp(`\\bawait\\s+${helper}\\(`).test(code) || /export\s+async\s+function/.test(code)) continue;
      calls++;
      if (/storeResponse\(|\.arrayBuffer\(\)|storeFinishedFilm\(/.test(code)) continue; // read on the same line
      const held = /(?:const|let)\s+(\w+)\s*=\s*await\b/.exec(code) || /(\w+)\s*=\s*await\b/.exec(code);
      if (!held) { problems.push(`${rel}:${i + 1}: ${helper}(...) hands back a machine's reply that is not kept. Store it, or read it.`); continue; }
      // A reply kept for later must be read somewhere further on in the same file.
      const later = lines.slice(i + 1, i + 120);
      if (!later.some((other) => consumes(other, held[1]))) problems.push(`${rel}:${i + 1}: ${helper}(...) hands back a machine's reply in ${held[1]} that is never read.`);
    }
  });
}

if (calls < 10) problems.push(`Only ${calls} machine calls found; the check may no longer be looking in the right place.`);

// The watchdog's knock path must be the same on both sides.
const machineSide = readFileSync(join(root, "worker/composer.ts"), "utf8");
const siteSide = readFileSync(join(root, "app/api/_lib/editor-machines.ts"), "utf8");
const pathOf = (text) => /SLEEP_PATH = "([^"]+)"/.exec(text)?.[1];
if (!pathOf(machineSide) || pathOf(machineSide) !== pathOf(siteSide)) problems.push("The watchdog's sleep path differs between worker/composer.ts and app/api/_lib/editor-machines.ts.");
// Every machine call must go through the stub that writes the machine down for the watchdog.
for (const path of files) {
  const rel = relative(root, path);
  if (rel === "app/api/_lib/composer.ts" || rel === "app/api/_lib/editor-machines.ts") continue;
  const text = readFileSync(path, "utf8");
  if (/namespace\.getByName\(|\.idFromName\(/.test(text)) problems.push(`${rel}: talks to a machine without machineStub, so the watchdog would not know about it.`);
}

if (problems.length) {
  console.error(`Editing-machine reply check failed (${problems.length}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Editing-machine reply check passed: ${calls} machine calls, every reply is read or let go.`);
