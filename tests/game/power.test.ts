import assert from "node:assert/strict";
import test from "node:test";

import {
  FIELD_CORE_CAPACITY_MW,
  POWER_DEMAND_MW,
  computePowerGrid,
} from "../../app/game/sim/power.ts";
import { FactorySimulation } from "../../app/game/simulation.ts";

test("field core and facility demands match the MVP contract", () => {
  assert.equal(FIELD_CORE_CAPACITY_MW, 24);
  assert.deepEqual(POWER_DEMAND_MW, {
    miner: 4,
    smelter: 8,
    crusher: 6,
    assembler: 10,
    storage: 1,
    belt: 0,
    splitter: 0,
    merger: 0,
  });
});

test("serves every load when total demand fits the field core", () => {
  const result = computePowerGrid([
    { structureId: 1, type: "miner" },
    { structureId: 2, type: "smelter" },
    { structureId: 3, type: "crusher" },
    { structureId: 4, type: "storage" },
  ]);

  assert.equal(result.supplyMW, 24);
  assert.equal(result.demandMW, 19);
  assert.equal(result.servedMW, 19);
  assert.equal(result.overloaded, false);
  assert.ok(result.structures.every((structure) => structure.powered));
});

test("sheds equal-priority loads in stable structure id order", () => {
  const result = computePowerGrid([
    { structureId: 30, type: "assembler" },
    { structureId: 10, type: "assembler" },
    { structureId: 20, type: "assembler" },
  ]);

  assert.equal(result.demandMW, 30);
  assert.equal(result.servedMW, 20);
  assert.equal(result.overloaded, true);
  assert.equal(result.poweredByStructureId.get(10), true);
  assert.equal(result.poweredByStructureId.get(20), true);
  assert.equal(result.poweredByStructureId.get(30), false);
});

test("priority takes precedence over structure id", () => {
  const result = computePowerGrid([
    { structureId: 1, type: "assembler", priority: 10 },
    { structureId: 99, type: "assembler", priority: 0 },
    { structureId: 2, type: "smelter", priority: 5 },
  ]);

  assert.equal(result.poweredByStructureId.get(99), true);
  assert.equal(result.poweredByStructureId.get(2), true);
  assert.equal(result.poweredByStructureId.get(1), false);
  assert.equal(result.servedMW, 18);
});

test("zero-demand logistics remain operational without consuming supply", () => {
  const result = computePowerGrid([
    { structureId: 1, type: "belt" },
    { structureId: 2, type: "splitter" },
    { structureId: 3, type: "merger" },
    { structureId: 4, type: "miner" },
  ], 0);

  assert.equal(result.demandMW, 4);
  assert.equal(result.servedMW, 0);
  assert.equal(result.overloaded, true);
  assert.deepEqual(result.structures.map(({ structureId, powered }) => [structureId, powered]), [
    [1, true], [2, true], [3, true], [4, false],
  ]);
});

test("rejects invalid capacity and duplicate structure ids", () => {
  assert.throws(() => computePowerGrid([], -1), /supplyMW/);
  assert.throws(() => computePowerGrid([
    { structureId: 1, type: "miner" },
    { structureId: 1, type: "storage" },
  ]), /duplicate power load structureId/);
});

test("factory processing pauses deterministically when the grid sheds a machine", () => {
  const simulation = new FactorySimulation();
  [10, 20, 30].forEach((id, index) => {
    simulation.addStructure({ id, type: "assembler", x: index * 3 - 6, z: 0, rotation: 0 });
    simulation.machines.get(id)!.input.push("iron_ingot");
  });

  simulation.update(0.05);

  assert.equal(simulation.machines.get(10)?.working, true);
  assert.equal(simulation.machines.get(20)?.working, true);
  assert.equal(simulation.machines.get(30)?.working, false);
  assert.equal(simulation.getSelectedInfo(30)?.runtimeState, "paused");
  assert.equal(simulation.getSelectedInfo(30)?.status, "전력 부족");
});

test("external campaign power availability overrides legacy dispatch without changing demand metadata", () => {
  const factory = new FactorySimulation();
  factory.addStructure({ id: 1, type: "miner", x: -8, z: -3, rotation: 0 });
  factory.setExternalPowerAvailability(new Map([[1, false]]));
  const grid = factory.getPowerGrid();
  assert.equal(grid.poweredByStructureId.get(1), false);
  assert.equal(grid.structures[0]?.demandMW, 4);
  assert.equal(grid.structures[0]?.servedMW, 0);
});
