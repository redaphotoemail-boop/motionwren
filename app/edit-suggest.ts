/* Turns what the photos look like into an editing suggestion. Pure (no imports) so it can be tested on its own. */

export type Mood = "warm" | "modern" | "luxe" | "bright";
export const MOODS: Mood[] = ["luxe", "modern", "warm", "bright"];
export type SuggestTemplate = { id: string; name: string; best: number; least: number };
export type EditSuggestion = { templateId: string | null; templateName: string; music: Mood; reason: string };

export function moodIn(answer: string): Mood | null {
  const text = answer.toLowerCase();
  if (/luxe|luxur|elegant|upscale|premium|high-end/.test(text)) return "luxe";
  if (/modern|contemporary|minimal|sleek/.test(text)) return "modern";
  if (/warm|cozy|cosy|traditional|rustic|homey|inviting/.test(text)) return "warm";
  if (/bright|airy|fresh|light|sunny|clean/.test(text)) return "bright";
  return null;
}

export function suggestEdit(input: { photoCount: number; moods: (Mood | null)[]; templates: SuggestTemplate[] }): EditSuggestion {
  const votes = new Map<Mood, number>();
  for (const mood of input.moods) if (mood) votes.set(mood, (votes.get(mood) || 0) + 1);
  const music = MOODS.reduce<Mood>((top, mood) => (votes.get(mood) || 0) > (votes.get(top) || 0) ? mood : top, votes.size ? MOODS.find((mood) => votes.has(mood)) as Mood : "modern");
  const fits = input.templates.filter((item) => input.photoCount >= item.least);
  const pool = fits.length ? fits : input.templates;
  const pick = [...pool].sort((a, b) => Math.abs(a.best - input.photoCount) - Math.abs(b.best - input.photoCount) || b.best - a.best)[0];
  const feel = votes.size ? `${music === "luxe" ? "an elegant" : music === "modern" ? "a modern" : music === "warm" ? "a warm" : "a bright, airy"} feel` : "no clear style";
  if (!pick) return { templateId: null, templateName: "", music, reason: `Your photos have ${feel}. ${music[0].toUpperCase()}${music.slice(1)} music suits them.` };
  const count = input.photoCount === pick.best ? `${pick.best} photos is exactly what ${pick.name} is built for` : input.photoCount < pick.least ? `${pick.name} works best with at least ${pick.least} photos — you have ${input.photoCount}` : `${pick.name} is built for ${pick.best} photos and adapts to your ${input.photoCount}`;
  return { templateId: pick.id, templateName: pick.name, music, reason: `Your photos have ${feel}, so ${music} music suits them. ${count}.` };
}
