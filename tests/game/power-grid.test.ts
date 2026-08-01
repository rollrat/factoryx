import assert from "node:assert/strict";
import test from "node:test";

import {
  AdvancedPowerGrid,
  type PowerGridInputSnapshot,
} from "../../app/game/sim/powerGrid.ts";

const input = (
  overrides: Partial<PowerGridInputSnapshot> = {},
): PowerGridInputSnapshot => ({
  gridId: "grid-a",
  deltaSeconds: 1,
  generators: [],
  consumers: [],
  batteries: [],
  ...overrides,
});

const assertConservation = (result: ReturnType<AdvancedPowerGrid["step"]>) => {
  const supplied = result.generationMW + result.batteryDischargeMW;
  const used = result.servedMW + result.batteryChargeMW + result.curtailedMW;
  assert.ok(Math.abs(supplied - used) < 1e-9, `${supplied} MW supplied != ${used} MW used`);
};

test("generators dispatch by stable priority and honor minimum load", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const result = grid.step(input({
    generators: [
      { id: "coal", nameplateMW: 10, minimumLoadMW: 4, dispatchPriority: 3, requiresFuel: true, fuelAvailable: true },
      { id: "core", nameplateMW: 5, dispatchPriority: 1 },
      { id: "gas", nameplateMW: 10, dispatchPriority: 2, requiresFuel: true, fuelAvailable: true },
    ],
    consumers: [{ id: "factory", active: true, activeMW: 17, idleMW: 1 }],
  }));

  assert.deepEqual(result.generators.map(({ id, generationMW }) => [id, generationMW]), [
    ["coal", 4],
    ["core", 5],
    ["gas", 10],
  ]);
  assert.equal(result.capacityMW, 25);
  assert.equal(result.dispatchableMW, 25);
  assert.equal(result.generationMW, 19);
  assert.equal(result.servedMW, 17);
  assert.equal(result.curtailedMW, 2);
  assert.equal(result.satisfaction, 1);
  assertConservation(result);
});

test("active, idle, and explicit requests remain distinct and share low voltage satisfaction", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const result = grid.step(input({
    generators: [{ id: "core", nameplateMW: 8, dispatchPriority: 1 }],
    consumers: [
      { id: "active", active: true, activeMW: 6, idleMW: 1, priority: 2 },
      { id: "idle", active: false, activeMW: 5, idleMW: 2, priority: 3 },
      { id: "requested", active: true, activeMW: 8, idleMW: 1, requestedMW: 2, priority: 4 },
    ],
  }));

  assert.equal(result.requestedMW, 10);
  assert.equal(result.maxConsumptionMW, 19);
  assert.equal(result.servedMW, 8);
  assert.equal(result.satisfaction, 0.8);
  const servedById = new Map(result.consumers.map(({ id, servedMW }) => [id, servedMW]));
  assert.ok(Math.abs(servedById.get("active")! - 4.8) < 1e-9);
  assert.ok(Math.abs(servedById.get("idle")! - 1.6) < 1e-9);
  assert.ok(Math.abs(servedById.get("requested")! - 1.6) < 1e-9);
  assertConservation(result);
});

test("batteries discharge after generators and update stored MWh", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const result = grid.step(input({
    deltaSeconds: 360,
    generators: [{ id: "core", nameplateMW: 5, dispatchPriority: 1 }],
    consumers: [{ id: "load", active: true, activeMW: 8, idleMW: 1 }],
    batteries: [{ id: "battery", capacityMWh: 2, storedMWh: 1, maxChargeMW: 5, maxDischargeMW: 5 }],
  }));

  assert.equal(result.generationMW, 5);
  assert.equal(result.batteryDischargeMW, 3);
  assert.equal(result.batteries[0].storedMWh, 0.7);
  assert.equal(result.satisfaction, 1);
  assertConservation(result);
});

test("minimum generator output charges batteries before curtailment", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const result = grid.step(input({
    deltaSeconds: 360,
    generators: [{ id: "thermal", nameplateMW: 10, minimumLoadMW: 6, dispatchPriority: 1 }],
    consumers: [{ id: "idle-load", active: false, activeMW: 5, idleMW: 2 }],
    batteries: [{ id: "battery", capacityMWh: 1, storedMWh: 0.8, maxChargeMW: 3, maxDischargeMW: 3 }],
  }));

  assert.equal(result.generationMW, 6);
  assert.equal(result.servedMW, 2);
  assert.ok(Math.abs(result.batteryChargeMW - 2) < 1e-9);
  assert.ok(Math.abs(result.curtailedMW - 2) < 1e-9);
  assert.equal(result.batteries[0].storedMWh, 1);
  assertConservation(result);
});

