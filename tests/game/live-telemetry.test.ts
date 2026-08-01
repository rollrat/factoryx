import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import { buildLiveTelemetry } from "../../app/game/telemetry/live.ts";

test("live telemetry aggregates machine states, belts, inventory, and progress", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "miner", x: -8, z: -3, rotation: 0 });
  simulation.addStructure({ id: 2, type: "smelter", x: 0, z: 0, rotation: 0 });
  simulation.addStructure({ id: 3, type: "belt", x: -1, z: 0, rotation: 1 });
  simulation.addStructure({ id: 4, type: "assembler", x: 10, z: 0, rotation: 0 });
  simulation.addStructure({ id: 5, type: "assembler", x: 30, z: 0, rotation: 0 });
  simulation.addStructure({ id: 6, type: "storage", x: 20, z: 0, rotation: 0 });
  simulation.addStructure({ id: 7, type: "belt", x: 19, z: 0, rotation: 1 });
  simulation.addStructure({ id: 8, type: "belt", x: 40, z: 0, rotation: 1 });
  simulation.addStructure({ id: 9, type: "belt", x: 42, z: 0, rotation: 1 });
  simulation.addStructure({ id: 10, type: "belt", x: 44, z: 0, rotation: 1 });

  Object.assign(simulation.machines.get(1)!, { working: true, progress: 0.4 });
  simulation.machines.get(4)!.output.push("iron_plate");
  simulation.machines.get(6)!.storedItems.push(...Array.from({ length: 20 }, () => "iron_plate" as const));
  simulation.machines.get(6)!.stored = 20;
  simulation.beltItems.set(8, { id: 100, type: "iron_ore", progress: 0.5 });
  simulation.beltItems.set(9, { id: 101, type: "iron_ingot", progress: 0.98 });

  const snapshot = buildLiveTelemetry(simulation);

  assert.deepEqual(snapshot.stateCounts, {
    working: 1,
    starved: 1,
    blocked: 1,
    disconnected: 1,
    idle: 1,
  });
  assert.deepEqual(snapshot.belts, {
    count: 5,
    buildingId: "conveyor_mk1",
    moving: 1,
    jammed: 1,
    idle: 3,
    itemsInTransit: 2,
    averageProgress: 0.74,
  });
  assert.equal(snapshot.byType.assembler.count, 2);
  assert.equal(snapshot.byType.storage.storedItems, 20);
  assert.equal(snapshot.byType.miner.averageProgress, 0.4);
  assert.equal(snapshot.totals.inventoryItems, 23);
  assert.equal(snapshot.totals.workInProgress, 1);
  assert.equal(snapshot.machines.find(({ structureId }) => structureId === 4)?.runtimeState, "blocked");
});

test("builder is side-effect free and supports building id overrides", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "storage", x: 0, z: 0, rotation: 0 });
  const before = structuredClone({
    structures: [...simulation.structures],
    machines: [...simulation.machines],
    belts: [...simulation.beltItems],
  });

  const snapshot = buildLiveTelemetry(simulation, {
    buildingIdByType: { storage: "custom_storage" },
  });

  assert.equal(snapshot.byType.storage.buildingId, "custom_storage");
  assert.equal(snapshot.machines[0]?.buildingId, "custom_storage");
  assert.deepEqual({
    structures: [...simulation.structures],
    machines: [...simulation.machines],
    belts: [...simulation.beltItems],
  }, before);
  assert.throws(() => buildLiveTelemetry(simulation, { beltJamProgress: 2 }), /between zero and one/);
});
