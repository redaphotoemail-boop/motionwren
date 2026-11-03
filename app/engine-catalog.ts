export type StudioEngineKey = "kling3" | "geminiOmni" | "veo31Lite" | "hailuo23" | "runway45" | "wan22" | "wan25" | "wan27" | "wan3" | "seedance1fast";
export type StudioResolution = "480p" | "720p" | "1080p";
export type StudioClipDuration = 3 | 4 | 5 | 6 | 8 | 10 | 15;

export type StudioEngine = {
  key: StudioEngineKey;
  name: string;
  shortName: string;
  description: string;
  bestFor: string;
  resolutions: StudioResolution[];
  audio: boolean;
  firstLastFrame: boolean;
  realEstate: boolean;
  badge?: string;
  pricePerSecond: Partial<Record<StudioResolution, number>>;
};

export const studioEngines: StudioEngine[] = [
  {
    key: "kling3",
    name: "Kling Video 3.0",
    shortName: "Kling 3.0",
    description: "Strong spatial consistency, smooth camera motion and native 1080p.",
    bestFor: "Real estate · best overall",
    resolutions: ["720p", "1080p"],
    audio: true,
    firstLastFrame: true,
    realEstate: true,
    badge: "RECOMMENDED",
    pricePerSecond: { "720p": 0.084, "1080p": 0.14 },
  },
  {
    key: "geminiOmni",
    name: "Google Gemini Omni 1.1",
    shortName: "Gemini Omni",
    description: "Premium keyframe control, native audio and high-resolution output.",
    bestFor: "Real estate · frame transitions",
    resolutions: ["720p", "1080p"],
    audio: true,
    firstLastFrame: true,
    realEstate: true,
    badge: "KEYFRAMES",
    pricePerSecond: { "720p": 0.12, "1080p": 0.23 },
  },
  {
    key: "veo31Lite",
    name: "Google Veo 3.1 Lite",
    shortName: "Veo 3.1 Lite",
    description: "Cost-efficient high-fidelity motion with native audio and frame interpolation.",
    bestFor: "Architecture · high-volume quality",
    resolutions: ["720p", "1080p"],
    audio: true,
    firstLastFrame: true,
    realEstate: true,
    badge: "VALUE PRO",
    pricePerSecond: { "720p": 0.05, "1080p": 0.08 },
  },
  {
    key: "hailuo23",
    name: "MiniMax Hailuo 2.3",
    shortName: "MiniMax H3",
    description: "High-detail image animation with controlled, realistic motion.",
    bestFor: "Real estate · fine detail",
    resolutions: ["720p", "1080p"],
    audio: false,
    firstLastFrame: false,
    realEstate: true,
    badge: "DETAIL",
    pricePerSecond: { "720p": 0.05, "1080p": 0.082 },
  },
  {
    key: "runway45",
    name: "Runway Gen-4.5",
    shortName: "Runway 4.5",
    description: "Precise image-to-video motion with strong scene consistency.",
    bestFor: "Lifestyle · cinematic control",
    resolutions: ["720p"],
    audio: false,
    firstLastFrame: false,
    realEstate: true,
    badge: "CONSISTENCY",
    pricePerSecond: { "720p": 0.12 },
  },
  {
    key: "wan22",
    name: "Wan 2.2 Fast",
    shortName: "Wan 2.2",
    description: "Lowest-cost drafts and fast motion tests.",
    bestFor: "Cheap previews",
    resolutions: ["480p", "720p"],
    audio: false,
    firstLastFrame: false,
    realEstate: false,
    pricePerSecond: { "480p": 0.01, "720p": 0.022 },
  },
  {
    key: "seedance1fast",
    name: "Seedance 1 Pro Fast",
    shortName: "Seedance Fast",
    description: "Fast, stable 1080p alternative with strong motion.",
    bestFor: "Speed at 1080p",
    resolutions: ["480p", "720p", "1080p"],
    audio: false,
    firstLastFrame: false,
    realEstate: true,
    pricePerSecond: { "480p": 0.015, "720p": 0.025, "1080p": 0.06 },
  },
  {
    key: "wan25",
    name: "Wan 2.5",
    shortName: "Wan 2.5",
    description: "Reliable image-to-video generation with synchronized audio.",
    bestFor: "Audio and voiceover",
    resolutions: ["480p", "720p", "1080p"],
    audio: true,
    firstLastFrame: false,
    realEstate: false,
    pricePerSecond: { "480p": 0.05, "720p": 0.1, "1080p": 0.15 },
  },
  {
    key: "wan27",
    name: "Wan 2.7",
    shortName: "Wan 2.7",
    description: "Strong control, synchronized audio and frame-to-frame work.",
    bestFor: "Controlled transitions",
    resolutions: ["720p", "1080p"],
    audio: true,
    firstLastFrame: true,
    realEstate: true,
    pricePerSecond: { "720p": 0.1, "1080p": 0.15 },
  },
  {
    key: "wan3",
    name: "Wan 3.0",
    shortName: "Wan 3.0",
    description: "Newest Wan model with cinematic motion and longer generations.",
    bestFor: "Latest overall quality",
    resolutions: ["480p", "720p", "1080p"],
    audio: false,
    firstLastFrame: false,
    realEstate: true,
    pricePerSecond: { "480p": 0.025, "720p": 0.05, "1080p": 0.1 },
  },
];

export function studioEngine(key: StudioEngineKey) {
  return studioEngines.find((engine) => engine.key === key) || studioEngines[0];
}

