import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import type { ProjectStageId } from "../../app/game/domain/types.ts";
import { CampaignProjectTracker } from "../../app/game/sim/campaign.ts";

const STAGE_ORDER = [
  "phase_1_settlement_package",
  "phase_2_industrial_power_node",
  "phase_3_automation_core",
  "phase_4_chemistry_stabilization",
  "phase_4_thermal_management_verification",
  "phase_4_colony_seed",
] as const satisfies readonly ProjectStageId[];

const completeStage = (
  campaign: CampaignProjectTracker,
  stageId: ProjectStageId,
  suppliedPowerMW = 32,
) => {
  const definition = START_REGISTRY.projectStages.get(stageId);
  assert.ok(definition, `missing campaign stage: ${stageId}`);
  definition.deliveries.forEach(({ portId, itemId, amount }) => {
    const result = campaign.deliver(stageId, { portId, itemId, amount }, suppliedPowerMW);
    assert.equal(result.accepted, true, `${stageId}.${portId} should accept its full contract amount`);
  });
  assert.equal(campaign.progress(stageId)?.completed, true);
};

test("registered campaign stages preserve the document progression order", () => {
  assert.deepEqual([...START_REGISTRY.projectStages.keys()], STAGE_ORDER);

  const campaign = new CampaignProjectTracker(START_REGISTRY);
  assert.deepEqual(campaign.allProgress().map(({ stageId }) => stageId), STAGE_ORDER);
  assert.equal(campaign.isUnlocked(STAGE_ORDER[0]), true);
  STAGE_ORDER.slice(1).forEach((stageId) => assert.equal(campaign.isUnlocked(stageId), false));
});

test("completing each prerequisite unlocks only the next campaign stage", () => {
  const campaign = new CampaignProjectTracker(START_REGISTRY);

  for (let index = 0; index < STAGE_ORDER.length - 1; index += 1) {
    const current = STAGE_ORDER[index];
    const next = STAGE_ORDER[index + 1];
    const nextDefinition = START_REGISTRY.projectStages.get(next)!;
    const nextDelivery = nextDefinition.deliveries[0];

    const locked = campaign.deliver(next, {
      portId: nextDelivery.portId,
      itemId: nextDelivery.itemId,
      amount: nextDelivery.amount,
    }, 32);
    assert.equal(locked.accepted, false);
    assert.equal(locked.reason, "stage_locked");

    completeStage(campaign, current);
    assert.equal(campaign.isUnlocked(next), true);
    STAGE_ORDER.slice(index + 2).forEach((stageId) => {
      assert.equal(campaign.isUnlocked(stageId), false, `${stageId} unlocked before its prerequisite`);
    });
  }
});

test("powered project stages require the full 32 MW before committing delivery", () => {
  const campaign = new CampaignProjectTracker(START_REGISTRY);
  completeStage(campaign, STAGE_ORDER[0]);
  completeStage(campaign, STAGE_ORDER[1]);

  const stageId = "phase_3_automation_core";
  const delivery = START_REGISTRY.projectStages.get(stageId)!.deliveries[0];
  const before = campaign.snapshot();
  const underpowered = campaign.deliver(stageId, {
    portId: delivery.portId,
    itemId: delivery.itemId,
    amount: delivery.amount,
  }, 31.999);

  assert.deepEqual(underpowered, {
    accepted: false,
    reason: "power_insufficient",
    portId: delivery.portId,
    requiredPowerMW: 32,
  });
  assert.deepEqual(campaign.snapshot(), before, "an underpowered attempt must not commit progress");

  const powered = campaign.deliver(stageId, {
    portId: delivery.portId,
    itemId: delivery.itemId,
    amount: delivery.amount,
  }, 32);
  assert.equal(powered.accepted, true);
  assert.equal(campaign.progress(stageId)?.completed, true);
});

test("campaign snapshot and restore preserve progress, ordering, and unlock state", () => {
  const original = new CampaignProjectTracker(START_REGISTRY);
  completeStage(original, STAGE_ORDER[0]);
  const phaseTwo = START_REGISTRY.projectStages.get(STAGE_ORDER[1])!;
  const partial = phaseTwo.deliveries[0];
  const result = original.deliver(STAGE_ORDER[1], {
    portId: partial.portId,
    itemId: partial.itemId,
    amount: partial.amount / 2,
  });
  assert.equal(result.accepted, true);

  const snapshot = structuredClone(original.snapshot());
  const restored = new CampaignProjectTracker(START_REGISTRY, snapshot);

  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(restored.allProgress(), original.allProgress());
  assert.deepEqual(restored.allProgress().map(({ stageId }) => stageId), STAGE_ORDER);
  assert.equal(restored.isUnlocked(STAGE_ORDER[1]), true);
  assert.equal(restored.isUnlocked(STAGE_ORDER[2]), false);
});

test("campaign restore rejects unsupported, duplicate, and unknown stage snapshots", () => {
  const campaign = new CampaignProjectTracker(START_REGISTRY);
  const snapshot = campaign.snapshot();

  assert.throws(() => new CampaignProjectTracker(START_REGISTRY, {
    ...snapshot,
    version: 2,
  } as never), /unsupported campaign snapshot version/);
  assert.throws(() => new CampaignProjectTracker(START_REGISTRY, {
    version: 1,
    stages: [snapshot.stages[0], snapshot.stages[0]],
  }), /duplicate campaign stage snapshot/);
  assert.throws(() => new CampaignProjectTracker(START_REGISTRY, {
    version: 1,
    stages: [{ stageId: "missing_stage", delivered: [] }],
  }), /unknown campaign stage snapshot/);
});
