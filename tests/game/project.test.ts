import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE_ONE_PROJECT_ID,
  ProjectStageTracker,
  createPhaseOneProject,
} from "../../app/game/sim/project.ts";
import { START_REGISTRY } from "../../app/game/data/index.ts";

test("loads the phase one port contracts from START_PROJECT_STAGES", () => {
  const project = createPhaseOneProject();
  assert.equal(project.definition, START_REGISTRY.projectStages.get(PHASE_ONE_PROJECT_ID));
  assert.deepEqual(project.progress().deliveries.map(({ portId, itemId, required }) => ({ portId, itemId, required })), [
    { portId: "phase1_plate_in", itemId: "iron_plate", required: 120 },
    { portId: "phase1_block_in", itemId: "construction_block", required: 80 },
    { portId: "phase1_fastener_in", itemId: "fastener_pack", required: 40 },
  ]);
});

test("accepts partial deliveries and reports weighted total progress", () => {
  const project = createPhaseOneProject();
  assert.deepEqual(project.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 60 }), {
    accepted: true,
    portId: "phase1_plate_in",
    itemId: "iron_plate",
    amount: 60,
    remaining: 60,
    completed: false,
  });
  const progress = project.progress();
  assert.equal(progress.deliveredTotal, 60);
  assert.equal(progress.requiredTotal, 240);
  assert.equal(progress.totalProgress, 0.25);
  assert.equal(progress.completed, false);
});

test("rejects an unknown port, wrong item, invalid amount, and excess atomically", () => {
  const project = createPhaseOneProject();
  const before = project.snapshot();
  assert.equal(project.deliver({ portId: "missing", itemId: "iron_plate", amount: 1 }).reason, "unknown_port");
  assert.equal(project.deliver({ portId: "phase1_plate_in", itemId: "construction_block", amount: 1 }).reason, "item_mismatch");
  assert.equal(project.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 0 }).reason, "invalid_amount");
  assert.equal(project.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 121 }).reason, "exceeds_requirement");
  assert.deepEqual(project.snapshot(), before);
});

test("completes only when every delivery contract is full", () => {
  const project = createPhaseOneProject();
  project.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 120 });
  project.deliver({ portId: "phase1_block_in", itemId: "construction_block", amount: 80 });
  const final = project.deliver({ portId: "phase1_fastener_in", itemId: "fastener_pack", amount: 40 });

  assert.equal(final.accepted, true);
  assert.equal(final.completed, true);
  assert.equal(project.progress().totalProgress, 1);
  assert.equal(project.progress().completed, true);
  assert.equal(project.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 1 }).reason, "stage_complete");
});

test("snapshot restore preserves cumulative progress and definition order", () => {
  const original = createPhaseOneProject();
  original.deliver({ portId: "phase1_block_in", itemId: "construction_block", amount: 23 });
  original.deliver({ portId: "phase1_plate_in", itemId: "iron_plate", amount: 11 });

  const restored = createPhaseOneProject(structuredClone(original.snapshot()));
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(restored.progress(), original.progress());
  assert.deepEqual(restored.progress().deliveries.map(({ portId }) => portId), [
    "phase1_plate_in", "phase1_block_in", "phase1_fastener_in",
  ]);
});

test("restore rejects corrupt or cross-stage snapshots", () => {
  const definition = START_REGISTRY.projectStages.get(PHASE_ONE_PROJECT_ID)!;
  assert.throws(() => new ProjectStageTracker(definition, {
    stageId: "wrong_stage",
    delivered: [],
  }), /stage id does not match/);
  assert.throws(() => createPhaseOneProject({
    stageId: PHASE_ONE_PROJECT_ID,
    delivered: [{ portId: "phase1_plate_in", itemId: "iron_plate", amount: 121 }],
  }), /invalid project snapshot amount/);
});

