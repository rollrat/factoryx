import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import {
  HeadlessFactory,
  type FactoryConfig,
  type FactorySnapshot,
} from "../../app/game/sim/factory.ts";

const recipe = (id: string) => {
  const value = START_REGISTRY.recipes.get(id);
  assert.ok(value, `missing recipe fixture: ${id}`);
  return value;
};

const createConfig = (): FactoryConfig => ({
  machines: [
    { id: "miner", recipe: recipe("mine_iron_ore"), outputCapacity: 4 },
    { id: "smelter", recipe: recipe("smelt_iron_ingot"), inputCapacity: 4, outputCapacity: 2 },
    { id: "former", recipe: recipe("form_iron_plate"), inputCapacity: 2, outputCapacity: 4 },
  ],
  storages: [{ id: "storage", portId: "solid_in", capacity: 2, acceptedItemId: "iron_plate" }],
  links: [
    { from: { nodeId: "miner", portId: "solid_out" }, to: { nodeId: "smelter", portId: "solid_in" }, maxAmountPerTick: 2 },
    { from: { nodeId: "smelter", portId: "solid_out" }, to: { nodeId: "former", portId: "solid_in" }, maxAmountPerTick: 1 },
    { from: { nodeId: "former", portId: "solid_out" }, to: { nodeId: "storage", portId: "solid_in" }, maxAmountPerTick: 2 },
  ],
});

const quantityState = (snapshot: FactorySnapshot) => ({
  machines: snapshot.machines.map((machine) => ({
    id: machine.id,
    progress: machine.process.progress,
    cycles: machine.process.completedCycles,
    wip: machine.process.workInProgress,
    inputs: machine.inputs.map(({ portId, itemId, amount }) => ({ portId, itemId, amount })),
    outputs: machine.outputs.map(({ portId, itemId, amount }) => ({ portId, itemId, amount })),
  })),
  storages: snapshot.storages,
});

test("miner to smelter to former to storage runs end to end", () => {
  const factory = new HeadlessFactory(createConfig());

  factory.advance(0.05);
  assert.equal(factory.machine("smelter").runtimeState, "starved");
  assert.equal(factory.machine("former").runtimeState, "starved");

  factory.advance(13);
  const stored = factory.inventory({ nodeId: "storage", portId: "solid_in" });
  assert.equal(stored.itemId, "iron_plate");
  assert.equal(stored.amount, 2);
  assert.equal(factory.machine("miner").completedCycles, 3);
  assert.equal(factory.machine("smelter").completedCycles, 2);
  assert.equal(factory.machine("former").completedCycles, 1);
});

test("pause and snapshot restore preserve the same deterministic flow", () => {
  const config = createConfig();
  const factory = new HeadlessFactory(config);
  factory.advance(6.25);
  factory.setPaused(true);
  const beforePause = quantityState(factory.snapshot());

  factory.advance(3);
  assert.deepEqual(quantityState(factory.snapshot()), beforePause);
  assert.ok(factory.snapshot().machines.every(({ process }) => process.runtimeState === "paused"));

  const pausedSnapshot = structuredClone(factory.snapshot());
  const restored = new HeadlessFactory(config, pausedSnapshot);
  factory.setPaused(false);
  restored.setPaused(false);
  factory.advance(7);
  restored.advance(7);

  assert.deepEqual(restored.snapshot(), factory.snapshot());
  assert.equal(restored.inventory({ nodeId: "storage", portId: "solid_in" }).amount, 2);
});

test("a full storage propagates blocked state without losing completed WIP", () => {
  const factory = new HeadlessFactory(createConfig());
  factory.advance(25);

  assert.equal(factory.inventory({ nodeId: "storage", portId: "solid_in" }).amount, 2);
  const former = factory.machine("former");
  assert.equal(former.runtimeState, "blocked");
  assert.equal(former.progress, 1);
  assert.equal(former.workInProgress?.completed, true);
  assert.equal(former.completedCycles, 3);
});
