import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildingDefinition,
  DefinitionRegistry,
  ItemDefinition,
} from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const items = [
  { id: "plate", name: "Plate", category: "material", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#aaa", geometryType: "plate", stackSize: 100, modelKey: "plate" },
  { id: "rod", name: "Rod", category: "material", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#888", geometryType: "rod", stackSize: 100, modelKey: "rod" },
  { id: "ore", name: "Ore", category: "resource", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#555", geometryType: "ore_chunk", stackSize: 100, modelKey: "ore" },
] as const satisfies readonly ItemDefinition[];

const solidPort = (id: string, direction: "input" | "output", x: number, z: number) => ({
  id,
  direction,
  medium: "solid" as const,
  connectorProfile: "belt_standard" as const,
  connectionCell: { x, z },
  localPosition: { x: direction === "input" ? -1 : 1, y: 0.5, z: 0 },
  localFacing: { x: direction === "input" ? -1 : 1, z: 0 },
  bufferSlots: 2,
  acceptedItemIds: direction === "input" ? ["ore"] : ["plate"],
});

const buildings = [
  {
    id: "machine",
    name: "Machine",
    unlockId: "start",
    placementMode: "buildable",
    footprint: { x: 2, z: 3 },
    allowedRotations: [0, 1, 2, 3],
    ports: [solidPort("input", "input", -1, 1), solidPort("output", "output", 2, 1)],
    recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 4 }, { itemId: "rod", amount: 2 }],
  },
  {
    id: "locked_machine",
    name: "Locked Machine",
    unlockId: "phase_1_complete",
    placementMode: "buildable",
    footprint: { x: 1, z: 1 },
    allowedRotations: [0],
    ports: [],
    recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 1 }],
  },
  {
    id: "project_dock",
    name: "Project Dock",
    unlockId: "start",
    placementMode: "preplaced_unique",
    footprint: { x: 2, z: 2 },
    allowedRotations: [0],
    ports: [],
    recipeIds: [],
    buildCost: [],
    preplacedPolicy: {
      worldAnchor: { x: 7, z: 7 },
      fixedRotation: 0,
      canBuild: false,
      canClone: false,
      canDemolish: false,
    },
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
  bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
  constructionInventory: [{ itemId: "plate", amount: 20 }, { itemId: "rod", amount: 10 }],
});

test("preplaced unique definitions seed once and cannot be built or demolished", () => {
  const world = createWorld();
  const dock = world.instance("preplaced:project_dock");
  assert.ok(dock);
  assert.deepEqual(dock.position, { x: 7, z: 7 });
  assert.equal(world.instanceAt({ x: 8, z: 8 })?.id, dock.id);
  assert.deepEqual(world.place({ buildingId: "project_dock", position: { x: 0, z: 0 }, rotation: 0 }), {
    ok: false,
    reason: "preplaced_unique",
  });
  assert.deepEqual(world.demolish(dock.id), { ok: false, reason: "immutable_preplaced" });
});

test("placement atomically consumes build costs only after unlock, bounds, and occupancy pass", () => {
  const world = createWorld();
  const beforePlate = world.inventoryAmount("plate");
  assert.deepEqual(world.place({ buildingId: "locked_machine", position: { x: 0, z: 0 }, rotation: 0 }), {
    ok: false,
    reason: "locked",
  });
  assert.equal(world.inventoryAmount("plate"), beforePlate);

  assert.equal(world.place({ buildingId: "machine", position: { x: 9, z: 9 }, rotation: 0 }).reason, "out_of_bounds");
  assert.equal(world.inventoryAmount("plate"), beforePlate);

  const placed = world.place({ buildingId: "machine", position: { x: 0, z: 0 }, rotation: 0 });
  assert.equal(placed.ok, true);
  assert.equal(world.inventoryAmount("plate"), 16);
  assert.equal(world.inventoryAmount("rod"), 8);
  assert.equal(world.place({ buildingId: "machine", position: { x: 1, z: 2 }, rotation: 0 }).reason, "occupied");
  assert.equal(world.inventoryAmount("plate"), 16);

  world.unlock("phase_1_complete");
  assert.equal(world.place({ buildingId: "locked_machine", position: { x: 5, z: 5 }, rotation: 0 }).ok, true);
});

