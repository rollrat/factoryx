import assert from "node:assert/strict";
import test from "node:test";

import type { BuildingDefinition, DefinitionRegistry } from "../../app/game/domain/types.ts";
import {
  canPlayerOccupy,
  recoverPlayerStart,
  resolvePlayerMovement,
  WorldCollisionIndex,
} from "../../app/game/sim/firstPersonCollision.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const buildings = [
  {
    id: "project_dock",
    name: "Dock",
    unlockId: "start",
    placementMode: "preplaced_unique",
    footprint: { x: 2, z: 4 },
    allowedRotations: [1],
    ports: [],
    recipeIds: [],
    buildCost: [],
    preplacedPolicy: { worldAnchor: { x: 4, z: 4 }, fixedRotation: 1, canBuild: false, canClone: false, canDemolish: false },
  },
  {
    id: "machine",
    name: "Machine",
    unlockId: "start",
    placementMode: "buildable",
    footprint: { x: 2, z: 3 },
    allowedRotations: [0, 1, 2, 3],
    ports: [],
    recipeIds: [],
    buildCost: [],
  },
] as const satisfies readonly BuildingDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(), recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(),
};

const createWorld = () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 19, minZ: 0, maxZ: 19 } });
  const placed = world.place({ buildingId: "machine", position: { x: 10, z: 4 }, rotation: 1 });
  assert.equal(placed.ok, true);
  return world;
};

test("collision index includes preplaced structures and rotated footprint AABBs", () => {
  const index = new WorldCollisionIndex(createWorld(), 4);
  assert.deepEqual(index.obstacles.map(({ instanceId, preplaced, bounds }) => ({ instanceId, preplaced, bounds })), [
    { instanceId: "building-1", preplaced: false, bounds: { minX: 10, maxX: 13, minZ: 4, maxZ: 6 } },
    { instanceId: "preplaced:project_dock", preplaced: true, bounds: { minX: 4, maxX: 8, minZ: 4, maxZ: 6 } },
  ]);
  assert.equal(canPlayerOccupy(index, { x: 5, z: 5 }, 0.25), false);
  assert.equal(canPlayerOccupy(index, { x: 3.7, z: 5 }, 0.25), true);
});

test("axis sweeps stop tunnelling and preserve the free axis for sliding", () => {
  const index = new WorldCollisionIndex(createWorld());
  const movement = resolvePlayerMovement(index, { x: 2, z: 3.5 }, { x: 4, z: 2 }, 0.25);
  assert.deepEqual(movement.position, { x: 6, z: 3.75 });
  assert.deepEqual(movement.applied, { x: 4, z: 0.25 });
  assert.equal(movement.contacts.some(({ instanceId }) => instanceId === "preplaced:project_dock"), true);
  assert.equal(canPlayerOccupy(index, movement.position, 0.25), true);
});

test("world bounds clamp movement and report a boundary contact", () => {
  const index = new WorldCollisionIndex(createWorld());
  const movement = resolvePlayerMovement(index, { x: 15, z: 15 }, { x: 20, z: 0 }, 0.25);
  assert.equal(movement.position.x, 19.75);
  assert.deepEqual(movement.contacts, [{ kind: "world_boundary", normal: { x: -1, z: 0 } }]);
});

test("invalid saved starts are clamped or escaped to the nearest deterministic safe point", () => {
  const index = new WorldCollisionIndex(createWorld());
  assert.deepEqual(recoverPlayerStart(index, { x: -3, z: 10 }, 0.25), {
    position: { x: 0.25, z: 10 }, corrected: true, reason: "clamped_to_bounds",
  });
  const escaped = recoverPlayerStart(index, { x: 5, z: 5 }, 0.25);
  assert.equal(escaped.reason, "escaped_obstacle");
  assert.equal(escaped.corrected, true);
  assert.equal(canPlayerOccupy(index, escaped.position, 0.25), true);
});

test("movement rejects an invalid start so callers must run recovery after world changes", () => {
  const index = new WorldCollisionIndex(createWorld());
  assert.throws(() => resolvePlayerMovement(index, { x: 5, z: 5 }, { x: 1, z: 0 }, 0.25), /valid position/);
});
