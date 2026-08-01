import assert from "node:assert/strict";
import test from "node:test";
import { FactorySimulation } from "../../app/game/simulation.ts";
import {
  factoryRuntimeSaveCodec,
  isFactoryRuntimeSnapshot,
  type FactoryRuntimeSnapshot,
} from "../../app/game/visualPersistence.ts";

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
