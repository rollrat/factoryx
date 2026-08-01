import assert from "node:assert/strict";
import test from "node:test";

import { CAMPAIGN_START_INVENTORY } from "../../app/game/data/campaign.ts";
import { START_REGISTRY } from "../../app/game/data/index.ts";
import {
  CampaignUnlocks,
  ConstructionInventory,
  ConstructionService,
} from "../../app/game/sim/progression.ts";

test("campaign start inventory can bootstrap the first iron production line", () => {
  const inventory = new ConstructionInventory(CAMPAIGN_START_INVENTORY);
  const construction = new ConstructionService(START_REGISTRY, new CampaignUnlocks(), inventory);

  assert.equal(construction.construct("vein_miner").ok, true);
  assert.equal(construction.construct("arc_smelter").ok, true);
  assert.equal(construction.construct("hydraulic_former").ok, true);
  assert.equal(construction.construct("distribution_pole_mk1").ok, true);
  for (let segment = 0; segment < 12; segment += 1) {
    assert.equal(construction.construct("conveyor_mk1").ok, true);
  }
});

test("construction is atomic and respects campaign unlocks", () => {
  const inventory = new ConstructionInventory(CAMPAIGN_START_INVENTORY);
  const unlocks = new CampaignUnlocks();
  const construction = new ConstructionService(START_REGISTRY, unlocks, inventory);
  const before = inventory.snapshot();

  assert.deepEqual(construction.construct("alloy_furnace"), {
    ok: false,
    reason: "locked",
    buildingId: "alloy_furnace",
  });
  assert.deepEqual(inventory.snapshot(), before);

  unlocks.complete("phase_1_settlement_package");
  inventory.add("construction_block", 4);
  assert.equal(construction.construct("alloy_furnace").ok, true);
});

test("preplaced structures cannot be constructed or demolished", () => {
  const inventory = new ConstructionInventory(CAMPAIGN_START_INVENTORY);
  const construction = new ConstructionService(START_REGISTRY, new CampaignUnlocks("sandbox"), inventory);
  const before = inventory.snapshot();

  assert.equal(construction.construct("project_dock").ok, false);
  assert.equal(construction.demolish("field_power_core"), false);
  assert.deepEqual(inventory.snapshot(), before);
});

test("construction inventory snapshots preserve materials and starter credits", () => {
  const original = new ConstructionInventory(CAMPAIGN_START_INVENTORY);
  original.addConstructionCredits({ pipe_mk1_length_m: 48, pipe_pump: 1 });
  original.spendConstructionCredit("pipe_mk1_length_m", 12);

  const restored = new ConstructionInventory([], structuredClone(original.snapshot()));
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.creditAmount("pipe_mk1_length_m"), 36);
});
