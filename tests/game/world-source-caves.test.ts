import assert from "node:assert/strict";
import test from "node:test";

import { IRONWIND_WORLD_SOURCE_V3, type WorldSourceV3 } from "../../app/game/environment/worldSourceV3/index.ts";
import { CaveRuntimeSampler, createCaveRuntimeView, safeCreateCaveRuntimeView } from "../../app/game/environment/worldSourceCaves/index.ts";

const approximate = (actual: number, expected: number, tolerance = 0.000001) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test("WorldSourceV3 cave adapter produces a deterministic room, portal, and corridor runtime view", () => {
  const before = structuredClone(IRONWIND_WORLD_SOURCE_V3);
  const first = createCaveRuntimeView(IRONWIND_WORLD_SOURCE_V3);
  const cave = IRONWIND_WORLD_SOURCE_V3.caves[0];
  const reordered = {
    ...IRONWIND_WORLD_SOURCE_V3,
    splines: [...IRONWIND_WORLD_SOURCE_V3.splines].reverse(),
    caves: [{ ...cave, rooms: [...cave.rooms].reverse(), portals: [...cave.portals].reverse(), corridors: [...cave.corridors].reverse() }],
  } satisfies WorldSourceV3;
  const second = createCaveRuntimeView(reordered);

  assert.deepEqual(first, second);
  assert.deepEqual(IRONWIND_WORLD_SOURCE_V3, before, "adapter must not mutate authored source data");
  const graph = first.graphs[0];
  assert.equal(graph.stratumId, "rift_depths");
  assert.deepEqual(graph.rooms.map(({ id }) => id), ["rift-entry-room", "rift-factory-room"]);
  assert.equal(graph.portals[0].roomId, "rift-entry-room");
  assert.equal(graph.portals[0].clearance, 11);
  assert.equal(graph.corridors[0].route[0].x, 12);
  assert.equal(graph.corridors[0].route.at(-1)?.z, 114);
  approximate(graph.corridors[0].maxRouteGradeDegrees, 14.714353588433495);
  assert.ok(graph.corridors[0].maxRouteGradeDegrees <= 15);
});

test("cave runtime sampler exposes source-only deterministic corridor routing and room clearance", () => {
  const view = createCaveRuntimeView(IRONWIND_WORLD_SOURCE_V3);
  const sampler = new CaveRuntimeSampler(view);
  const corridor = view.graphs[0].corridors[0];
  const start = sampler.routePosition(corridor.id, -10)!;
  const end = sampler.routePosition(corridor.id, Number.POSITIVE_INFINITY)!;
  const repeat = sampler.routePosition(corridor.id, corridor.routeLength * 0.5)!;

  assert.deepEqual(start, sampler.routePosition(corridor.id, 0));
  assert.equal(start.x, 12);
  assert.equal(start.y, -18);
  approximate(end.x, 4);
  approximate(end.y, -22);
  assert.ok(repeat.gradeDegrees > 0 && repeat.gradeDegrees <= 15);
  assert.deepEqual(sampler.sampleSpace(4, 116, "rift_depths"), {
    graphId: "thermal-rift-cave",
    roomId: "rift-factory-room",
    corridorId: null,
    floorHeight: -22,
    clearance: 13,
  });
  assert.equal(sampler.sampleSpace(70, 70, "rift_depths"), null);
  assert.equal(sampler.graphForStratum("surface"), null);
});

test("cave adapter rejects portal endpoints, disconnected rooms, and nondeterministic-grade source routes", () => {
  const cave = IRONWIND_WORLD_SOURCE_V3.caves[0];
  const portalOutsideRoom = {
    ...IRONWIND_WORLD_SOURCE_V3,
    caves: [{ ...cave, portals: cave.portals.map((portal) => ({ ...portal, position: { ...portal.position, x: 25 } })) }],
  } satisfies WorldSourceV3;
  const disconnected = {
    ...IRONWIND_WORLD_SOURCE_V3,
    caves: [{ ...cave, corridors: [] }],
  } satisfies WorldSourceV3;
  const excessiveGrade = {
    ...IRONWIND_WORLD_SOURCE_V3,
    splines: IRONWIND_WORLD_SOURCE_V3.splines.map((spline) => spline.id === "rift-gallery-to-factory"
      ? { ...spline, maxGradeDegrees: 10 }
      : spline),
  } satisfies WorldSourceV3;

  const portalResult = safeCreateCaveRuntimeView(portalOutsideRoom);
  assert.equal(portalResult.ok, false);
  if (!portalResult.ok) assert.ok(portalResult.issues.some(({ code }) => code === "portal_outside_room"));
  const disconnectedResult = safeCreateCaveRuntimeView(disconnected);
  assert.equal(disconnectedResult.ok, false);
  if (!disconnectedResult.ok) assert.ok(disconnectedResult.issues.some(({ code }) => code === "disconnected_room"));
  const gradeResult = safeCreateCaveRuntimeView(excessiveGrade);
  assert.equal(gradeResult.ok, false);
  if (!gradeResult.ok) assert.ok(gradeResult.issues.some(({ code }) => code === "route_grade"));
});
