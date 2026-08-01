import assert from "node:assert/strict";
import test from "node:test";
import { FactorySimulation } from "../../app/game/simulation.ts";
import {
  factoryRuntimeSaveCodec,
  isFactoryRuntimeSnapshot,
  type FactoryRuntimeSnapshot,
} from "../../app/game/visualPersistence.ts";
import { CampaignWorldRuntime } from "../../app/game/sim/campaignWorld.ts";
import { START_REGISTRY } from "../../app/game/data/index.ts";
import { CAMPAIGN_START_INVENTORY } from "../../app/game/data/campaign.ts";

const snapshot = (): FactoryRuntimeSnapshot => ({
  version: 1,
  simulation: new FactorySimulation().snapshot(),
  credits: 1200,
  nextId: 1,
  cameraMode: "overview",
  cameraAngle: Math.PI / 4,
  cameraZoom: 1,
  cameraTarget: [0, 0, 0],
  playerPosition: [0, 1.62, 5.5],
  firstPersonYaw: 0,
  firstPersonPitch: -0.08,
});

test("visual runtime save round-trips the exact simulation and camera state", () => {
  const original = snapshot();
  const decoded = factoryRuntimeSaveCodec.decode(factoryRuntimeSaveCodec.encode(original, { nowMs: 12 }));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value.snapshot, original);
});

test("visual runtime save rejects malformed or non-finite state", () => {
  assert.equal(isFactoryRuntimeSnapshot({ ...snapshot(), cameraZoom: Number.NaN }), false);
  assert.equal(isFactoryRuntimeSnapshot({ ...snapshot(), credits: -1 }), false);
  assert.equal(isFactoryRuntimeSnapshot({ ...snapshot(), extra: true }), false);
});

test("visual runtime save preserves the integrated world, campaign, and power snapshot", () => {
  const original = snapshot();
  const campaignWorld = new CampaignWorldRuntime({
    registry: START_REGISTRY,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    constructionInventory: CAMPAIGN_START_INVENTORY,
  });
  campaignWorld.stepPower(1);
  const integrated = {
    ...original,
    world: campaignWorld.world.snapshot(),
    campaignWorld: campaignWorld.snapshot(),
  };
  const decoded = factoryRuntimeSaveCodec.decode(factoryRuntimeSaveCodec.encode(integrated, { nowMs: 20 }));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value.snapshot, integrated);
});
