import { START_REGISTRY } from "../data/index.ts";
import type { BuildingId, RecipeDefinition, RecipeId } from "../domain/types.ts";

export type RuntimeItemId =
  | "iron_ore"
  | "copper_ore"
  | "iron_ingot"
  | "copper_ingot"
  | "iron_plate";

export type RuntimeRecipeAmount = Readonly<{
  itemId: RuntimeItemId;
  amount: number;
}>;

export type RuntimeRecipe = Readonly<{
  id: RecipeId;
  name: string;
  buildingId: BuildingId;
  inputs: readonly RuntimeRecipeAmount[];
  outputs: readonly RuntimeRecipeAmount[];
  durationSeconds: number;
}>;

export type RuntimeRecipeRequest =
  | Readonly<{ type: "miner"; x: number; z: number }>
  | Readonly<{ type: "smelter"; inputItemId: RuntimeItemId }>
  | Readonly<{ type: "assembler"; inputItemId?: RuntimeItemId }>;

export const RUNTIME_BUILDING_IDS = {
  miner: "vein_miner",
  smelter: "arc_smelter",
  assembler: "hydraulic_former",
} as const satisfies Record<RuntimeRecipeRequest["type"], BuildingId>;

const RUNTIME_RECIPE_IDS = new Set<RecipeId>([
  "mine_iron_ore",
  "mine_copper_ore",
  "smelt_iron_ingot",
  "smelt_copper_ingot",
  "form_iron_plate",
]);

const RUNTIME_ITEM_IDS = new Set<RuntimeItemId>([
  "iron_ore",
  "copper_ore",
  "iron_ingot",
  "copper_ingot",
  "iron_plate",
]);

const toRuntimeRecipe = (recipe: RecipeDefinition): RuntimeRecipe => {
  const amounts = [...recipe.inputs, ...recipe.outputs];
  if (amounts.some(({ itemId }) => !RUNTIME_ITEM_IDS.has(itemId as RuntimeItemId))) {
    throw new Error(`recipe ${recipe.id} contains an unsupported runtime item`);
  }
  return {
    id: recipe.id,
    name: recipe.name,
    buildingId: recipe.buildingId,
    inputs: recipe.inputs.map(({ itemId, amount }) => ({ itemId: itemId as RuntimeItemId, amount })),
    outputs: recipe.outputs.map(({ itemId, amount }) => ({ itemId: itemId as RuntimeItemId, amount })),
    durationSeconds: recipe.durationSeconds,
  };
};

/** Looks up only recipes supported by the current visual runtime. */
export const getRuntimeRecipe = (recipeId: RecipeId): RuntimeRecipe | null => {
  if (!RUNTIME_RECIPE_IDS.has(recipeId)) return null;
  const recipe = START_REGISTRY.recipes.get(recipeId);
  return recipe ? toRuntimeRecipe(recipe) : null;
};

/** Selects a registry recipe from the legacy runtime machine and live input. */
export const resolveRuntimeRecipe = (request: RuntimeRecipeRequest): RuntimeRecipe | null => {
  let recipeId: RecipeId | null = null;
  if (request.type === "miner") {
    if (request.x === -8 && request.z === -3) recipeId = "mine_iron_ore";
    else if (request.x === 7 && request.z === 4) recipeId = "mine_copper_ore";
  } else if (request.type === "smelter") {
    if (request.inputItemId === "iron_ore") recipeId = "smelt_iron_ingot";
    else if (request.inputItemId === "copper_ore") recipeId = "smelt_copper_ingot";
  } else if (request.inputItemId === undefined || request.inputItemId === "iron_ingot") {
    recipeId = "form_iron_plate";
  }

  if (!recipeId) return null;
  const recipe = getRuntimeRecipe(recipeId);
  if (!recipe || recipe.buildingId !== RUNTIME_BUILDING_IDS[request.type]) return null;
  return recipe;
};

