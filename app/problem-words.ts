/* The words for each kind of video problem on the manager's Production page.
   Shared by the server (which finds the problems) and the page (which groups
   the videos under them). */
export type IssueCode = "stopped" | "waiting" | "stuck" | "stalled" | "remade" | "slow";

export const ISSUE_WORDS: Record<IssueCode, { title: string; meaning: string; kind: "problem" | "handled" }> = {
  stopped: { title: "Videos that stopped before they finished", meaning: "The engine gave up on a scene. Finished scenes are kept; Resume makes only the missing ones again.", kind: "problem" },
  waiting: { title: "Scenes waiting to try again", meaning: "The engine did not finish a scene, so it is being retried on its own. Retry now skips the wait.", kind: "problem" },
  stuck: { title: "Videos that have not moved for a while", meaning: "Nothing has changed for over 20 minutes, so an update from the engine may have been missed. Nudge asks the engine again.", kind: "problem" },
  stalled: { title: "Scenes the engine left “processing” too long", meaning: "They were cut off and sent again, or sent to the backup engine. Nothing to fix.", kind: "handled" },
  remade: { title: "Scenes the quality check made again", meaning: "The automatic check flagged a scene and it was made again. That is why a video takes longer and costs more. Nothing to fix.", kind: "handled" },
  slow: { title: "Videos that took much longer than normal", meaning: "They finished, but slowly. The reason is listed under each one.", kind: "handled" },
};
