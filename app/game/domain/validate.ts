import type {
  BuildingDefinition,
  ItemDefinition,
  ProjectStageDefinition,
  RecipeDefinition,
  TransportMedium,
  UnlockId,
} from "./types.ts";

export type DefinitionSource = Readonly<{
  items: readonly ItemDefinition[];
  recipes: readonly RecipeDefinition[];
  buildings: readonly BuildingDefinition[];
  projectStages: readonly ProjectStageDefinition[];
}>;

export type ValidationIssue = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

const UNLOCK_ORDER: readonly UnlockId[] = [
  "start",
  "phase_1_complete",
  "phase_2_complete",
  "phase_3_complete",
  "chemistry_stable",
  "thermal_verified",
];

const unlockRank = new Map<UnlockId, number>(UNLOCK_ORDER.map((id, index) => [id, index]));

const expectedProfile: Record<TransportMedium, string[]> = {
  solid: ["belt_standard"],
  fluid: ["pipe_mk1"],
  power: ["power_local", "power_high_voltage"],
};

const addDuplicateIssues = <T extends { id: string }>(
  values: readonly T[],
  collection: string,
  issues: ValidationIssue[],
) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      issues.push({
        code: "duplicate_id",
        path: `${collection}[${index}].id`,
        message: `Duplicate ${collection} id: ${value.id}`,
      });
    }
    seen.add(value.id);
  });
};

const isInput = (direction: string) => direction === "input" || direction === "bidirectional";
const isOutput = (direction: string) => direction === "output" || direction === "bidirectional";