test("rotation swaps occupancy and transforms connection cells and facing", () => {
  const world = createWorld();
  const result = world.place({ buildingId: "machine", position: { x: 1, z: 1 }, rotation: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The 2x3 footprint becomes 3x2 and occupies x=1..3, z=1..2.
  assert.equal(world.instanceAt({ x: 3, z: 2 })?.id, result.instance.id);
  assert.equal(world.instanceAt({ x: 1, z: 3 }), null);
  const ports = world.portsFor(result.instance.id);
  assert.deepEqual(ports.map(({ definition, connectionCell, localFacing }) => ({
    id: definition.id,
    connectionCell,
    localFacing,
  })), [
    { id: "input", connectionCell: { x: 2, z: 0 }, localFacing: { x: 0, z: -1 } },
    { id: "output", connectionCell: { x: 2, z: 3 }, localFacing: { x: 0, z: 1 } },
  ]);
});

test("demolition returns build cost, buffers, and WIP without losing items", () => {
  const world = createWorld();
  const placed = world.place({ buildingId: "machine", position: { x: 0, z: 0 }, rotation: 0 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(world.setRuntimeContents(placed.instance.id, {
    inputBuffersByPortId: { input: [{ itemId: "ore", amount: 3 }] },
    outputBuffersByPortId: { output: [{ itemId: "plate", amount: 2 }] },
    workInProgress: [{ itemId: "ore", amount: 2 }],
  }), true);

  const demolition = world.demolish(placed.instance.id);
  assert.equal(demolition.ok, true);
  if (!demolition.ok) return;
  assert.deepEqual(demolition.recoveredItems, [
    { itemId: "ore", amount: 5 },
    { itemId: "plate", amount: 6 },
    { itemId: "rod", amount: 2 },
  ]);
  assert.equal(world.inventoryAmount("plate"), 22);
  assert.equal(world.inventoryAmount("rod"), 10);
  assert.equal(world.inventoryAmount("ore"), 5);
  assert.equal(world.instanceAt({ x: 0, z: 0 }), null);
});

test("insufficient materials fail without partial consumption", () => {
  const world = new DataDrivenWorld({
    registry,
    bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
    constructionInventory: [{ itemId: "plate", amount: 20 }, { itemId: "rod", amount: 1 }],
  });
  const result = world.place({ buildingId: "machine", position: { x: 0, z: 0 }, rotation: 0 });
  assert.deepEqual(result, { ok: false, reason: "insufficient_materials", itemId: "rod" });
  assert.equal(world.inventoryAmount("plate"), 20);
  assert.equal(world.inventoryAmount("rod"), 1);
  assert.equal(world.instanceAt({ x: 0, z: 0 }), null);
});

test("batch placement rolls back every segment when a later segment fails", () => {
  const world = createWorld();
  const before = world.snapshot();
  const result = world.placeBatch([
    { buildingId: "machine", position: { x: 0, z: 0 }, rotation: 0 },
    { buildingId: "machine", position: { x: 0, z: 0 }, rotation: 0 },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(world.snapshot(), before);
});

test("snapshot restore preserves inventory, unlocks, instances, runtime contents, and next id", () => {
  const original = createWorld();
  original.unlock("phase_1_complete");
  const placed = original.place({ buildingId: "machine", position: { x: 0, z: 0 }, rotation: 2 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  original.setRuntimeContents(placed.instance.id, {
    inputBuffersByPortId: { input: [{ itemId: "ore", amount: 2 }] },
    outputBuffersByPortId: { output: [] },
    workInProgress: [{ itemId: "ore", amount: 1 }],
  });

  const restored = new DataDrivenWorld({
    registry,
    bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
    snapshot: structuredClone(original.snapshot()),
  });
  assert.deepEqual(restored.snapshot(), original.snapshot());
  const next = restored.place({ buildingId: "locked_machine", position: { x: 5, z: 5 }, rotation: 0 });
  assert.equal(next.ok, true);
  if (next.ok) assert.equal(next.instance.id, "building-2");
});

test("restore rejects overlap, boundary violations, and invalid rotations", () => {
  const world = createWorld();
  const snapshot = world.snapshot();
  const machine = {
    id: "building-1",
    definitionId: "machine",
    position: { x: 9, z: 9 },
    rotation: 0 as const,
    runtimeState: "idle",
    progress: 0,
    inputBuffersByPortId: { input: [] },
    outputBuffersByPortId: { output: [] },
    workInProgress: [],
  };
  assert.throws(() => new DataDrivenWorld({
    registry,
    bounds: snapshot.bounds,
    snapshot: { ...snapshot, instances: [...snapshot.instances, machine] },
  }), /out_of_bounds/);
  assert.throws(() => new DataDrivenWorld({
    registry,
    bounds: snapshot.bounds,
    snapshot: { ...snapshot, instances: [...snapshot.instances, { ...machine, position: { x: 7, z: 7 } }] },
  }), /occupied/);
  assert.throws(() => new DataDrivenWorld({
    registry,
    bounds: snapshot.bounds,
    snapshot: {
      ...snapshot,
      instances: [...snapshot.instances, { ...machine, definitionId: "locked_machine", position: { x: 5, z: 5 }, rotation: 1 as const }],
    },
  }), /invalid_rotation/);
});
