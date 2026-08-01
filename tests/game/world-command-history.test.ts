import assert from "node:assert/strict";
import test from "node:test";

import type { BuildingDefinition, DefinitionRegistry, ItemDefinition } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldCommandHistory } from "../../app/game/sim/worldCommandHistory.ts";

const items = [
  { id: "plate", name: "Plate", category: "material", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#aaa", geometryType: "plate", stackSize: 100, modelKey: "plate" },
  { id: "ore", name: "Ore", category: "resource", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#555", geometryType: "ore_chunk", stackSize: 100, modelKey: "ore" },
] as const satisfies readonly ItemDefinition[];

const buildings = [
  {
    id: "machine", name: "Machine", unlockId: "start", placementMode: "buildable",
    footprint: { x: 2, z: 1 }, allowedRotations: [0, 1, 2, 3],
    ports: [
      { id: "input", direction: "input", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: -1, z: 0 }, localPosition: { x: -1, y: 0.5, z: 0 }, localFacing: { x: -1, z: 0 }, bufferSlots: 2, acceptedItemIds: ["ore"] },
      { id: "output", direction: "output", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: 2, z: 0 }, localPosition: { x: 1, y: 0.5, z: 0 }, localFacing: { x: 1, z: 0 }, bufferSlots: 2, acceptedItemIds: ["plate"] },
    ], recipeIds: [], buildCost: [{ itemId: "plate", amount: 4 }],
  },
  {
    id: "belt", name: "Belt", unlockId: "start", placementMode: "buildable",
    footprint: { x: 1, z: 1 }, allowedRotations: [0, 1, 2, 3], ports: [], recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 1 }], transportPolicy: { throughputPerMinute: 60 },
  },
  {
    id: "pipe", name: "Pipe", unlockId: "phase_1_complete", placementMode: "buildable",
    footprint: { x: 1, z: 1 }, allowedRotations: [0, 1, 2, 3], ports: [], recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 2 }], transportPolicy: { throughputPerMinute: 60 },
  },
] as const satisfies readonly BuildingDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(items.map((item) => [item.id, item])),
  recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(),
};

const createWorld = () => new DataDrivenWorld({
  registry,
  bounds: { minX: 0, maxX: 14, minZ: 0, maxZ: 8 },
  constructionInventory: [{ itemId: "plate", amount: 40 }],
});

test("single placement undo and redo preserve later campaign unlocks and inventory grants", () => {
  const world = createWorld();
  const history = new WorldCommandHistory();
  const placed = history.place(world, { buildingId: "machine", position: { x: 0, z: 0 }, rotation: 1 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(world.inventoryAmount("plate"), 36);

  world.unlock("phase_1_complete");
  world.grantItems([{ itemId: "plate", amount: 7 }]);
  assert.equal(history.undo(world).ok, true);
  assert.equal(world.instance(placed.instance.id), null);
  assert.equal(world.inventoryAmount("plate"), 47);
  assert.ok(world.snapshot().unlockedIds.includes("phase_1_complete"));

  assert.equal(history.redo(world).ok, true);
  assert.equal(world.instance(placed.instance.id)?.rotation, 1);
  assert.equal(world.inventoryAmount("plate"), 43);
  assert.ok(world.snapshot().unlockedIds.includes("phase_1_complete"));
});

test("rotated belt and pipe routes undo and redo as one atomic batch", () => {
  const world = createWorld();
  world.unlock("phase_1_complete");
  const history = new WorldCommandHistory();
  const requests = [
    { buildingId: "belt", position: { x: 0, z: 0 }, rotation: 0 as const },
    { buildingId: "belt", position: { x: 1, z: 0 }, rotation: 1 as const },
    { buildingId: "pipe", position: { x: 3, z: 0 }, rotation: 2 as const },
    { buildingId: "pipe", position: { x: 4, z: 0 }, rotation: 3 as const },
  ];
  const result = history.placeBatch(world, requests);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ids = result.instances.map(({ id }) => id);
  assert.equal(history.undoDepth, 1);
  assert.ok(ids.every((id) => world.instance(id)));

  assert.equal(history.undo(world).ok, true);
  assert.ok(ids.every((id) => world.instance(id) === null));
  assert.equal(world.inventoryAmount("plate"), 40);
  assert.equal(history.redo(world).ok, true);
  assert.deepEqual(ids.map((id) => world.instance(id)?.rotation), [0, 1, 2, 3]);
  assert.equal(world.inventoryAmount("plate"), 34);
});

test("demolition undo restores build cost, buffers, WIP, and runtime fields exactly", () => {
  const world = createWorld();
  const placed = world.place({ buildingId: "machine", position: { x: 0, z: 0 }, rotation: 2 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  world.setRuntimeContents(placed.instance.id, {
    inputBuffersByPortId: { input: [{ itemId: "ore", amount: 3 }] },
    outputBuffersByPortId: { output: [{ itemId: "plate", amount: 2 }] },
    workInProgress: [{ itemId: "ore", amount: 2 }],
    runtimeState: "working",
    progress: 0.625,
  });
  const exactInstance = world.instance(placed.instance.id);
  const history = new WorldCommandHistory();
  const demolition = history.demolish(world, placed.instance.id);
  assert.equal(demolition.ok, true);
  assert.equal(world.inventoryAmount("plate"), 42);
  assert.equal(world.inventoryAmount("ore"), 5);

  world.grantItems([{ itemId: "plate", amount: 10 }]);
  assert.equal(history.undo(world).ok, true);
  assert.deepEqual(world.instance(placed.instance.id), exactInstance);
  assert.equal(world.inventoryAmount("plate"), 46);
  assert.equal(world.inventoryAmount("ore"), 0);

  assert.equal(history.redo(world).ok, true);
  assert.equal(world.instance(placed.instance.id), null);
  assert.equal(world.inventoryAmount("plate"), 52);
  assert.equal(world.inventoryAmount("ore"), 5);
});

test("failed batches are not recorded and conflicting live mutations fail without data loss", () => {
  const world = createWorld();
  const history = new WorldCommandHistory();
  const failed = history.placeBatch(world, [
    { buildingId: "belt", position: { x: 0, z: 0 }, rotation: 0 },
    { buildingId: "belt", position: { x: 0, z: 0 }, rotation: 0 },
  ]);
  assert.equal(failed.ok, false);
  assert.equal(history.canUndo, false);

  const placed = history.place(world, { buildingId: "machine", position: { x: 2, z: 2 }, rotation: 0 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  world.setRuntimeContents(placed.instance.id, {
    inputBuffersByPortId: { input: [{ itemId: "ore", amount: 1 }] },
    outputBuffersByPortId: { output: [] },
    workInProgress: [],
  });
  const beforeUndo = world.snapshot();
  assert.deepEqual(history.undo(world), { ok: false, reason: "world_changed" });
  assert.deepEqual(world.snapshot(), beforeUndo);
  assert.equal(history.canUndo, true);
});