export function validateDefinitions(source: DefinitionSource): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  addDuplicateIssues(source.items, "items", issues);
  addDuplicateIssues(source.recipes, "recipes", issues);
  addDuplicateIssues(source.buildings, "buildings", issues);
  addDuplicateIssues(source.projectStages, "projectStages", issues);

  const items = new Map(source.items.map((definition) => [definition.id, definition]));
  const recipes = new Map(source.recipes.map((definition) => [definition.id, definition]));
  const buildings = new Map(source.buildings.map((definition) => [definition.id, definition]));
  const stages = new Map(source.projectStages.map((definition) => [definition.id, definition]));

  const checkUnlock = (unlockId: string, path: string) => {
    if (!unlockRank.has(unlockId as UnlockId)) {
      issues.push({ code: "invalid_unlock", path, message: `Unknown unlock id: ${unlockId}` });
    }
  };

  source.items.forEach((item, itemIndex) => {
    checkUnlock(item.unlockId, `items[${itemIndex}].unlockId`);
    if (item.stackSize <= 0) {
      issues.push({ code: "invalid_amount", path: `items[${itemIndex}].stackSize`, message: "Stack size must be positive" });
    }
  });

  source.buildings.forEach((building, buildingIndex) => {
    const basePath = `buildings[${buildingIndex}]`;
    checkUnlock(building.unlockId, `${basePath}.unlockId`);
    if (building.placementMode === "buildable" && building.buildCost.length === 0) {
      issues.push({ code: "missing_build_cost", path: `${basePath}.buildCost`, message: "Buildable buildings require a build cost" });
    }
    if (building.placementMode === "preplaced_unique" && building.buildCost.length > 0) {
      issues.push({ code: "unexpected_build_cost", path: `${basePath}.buildCost`, message: "Preplaced unique buildings cannot have a build cost" });
    }
    if (building.allowedRotations.length === 0) {
      issues.push({ code: "missing_rotation", path: `${basePath}.allowedRotations`, message: "At least one rotation is required" });
    }

    const portIds = new Set<string>();
    building.ports.forEach((port, portIndex) => {
      const portPath = `${basePath}.ports[${portIndex}]`;
      if (portIds.has(port.id)) {
        issues.push({ code: "duplicate_port_id", path: `${portPath}.id`, message: `Duplicate port id on ${building.id}: ${port.id}` });
      }
      portIds.add(port.id);
      if (!expectedProfile[port.medium].includes(port.connectorProfile)) {
        issues.push({ code: "port_medium_mismatch", path: `${portPath}.connectorProfile`, message: `${port.connectorProfile} cannot carry ${port.medium}` });
      }
      port.acceptedItemIds.forEach((itemId, acceptedIndex) => {
        const item = items.get(itemId);
        if (!item) {
          issues.push({ code: "missing_item", path: `${portPath}.acceptedItemIds[${acceptedIndex}]`, message: `Unknown item: ${itemId}` });
        } else if (item.medium !== port.medium) {
          issues.push({ code: "port_item_medium_mismatch", path: `${portPath}.acceptedItemIds[${acceptedIndex}]`, message: `${itemId} cannot use a ${port.medium} port` });
        }
      });
    });

    building.buildCost.forEach((cost, costIndex) => {
      const item = items.get(cost.itemId);
      if (!item) {
        issues.push({ code: "missing_item", path: `${basePath}.buildCost[${costIndex}].itemId`, message: `Unknown item: ${cost.itemId}` });
      }
      if (cost.amount <= 0) {
        issues.push({ code: "invalid_amount", path: `${basePath}.buildCost[${costIndex}].amount`, message: "Build cost must be positive" });
      }
      const buildingRank = unlockRank.get(building.unlockId);
      const itemRank = item ? unlockRank.get(item.unlockId) : undefined;
      if (buildingRank !== undefined && itemRank !== undefined && itemRank > buildingRank) {
        issues.push({ code: "unlock_order", path: `${basePath}.buildCost[${costIndex}].itemId`, message: `${building.id} requires locked build item ${item?.id}` });
      }
    });

    building.recipeIds.forEach((recipeId, recipeIndex) => {
      const recipe = recipes.get(recipeId);
      if (!recipe) {
        issues.push({ code: "missing_recipe", path: `${basePath}.recipeIds[${recipeIndex}]`, message: `Unknown recipe: ${recipeId}` });
      } else if (recipe.buildingId !== building.id) {
        issues.push({ code: "recipe_building_mismatch", path: `${basePath}.recipeIds[${recipeIndex}]`, message: `${recipeId} belongs to ${recipe.buildingId}` });
      }
    });
  });

  source.recipes.forEach((recipe, recipeIndex) => {
    const basePath = `recipes[${recipeIndex}]`;
    checkUnlock(recipe.unlockId, `${basePath}.unlockId`);
    const building = buildings.get(recipe.buildingId);
    if (!building) {
      issues.push({ code: "missing_building", path: `${basePath}.buildingId`, message: `Unknown building: ${recipe.buildingId}` });
      return;
    }
    if (!building.recipeIds.includes(recipe.id)) {
      issues.push({ code: "unlisted_recipe", path: `${basePath}.buildingId`, message: `${building.id} does not list ${recipe.id}` });
    }
    const recipeRank = unlockRank.get(recipe.unlockId);
    const buildingRank = unlockRank.get(building.unlockId);
    if (recipeRank !== undefined && buildingRank !== undefined && buildingRank > recipeRank) {
      issues.push({ code: "unlock_order", path: `${basePath}.unlockId`, message: `${recipe.id} unlocks before ${building.id}` });
    }

    const validateAmount = (amount: { itemId: string; amount: number; portId: string }, index: number, output: boolean) => {
      const amountPath = `${basePath}.${output ? "outputs" : "inputs"}[${index}]`;
      const item = items.get(amount.itemId);
      const port = building.ports.find((candidate) => candidate.id === amount.portId);
      if (!item) issues.push({ code: "missing_item", path: `${amountPath}.itemId`, message: `Unknown item: ${amount.itemId}` });
      if (!port) issues.push({ code: "missing_port", path: `${amountPath}.portId`, message: `Unknown port on ${building.id}: ${amount.portId}` });
      if (amount.amount <= 0) issues.push({ code: "invalid_amount", path: `${amountPath}.amount`, message: "Recipe amount must be positive" });
      if (port && !(output ? isOutput(port.direction) : isInput(port.direction))) {
        issues.push({ code: "port_direction_mismatch", path: `${amountPath}.portId`, message: `${port.id} has the wrong direction` });
      }
      if (port && item && (port.medium !== item.medium || (port.acceptedItemIds.length > 0 && !port.acceptedItemIds.includes(item.id)))) {
        issues.push({ code: "port_item_mismatch", path: `${amountPath}.portId`, message: `${port.id} does not accept ${item.id}` });
      }
      const itemRank = item ? unlockRank.get(item.unlockId) : undefined;
      if (recipeRank !== undefined && itemRank !== undefined && itemRank > recipeRank) {
        issues.push({ code: "unlock_order", path: `${amountPath}.itemId`, message: `${recipe.id} references locked item ${item?.id}` });
      }
    };
    recipe.inputs.forEach((amount, index) => validateAmount(amount, index, false));
    recipe.outputs.forEach((amount, index) => validateAmount(amount, index, true));
    if (recipe.durationSeconds <= 0) {
      issues.push({ code: "invalid_duration", path: `${basePath}.durationSeconds`, message: "Recipe duration must be positive" });
    }
  });

  source.projectStages.forEach((stage, stageIndex) => {
    const basePath = `projectStages[${stageIndex}]`;
    stage.prerequisiteIds.forEach((stageId, prerequisiteIndex) => {
      if (!stages.has(stageId)) issues.push({ code: "missing_stage", path: `${basePath}.prerequisiteIds[${prerequisiteIndex}]`, message: `Unknown project stage: ${stageId}` });
    });
    stage.deliveries.forEach((delivery, deliveryIndex) => {
      const deliveryPath = `${basePath}.deliveries[${deliveryIndex}]`;
      const item = items.get(delivery.itemId);
      const dock = source.buildings.find((building) => building.placementMode === "preplaced_unique" && building.ports.some((port) => port.id === delivery.portId));
      const port = dock?.ports.find((candidate) => candidate.id === delivery.portId);
      if (!item) issues.push({ code: "missing_item", path: `${deliveryPath}.itemId`, message: `Unknown item: ${delivery.itemId}` });
      if (!port) issues.push({ code: "missing_port", path: `${deliveryPath}.portId`, message: `Unknown project delivery port: ${delivery.portId}` });
      if (delivery.amount <= 0) issues.push({ code: "invalid_amount", path: `${deliveryPath}.amount`, message: "Delivery amount must be positive" });
      if (item && item.medium !== delivery.medium) issues.push({ code: "delivery_medium_mismatch", path: `${deliveryPath}.medium`, message: `${delivery.itemId} is ${item.medium}` });
      if (port && (port.medium !== delivery.medium || !isInput(port.direction) || (port.acceptedItemIds.length > 0 && !port.acceptedItemIds.includes(delivery.itemId)))) {
        issues.push({ code: "delivery_port_mismatch", path: `${deliveryPath}.portId`, message: `${delivery.portId} cannot accept ${delivery.itemId}` });
      }
      const expectedCommit = delivery.medium === "solid" ? "solid_lock_complete" : "fluid_accepted_per_tick";
      if (delivery.commitPolicy !== expectedCommit) issues.push({ code: "commit_policy_mismatch", path: `${deliveryPath}.commitPolicy`, message: `${delivery.medium} deliveries require ${expectedCommit}` });
      if (stage.dockPowerMode === "manual" && delivery.medium === "fluid") issues.push({ code: "manual_fluid_delivery", path: deliveryPath, message: "Manual dock stages cannot accept fluid" });
    });
    (["itemIds", "recipeIds", "buildingIds"] as const).forEach((key) => {
      const lookup = key === "itemIds" ? items : key === "recipeIds" ? recipes : buildings;
      stage.rewards[key].forEach((id, rewardIndex) => {
        if (!lookup.has(id)) issues.push({ code: "missing_reward", path: `${basePath}.rewards.${key}[${rewardIndex}]`, message: `Unknown reward: ${id}` });
      });
    });
  });

  const recipesByUnlock = new Map<UnlockId, RecipeDefinition[]>();
  source.recipes.forEach((recipe) => {
    const group = recipesByUnlock.get(recipe.unlockId) ?? [];
    group.push(recipe);
    recipesByUnlock.set(recipe.unlockId, group);
  });
  recipesByUnlock.forEach((group, unlockId) => {
    const producers = new Map<string, string[]>();
    group.forEach((recipe) => recipe.outputs.forEach((output) => producers.set(output.itemId, [...(producers.get(output.itemId) ?? []), recipe.id])));
    const edges = new Map(group.map((recipe) => [recipe.id, new Set<string>()]));
    group.forEach((recipe) => recipe.inputs.forEach((input) => (producers.get(input.itemId) ?? []).forEach((producerId) => edges.get(producerId)?.add(recipe.id))));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const cyclic = Array.from(edges.get(id) ?? []).some(visit);
      visiting.delete(id);
      visited.add(id);
      return cyclic;
    };
    if (group.some((recipe) => visit(recipe.id))) {
      issues.push({ code: "recipe_cycle", path: `recipes@${unlockId}`, message: `Recipe cycle detected within ${unlockId}` });
    }
  });

  return issues;
}

export function assertValidDefinitions(source: DefinitionSource): void {
  const issues = validateDefinitions(source);
  if (issues.length > 0) {
    throw new Error(`Invalid FactoryX definitions:\n${issues.map((issue) => `- [${issue.code}] ${issue.path}: ${issue.message}`).join("\n")}`);
  }
}
