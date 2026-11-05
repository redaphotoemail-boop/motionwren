/* The music templates customers choose from in the plan ("Choose your
   music"). The id is what the plan sends (it was the "mood" answer), what is
   saved with the order, and the name of the sample clip. One template =
   one prompt for ElevenLabs Music; each film still gets its own track made
   to its exact length. Server and client safe: no imports. */

export type MusicTemplate = { id: string; name: string; blurb: string; prompt: string };

export const MUSIC_TEMPLATES: readonly MusicTemplate[] = [
  {
    id: "warm",
    name: "Warm & inviting",
    blurb: "Soft piano and strings",
    prompt: "Warm, elegant instrumental for a real estate home tour video. Soft piano melody with light strings and gentle ambient pads, calm and welcoming, steady 80 BPM, polished modern production, smooth intro and a graceful ending. No vocals.",
  },
  {
    id: "modern",
    name: "Sleek & modern",
    blurb: "Minimal, smooth electronic",
    prompt: "Sleek, minimal modern instrumental for a contemporary home video. Smooth downtempo electronic groove, deep warm bass, soft plucked synths and light percussion, understated and sophisticated, around 95 BPM, polished clean production, a smooth intro and a clean ending. No vocals.",
  },
  {
    id: "luxe",
    name: "Luxe & cinematic",
    blurb: "Slow, sweeping orchestral",
    prompt: "Refined cinematic instrumental for a luxury property film. Slow evolving strings, felt piano and warm ambient textures, sophisticated and inspiring, around 70 BPM, wide cinematic sound, gentle build and an elegant ending. No vocals.",
  },
  {
    id: "bright",
    name: "Bright & energetic",
    blurb: "Upbeat, modern and fresh",
    prompt: "Bright, modern instrumental for a real estate social media reel. Light electronic beat, clean guitar plucks and airy synths, upbeat and confident, around 110 BPM, polished production and a clean ending. No vocals.",
  },
];

export const SAMPLE_SECONDS = 14;

export function musicTemplate(id: unknown): MusicTemplate | null {
  return MUSIC_TEMPLATES.find((template) => template.id === id) || null;
}

/* When the customer does not choose (older orders, Studio films): matched to
   how the film is shown — vertical social reels get the upbeat track, long or
   cinematic films the luxe score, everything else the warm one. */
export function defaultMusicId({ aspect, duration }: { aspect: string; duration: number }) {
  if (aspect === "vertical") return "bright";
  if (aspect === "cinematic" || duration >= 50) return "luxe";
  return "warm";
}

export const sampleKey = (id: string) => `music-samples/${id}.mp3`;
