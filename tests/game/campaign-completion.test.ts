import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { CampaignWorldRuntime } from "../../app/game/sim/campaignWorld.ts";
import { ProjectDockDeliveryCommitter } from "../../app/game/sim/projectDockCommitter.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

test("the complete registered campaign can advance through the AX-17 colony seed using the physical dock", () => {
  const campaign = new CampaignWorldRuntime({
    registry: START_REGISTRY,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
  });
  const production = new WorldProductionSimulation(campaign.world);
  const committer = new ProjectDockDeliveryCommitter(campaign, production, 60);
  const dock = campaign.world.allInstances().find(({ definitionId }) => definitionId === "project_dock");
  assert.ok(dock);
  if (!dock) return;

  for (const stage of START_REGISTRY.projectStages.values()) {
    assert.equal(campaign.campaign.isUnlocked(stage.id), true, `${stage.id} must unlock in sequence`);
    campaign.setDockSuppliedPowerMW(stage.dockPowerMode === "powered" ? stage.requiredPowerMW ?? 32 : 0);
    for (const delivery of stage.deliveries.filter(({ medium }) => medium === "solid")) {
      assert.equal(
        production.deposit(dock.id, delivery.portId, "input", delivery.itemId, delivery.amount),
        true,
        `${stage.id}/${delivery.portId} must fit the dock input contract`,
      );
    }
    const fluids = stage.deliveries.filter(({ medium }) => medium === "fluid");
    let result = fluids.length === 0 ? committer.advanceFixedTick(1) : null;
    for (const delivery of fluids) {
      let remaining = delivery.amount;
      const capacity = production.nodeState(dock.id)?.inputs.find(({ portId }) => portId === delivery.portId)?.capacity ?? 0;
      assert.ok(capacity > 0);
      while (remaining > 0) {
        const amount = Math.min(remaining, capacity);
        assert.equal(production.deposit(dock.id, delivery.portId, "input", delivery.itemId, amount), true);
        result = committer.advanceFixedTick(amount);
        remaining -= amount;
      }
    }
    assert.ok(result);
    if (!result) return;
    assert.equal(result.stageId, stage.id);
    assert.equal(campaign.campaign.progress(stage.id)?.completed, true, `${stage.id} must complete atomically`);
  }

  assert.equal(campaign.campaign.allProgress().every(({ completed }) => completed), true);
  assert.equal(campaign.isItemUnlocked("colony_seed_ax17"), true);
  assert.equal(campaign.world.isUnlockActive("thermal_verified"), true);
});
