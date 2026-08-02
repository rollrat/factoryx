import assert from "node:assert/strict";
import test from "node:test";

import { WorldWaterSampler } from "../../app/game/environment/water/index.ts";
import { IRONWIND_WORLD_SOURCE_V3, parseWorldSourceV3, type WorldSourceV3 } from "../../app/game/environment/worldSourceV3/index.ts";

const waterFixture = (): WorldSourceV3 => ({
  ...IRONWIND_WORLD_SOURCE_V3,
  splines: [
    ...IRONWIND_WORLD_SOURCE_V3.splines,
    {
      id: "lake-service-road", kind: "route", priority: 90, operation: "flatten", stratumId: "surface", width: 2,
      maxGradeDegrees: 6, minTurnRadius: 4,
      controlPoints: [{ x: -20, y: 5, z: 55 }, { x: -4, y: 5, z: 55 }],
    },
  ],
  placements: [
    ...IRONWIND_WORLD_SOURCE_V3.placements,
    {
      id: "falls-upper", assetId: "waterfall_socket_marker", priority: 90, stratumId: "surface", biomeId: "windglass_basin",
      transform: { position: { x: -40, y: 20, z: 80 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
      tags: ["water-socket"],
    },
    {
      id: "falls-lower", assetId: "waterfall_socket_marker", priority: 91, stratumId: "surface", biomeId: "windglass_basin",
      transform: { position: { x: -40, y: 5, z: 80 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
      tags: ["water-socket"],
    },
  ],
  waterBodies: [
    ...IRONWIND_WORLD_SOURCE_V3.waterBodies,
    {
      id: "inspection-lake", kind: "lake", priority: 60,
      polygon: [{ x: -20, z: 50 }, { x: -4, z: 50 }, { x: -4, z: 66 }, { x: -20, z: 66 }], holes: [], level: 5,
    },
    { id: "inspection-falls", kind: "waterfall", priority: 80, fromSocket: "falls-upper", toSocket: "falls-lower", width: 3 },
  ],
  resourceAnchors: [
    ...IRONWIND_WORLD_SOURCE_V3.resourceAnchors,
    {
      id: "lake-resource-pad", itemId: "test", position: { x: -15, y: 5, z: 60 }, extractionBuildingId: "test",
      recipeId: "test", unlockId: "test", medium: "solid", stratumId: "surface", padRadius: 1.5, protectionRadius: 2,
    },
  ],
}) as WorldSourceV3;

test("WorldWaterSampler deterministically samples every authored water kind", () => {
  const source = waterFixture();
  assert.doesNotThrow(() => parseWorldSourceV3(source));
  const before = structuredClone(source);
  const first = new WorldWaterSampler(source);
  const second = new WorldWaterSampler(source);
  const points = [
    { x: -10, z: 60 }, // lake
    { x: 60, z: 50 }, // marsh
    { x: 84, z: 72 }, // river
    { x: -40, z: 80 }, // waterfall
  ];

  assert.deepEqual(points.map(({ x, z }) => first.sample(x, z)), points.map(({ x, z }) => second.sample(x, z)));
  assert.deepEqual(source, before);
  assert.equal(first.sample(-10, 60)?.kind, "lake");
  assert.equal(first.sample(60, 50)?.kind, "marsh");
  const river = first.sample(84, 72);
  assert.equal(river?.kind, "river");
  assert.ok((river?.flowDirection.x ?? 0) > 0 && (river?.flowDirection.z ?? 0) > 0);
  assert.ok((river?.depth ?? 0) > 0);
  const falls = first.sample(-40, 80);
  assert.equal(falls?.kind, "waterfall");
  assert.ok((falls?.flowDirection.y ?? 0) < 0);
  assert.ok((falls?.flowSpeed ?? 0) > 1);
});

test("WorldWaterSampler preserves exact shoreline continuity and dry infrastructure", () => {
  const sampler = new WorldWaterSampler(waterFixture());
  const lakeRibbon = sampler.shorelineRibbons().find((ribbon) => ribbon.waterBodyId === "inspection-lake");
  assert.ok(lakeRibbon);
  assert.deepEqual(lakeRibbon.points[0], lakeRibbon.points[lakeRibbon.points.length - 1]);
  assert.equal(lakeRibbon.points.length, 5);
  assert.ok((sampler.sample(-10, 60)?.shorelineDistance ?? 0) > 0);

  assert.equal(sampler.sample(-10, 55), null, "surface route must remain dry");
  assert.equal(sampler.sample(-15, 60), null, "surface resource pad must remain dry");
  assert.equal(sampler.sample(-21, 60), null, "water must not leak beyond its authored shoreline");
});
