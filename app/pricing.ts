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

/** Photos a film needs (Reda, Nov 25 2026: two photos can't make a 60-second film). Scenes stay roughly even and no
    scene runs longer than MAX_SCENE_SECONDS, so a length needs enough photos: 10 s 2 photos, 20 s 3, 50 s 7, 60 s 8.
    The order flow only offers a length the photos can fill, and submitting an order checks it again. */
export const MAX_SCENE_SECONDS = 8;
export const TEASER_SECONDS = 10;
const JOIN_SECONDS = 0.5; // the soft overlap where two scenes join (CROSSFADE_SECONDS in engine-catalog.ts)
export const minPhotosFor = (seconds: number) => (seconds > 0 ? Math.max(2, Math.ceil((seconds - JOIN_SECONDS) / (MAX_SCENE_SECONDS - JOIN_SECONDS))) : 2);
/** The longest length, up to `longest`, that this many photos can fill (membership 60 s, 50 s, 20 s, then 10 s). */
export function filmLengthForPhotos(photos: number, longest = LONG_SECONDS): number {
  for (const seconds of [longest, LONG_SECONDS, BASE_SECONDS, TEASER_SECONDS]) if (seconds <= longest && photos >= minPhotosFor(seconds)) return seconds;
  return TEASER_SECONDS;
}

/** Five-pack: five 20-second credits. */
export const FIVE_PACK_CENTS = 12500;

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
