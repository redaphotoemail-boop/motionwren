import { cloudflareRun, reviewersConnected } from "./film-review";
import { roomIn } from "./room-order";
import { moodIn, type Mood } from "../../edit-suggest";

/* Reads each photo for its room and overall style. Nothing else is asked of the photo; if the reader is not
   connected or an answer fails, that photo simply has no vote. */
const STYLE_QUESTION = "Which one word best describes the style and mood of this real-estate photograph? Answer with exactly one word from this list: luxe, modern, warm, bright.";
const ROOM_QUESTION = "What is the main subject of this real-estate photograph? Answer with exactly one word from this list: exterior, entry, living, dining, kitchen, bedroom, bathroom, outdoor.";

const withTimeout = (work: Promise<string>) => Promise.race([work, new Promise<string>((resolve) => setTimeout(() => resolve(""), 12000))]);

export async function readStyle(env: unknown, images: Uint8Array[]): Promise<{ connected: boolean; moods: (Mood | null)[]; rooms: (string | null)[] }> {
  if (!reviewersConnected(env).cloudflare) return { connected: false, moods: images.map(() => null), rooms: images.map(() => null) };
  const both = await Promise.all(images.map(async (bytes) => {
    const ask = async (question: string) => { try { return await withTimeout(cloudflareRun(env, bytes, question, 8)); } catch { return ""; } };
    const [style, room] = await Promise.all([ask(STYLE_QUESTION), ask(ROOM_QUESTION)]);
    return { mood: moodIn(style), room: roomIn(room) };
  }));
  return { connected: true, moods: both.map((item) => item.mood), rooms: both.map((item) => item.room) };
}
