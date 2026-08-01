import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { HeadlessFactory, type FactoryConfig } from "../../app/game/sim/factory.ts";

const recipe = (id: string) => {
  const value = START_REGISTRY.recipes.get(id);
  assert.ok(value, `missing recipe: ${id}`);
  return value;
};

test("the refinery preserves both its primary output and fluid byproduct", () => {
  const config: FactoryConfig = {
    machines: [
      { id: "well", recipe: recipe("extract_crude_oil"), outputCapacity: 12 },
      {
        id: "refinery",
        recipe: recipe("refine_crude_oil"),
        inputCapacity: 12,
        outputCapacity: { resin_out: 4, gas_out: 8 },
      },
    ],
    storages: [
      { id: "resin_store", portId: "solid_in", capacity: 10, acceptedItemId: "polymer_resin" },
      { id: "gas_tank", portId: "fluid_in", capacity: 20, acceptedItemId: "fuel_gas" },
    ],
    links: [
      { from: { nodeId: "well", portId: "fluid_out" }, to: { nodeId: "refinery", portId: "crude_in" }, maxAmountPerTick: 3 },
      { from: { nodeId: "refinery", portId: "resin_out" }, to: { nodeId: "resin_store", portId: "solid_in" } },
      { from: { nodeId: "refinery", portId: "gas_out" }, to: { nodeId: "gas_tank", portId: "fluid_in" }, maxAmountPerTick: 2 },
    ],
  };
  const factory = new HeadlessFactory(config);
  factory.advance(19);

  const resin = factory.inventory({ nodeId: "resin_store", portId: "solid_in" });
  const gas = factory.inventory({ nodeId: "gas_tank", portId: "fluid_in" });
  assert.equal(resin.amount, 2);
  assert.equal(gas.amount, 4);
  assert.equal(gas.amount, resin.amount * 2);
});

test("power satisfaction scales production progress instead of deleting WIP", () => {
  const config: FactoryConfig = {
    machines: [{ id: "miner", recipe: recipe("mine_iron_ore"), outputCapacity: 10 }],
    storages: [],
    links: [],
    machineSpeed: () => 0.5,
  };
  const factory = new HeadlessFactory(config);
  factory.advance(2);

  const miner = factory.machine("miner");
  assert.equal(miner.runtimeState, "working");
  assert.ok(Math.abs(miner.progress - 0.25) < 1e-9);
  assert.deepEqual(miner.workInProgress?.inputs, []);
});

test("invalid power satisfaction is rejected deterministically", () => {
  const factory = new HeadlessFactory({
    machines: [{ id: "miner", recipe: recipe("mine_iron_ore") }],
    storages: [],
    links: [],
    machineSpeed: () => 1.01,
  });
  assert.throws(() => factory.advance(0.05), /between 0 and 1/);
});
