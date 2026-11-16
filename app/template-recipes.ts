/* Template recipes (spec v1): frozen JSON edit recipes the composer executes
   directly on the photos or clips supplied — no AI generation of the shots.
   The recipe JSONs live in composer/templates/ and are bundled here at build
   time, so Studio and the production API can offer them without a runtime
   dependency on the composer's filesystem. Pure (no Worker bindings), so
   plain node can test it. */

import houseCalling from "../composer/templates/house-calling-v1.json";
import tourFlow from "../composer/templates/tour-flow-v1.json";

export type TemplateRecipeJson = {
  template_id: string;
  name: string;
  recipe_version: string;
  aspect: string;
  resolution: string;
  fps: number;
  duration_s: number;
  inputs: { slot: string; type: string; required: boolean }[];
  scenes: { id: string; start_s: number; duration_s: number; input?: string; grade?: string }[];
  grades: Record<string, unknown>;
  [key: string]: unknown;
};

export type TemplateRecipeEntry = {
  id: string;
  name: string;
  seconds: number;
  photos: number;
  /** Input slots whose scenes are day exteriors (grade bright_warm_day): the
      slots a night look can be made from, using the day photo. */
  nightEligible: string[];
  recipe: TemplateRecipeJson;
};

const entry = (recipe: TemplateRecipeJson): TemplateRecipeEntry => {
  const dayExteriors = new Set(
    recipe.scenes.filter((s) => s.grade === "bright_warm_day" && s.input).map((s) => s.input as string),
  );
  return {
    id: recipe.template_id,
    name: recipe.name,
    seconds: recipe.duration_s,
    photos: recipe.inputs.length,
    nightEligible: recipe.inputs.filter((i) => dayExteriors.has(i.slot)).map((i) => i.slot),
    recipe,
  };
};

export const TEMPLATE_RECIPES: TemplateRecipeEntry[] = [
  entry(houseCalling as TemplateRecipeJson),
  entry(tourFlow as TemplateRecipeJson),
];

export const templateRecipeById = (id: string): TemplateRecipeEntry | null =>
  TEMPLATE_RECIPES.find((item) => item.id === id) || null;

/** The recipe with a job-time night choice applied: the named slots render
    with the night grade. Only slots the template actually has are kept;
    anything else is dropped here (the composer reader would fail loudly,
    but Studio should never send a bad slot). */
export const recipeWithNightSlots = (recipe: TemplateRecipeJson, nightSlots: string[]): TemplateRecipeJson => {
  const valid = new Set([
    ...recipe.scenes.map((s) => s.id),
    ...recipe.inputs.map((i) => i.slot),
  ]);
  const kept = (Array.isArray(nightSlots) ? nightSlots : []).filter((slot) => typeof slot === "string" && valid.has(slot));
  return kept.length ? { ...recipe, night_slots: kept } : recipe;
};
