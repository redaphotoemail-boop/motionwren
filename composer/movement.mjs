/* Measures a film's photos with OpenCV (composer/movement.py) so the site can
   choose each photo's camera movement. Numbers only: nothing here picks a
   movement or touches a prompt. Photos arrive as links or inline (base64). */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_PHOTOS = 24;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "movement.py");

function runPython(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; if (stderr.length > 20_000) stderr = stderr.slice(-10_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("The photo reader took too long.")); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`photo reader failed (${code}): ${stderr.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`));
    });
  });
}

export async function fetchPhoto(item, file) {
  if (typeof item?.data === "string" && item.data) {
    const bytes = Buffer.from(item.data, "base64");
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("The photo is empty or too large.");
    await fs.writeFile(file, bytes);
    return;
  }
  if (typeof item?.url !== "string" || !/^https?:\/\//.test(item.url)) throw new Error("A photo needs a link or its data.");
  const response = await fetch(item.url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`The photo could not be fetched (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("The photo is empty or too large.");
  await fs.writeFile(file, bytes);
}

/* → { opencv, photos: [ {numbers…, thumb?: base64} | {error} ] } */
export async function measurePhotos(root, photos, { thumbs = false } = {}) {
  if (!Array.isArray(photos) || !photos.length) throw Object.assign(new Error("Photos are needed."), { status: 400 });
  if (photos.length > MAX_PHOTOS) throw Object.assign(new Error(`At most ${MAX_PHOTOS} photos.`), { status: 400 });
  const dir = await fs.mkdtemp(path.join(root, "look-"));
  try {
    const files = []; const errors = new Map();
    for (const [index, item] of photos.entries()) {
      const file = path.join(dir, `p${index}`);
      try { await fetchPhoto(item, file); files.push(file); }
      catch (error) { errors.set(index, String(error?.message || error).slice(0, 200)); files.push(path.join(dir, `missing${index}`)); }
    }
    const thumbDir = path.join(dir, "thumbs");
    if (thumbs) await fs.mkdir(thumbDir);
    const out = JSON.parse(await runPython([...(thumbs ? ["--thumbs", thumbDir] : []), ...files], 120_000));
    const result = [];
    for (const [index, measured] of out.photos.entries()) {
      if (errors.has(index)) { result.push({ error: errors.get(index) }); continue; }
      if (thumbs && !measured.error) measured.thumb = (await fs.readFile(path.join(thumbDir, `${index}.jpg`)).catch(() => Buffer.alloc(0))).toString("base64") || undefined;
      result.push(measured);
    }
    return { opencv: out.opencv, photos: result };
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}
