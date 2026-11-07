/* Music moods for Studio Ads. One template = one prompt for ElevenLabs
   Music; each ad still gets its own track made to its exact length (the
   composer does that, same as the customer films). These are written for
   commercials, not home tours: confident and premium, never cheesy, never
   childish. Instrumental only — a voiceover sits on top when one is set.
   Server and client safe: no imports. */

export type AdMusicMood = { id: string; name: string; blurb: string; prompt: string };

export const AD_MUSIC_MOODS: readonly AdMusicMood[] = [
  {
    id: "bold",
    name: "Bold & confident",
    blurb: "Driving, modern, assured",
    prompt: "Bold, confident instrumental for a premium brand commercial. Driving modern groove, deep punchy bass, crisp percussion and a memorable synth hook, energetic but controlled, around 105 BPM, polished broadcast production, a strong opening and a clean ending. No vocals.",
  },
  {
    id: "cinematic",
    name: "Cinematic & sweeping",
    blurb: "Slow, orchestral, inspiring",
    prompt: "Sweeping cinematic instrumental for a high-end commercial. Slow evolving strings, deep piano and warm ambient textures, inspiring and grand without being sentimental, around 70 BPM, wide cinematic sound, a gentle build and an elegant ending. No vocals.",
  },
  {
    id: "upbeat",
    name: "Upbeat & fresh",
    blurb: "Bright, modern, social-first",
    prompt: "Bright, upbeat instrumental for a social media commercial. Light electronic beat, clean guitar plucks and airy synths, fresh and optimistic, around 115 BPM, polished modern production, an opening that hooks in the first second and a clean ending. No vocals.",
  },
  {
    id: "minimal",
    name: "Minimal & sleek",
    blurb: "Quiet, spacious, refined",
    prompt: "Minimal, sleek instrumental for a luxury brand film. Sparse felt piano, soft sub bass and delicate textures, quiet and spacious, around 60 BPM, refined and restrained, a slow fade-in and a graceful ending. No vocals.",
  },
  {
    id: "luxe",
    name: "Luxe & warm",
    blurb: "Warm, rich, premium",
    prompt: "Warm, luxurious instrumental for a premium product commercial. Rich strings, soft Rhodes piano and gentle brushed percussion, warm and inviting, around 80 BPM, polished and expensive-sounding, a smooth intro and a graceful ending. No vocals.",
  },
  {
    id: "warm",
    name: "Warm & human",
    blurb: "Gentle, honest, close",
    prompt: "Warm, human instrumental for a heartfelt brand story. Gentle acoustic guitar, soft piano and light strings, honest and close, around 85 BPM, intimate production, a tender opening and a soft ending. No vocals.",
  },
];

export function adMusicMood(id: unknown): AdMusicMood | null {
  return AD_MUSIC_MOODS.find((mood) => mood.id === id) || null;
}

export function defaultAdMusicMood(aspect: string, duration: number): string {
  if (aspect === "vertical") return "upbeat";
  if (duration >= 50) return "cinematic";
  return "bold";
}
