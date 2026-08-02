import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { WaterSourceRenderer } from "../../app/game/environment/render/WaterSourceRenderer.ts";
import { IRONWIND_WORLD_SOURCE_V3, type WorldSourceV3 } from "../../app/game/environment/worldSourceV3/index.ts";

const completeWaterSource = (): WorldSourceV3 => ({
  ...IRONWIND_WORLD_SOURCE_V3,
  splines: [
    ...IRONWIND_WORLD_SOURCE_V3.splines,
    {
      id: "render-falls-upper", kind: "river", priority: 90, operation: "carve", stratumId: "surface", width: 3,
      maxGradeDegrees: 80, minTurnRadius: 1,
      controlPoints: [{ x: -40, y: 20, z: 80 }, { x: -40, y: 20, z: 80 }],
    },
    {
      id: "render-falls-lower", kind: "river", priority: 90, operation: "carve", stratumId: "surface", width: 3,
      maxGradeDegrees: 80, minTurnRadius: 1,
      controlPoints: [{ x: -40, y: 5, z: 80 }, { x: -40, y: 5, z: 80 }],
    },
  ],
  waterBodies: [
    ...IRONWIND_WORLD_SOURCE_V3.waterBodies,
    {
      id: "render-lake", kind: "lake", priority: 60,
      polygon: [{ x: -20, z: 50 }, { x: -4, z: 50 }, { x: -4, z: 66 }, { x: -20, z: 66 }], holes: [], level: 5,
    },
    { id: "render-falls", kind: "waterfall", priority: 80, fromSocket: "render-falls-upper:end", toSocket: "render-falls-lower:start", width: 3 },
  ],
}) as WorldSourceV3;

test("source water renderer creates deterministic per-body surfaces and exact shoreline cues", () => {
  const source = completeWaterSource();
  const before = structuredClone(source);
  const first = new WaterSourceRenderer(source);
  const second = new WaterSourceRenderer(source);
  assert.equal(first.waterBodyCount(), 4);
  assert.equal(first.shorelineCueCount(), 6, "marsh + lake + two river banks + two waterfall edges");
  assert.deepEqual(
    first.waterSurfaces.map((mesh) => [mesh.name, (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array]),
    second.waterSurfaces.map((mesh) => [mesh.name, (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array]),
  );
  assert.ok(first.root.getObjectByName("water-surface:render-lake"));
  assert.ok(first.root.getObjectByName("water-surface:render-falls"));
  const falls = first.root.getObjectByName("water-surface:render-falls") as THREE.Mesh;
  const fallPositions = falls.geometry.getAttribute("position") as THREE.BufferAttribute;
  assert.notEqual(fallPositions.getY(0), fallPositions.getY(fallPositions.count - 1), "waterfall must retain authored vertical fall");
  assert.deepEqual(source, before);
  first.dispose();
  second.dispose();
});

test("source water renderer has zero water objects when no source is supplied", () => {
  const renderer = new WaterSourceRenderer(null);
  assert.equal(renderer.waterBodyCount(), 0);
  assert.equal(renderer.shorelineCueCount(), 0);
  assert.equal(renderer.root.children.length, 0);
  renderer.dispose();
});
