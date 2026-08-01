import { createDefinitionRegistry } from "../domain/registry.ts";
import type { DefinitionSource } from "../domain/validate.ts";
import { START_BUILDINGS } from "./buildings.ts";
import { START_ITEMS } from "./items.ts";
import { START_PROJECT_STAGES } from "./projectStages.ts";
import { START_RECIPES } from "./recipes.ts";

export { START_BUILDINGS } from "./buildings.ts";
export { START_ITEMS } from "./items.ts";
export { START_PROJECT_STAGES } from "./projectStages.ts";
export { START_RECIPES } from "./recipes.ts";
export { CAMPAIGN_START_INVENTORY, CAMPAIGN_UNLOCK_STAGE, SANDBOX_PROJECT_TARGET } from "./campaign.ts";
export { SHAFT_PAIRS, shaftPairIdAt } from "./shaftPairs.ts";
export type { ShaftPairDefinition, ShaftPairEndpoint } from "./shaftPairs.ts";

export const START_DEFINITIONS = {
  items: START_ITEMS,
  recipes: START_RECIPES,
  buildings: START_BUILDINGS,
  projectStages: START_PROJECT_STAGES,
} as const satisfies DefinitionSource;

export const START_REGISTRY = createDefinitionRegistry(START_DEFINITIONS);
