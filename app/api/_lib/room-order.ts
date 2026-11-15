import { cloudflareRun, reviewersConnected } from "./film-review";
import { ROOM_ORDER, storyOrderIndexes, type Room } from "../../wrencut-fit";

/* Puts a template film's photos in the order a listing film walks through a home. Only rooms are asked of the photo
   (never anything else); if the reader is not connected, or any answer fails, the photos keep the order they came in. */
const QUESTION = "What is the main subject of this real-estate photograph? Answer with exactly one word from this list: exterior, entry, living, dining, kitchen, bedroom, bathroom, outdoor. Use exterior for the front or outside of the house, outdoor for a patio, pool, yard or view.";
const MAX_BYTES = 1_400_000;

export function roomIn(answer: string): Room | null {
  const text = answer.toLowerCase();
  const alias: [RegExp, Room][] = [[/exterior|facade|front of/, "exterior"], [/entry|foyer|hall/, "entry"], [/living|family room|lounge|great room/, "living"], [/dining/, "dining"], [/kitchen/, "kitchen"], [/bed/, "bedroom"], [/bath|shower|toilet/, "bathroom"], [/outdoor|patio|pool|yard|garden|view|deck|terrace/, "outdoor"]];
  for (const [pattern, room] of alias) if (pattern.test(text)) return room;
  return null;
}

function bytesOf(image: string): Uint8Array | null {
  const match = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(image);
  if (!match) return null;
  try { const raw = atob(match[1]); if (raw.length > MAX_BYTES) return null; const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i); return out; } catch { return null; }
}

export async function storyOrder<T extends { image?: unknown }>(env: unknown, scenes: T[]): Promise<{ scenes: T[]; ordered: boolean; rooms: (Room | null)[] }> {
  const keep = { scenes, ordered: false, rooms: scenes.map(() => null) as (Room | null)[] };
  if (scenes.length < 3 || !reviewersConnected(env).cloudflare) return keep;
  try {
    const rooms = await Promise.all(scenes.map(async (scene) => {
      const bytes = typeof scene.image === "string" ? bytesOf(scene.image) : null;
      if (!bytes) return null;
      try { return roomIn(await Promise.race([cloudflareRun(env, bytes, QUESTION, 8), new Promise<string>((resolve) => setTimeout(() => resolve(""), 12000))])); } catch { return null; }
    }));
    const order = storyOrderIndexes(rooms);
    const moved = order.some((value, index) => value !== index);
    return { scenes: order.map((index) => scenes[index]), ordered: moved, rooms: order.map((index) => rooms[index]) };
  } catch { return keep; }
}
export { ROOM_ORDER };
