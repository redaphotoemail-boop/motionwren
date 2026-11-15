/* Which part of a photo a film keeps when the photo is not the film's shape. Sideways trims stay centred. When height has
   to go, most of it comes off the top (sky, ceiling) so the floor, steps and the base of the house stay in the picture. */
export const TOP_SHARE_OF_TRIM = 0.75;

export function frameCrop(width: number, height: number, target: number) {
  const original = width / height;
  if (original > target) { const sw = height * target; return { sx: (width - sw) / 2, sy: 0, sw, sh: height, lostShare: 1 - sw / width }; }
  const sh = width / target;
  return { sx: 0, sy: (height - sh) * TOP_SHARE_OF_TRIM, sw: width, sh, lostShare: 1 - sh / height };
}
