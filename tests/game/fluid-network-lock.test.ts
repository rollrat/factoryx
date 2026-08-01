import assert from "node:assert/strict";
import test from "node:test";

import type { DefinitionRegistry } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

const item = (id: string) => ({
  id, name: id, category: "fluid" as const, medium: "fluid" as const, unit: "m3" as const,
  unlockId: "start" as const, defaultColor: "#777", geometryType: "fluid", stackSize: 100, modelKey: id,
});
const fluidPort = (id: string, x: number) => ({
  id, direction: "bidirectional" as const, medium: "fluid" as const, connectorProfile: "pipe_mk1" as const,
  connectionCell: { x, z: 0 }, localPosition: { x: x / 2, y: 0.5, z: 0 }, localFacing: { x: Math.sign(x), z: 0 },
  bufferSlots: 0, acceptedItemIds: ["oil", "gas"],
});

const registry: DefinitionRegistry = {
  items: new Map([["oil", item("oil")], ["gas", item("gas")]]),
  recipes: new Map(),
  buildings: new Map([["pipe", {
    id: "pipe", name: "Pipe", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
    ports: [fluidPort("in", -1), fluidPort("out", 1)], recipeIds: [], buildCost: [],
    transportPolicy: { throughputPerMinute: 60 },
    fluidStoragePolicy: { capacityM3: 4, throughputM3PerMinute: 60, locksFluidType: true },
  }]]),
  projectStages: new Map(),
};

test("the first fluid locks a connected pipe component until every internal volume is empty", () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 1 } });
  const first = world.place({ buildingId: "pipe", position: { x: 0, z: 0 }, rotation: 0 });
  const second = world.place({ buildingId: "pipe", position: { x: 2, z: 0 }, rotation: 0 });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  const production = new WorldProductionSimulation(world);
  assert.equal(production.deposit(first.instance.id, "in", "input", "oil", 2), true);
  assert.equal(production.deposit(second.instance.id, "out", "input", "gas", 1), false);
  assert.equal(production.withdraw(first.instance.id, "in", "input", "oil", 2), true);
  assert.equal(production.deposit(second.instance.id, "out", "input", "gas", 1), true);
});
