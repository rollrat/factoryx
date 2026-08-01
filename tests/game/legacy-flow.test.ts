import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import type { StructureData } from "../../app/game/types.ts";

const seed: Array<Omit<StructureData, "id">> = [
  { type: "miner", x: -8, z: -3, rotation: 0 },
  { type: "belt", x: -6, z: -3, rotation: 1 },
  { type: "belt", x: -5, z: -3, rotation: 1 },
  { type: "belt", x: -4, z: -3, rotation: 1 },
  { type: "belt", x: -3, z: -3, rotation: 1 },
  { type: "smelter", x: -2, z: -3, rotation: 0 },
  { type: "belt", x: 0, z: -3, rotation: 1 },
  { type: "belt", x: 1, z: -3, rotation: 1 },
  { type: "assembler", x: 2, z: -3, rotation: 0 },
  { type: "belt", x: 4, z: -3, rotation: 1 },
  { type: "storage", x: 5, z: -3, rotation: 0 },
];

const run = (fps: number, seconds: number) => {
  const simulation = new FactorySimulation();
  seed.forEach((structure, index) => simulation.addStructure({ ...structure, id: index + 1 }));
  for (let frame = 0; frame < fps * seconds; frame += 1) simulation.update(1 / fps);
  return {
    stored: simulation.getStoredComponents(),
    machines: [...simulation.machines].map(([id, state]) => ({
      id,
      input: state.input,
      output: state.output,
      progress: state.progress,
      working: state.working,
      stored: state.stored,
    })),
    belts: [...simulation.beltItems].map(([beltId, item]) => ({
      beltId,
      type: item.type,
      progress: item.progress,
    })),
  };
};

test("the playable production line is deterministic across render frame rates", () => {
  const at30Fps = run(30, 60);
  const at144Fps = run(144, 60);

  assert.ok(at30Fps.stored > 0, "seeded line should deliver finished components");
  assert.deepEqual(at144Fps, at30Fps);
});
