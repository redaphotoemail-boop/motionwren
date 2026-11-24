/* The steps every MotionWren film goes through, in order. One list feeds the
   customer's homepage (plain words) and the owner's Production page (how each
   step works, and whether it is on). Wording only: nothing here runs the steps. */

export type PipelineStep = {
  n: number;
  title: string;
  /** For customers: one plain line. */
  line: string;
  /** For the owner: what actually happens. */
  how: string;
  /** The setting that switches it, when there is one. */
  switch?: "movement" | "cloudflare" | "claude" | "autoFix";
};

export const PIPELINE: PipelineStep[] = [
  { n: 1, title: "Photos checked", line: "Size, light and framing are checked before anything is made.", how: "Every upload is checked and prepared; at least two photos are needed." },
  { n: 2, title: "Each room read", line: "We study every photo so the camera move fits that room.", how: "OpenCV measures lines, depth and sky in each photo; the AI reader can look at every photo too (Engines → Camera movement).", switch: "movement" },
  { n: 3, title: "A story, not a slideshow", line: "The film opens by moving in and closes by pulling back.", how: "After the room decides, the story orders the moves: open moving in, close pulling back, never the same move twice in a row." },
  { n: 4, title: "Camera moves, the home does not", line: "Walls, furniture and light are locked. Only the camera travels.", how: "The fixed real-estate prompt (static architecture, furnishings, lighting, reflections) is sent with every scene." },
  { n: 5, title: "Made, then sharpened to 1080p", line: "Every scene is made on a top engine and finished in full HD.", how: "Scenes are made on the chosen engine; H3 engines are made at 768p and upscaled to 1080p." },
  { n: 6, title: "A backup always ready", line: "If one engine stalls, another takes over. You never wait on it.", how: "A stalled scene moves once to the backup engine and then down the shared order; finished scenes are kept." },
  { n: 7, title: "Measured for flaws", line: "Sharpness, flicker, freezes and jumps are measured on every film.", how: "The free mechanical check runs on every finished film." },
  { n: 8, title: "Compared with your photo", line: "An AI reviewer checks the video against your photo, so nothing is added or moved.", how: "Stills are compared with the source photos by Cloudflare AI and/or Claude (Engines → Film quality check).", switch: "cloudflare" },
  { n: 9, title: "Flawed scenes made again", line: "Anything that looks off is quietly re-made before you see it.", how: "A flagged scene is re-made up to 2 more times (Fix automatically).", switch: "autoFix" },
  { n: 10, title: "True crossfades and one soundtrack", line: "Scenes are joined by our own editor, with one music track throughout.", how: "Server-side assembly in the composer: real crossfades, engine sound dropped, one music track under the film." },
  { n: 11, title: "Cards, saved, delivered", line: "Listing details are added sharp, the film is saved and you are emailed.", how: "Opening and closing cards and titles are burned in, the film is stored durably (R2, with history in D1), and the ready email is sent." },
];

/* The same care in five short stages, for the customer's homepage. */
export const HOME_STAGES: { title: string; line: string }[] = [
  { title: "Read", line: "AI studies every room." },
  { title: "Direct", line: "Movement matched to the room and the story." },
  { title: "Lock", line: "The home stays exactly as photographed." },
  { title: "Check", line: "AI checks quality. Flaws are fixed." },
  { title: "Finish", line: "Smooth cuts, music, your details." },
];
