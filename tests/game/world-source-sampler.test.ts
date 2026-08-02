import assert from "node:assert/strict";
import test from "node:test";

import { IRONWIND_WORLD_SOURCE_V3, type MacroForm, type WorldSourceV3 } from "../../app/game/environment/worldSourceV3/index.ts";
import { WorldSourceSampler, createWorldSourceSampler } from "../../app/game/environment/worldSourceSampler/index.ts";

const approximate = (actual: number, expected: number, tolerance = 0.000001) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test("Ironwind source sampler is deterministic and source-only", () => {
  const before = structuredClone(IRONWIND_WORLD_SOURCE_V3);
  const first = new WorldSourceSampler(IRONWIND_WORLD_SOURCE_V3);
  const second = new WorldSourceSampler(IRONWIND_WORLD_SOURCE_V3);
  const points = [
    { x: 0, z: 0 }, { x: 52, z: -39 }, { x: -66, z: 20 }, { x: -40, z: -75 }, { x: 12, z: 99 },
  ];

  assert.deepEqual(points.map(({ x, z }) => first.sample(x, z)), points.map(({ x, z }) => second.sample(x, z)));
  assert.deepEqual(IRONWIND_WORLD_SOURCE_V3, before);
  approximate(first.heightAt(0, 0), -4);
  assert.ok(first.heightAt(-66, 20) > 13.9);
  assert.ok(first.heightAt(-40, -75) > 20);
  assert.ok(first.heightAt(12, 99) < -27.9);
});

test("Ironwind source sampler honors half-open world bounds and biome boundaries", () => {
  const sampler = createWorldSourceSampler(IRONWIND_WORLD_SOURCE_V3);

  assert.equal(sampler.contains(-128, -128), true);
  assert.equal(sampler.contains(127.999, 127.999), true);
  assert.equal(sampler.contains(128, 0), false);
  assert.equal(sampler.contains(0, 128), false);
  assert.throws(() => sampler.heightAt(128, 0), RangeError);
  assert.equal(sampler.biomeAt(0, 0).biomeId, "windglass_basin");
  assert.equal(sampler.biomeAt(47, 0).biomeId, null);
  assert.throws(() => createWorldSourceSampler({ ...IRONWIND_WORLD_SOURCE_V3, schemaVersion: 99 }), /Invalid WorldSourceV3/);
});

test("Ironwind route spline flattens height and exposes its deterministic route sample", () => {
  const sampler = new WorldSourceSampler(IRONWIND_WORLD_SOURCE_V3);
  const routePoint = sampler.sample(52, -39);

  approximate(routePoint.height, 11);
  assert.equal(routePoint.route?.splineId, "ironwind-vehicle-route");
  assert.equal(routePoint.route?.operation, "flatten");
  approximate(routePoint.route?.progress ?? Number.NaN, 0.3021030274241596);
  assert.equal(sampler.routeAt(52, -33), null);
});

test("all macro forms and operations produce finite, localized deterministic heights", () => {
  const forms = [
    { id: "basin", kind: "basin", priority: 1, operation: "min", center: { x: -90, z: -90 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: -5, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "plateau", kind: "plateau", priority: 2, operation: "smooth-union", center: { x: -50, z: -90 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: 8, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "ridge", kind: "ridge", priority: 3, operation: "add", center: { x: -10, z: -90 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: 6, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "fault", kind: "fault-step", priority: 4, operation: "max", center: { x: 30, z: -90 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: 10, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "canyon", kind: "canyon", priority: 5, operation: "carve", center: { x: 70, z: -90 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: -7, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "crater", kind: "crater-ring", priority: 6, operation: "add", center: { x: 100, z: -70 }, rotationRadians: 0, size: { x: 24, z: 24 }, height: 8, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "sinkhole", kind: "sinkhole", priority: 7, operation: "carve", center: { x: 70, z: -50 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: -9, falloff: 2, biomeId: "test", gameplayTags: [] },
    { id: "saddle", kind: "saddle", priority: 8, operation: "add", center: { x: 20, z: -50 }, rotationRadians: 0, size: { x: 20, z: 20 }, height: 4, falloff: 2, biomeId: "test", gameplayTags: [] },
  ] as const satisfies readonly MacroForm[];
  const source = { ...IRONWIND_WORLD_SOURCE_V3, macroForms: forms, splines: [], biomeRegions: [] } satisfies WorldSourceV3;
  const sampler = new WorldSourceSampler(source);

  approximate(sampler.heightAt(-90, -90), -5);
  assert.ok(sampler.heightAt(-50, -90) > 7.9);
  approximate(sampler.heightAt(-10, -90), 6);
  approximate(sampler.heightAt(39, -90), 10);
  approximate(sampler.heightAt(70, -90), -7);
  assert.ok(sampler.heightAt(108.16, -70) > 7.9);
  approximate(sampler.heightAt(70, -50), -9);
  approximate(sampler.heightAt(20, -50), 4);
  approximate(sampler.heightAt(0, 80), 0);
});