test("load shedding waits three seconds then sheds P4 in stable id order", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const snapshot = input({
    generators: [{ id: "core", nameplateMW: 6, dispatchPriority: 1 }],
    consumers: [
      { id: "p1", active: true, activeMW: 4, idleMW: 0, priority: 1 },
      { id: "optional-b", active: true, activeMW: 3, idleMW: 0, priority: 4 },
      { id: "optional-a", active: true, activeMW: 3, idleMW: 0, priority: 4 },
    ],
  });

  assert.equal(grid.step(snapshot).shedConsumerIds.length, 0);
  assert.equal(grid.step(snapshot).shedConsumerIds.length, 0);
  const shed = grid.step(snapshot);
  assert.deepEqual(shed.shedConsumerIds, ["optional-a"]);
  assert.equal(shed.requestedMW, 7);
  assert.ok(Math.abs(shed.satisfaction - 6 / 7) < 1e-9);
  assert.equal(shed.mainBreakerTripped, false);
});

test("P1 shortage latches the main breaker until sequential restart", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const shortage = input({
    generators: [{ id: "core", nameplateMW: 2, dispatchPriority: 1 }],
    consumers: [{ id: "auxiliary", active: true, activeMW: 4, idleMW: 0, priority: 1 }],
  });
  grid.step(shortage);
  grid.step(shortage);
  const tripped = grid.step(shortage);
  assert.equal(tripped.mainBreakerTripped, true);
  assert.equal(tripped.servedMW, 0);

  const sufficient = input({
    generators: [{ id: "core", nameplateMW: 8, dispatchPriority: 1 }],
    consumers: shortage.consumers,
  });
  assert.equal(grid.step(sufficient).mainBreakerTripped, true);
  grid.sequentialRestart();
  const restarted = grid.step(sufficient);
  assert.equal(restarted.mainBreakerTripped, false);
  assert.equal(restarted.servedMW, 4);
});

test("shed zones reconnect one at a time only after ten seconds of sustainable reserve", () => {
  const grid = new AdvancedPowerGrid("grid-a");
  const weak = input({
    generators: [{ id: "core", nameplateMW: 4, dispatchPriority: 1 }],
    consumers: [
      { id: "p1", active: true, activeMW: 4, idleMW: 0, priority: 1 },
      { id: "optional-b", active: true, activeMW: 3, idleMW: 0, priority: 4 },
      { id: "optional-a", active: true, activeMW: 3, idleMW: 0, priority: 4 },
    ],
  });
  grid.step(weak);
  grid.step(weak);
  assert.deepEqual(grid.step(weak).shedConsumerIds, ["optional-a", "optional-b"]);

  const recovered = input({ ...weak, generators: [{ id: "core", nameplateMW: 12, dispatchPriority: 1 }] });
  for (let second = 0; second < 9; second += 1) grid.step(recovered);
  assert.deepEqual(grid.step(recovered).shedConsumerIds, ["optional-b"]);
  assert.deepEqual(grid.step(recovered).shedConsumerIds, ["optional-b"], "only one zone reconnects per recovery window");
});

test("snapshot restore preserves battery energy, shedding timers, and deterministic continuation", () => {
  const snapshot = input({
    generators: [{ id: "core", nameplateMW: 5, dispatchPriority: 1 }],
    consumers: [
      { id: "production", active: true, activeMW: 8, idleMW: 1, priority: 3 },
      { id: "optional", active: true, activeMW: 2, idleMW: 0, priority: 4 },
    ],
    batteries: [{ id: "battery", capacityMWh: 2, storedMWh: 1, maxChargeMW: 2, maxDischargeMW: 2 }],
  });
  const original = new AdvancedPowerGrid("grid-a");
  original.step(snapshot);
  original.step(snapshot);

  const restored = new AdvancedPowerGrid("grid-a", structuredClone(original.snapshot()));
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(restored.step(snapshot), original.step(snapshot));
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
