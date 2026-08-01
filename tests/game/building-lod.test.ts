import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBuildingLods,
  createWorldBuildingLodSubjects,
  frustumPlanesFromMatrix,
  visibleBuildingLods,
  type BuildingLodSubject,
} from "../../app/game/models/buildingLod.ts";
import type { BuildingDefinition, DefinitionRegistry } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const subject = (instanceId: string, x: number, radius = 1): BuildingLodSubject => ({
  instanceId,
  definitionId: "machine",
  center: { x, y: 0, z: 0 },
  radius,
});

test("distance tiers use the documented 18m and 45m surface thresholds", () => {
  const decisions = classifyBuildingLods([
    subject("near", 10),
    subject("middle", 30),
    subject("far", 60),
  ], { x: 0, y: 0, z: 0 });
  assert.deepEqual(decisions.map(({ instanceId, detailTier, detail }) => [instanceId, detailTier, detail]), [
    ["near", 0, "full"],
    ["middle", 1, "operational"],
    ["far", 2, "silhouette"],
  ]);
});

test("frustum planes and max distance omit buildings before model detail work", () => {
  const decisions = classifyBuildingLods([
    subject("inside", 5),
    subject("behind", -5),
    subject("too-far", 80),
  ], { x: 0, y: 0, z: 0 }, {
    frustumPlanes: [{ normal: { x: 1, y: 0, z: 0 }, constant: 0 }],
    maxDistance: 70,
  });
  assert.equal(decisions.find(({ instanceId }) => instanceId === "behind")?.culledReason, "frustum");
  assert.equal(decisions.find(({ instanceId }) => instanceId === "too-far")?.culledReason, "distance");
  assert.deepEqual(visibleBuildingLods(decisions).map(({ instanceId }) => instanceId), ["inside"]);
});

test("identity projection-view matrix extracts the canonical clip-space frustum", () => {
  const planes = frustumPlanesFromMatrix([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const decisions = classifyBuildingLods([
    subject("inside", 0, 0.1),
    subject("outside", 2, 0.1),
  ], { x: 0, y: 0, z: 0 }, { frustumPlanes: planes });
  assert.equal(decisions[0].visible, true);
  assert.equal(decisions[1].culledReason, "frustum");
});

test("DataDrivenWorld instances produce rotation-aware conservative bounding spheres", () => {
  const dock: BuildingDefinition = {
    id: "project_dock", name: "Dock", unlockId: "start", placementMode: "preplaced_unique",
    footprint: { x: 2, z: 4 }, allowedRotations: [1], ports: [], recipeIds: [], buildCost: [],
    preplacedPolicy: { worldAnchor: { x: 4, z: 4 }, fixedRotation: 1, canBuild: false, canClone: false, canDemolish: false },
  };
  const registry: DefinitionRegistry = {
    items: new Map(), recipes: new Map(), buildings: new Map([[dock.id, dock]]), projectStages: new Map(),
  };
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 19, minZ: 0, maxZ: 19 } });
  const subjects = createWorldBuildingLodSubjects(world, () => 6);
  assert.deepEqual(subjects[0].center, { x: 6, y: 3, z: 5 });
  assert.equal(subjects[0].radius, Math.hypot(4, 6, 2) / 2);
});

test("invalid LOD thresholds and matrices fail fast", () => {
  assert.throws(() => classifyBuildingLods([], { x: 0, y: 0, z: 0 }, { nearDistance: 45, farDistance: 18 }), /LOD distances/);
  assert.throws(() => frustumPlanesFromMatrix([1, 2, 3]), /16 finite elements/);
});
