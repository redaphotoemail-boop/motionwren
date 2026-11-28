/* What a film costs the customer, by length or by number of photos. Pure
   maths so the checkout, the order and the tests agree.

   Two lengths (Reda, Nov 25 2026): up to 20 s $29, up to 50 s $49.
   Change LONG_SECONDS / LONG_CENTS here and every page, quote and checkout
   follows. Automatic length: each photo is a 5-second scene; up to 4 photos
   is the 20-second price, up to LONG_SECONDS is the long price, then $5 for
   every extra photo.

   Credits: a Single or Five-pack credit covers one 20-second film; a longer
   film pays the difference. Membership ($99 a month) adds MEMBER_FILMS
   credits a month, and each membership film covers a film up to
   MEMBER_FILM_SECONDS (a "member_film" ledger row pays the difference). */

export const BASE_SECONDS = 20;
export const BASE_CENTS = 2900;
/** The long film: one constant for its length, one for its price. */
export const LONG_SECONDS = 50;
export const LONG_CENTS = 4900;
export const SCENE_SECONDS = 5;
export const MAX_PRICED_PHOTOS = 24; // 2 minutes
export const EXTRA_PHOTO_CENTS = 500;

/** Membership: a monthly plan with a few films each month, each up to MEMBER_FILM_SECONDS. */
export const MEMBER_MONTHLY_CENTS = 9900;
export const MEMBER_FILMS = 3;
export const MEMBER_FILM_SECONDS = 60;

/** Photos per film (Reda, Nov 25 2026: two photos can't make a 60-second film; extra photos must still fit).
    Every photo becomes one scene, scenes stay even, and a scene stays between MIN_SCENE_SECONDS (quicker reads as a
    flicker) and COMFORT_SCENE_SECONDS (longer reads slow for a push-in). So a length needs at least minPhotosFor and
    uses at most maxPhotosFor photos (the rest wait out, in the customer's order):
      10 s: 2-3 photos · 20 s: 4-7 · 40 s: 8-15 · 50 s: 9-19 · 60 s: 11-23
    Lengths follow the photos inside each price: up to 7 photos make the up-to-20-second film (2 photos 10 s,
    3 photos 15 s, 4-7 photos 20 s); from 8 photos the film moves up to the up-to-50-second price (8 photos 40 s,
    9 or more 50 s). Membership films go to 60 s (10 photos 55 s, 11 or more 60 s). The order flow offers only
    these lengths, and submitting an order checks the photo count again. */
export const MIN_SCENE_SECONDS = 3;
export const COMFORT_SCENE_SECONDS = 6;
export const TEASER_SECONDS = 10;
const JOIN_SECONDS = 0.5; // the soft overlap where two scenes join (CROSSFADE_SECONDS in engine-catalog.ts)
export const minPhotosFor = (seconds: number) => (seconds > 0 ? Math.max(2, Math.ceil((seconds - JOIN_SECONDS) / (COMFORT_SCENE_SECONDS - JOIN_SECONDS))) : 2);
export const maxPhotosFor = (seconds: number) => Math.max(2, Math.floor((seconds - JOIN_SECONDS) / (MIN_SCENE_SECONDS - JOIN_SECONDS)));
/** The longest length (in 5-second steps, at least 10 s) up to `cap` that this many photos fill comfortably. */
export function filmSecondsFor(photos: number, cap: number): number {
  for (let seconds = cap; seconds > TEASER_SECONDS; seconds -= SCENE_SECONDS) if (photos >= minPhotosFor(seconds)) return seconds;
  return TEASER_SECONDS;
}
/** Where a film moves from the 20-second price to the 50-second price: one photo more than a 20-second film can use. */
export const LONG_FROM_PHOTOS = maxPhotosFor(BASE_SECONDS) + 1;
/** The hero film's length for this many photos: the 20-second film up to 7 photos, then the long film (or a member's
    film up to `longest`). */
export function filmLengthForPhotos(photos: number, longest = LONG_SECONDS): number {
  return photos >= LONG_FROM_PHOTOS ? filmSecondsFor(photos, longest) : filmSecondsFor(photos, BASE_SECONDS);
}

/** Five-pack: five 20-second credits. */
export const FIVE_PACK_CENTS = 12500;
/** Pro (kept, Reda Nov 26 2026): ten 20-second credits a month. */
export const PRO_MONTHLY_CENTS = 19900;
export const PRO_CREDITS = 10;

/** "$29", "$49", "$12.50". */
export const dollars = (cents: number) => `$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`;

/** Price in cents for a film of this many seconds. */
export function priceForSeconds(seconds: number): number {
  const s = Math.max(0, seconds);
  if (s <= BASE_SECONDS) return BASE_CENTS;
  if (s <= LONG_SECONDS) return LONG_CENTS;
  const extraScenes = Math.ceil((Math.min(s, MAX_PRICED_PHOTOS * SCENE_SECONDS) - LONG_SECONDS) / SCENE_SECONDS);
  return LONG_CENTS + EXTRA_PHOTO_CENTS * extraScenes;
}

/** Price in cents for a film made from this many 5-second scenes. */
export const priceForScenes = (scenes: number) => priceForSeconds(Math.max(1, Math.floor(scenes)) * SCENE_SECONDS);

/** Automatic length: the film's length and price from the photos the customer uploaded. */
export function autoQuote(photos: number) {
  const scenes = Math.max(1, Math.min(Math.floor(photos), MAX_PRICED_PHOTOS));
  return { scenes, seconds: Math.max(BASE_SECONDS, scenes * SCENE_SECONDS), cents: priceForScenes(scenes) };
}

/** targetDuration 0 means "automatic". */
export function quoteFor(targetDuration: number, photos: number) {
  if (!targetDuration) return autoQuote(photos);
  return { scenes: Math.ceil(targetDuration / SCENE_SECONDS), seconds: targetDuration, cents: priceForSeconds(targetDuration) };
}

/** What a customer pays on top of the one credit that covers a 20-second film. */
export const upgradeCents = (quoteCents: number) => Math.max(0, quoteCents - BASE_CENTS);

/** What one membership film adds to a credit: a MEMBER_FILM_SECONDS film's price above the 20-second price. */
export const MEMBER_FILM_UPGRADE_CENTS = upgradeCents(priceForSeconds(MEMBER_FILM_SECONDS));
