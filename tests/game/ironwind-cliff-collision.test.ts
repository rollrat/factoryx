import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT, TerrainSampler, resolveTerrainMovement } from "../../app/game/environment/index.ts";
import { IRONWIND_CLIFF_PLACEMENTS } from "../../app/game/environment/data/ironwindCliffPlacements.ts";
import {
  IRONWIND_CLIFF_COLLISION,
  cliffMovementBlocked,
  createIronwindCliffCollision,
} from "../../app/game/environment/collision/IronwindCliffCollision.ts";

test("validated GLB wall metadata produces stable straight, corner, and arch colliders", () => {
  assert.deepEqual(createIronwindCliffCollision(), createIronwindCliffCollision());
  assert.ok(IRONWIND_CLIFF_COLLISION.colliders.every(({ collisionNode }) => collisionNode === "COL_WALL"));
  assert.equal(IRONWIND_CLIFF_COLLISION.passages.length, 1);
  assert.equal(new Set(IRONWIND_CLIFF_COLLISION.colliders.map(({ id }) => id)).size, IRONWIND_CLIFF_COLLISION.colliders.length);
});

test("straight cliff walls block crossing but allow parallel wall sliding and traversal on top", () => {
  const straight = IRONWIND_CLIFF_PLACEMENTS.find(({ id }) => id === "ironwind-cliff:straight:01")!;
  const collider = IRONWIND_CLIFF_COLLISION.colliders.find(({ placementId }) => placementId === straight.id)!;
  const normal = { x: Math.sin(collider.rotation), z: Math.cos(collider.rotation) };
  const tangent = { x: Math.cos(collider.rotation), z: -Math.sin(collider.rotation) };
  const lowerY = collider.minY + 0.2;
  const acrossFrom = { x: collider.center.x - normal.x * 5, z: collider.center.z - normal.z * 5 };
  const acrossTo = { x: collider.center.x + normal.x * 5, z: collider.center.z + normal.z * 5 };
  assert.equal(cliffMovementBlocked(acrossFrom, acrossTo, lowerY, lowerY), true);
  const slideFrom = { x: collider.center.x - normal.x * (collider.halfExtents.z + 0.8), z: collider.center.z - normal.z * (collider.halfExtents.z + 0.8) };
  const slideTo = { x: slideFrom.x + tangent.x * 3, z: slideFrom.z + tangent.z * 3 };
  assert.equal(cliffMovementBlocked(slideFrom, slideTo, lowerY, lowerY), false);
  assert.equal(cliffMovementBlocked(acrossFrom, acrossTo, collider.maxY + 0.2, collider.maxY + 0.2), false);
});

test("natural arch passage clears the ten metre road while its buttresses remain solid", () => {
  const arch = IRONWIND_CLIFF_PLACEMENTS.find(({ assetId }) => assetId === "ironwind_natural_arch")!;
  const passage = IRONWIND_CLIFF_COLLISION.passages[0];
  const forward = { x: Math.sin(passage.heading), z: Math.cos(passage.heading) };
  const across = { x: Math.cos(passage.heading), z: -Math.sin(passage.heading) };
  const roadFrom = { x: passage.center.x - forward.x * 12, z: passage.center.z - forward.z * 12 };
  const roadTo = { x: passage.center.x + forward.x * 12, z: passage.center.z + forward.z * 12 };
  assert.equal(cliffMovementBlocked(roadFrom, roadTo, arch.transform.position.y, arch.transform.position.y), false);
  const buttressFrom = { x: passage.center.x + across.x * 6 - forward.x * 4, z: passage.center.z + across.z * 6 - forward.z * 4 };
  const buttressTo = { x: passage.center.x + across.x * 6 + forward.x * 4, z: passage.center.z + across.z * 6 + forward.z * 4 };
  assert.equal(cliffMovementBlocked(buttressFrom, buttressTo, arch.transform.position.y, arch.transform.position.y), true);
});

test("terrain movement keeps authored crossings open and blocks an un-authored cliff approach", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const routeStart = { x: 45, z: -31.3 };
  const routeEnd = { x: 45.5, z: -31.8 };
  assert.ok(sampler.accessRouteAt(routeStart.x, routeStart.z));
  assert.equal(resolveTerrainMovement(sampler, routeStart, routeEnd).blocked, false);

  const blocked = resolveTerrainMovement(sampler, { x: 42, z: -72 }, { x: 47, z: -72 });
  assert.equal(blocked.blocked, true);
});
