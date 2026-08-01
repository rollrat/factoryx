import { START_REGISTRY } from "../data/index.ts";
import type { BuildingId, ItemId, RecipeDefinition, RecipeId } from "../domain/types.ts";

export type RuntimeItemId = ItemId;

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
  | Readonly<{ type: "assembler"; inputItemId?: RuntimeItemId }>
  | Readonly<{ type: "crusher"; inputItemId?: RuntimeItemId }>;

export const RUNTIME_RESOURCE_ANCHORS = {
  iron_ore: { x: -8, z: -3 },
  copper_ore: { x: 7, z: 4 },
  limestone: { x: -7, z: 7 },
} as const;

export const RUNTIME_BUILDING_IDS = {
  miner: "vein_miner",
  smelter: "arc_smelter",
  assembler: "hydraulic_former",
  crusher: "crusher",
} as const satisfies Record<RuntimeRecipeRequest["type"], BuildingId>;

const toRuntimeRecipe = (recipe: RecipeDefinition): RuntimeRecipe => {
  return {
    id: recipe.id,
    name: recipe.name,
    buildingId: recipe.buildingId,
    inputs: recipe.inputs.map(({ itemId, amount }) => ({ itemId, amount })),
    outputs: recipe.outputs.map(({ itemId, amount }) => ({ itemId, amount })),
    durationSeconds: recipe.durationSeconds,
  };
};

/** Converts any validated campaign recipe into the compact legacy runtime shape. */
export const getRuntimeRecipe = (recipeId: RecipeId): RuntimeRecipe | null => {
  const recipe = START_REGISTRY.recipes.get(recipeId);
  return recipe ? toRuntimeRecipe(recipe) : null;
};

/** Resolves a player's selected recipe only when it belongs to the requested building. */
export const getRuntimeRecipeForBuilding = (
  buildingId: BuildingId,
  selectedRecipeId: RecipeId | null | undefined,
): RuntimeRecipe | null => {
  if (!selectedRecipeId) return null;
  const building = START_REGISTRY.buildings.get(buildingId);
  if (!building || !building.recipeIds.includes(selectedRecipeId)) return null;
  const recipe = START_REGISTRY.recipes.get(selectedRecipeId);
  if (!recipe || recipe.buildingId !== buildingId) return null;
  return toRuntimeRecipe(recipe);
};

/** Selects a registry recipe from the legacy runtime machine and live input. */
export const resolveRuntimeRecipe = (request: RuntimeRecipeRequest): RuntimeRecipe | null => {
  let recipeId: RecipeId | null = null;
  if (request.type === "miner") {
    if (request.x === RUNTIME_RESOURCE_ANCHORS.iron_ore.x && request.z === RUNTIME_RESOURCE_ANCHORS.iron_ore.z) recipeId = "mine_iron_ore";
    else if (request.x === RUNTIME_RESOURCE_ANCHORS.copper_ore.x && request.z === RUNTIME_RESOURCE_ANCHORS.copper_ore.z) recipeId = "mine_copper_ore";
    else if (request.x === RUNTIME_RESOURCE_ANCHORS.limestone.x && request.z === RUNTIME_RESOURCE_ANCHORS.limestone.z) recipeId = "mine_limestone";
  } else if (request.type === "smelter") {
    if (request.inputItemId === "iron_ore") recipeId = "smelt_iron_ingot";
    else if (request.inputItemId === "copper_ore") recipeId = "smelt_copper_ingot";
  } else if (request.type === "crusher") {
    if (request.inputItemId === undefined || request.inputItemId === "limestone") recipeId = "crush_construction_block";
  } else if (request.inputItemId === undefined || request.inputItemId === "iron_ingot") {
    recipeId = "form_iron_plate";
  }

  if (!recipeId) return null;
  return getRuntimeRecipeForBuilding(RUNTIME_BUILDING_IDS[request.type], recipeId);
};
