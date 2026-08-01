import type { ItemId, ProjectStageId, RecipeDefinition } from "../domain/types.ts";
import type { DefinitionSource } from "../domain/validate.ts";

export type ProjectProductionPlan = Readonly<{
  stageId: ProjectStageId;
  rawRequirements: ReadonlyMap<ItemId, number>;
  machineMinutes: number;
  unresolvedItemIds: readonly ItemId[];
}>;

const add = (map: Map<ItemId, number>, itemId: ItemId, amount: number) => {
  map.set(itemId, (map.get(itemId) ?? 0) + amount);
};

/** Deterministic canonical-recipe reverse expansion for project planning. */
export function calculateProjectProductionPlan(
  definitions: DefinitionSource,
  stageId: ProjectStageId,
): ProjectProductionPlan {
  const stage = definitions.projectStages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`unknown project stage: ${stageId}`);
  const recipesByOutput = new Map<ItemId, RecipeDefinition[]>();
  definitions.recipes.forEach((recipe) => recipe.outputs.forEach((output) => {
    recipesByOutput.set(output.itemId, [...(recipesByOutput.get(output.itemId) ?? []), recipe]);
  }));
  recipesByOutput.forEach((recipes) => recipes.sort((a, b) => a.id.localeCompare(b.id)));

  const raw = new Map<ItemId, number>();
  const surplus = new Map<ItemId, number>();
  const unresolved = new Set<ItemId>();
  let machineMinutes = 0;

  const expandRequirement = (itemId: ItemId, requested: number, ancestry: ReadonlySet<ItemId>) => {
    const available = surplus.get(itemId) ?? 0;
    const used = Math.min(available, requested);
    if (used > 0) surplus.set(itemId, available - used);
    const amount = requested - used;
    if (amount <= 1e-9) return;

    const recipe = recipesByOutput.get(itemId)?.[0];
    if (!recipe || ancestry.has(itemId)) {
      add(raw, itemId, amount);
      if (ancestry.has(itemId)) unresolved.add(itemId);
      return;
    }
    const targetOutput = recipe.outputs.find((output) => output.itemId === itemId);
    if (!targetOutput || targetOutput.amount <= 0) {
      add(raw, itemId, amount);
      unresolved.add(itemId);
      return;
    }
    const cycles = amount / targetOutput.amount;
    machineMinutes += cycles * recipe.durationSeconds / 60;
    if (recipe.inputs.length === 0) {
      add(raw, itemId, amount);
      return;
    }
    recipe.outputs.forEach((output) => {
      if (output.itemId !== itemId) add(surplus, output.itemId, cycles * output.amount);
    });
    const nextAncestry = new Set(ancestry).add(itemId);
    recipe.inputs.forEach((input) => expandRequirement(input.itemId, cycles * input.amount, nextAncestry));
  };

  stage.deliveries.forEach((delivery) => expandRequirement(delivery.itemId, delivery.amount, new Set()));
  return {
    stageId,
    rawRequirements: new Map([...raw].sort(([a], [b]) => a.localeCompare(b))),
    machineMinutes,
    unresolvedItemIds: [...unresolved].sort(),
  };
}