export function engineSupportsResolution(key: StudioEngineKey, resolution: StudioResolution) {
  return studioEngine(key).resolutions.includes(resolution);
}

export function engineCost(key: StudioEngineKey, resolution: StudioResolution, seconds: number) {
  return (studioEngine(key).pricePerSecond[resolution] || 0) * seconds;
}

/**
 * Provider-safe clip lengths for the controls we expose in the Studio.
 * These are deliberately centralized so the UI and API cannot disagree about
 * a duration that a provider will silently change or reject.
 */
export function engineDurationOptions(key: StudioEngineKey, resolution: StudioResolution): StudioClipDuration[] {
  switch (key) {
    case "geminiOmni": return [5, 10];
    case "veo31Lite": return resolution === "1080p" ? [8] : [4, 6, 8];
    case "hailuo23": return resolution === "1080p" ? [6] : [6, 10];
    case "runway45": return [5, 10];
    case "wan22": return [5, 10];
    case "seedance1fast": return [5, 8, 10];
    case "kling3": return [3, 5, 6, 8, 10, 15];
    case "wan25": return [3, 5, 6, 8, 10];
    case "wan27": return [3, 5, 6, 8, 10, 15];
    case "wan3": return [3, 5, 6, 8, 10, 15];
  }
}

export function preferredDurationForEngine(key: StudioEngineKey, requested: number, resolution: StudioResolution) {
  const options = engineDurationOptions(key, resolution);
  return options.reduce((closest, option) => Math.abs(option - requested) < Math.abs(closest - requested) ? option : closest, options[0]);
}

/**
 * The video lengths offered when making a video: 15 s for social reels and
 * stories, 30 s for the standard listing film, 60 s for a full home tour.
 */
export const VIDEO_LENGTHS = [15, 30, 60] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];

/** Scenes overlap by this much where our editor (the composer) cross-dissolves
    one into the next. Every scene is trimmed to its share of the film, so the
    finished film lands exactly on the ordered length. */
export const CROSSFADE_SECONDS = 0.5;

/** Scene lengths an engine can make for a film. Wan 3.0 takes any whole
    number of seconds (2–30 per its published schema); others use their
    Studio options. */
export function filmSceneDurations(key: StudioEngineKey, resolution: StudioResolution): number[] {
  if (key === "wan3") return [3, 4, 5, 6, 7, 8, 9, 10, 12, 15];
  return [...engineDurationOptions(key, resolution)].sort((a, b) => a - b);
}

/** How long each photo stays on screen, chosen by film length (automatic
    "Scene timing"): quick cuts for short social videos, calmer shots for
    longer listing films. Short AI scenes also stay truer to the photo. */
export function idealShotSeconds(targetSeconds: number) {
  return targetSeconds <= 15 ? 3 : targetSeconds <= 20 ? 3.5 : targetSeconds <= 30 ? 4 : 5;
}

/**
 * How many photos a video uses and how long each scene is made, so the
 * finished film lands exactly on the ordered length. Scene timing is
 * automatic (idealShotSeconds) unless the manager fixed it at 3 or 5 s.
 * Each scene is made at the shortest engine length that covers its share
 * (shareSeconds) and trimmed to it. Picks the number of photos whose share is
 * closest to the ideal pace while wasting the least engine time.
 * Typical: 10 s → 4 photos, 15 s → 6, 20 s → 6, 30 s → 9, 60 s → 12.
 * Never more than 12 scenes; with fewer photos each scene simply runs longer.
 */
export const MAX_CUSTOMER_SCENES = 12;
export function scenePlan(key: StudioEngineKey, resolution: StudioResolution, targetSeconds: number, available: number, secondsPerPhoto?: 3 | 5) {
  const allowed = filmSceneDurations(key, resolution);
  const longest = allowed[allowed.length - 1];
  const ideal = secondsPerPhoto || idealShotSeconds(targetSeconds);
  const most = Math.max(1, Math.min(available, MAX_CUSTOMER_SCENES));
  const X = CROSSFADE_SECONDS;
  if (most === 1) {
    const sceneSeconds = allowed.find((option) => option >= targetSeconds) || longest;
    const totalSeconds = Math.min(targetSeconds, sceneSeconds);
    return { count: 1, sceneSeconds, shareSeconds: totalSeconds, totalSeconds };
  }
  let best: { count: number; share: number; sceneSeconds: number; score: number } | null = null;
  for (let count = 2; count <= most; count += 1) {
    const share = (targetSeconds + (count - 1) * X) / count;
    if (share < 2.5) break; // faster than this reads as flicker
    const sceneSeconds = allowed.find((option) => option >= share - 1e-9);
    if (!sceneSeconds) continue; // a scene can't be that long: more photos needed
    const score = Math.abs(share - ideal) / ideal + 0.6 * (sceneSeconds - share) / sceneSeconds;
    if (!best || score < best.score - 1e-9) best = { count, share, sceneSeconds, score };
  }
  if (!best) {
    // Too few photos for the length even at the longest scenes: the film is as long as they allow.
    return { count: most, sceneSeconds: longest, shareSeconds: longest, totalSeconds: most * longest - (most - 1) * X };
  }
  return { count: best.count, sceneSeconds: best.sceneSeconds, shareSeconds: Math.round(best.share * 1000) / 1000, totalSeconds: targetSeconds };
}

/** Manager's "Scene timing" setting: "3" or "5" fixes it; anything else is automatic. */
export function sceneTimingSetting(value: string | null | undefined): 3 | 5 | undefined {
  return value === "3" ? 3 : value === "5" ? 5 : undefined;
}
