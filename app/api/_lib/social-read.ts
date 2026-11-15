import { cloudflareRun, reviewersConnected } from "./film-review";
import { arrangePhotos, parseLight, parseRoom, parseYes, type PhotoFacts } from "../../social-check";
import type { SocialSpec } from "../../social-templates";

/* Reads each photo for what a social template needs to know: its room, whether it is day, dusk or night, and whether it
   shows depth a camera can travel into. Only those questions are asked of a photo. If the reader is not connected, or an
   answer fails, that photo simply has no answer and the checks that depend on it are skipped. */
const ROOM = "What is the main subject of this real-estate photograph? Answer with exactly one word from this list: exterior, entry, living, dining, kitchen, bedroom, bathroom, outdoor, aerial, detail. Use exterior for the front or outside of the house, outdoor for a patio, pool, yard or garden, aerial for a drone or high overhead view, detail for a close view of a material, fixture or object.";
const LIGHT = "What is the lighting in this photograph? Answer with exactly one word from this list: day, dusk, night.";
const DEPTH = "Does this photograph show a deep space, such as a hallway, a long room or a path, that a camera could travel forward into? Answer yes or no.";
const MAX_BYTES = 1_400_000;

const withTimeout = (work: Promise<string>) => Promise.race([work, new Promise<string>((resolve) => setTimeout(() => resolve(""), 12000))]);

export function dataUrlBytes(image: unknown): Uint8Array | null {
  const match = typeof image === "string" ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
  if (!match) return null;
  try { const raw = atob(match[1]); if (raw.length > MAX_BYTES) return null; const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i); return out; } catch { return null; }
}

export async function readSocialPhotos(env: unknown, images: (Uint8Array | null)[]): Promise<{ connected: boolean; facts: Pick<PhotoFacts, "room" | "light" | "depth">[] }> {
  const none = images.map(() => ({ room: null, light: null, depth: null }));
  if (!reviewersConnected(env).cloudflare) return { connected: false, facts: none };
  const facts = await Promise.all(images.map(async (bytes) => {
    if (!bytes) return { room: null, light: null, depth: null };
    const ask = async (question: string) => { try { return await withTimeout(cloudflareRun(env, bytes, question, 8)); } catch { return ""; } };
    const [room, light, depth] = await Promise.all([ask(ROOM), ask(LIGHT), ask(DEPTH)]);
    return { room: parseRoom(room), light: parseLight(light), depth: parseYes(depth) };
  }));
  return { connected: true, facts };
}

/* The scenes of a film, put in the template's story order and trimmed to the photos it has room for. Without the reader
   the photos keep the order they came in (the first ones are used). */
export async function socialOrder<T extends { image?: unknown }>(env: unknown, spec: SocialSpec, scenes: T[]): Promise<{ scenes: T[]; ordered: boolean; kept: number[]; dropped: number }> {
  const bytes = scenes.map((scene) => dataUrlBytes(scene.image));
  const read = await readSocialPhotos(env, bytes);
  const photos: PhotoFacts[] = scenes.map((_, index) => ({ w: 0, h: 0, ...read.facts[index] }));
  const arrangement = arrangePhotos(spec, photos);
  return { scenes: arrangement.used.map((index) => scenes[index]), ordered: arrangement.used.some((value, index) => value !== index), kept: arrangement.kept, dropped: arrangement.unused.length };
}
