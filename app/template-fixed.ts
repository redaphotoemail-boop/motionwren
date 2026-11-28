/* Every template in the Studio picker as a fixed recipe (app/template-contract.ts), checked. Joins the social templates and
   the composer's v1 JSON recipes to the contract; kept apart from both so they stay importable by plain node. */

import { SOCIAL_SPECS, buildSocialRecipe, socialSpec, sourceSeconds, type SocialSpec } from "./social-templates";
import { TEMPLATE_RECIPES } from "./template-recipes";
import { jsonFixedRecipe, socialFixedRecipe, validateFixedRecipe, type FixedRecipe } from "./template-contract";

export function fixedSocialRecipe(spec: SocialSpec): FixedRecipe {
  const built = buildSocialRecipe(spec);
  return socialFixedRecipe(spec, built, built.slots.map((slot) => sourceSeconds(slot.dur, slot.speed)));
}

export const fixedSocialRecipeByKey = (key: unknown): FixedRecipe | null => { const spec = socialSpec(key); return spec ? fixedSocialRecipe(spec) : null; };

/* All built-in templates, social and v1, as fixed recipes. */
export const allFixedRecipes = (): FixedRecipe[] => [...SOCIAL_SPECS.map(fixedSocialRecipe), ...TEMPLATE_RECIPES.map((entry) => jsonFixedRecipe(entry.recipe))];

/* Problems with a social template's recipe; empty means it may be installed and offered. */
export const socialRecipeProblems = (spec: SocialSpec): string[] => validateFixedRecipe(fixedSocialRecipe(spec));
