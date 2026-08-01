import type { ItemId, ProjectStageId, RecipeDefinition } from "../domain/types.ts";
import type { DefinitionSource } from "../domain/validate.ts";

export type ProjectProductionPlan = Readonly<{
  stageId: ProjectStageId;
  rawRequirements: ReadonlyMap<ItemId, number>;
  machineMinutes: number;
  unresolvedItemIds: readonly ItemId[];
  normalizedDeliveryUnits: number;
  targetPlayMinutes: Readonly<{ min: number; max: number }>;
  recommendedParallelMachines: number;
  recommendedBuildingCounts: ReadonlyMap<string, number>;
  recommendedBuildCost: ReadonlyMap<ItemId, number>;
}>;

export const PLANNING_UNIT_SCALE = Object.freeze({ item: 1, m3: 1 } as const);

export const PROJECT_PLAYTIME_TARGETS: Readonly<Record<ProjectStageId, Readonly<{ min: number; max: number }>>> = {
  phase_1_settlement_package: { min: 20, max: 35 },
  phase_2_industrial_power_node: { min: 45, max: 75 },
  phase_3_automation_core: { min: 90, max: 150 },
  phase_4_chemistry_stabilization: { min: 30, max: 50 },
  phase_4_thermal_management_verification: { min: 25, max: 45 },
  phase_4_colony_seed: { min: 90, max: 150 },
};

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
  const machineMinutesByBuilding = new Map<string, number>();

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
    const recipeMachineMinutes = cycles * recipe.durationSeconds / 60;
    machineMinutes += recipeMachineMinutes;
    machineMinutesByBuilding.set(recipe.buildingId, (machineMinutesByBuilding.get(recipe.buildingId) ?? 0) + recipeMachineMinutes);
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
  const targetPlayMinutes = PROJECT_PLAYTIME_TARGETS[stageId];
  if (!targetPlayMinutes) throw new Error(`missing project playtime target: ${stageId}`);
  const normalizedDeliveryUnits = stage.deliveries.reduce((sum, delivery) => {
    const unit = definitions.items.find(({ id }) => id === delivery.itemId)?.unit ?? "item";
    return sum + delivery.amount * PLANNING_UNIT_SCALE[unit];
  }, 0);
  const targetMidpoint = (targetPlayMinutes.min + targetPlayMinutes.max) / 2;
  const recommendedBuildingCounts = new Map([...machineMinutesByBuilding]
    .map(([buildingId, minutes]) => [buildingId, Math.max(1, Math.ceil(minutes / targetMidpoint))] as const)
    .sort(([a], [b]) => a.localeCompare(b)));
  const recommendedBuildCost = new Map<ItemId, number>();
  recommendedBuildingCounts.forEach((count, buildingId) => {
    definitions.buildings.find(({ id }) => id === buildingId)?.buildCost.forEach((cost) => {
      recommendedBuildCost.set(cost.itemId, (recommendedBuildCost.get(cost.itemId) ?? 0) + cost.amount * count);
    });
  });
  return {
    stageId,
    rawRequirements: new Map([...raw].sort(([a], [b]) => a.localeCompare(b))),
    machineMinutes,
    unresolvedItemIds: [...unresolved].sort(),
    normalizedDeliveryUnits,
    targetPlayMinutes,
    recommendedParallelMachines: [...recommendedBuildingCounts.values()].reduce((sum, count) => sum + count, 0),
    recommendedBuildingCounts,
    recommendedBuildCost: new Map([...recommendedBuildCost].sort(([a], [b]) => a.localeCompare(b))),
  };
}
