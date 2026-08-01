import assert from "node:assert/strict";
import test from "node:test";

import type { RecipeDefinition } from "../../app/game/domain/types.ts";
import { FixedStepClock } from "../../app/game/sim/clock.ts";
import { PortInventory } from "../../app/game/sim/inventory.ts";
import { RecipeProcess } from "../../app/game/sim/process.ts";

const recipe: RecipeDefinition = {
  id: "test_plate",
  name: "Test plate",
  buildingId: "test_smelter",
  inputs: [{ itemId: "ore", amount: 2, portId: "input" }],
  outputs: [{ itemId: "plate", amount: 1, portId: "output", role: "primary" }],
  durationSeconds: 1,
  unlockId: "start",
};

const runClock = (framesPerSecond: number, seconds: number) => {
  const clock = new FixedStepClock();
  const observedTicks: number[] = [];
  const frameDelta = 1 / framesPerSecond;
  for (let frame = 0; frame < framesPerSecond * seconds; frame += 1) {
    clock.advance(frameDelta, (tick, fixedDelta) => {
      assert.equal(fixedDelta, 1 / 20);
      observedTicks.push(tick);
    });
  }
  return { snapshot: clock.snapshot(), observedTicks };
};

test("fixed clock produces the same simulation ticks at different render FPS", () => {
  const at30Fps = runClock(30, 10);
  const at144Fps = runClock(144, 10);

  assert.equal(at30Fps.snapshot.tick, 200);
  assert.equal(at144Fps.snapshot.tick, at30Fps.snapshot.tick);
  assert.equal(at144Fps.snapshot.elapsedSeconds, at30Fps.snapshot.elapsedSeconds);
  assert.ok(Math.abs(at30Fps.snapshot.accumulatorSeconds) < 1e-12);
  assert.ok(Math.abs(at144Fps.snapshot.accumulatorSeconds) < 1e-12);
  assert.deepEqual(at144Fps.observedTicks, at30Fps.observedTicks);
});

test("process snapshot preserves consumed inputs as WIP across restore", () => {
  const input = new PortInventory("input", 4, { itemId: "ore", amount: 2 });
  const output = new PortInventory("output", 2);
  const inputs = new Map([[input.portId, input]]);
  const outputs = new Map([[output.portId, output]]);
  const process = new RecipeProcess(recipe);

  const beforeSave = process.step(inputs, outputs, { deltaSeconds: 0.4 });
  assert.equal(input.amount, 0);
  assert.equal(beforeSave.runtimeState, "working");
  assert.deepEqual(beforeSave.workInProgress?.inputs, [{ itemId: "ore", amount: 2 }]);

  const restored = new RecipeProcess(recipe, structuredClone(beforeSave));
  const afterLoad = restored.step(inputs, outputs, { deltaSeconds: 0.6 });
  assert.equal(afterLoad.completedCycles, 1);
  assert.equal(afterLoad.workInProgress, null);
  assert.equal(output.amount, 1);
  assert.equal(output.itemId, "plate");
});

test("completed WIP blocks without loss and resumes once output has capacity", () => {
  const input = new PortInventory("input", 4, { itemId: "ore", amount: 2 });
  const output = new PortInventory("output", 1, { itemId: "plate", amount: 1 });
  const process = new RecipeProcess(recipe);
  const inputs = new Map([[input.portId, input]]);
  const outputs = new Map([[output.portId, output]]);

  const blocked = process.step(inputs, outputs, { deltaSeconds: 1 });
  assert.equal(blocked.runtimeState, "blocked");
  assert.equal(blocked.workInProgress?.completed, true);
  assert.equal(blocked.completedCycles, 0);
  assert.equal(input.amount, 0);
  assert.equal(output.amount, 1);

  assert.equal(output.withdraw("plate", 1), true);
  const resumed = process.step(inputs, outputs, { deltaSeconds: 1 / 20 });
  assert.equal(resumed.runtimeState, "idle");
  assert.equal(resumed.workInProgress, null);
  assert.equal(resumed.completedCycles, 1);
  assert.equal(output.amount, 1);
  assert.equal(output.itemId, "plate");
});
