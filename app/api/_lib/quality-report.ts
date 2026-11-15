import { fixEstimate } from "./render-jobs";
import type { ProductionManifest } from "./production";
import { studioEngine } from "../../engine-catalog";

/* What History → Quality shows for one film: EVERY scene (not only the flagged ones), with how many frames of it the check looked at,
   what was found, every attempt's clip, and the exact instruction written for each re-make. */
export type SceneReport = {
  scene: number; state: "flagged" | "clean" | "unchecked" | "photo-move";
  frames: number; issues: string[]; clip: string; canFix: boolean;
  attempts: { attempt: number; clip: string; issues: string[]; instruction: string; by?: "check" | "you" }[];
};

export function qualityReport(jobId: string, manifest: ProductionManifest | null, row: { status: string; resolution: string; duration: number }) {
  const count = manifest?.inputs.length || 0;
  const fix = manifest?.fix;
  const clip = (file: string) => `/api/job-frames/${jobId}/${file}`;
  const out = (scene: number) => `out-${String(scene + 1).padStart(2, "0")}.mp4`;
  const checked = Boolean(manifest?.qc || manifest?.aiReview);
  const finished = row.status === "succeeded";
  const scenes: SceneReport[] = Array.from({ length: count }, (_, scene) => {
    const flagged = fix?.flagged?.find((item) => item.scene === scene);
    const kept = (fix?.kept || []).filter((item) => item.scene === scene);
    const sent = (fix?.sent || []).filter((item) => item.scene === scene);
    const move = Boolean(manifest?.photoMoves?.[scene]);
    const attempts = [
      ...kept.map((item, index) => ({ attempt: index + 1, clip: clip(item.file), issues: item.issues, instruction: index ? sent[index - 1]?.text || "" : "", by: index ? sent[index - 1]?.by : undefined })),
      { attempt: kept.length + 1, clip: clip(out(scene)), issues: flagged?.issues || [], instruction: kept.length ? sent[kept.length - 1]?.text || "" : "", by: kept.length ? sent[kept.length - 1]?.by : undefined },
    ];
    return { scene: scene + 1, state: move ? "photo-move" : flagged ? "flagged" : checked ? "clean" : "unchecked", frames: manifest?.checkedFrames?.[scene] || 0, issues: flagged?.issues || [], clip: clip(out(scene)), canFix: finished && !move && !manifest?.fromClips, attempts };
  });
  const estimate = manifest && finished ? fixEstimate(manifest, row) : null;
  return { rounds: fix?.round || 0, jobId, fixCents: estimate?.cents || 0, fixEngine: estimate ? studioEngine(estimate.engine).name : "", scenes };
}
