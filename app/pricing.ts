/* What a film costs the customer, by length or by number of photos. Pure
   maths so the checkout, the order and the tests agree.

   Baselines: 20 s $29, 30 s $39, 60 s $59. Automatic length: each photo is a
   5-second scene, and the price follows the same line (4 photos $29, 6 photos
   $39, 12 photos $59), then $5 for every photo past 12. Credits (Five-pack,
   Pro, gift codes) each cover one 20-second film; anything longer pays the
   difference. */

export const BASE_CENTS = 2900;
export const SCENE_SECONDS = 5;
export const MAX_PRICED_PHOTOS = 24; // 2 minutes
export const EXTRA_PHOTO_CENTS = 500;

/** Price in cents for a film made from this many 5-second scenes. */
export function priceForScenes(scenes: number): number {
  const n = Math.max(1, Math.floor(scenes));
  if (n <= 4) return BASE_CENTS;
  if (n === 5) return 3400;
  if (n <= 12) return 3900 + Math.round((2000 * (n - 6)) / 6 / 100) * 100;
  return 5900 + EXTRA_PHOTO_CENTS * (Math.min(n, MAX_PRICED_PHOTOS) - 12);
}

/** A fixed length (20, 30 or 60 s; others fall on the same line). */
export const priceForSeconds = (seconds: number) => priceForScenes(Math.ceil(Math.max(0, seconds) / SCENE_SECONDS));

/** Automatic length: the film's length and price from the photos the customer uploaded. */
export function autoQuote(photos: number) {
  const scenes = Math.max(1, Math.min(Math.floor(photos), MAX_PRICED_PHOTOS));
  return { scenes, seconds: Math.max(20, scenes * SCENE_SECONDS), cents: priceForScenes(scenes) };
}

/** targetDuration 0 means "automatic". */
export function quoteFor(targetDuration: number, photos: number) {
  if (!targetDuration) return autoQuote(photos);
  return { scenes: Math.ceil(targetDuration / SCENE_SECONDS), seconds: targetDuration, cents: priceForSeconds(targetDuration) };
}

/** What a customer pays on top of the one credit that covers a 20-second film. */
export const upgradeCents = (quoteCents: number) => Math.max(0, quoteCents - BASE_CENTS);
