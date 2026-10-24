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
