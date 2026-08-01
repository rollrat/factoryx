import assert from "node:assert/strict";
import test from "node:test";

import { START_DEFINITIONS, START_REGISTRY } from "../../app/game/data/index.ts";
import { createDefinitionRegistry } from "../../app/game/domain/registry.ts";
import type { DefinitionSource } from "../../app/game/domain/validate.ts";
import { assertValidDefinitions, validateDefinitions } from "../../app/game/domain/validate.ts";

const validDefinitions = (): DefinitionSource => ({
  items: [
    { id: "ore", name: "Ore", category: "resource", medium: "solid", unit: "item", unlockId: "start", defaultColor: 0x777777, geometryType: "ore_chunk", stackSize: 100, modelKey: "ore" },
    { id: "plate", name: "Plate", category: "material", medium: "solid", unit: "item", unlockId: "start", defaultColor: 0xaaaaaa, geometryType: "plate", stackSize: 100, modelKey: "plate" },
  ],
  buildings: [{
    id: "smelter",
    name: "Smelter",
    unlockId: "start",
    placementMode: "buildable",
    footprint: { x: 2, z: 2 },
    allowedRotations: [0, 1, 2, 3],
    ports: [
      {
        id: "input",
        direction: "input",
        medium: "solid",
        connectorProfile: "belt_standard",
        connectionCell: { x: -1, z: 0 },
        localPosition: { x: -1, y: 0.5, z: 0 },
        localFacing: { x: -1, z: 0 },
        bufferSlots: 2,
        acceptedItemIds: ["ore"],
      },
      {
        id: "output",
        direction: "output",
        medium: "solid",
        connectorProfile: "belt_standard",
        connectionCell: { x: 2, z: 0 },
        localPosition: { x: 1, y: 0.5, z: 0 },
        localFacing: { x: 1, z: 0 },
        bufferSlots: 1,
        acceptedItemIds: ["plate"],
      },
    ],
    recipeIds: ["smelt_plate"],
    buildCost: [{ itemId: "plate", amount: 4 }],
  }],
  recipes: [{
    id: "smelt_plate",
    name: "Smelt plate",
    buildingId: "smelter",
    inputs: [{ itemId: "ore", amount: 2, portId: "input" }],
    outputs: [{ itemId: "plate", amount: 1, portId: "output", role: "primary" }],
    durationSeconds: 4,
    unlockId: "start",
  }],
  projectStages: [],
});

test("shipped start definitions are valid and indexed", () => {
  assert.deepEqual(validateDefinitions(START_DEFINITIONS), []);
  assert.ok(START_REGISTRY.items.size > 0);
  assert.ok(START_REGISTRY.recipes.size > 0);
  assert.ok(START_REGISTRY.buildings.size > 0);
});

test("valid definitions build an indexed registry", () => {
  const source = validDefinitions();
  assert.deepEqual(validateDefinitions(source), []);
  assert.doesNotThrow(() => assertValidDefinitions(source));

  const registry = createDefinitionRegistry(source);
  assert.equal(registry.items.get("ore")?.name, "Ore");
  assert.equal(registry.recipes.get("smelt_plate")?.buildingId, "smelter");
  assert.equal(registry.buildings.get("smelter")?.ports.length, 2);
});

test("validator rejects a duplicate id fixture", () => {
  const source = validDefinitions();
  const invalid: DefinitionSource = { ...source, items: [...source.items, { ...source.items[0] }] };
  const issues = validateDefinitions(invalid);

  assert.ok(issues.some((issue) => issue.code === "duplicate_id" && issue.path === "items[2].id"));
  assert.throws(() => createDefinitionRegistry(invalid), /duplicate_id/);
});

test("validator rejects missing references and a wrong port direction", () => {
  const source = validDefinitions();
  const invalid: DefinitionSource = {
    ...source,
    recipes: [{
      ...source.recipes[0],
      inputs: [{ itemId: "missing_ore", amount: 2, portId: "output" }],
    }],
  };
  const issueCodes = new Set(validateDefinitions(invalid).map((issue) => issue.code));

  assert.ok(issueCodes.has("missing_item"));
  assert.ok(issueCodes.has("port_direction_mismatch"));
});

test("validator rejects zero or inward port facings that cannot match rotated model connectors", () => {
  const source = validDefinitions();
  const zeroFacing: DefinitionSource = {
    ...source,
    buildings: [{
      ...source.buildings[0],
      ports: [{ ...source.buildings[0].ports[0], localFacing: { x: 0, z: 0 } }, source.buildings[0].ports[1]],
    }],
  };
  assert.ok(validateDefinitions(zeroFacing).some(({ code }) => code === "invalid_port_facing"));

  const inwardFacing: DefinitionSource = {
    ...source,
    buildings: [{
      ...source.buildings[0],
      ports: [{ ...source.buildings[0].ports[0], localFacing: { x: 1, z: 0 } }, source.buildings[0].ports[1]],
    }],
  };
  assert.ok(validateDefinitions(inwardFacing).some(({ code }) => code === "invalid_port_facing"));
});

test("validator enforces item units and preplaced world policies", () => {
  const source = validDefinitions();
  const invalid: DefinitionSource = {
    ...source,
    items: [{ ...source.items[0], unit: "m3" }, source.items[1]],
    buildings: [{
      ...source.buildings[0],
      placementMode: "preplaced_unique",
      buildCost: [],
      allowedRotations: [0],
    }],
  };
  const issueCodes = new Set(validateDefinitions(invalid).map((issue) => issue.code));

  assert.ok(issueCodes.has("item_unit_mismatch"));
  assert.ok(issueCodes.has("missing_preplaced_policy"));
});

test("validator rejects cyclic project prerequisites and unpowered powered stages", () => {
  const source = validDefinitions();
  const projectStage = (id: string, prerequisiteIds: readonly string[]) => ({
    id,
    prerequisiteIds,
    deliveries: [],
    rewards: { resourceIds: [], recipeIds: [], buildingIds: [] },
    dockPowerMode: "powered" as const,
    completionSequence: "test",
  });
  const invalid: DefinitionSource = {
    ...source,
    projectStages: [projectStage("alpha", ["beta"]), projectStage("beta", ["alpha"])],
  };
  const issueCodes = new Set(validateDefinitions(invalid).map((issue) => issue.code));

  assert.ok(issueCodes.has("project_stage_cycle"));
  assert.ok(issueCodes.has("missing_project_power"));
});
