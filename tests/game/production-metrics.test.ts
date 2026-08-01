import assert from "node:assert/strict";
import test from "node:test";

import type { DefinitionRegistry } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";
import { ProductionMetricCollector } from "../../app/game/telemetry/productionMetrics.ts";

const registry: DefinitionRegistry = {
  items: new Map([["ore", {
    id: "ore", name: "Ore", category: "resource", medium: "solid", unit: "item", unlockId: "start",
    defaultColor: "#777", geometryType: "ore_chunk", stackSize: 100, modelKey: "ore",
  }]]),
  recipes: new Map([["mine", {
    id: "mine", name: "Mine", buildingId: "miner", inputs: [],
    outputs: [{ itemId: "ore", amount: 1, portId: "out", role: "primary" }], durationSeconds: 1, unlockId: "start",
  }]]),
  buildings: new Map([
    ["miner", {
      id: "miner", name: "Miner", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
      ports: [{ id: "out", direction: "output", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: 1, z: 0 }, localPosition: { x: 0.5, y: 0.5, z: 0 }, localFacing: { x: 1, z: 0 }, bufferSlots: 1, acceptedItemIds: ["ore"] }],
      recipeIds: ["mine"], buildCost: [],
    }],
    ["sink", {
      id: "sink", name: "Sink", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
      ports: [{ id: "in", direction: "input", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: -1, z: 0 }, localPosition: { x: -0.5, y: 0.5, z: 0 }, localFacing: { x: -1, z: 0 }, bufferSlots: 1, acceptedItemIds: ["ore"] }],
      recipeIds: [], buildCost: [],
    }],
  ]),
  projectStages: new Map(),
};

test("rolling production metrics report a 60-second rate and warmup state from fixed-tick counters", () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 2 } });
  assert.equal(world.place({ buildingId: "miner", position: { x: 0, z: 0 }, rotation: 0 }).ok, true);
  assert.equal(world.place({ buildingId: "sink", position: { x: 2, z: 0 }, rotation: 0 }).ok, true);
  const production = new WorldProductionSimulation(world);
  const collector = new ProductionMetricCollector(60, 15);
  collector.sample(production);
  production.advance(10);
  const warming = collector.sample(production).get("ore")!;
  assert.equal(warming.windowSeconds, 10);
  assert.equal(warming.collecting, true);
  assert.ok(warming.producedPerMinute >= 54 && warming.producedPerMinute <= 60);
  production.advance(10);
  const ready = collector.sample(production).get("ore")!;
  assert.equal(ready.windowSeconds, 20);
  assert.equal(ready.collecting, false);
  assert.ok(ready.bufferStock > 0);
});

test("metrics use installed recipe demand and separate storage, transport, and machine buffers", () => {
  const extended: DefinitionRegistry = {
    ...registry,
    recipes: new Map([...registry.recipes, ["consume", {
      id: "consume", name: "Consume", buildingId: "consumer",
      inputs: [{ itemId: "ore", amount: 2, portId: "in" }], outputs: [], durationSeconds: 2, unlockId: "start",
    }]]),
    buildings: new Map([...registry.buildings,
      ["storage", {
        id: "storage", name: "Storage", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
        ports: [{ id: "io", direction: "bidirectional", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: 1, z: 0 }, localPosition: { x: 0.5, y: 0.5, z: 0 }, localFacing: { x: 1, z: 0 }, bufferSlots: 1, acceptedItemIds: ["ore"] }],
        recipeIds: [], buildCost: [], storagePolicy: { slotCount: 1, lockToSingleItem: true, supportsInputFilter: true, supportsOutputFilter: true, defaultRoutingPolicy: "fill_then_output" },
      }],
      ["belt", {
        id: "belt", name: "Belt", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
        ports: [{ id: "io", direction: "bidirectional", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: 1, z: 0 }, localPosition: { x: 0.5, y: 0.5, z: 0 }, localFacing: { x: 1, z: 0 }, bufferSlots: 1, acceptedItemIds: ["ore"] }],
        recipeIds: [], buildCost: [], transportPolicy: { throughputPerMinute: 60 },
      }],
      ["consumer", {
        id: "consumer", name: "Consumer", unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
        ports: [{ id: "in", direction: "input", medium: "solid", connectorProfile: "belt_standard", connectionCell: { x: -1, z: 0 }, localPosition: { x: -0.5, y: 0.5, z: 0 }, localFacing: { x: -1, z: 0 }, bufferSlots: 1, acceptedItemIds: ["ore"] }],
        recipeIds: ["consume"], buildCost: [],
      }],
    ]),
  };
  const world = new DataDrivenWorld({ registry: extended, bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 2 } });
  const storage = world.place({ buildingId: "storage", position: { x: 0, z: 0 }, rotation: 0 });
  const belt = world.place({ buildingId: "belt", position: { x: 2, z: 0 }, rotation: 0 });
  assert.equal(storage.ok, true);
  assert.equal(belt.ok, true);
  if (!storage.ok || !belt.ok) return;
  const production = new WorldProductionSimulation(world);
  assert.equal(production.deposit(storage.instance.id, "io", "input", "ore", 7), true);
  assert.equal(production.deposit(belt.instance.id, "io", "input", "ore", 3), true);
  const collector = new ProductionMetricCollector();
  const beforeConsumer = collector.sample(production).get("ore")!;
  assert.equal(beforeConsumer.demandPerMinute, 0);
  assert.equal(beforeConsumer.storedStock, 7);
  assert.equal(beforeConsumer.inTransit, 3);
  assert.equal(beforeConsumer.bufferStock, 0);

  assert.equal(world.place({ buildingId: "consumer", position: { x: 4, z: 0 }, rotation: 0 }).ok, true);
  production.syncWorld();
  assert.equal(collector.sample(production).get("ore")!.demandPerMinute, 60);
});
