import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT, TerrainSampler } from "../../app/game/environment/index.ts";
import { IRONWIND_PEDESTRIAN_SHORTCUT, IRONWIND_TOPOGRAPHY, sampleIronwindTopography } from "../../app/game/environment/data/ironwindTopography.ts";
import { resolveTerrainMovement } from "../../app/game/environment/collision/TerrainCollision.ts";

test("Ironwind has a readable 20-25 metre fault between construction terraces", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const lower = sampler.heightAt(34, -48);
  const upper = sampler.heightAt(80, -48);
  assert.ok(upper - lower >= 20 && upper - lower <= 25, `unexpected fault relief: ${upper - lower}m`);
  assert.ok(sampler.sample(34, -48).slopeDegrees < 8, "lower factory terrace must stay flat");
  assert.ok(sampler.sample(80, -48).slopeDegrees < 8, "upper factory terrace must stay flat");
  assert.ok(sampler.sample(52, -10).slopeDegrees > 45, "fault wall must read as a real cliff away from the authored crossings");
});

test("Ironwind has a narrow traversable pedestrian shortcut across the fault", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const start = IRONWIND_PEDESTRIAN_SHORTCUT[0];
  const finalFrom = IRONWIND_PEDESTRIAN_SHORTCUT[1];
  const finalTo = IRONWIND_PEDESTRIAN_SHORTCUT[2];
  const finalDx = finalTo.x - finalFrom.x;
  const finalDz = finalTo.z - finalFrom.z;
  const finalLength = Math.hypot(finalDx, finalDz);
  const finalMidpoint = { x: (finalFrom.x + finalTo.x) * 0.5, z: (finalFrom.z + finalTo.z) * 0.5 };
  const outsideShortcut = { x: finalMidpoint.x - finalDz / finalLength * 2, z: finalMidpoint.z + finalDx / finalLength * 2 };
  assert.ok(sampler.accessRouteAt(start.x, start.z));
  assert.equal(sampler.accessRouteAt(outsideShortcut.x, outsideShortcut.z), null, "shortcut should remain three metres wide");
  let position = { ...start };
  IRONWIND_PEDESTRIAN_SHORTCUT.slice(1).forEach((to) => {
    const from = position;
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    for (let step = 1; step <= Math.ceil(distance); step += 1) {
      const progress = Math.min(1, step / Math.ceil(distance));
      const desired = { x: from.x + (to.x - from.x) * progress, z: from.z + (to.z - from.z) * progress };
      const result = resolveTerrainMovement(sampler, position, desired);
      assert.equal(result.blocked, false, `pedestrian shortcut blocked near ${desired.x},${desired.z}`);
      position = result.position;
    }
  });
});

test("Ironwind macro topology is deterministic and fades into surrounding terrain", () => {
  assert.deepEqual(sampleIronwindTopography(72, -48, 4), sampleIronwindTopography(72, -48, 4));
  assert.equal(sampleIronwindTopography(-20, 80, 3).height, 3);
  assert.equal(sampleIronwindTopography(-20, 80, 3).region, "outside");
});

test("the coal approach is a 10 metre vehicle corridor and remains traversable", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  assert.equal(IRONWIND_TOPOGRAPHY.vehicleCorridorWidth, 10);
  const segmentFrom = { x: 38, z: -25 };
  const segmentTo = { x: 69, z: -53 };
  const dx = segmentTo.x - segmentFrom.x;
  const dz = segmentTo.z - segmentFrom.z;
  const length = Math.hypot(dx, dz);
  const midpoint = { x: (segmentFrom.x + segmentTo.x) * 0.5, z: (segmentFrom.z + segmentTo.z) * 0.5 };
  const fourMetresOffCenter = { x: midpoint.x - dz / length * 4, z: midpoint.z + dx / length * 4 };
  const sixMetresOffCenter = { x: midpoint.x - dz / length * 6, z: midpoint.z + dx / length * 6 };
  assert.ok(sampler.accessRouteAt(fourMetresOffCenter.x, fourMetresOffCenter.z));
  assert.equal(sampler.accessRouteAt(sixMetresOffCenter.x, sixMetresOffCenter.z), null);

  let position = { ...segmentFrom };
  for (let step = 1; step <= Math.ceil(length); step += 1) {
    const progress = Math.min(1, step / Math.ceil(length));
    const desired = { x: segmentFrom.x + dx * progress, z: segmentFrom.z + dz * progress };
    const result = resolveTerrainMovement(sampler, position, desired);
    assert.equal(result.blocked, false, `vehicle corridor blocked near ${desired.x},${desired.z}`);
    position = result.position;
  }
});
