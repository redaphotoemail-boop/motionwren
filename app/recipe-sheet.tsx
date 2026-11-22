/* A template's fixed recipe, shown as a sheet: the shot list (time, photo, camera, join), the words on screen and the
   quality gates. Used by the Studio photo guide and by Library Studio, so both show the same recipe. */

import { CAMERA_MOVES, TRANSITIONS, qualityLines, textSlotLabel, validateFixedRecipe, type FixedRecipe } from "./template-contract";

const secs = (value: number) => `${value.toFixed(2).replace(/0$/, "")} s`;

export function RecipeSheet({ recipe, summary = "The recipe" }: { recipe: FixedRecipe; summary?: string }) {
  const problems = validateFixedRecipe(recipe);
  return <details className="sg-more recipe-sheet">
    <summary>{summary} · {recipe.shots.length} shots · {recipe.seconds} s{recipe.music ? ` · ${recipe.music.bpm} BPM` : ""}</summary>
    <p className="muted small">{problems.length ? `Recipe check: ${problems.length} problem${problems.length === 1 ? "" : "s"}. ${problems[0]}` : `Recipe v${recipe.version} checked: every shot, join and word is fixed.`}</p>
    <ol className="recipe-shots">{recipe.shots.map((shot) => <li key={shot.n}>
      <b>{secs(shot.start)}–{secs(shot.end)}</b> · {shot.photoLabel} · {CAMERA_MOVES[shot.camera] || shot.camera}{shot.ramp !== "none" ? ` (${shot.ramp})` : ""} · <i>{TRANSITIONS[shot.transition] || shot.transition}</i>
    </li>)}</ol>
    <strong>Music</strong><p className="small">{recipe.music ? recipe.music.style : "None: an intro for a longer edit."}</p>
    <strong>Words on screen</strong>{recipe.text.length ? <ul>{recipe.text.map((slot) => <li key={`${slot.at}.${slot.line}.${slot.example}`}>{textSlotLabel(slot)}</li>)}</ul> : <p className="small">None.</p>}
    <strong>Quality gates</strong><ul>{qualityLines(recipe).map((line) => <li key={line}>{line}</li>)}</ul>
  </details>;
}
