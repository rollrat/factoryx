import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT } from "../../app/game/environment/data/environment.ts";
import {
  IRONWIND_WORLD_SOURCE_V3,
  computeWorldSourceContentHash,
  migrateWorldStudioV2ToV3,
  parseWorldSourceV3Json,
  safeParseWorldSourceV3,
  safeParseWorldSourceV3Json,
  stringifyWorldSourceV3,
  type WorldSourceV3,
} from "../../app/game/environment/worldSourceV3/index.ts";

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

const cloneFixture = () => structuredClone(IRONWIND_WORLD_SOURCE_V3) as unknown as Mutable<WorldSourceV3>;
const hasIssue = (value: unknown, code: string) => {
  const result = safeParseWorldSourceV3(value);
  return !result.ok && result.issues.some((issue) => issue.code === code);
};

test("Ironwind fixture satisfies the complete WorldSourceV3 contract", () => {
  const parsed = safeParseWorldSourceV3(IRONWIND_WORLD_SOURCE_V3);

  if (!parsed.ok) assert.fail(JSON.stringify(parsed.issues));
  assert.equal(parsed.ok, true);
  assert.notEqual(parsed.value, IRONWIND_WORLD_SOURCE_V3);
  assert.equal(parsed.value.caves[0].stratumId, "rift_depths");
  assert.equal(parsed.value.placements.length, A17_ENVIRONMENT.landmarks.length);
});

test("canonical export-import is lossless and rejects malformed JSON", () => {
  const json = stringifyWorldSourceV3(IRONWIND_WORLD_SOURCE_V3);
  const imported = parseWorldSourceV3Json(json);

  assert.deepEqual(imported, IRONWIND_WORLD_SOURCE_V3);
  const malformed = safeParseWorldSourceV3Json("{not-json");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.issues[0].code, "invalid_json");
});

test("content hash is deterministic, key-order independent, and source-sensitive", async () => {
  const reversedRootKeys = Object.fromEntries(
    Object.entries(structuredClone(IRONWIND_WORLD_SOURCE_V3)).reverse(),
  ) as unknown as WorldSourceV3;
  const changed = cloneFixture();
  changed.generatorVersion += 1;

  const [first, second, changedHash] = await Promise.all([
    computeWorldSourceContentHash(IRONWIND_WORLD_SOURCE_V3),
    computeWorldSourceContentHash(reversedRootKeys),
    computeWorldSourceContentHash(changed),
  ]);

  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changedHash);
});

test("validator rejects duplicate stable IDs and unknown properties", () => {
  const duplicate = cloneFixture();
  duplicate.splines[0].id = duplicate.macroForms[0].id;
  assert.equal(hasIssue(duplicate, "duplicate_id"), true);

  const unknownProperty = cloneFixture() as unknown as Record<string, unknown>;
  unknownProperty.editorOnly = true;
  assert.equal(hasIssue(unknownProperty, "unknown_property"), true);
});

test("validator rejects invalid bounds, polygon winding, and out-of-range coordinates", () => {
  const invalidBounds = cloneFixture();
  invalidBounds.bounds.maxXExclusive = invalidBounds.bounds.minX;
  assert.equal(hasIssue(invalidBounds, "invalid_bounds"), true);

  const clockwiseOuterRing = cloneFixture();
  clockwiseOuterRing.biomeRegions[0].polygon.reverse();
  assert.equal(hasIssue(clockwiseOuterRing, "invalid_polygon"), true);

  const outOfBounds = cloneFixture();
  outOfBounds.resourceAnchors[0].position.x = outOfBounds.bounds.maxXExclusive;
  assert.equal(hasIssue(outOfBounds, "out_of_bounds"), true);
});

test("validator rejects zero-length splines and broken spline references", () => {
  const zeroLengthSegment = cloneFixture();
  zeroLengthSegment.splines[0].controlPoints[1] = { ...zeroLengthSegment.splines[0].controlPoints[0] };
  assert.equal(hasIssue(zeroLengthSegment, "invalid_spline"), true);

  const brokenReference = cloneFixture();
  const river = brokenReference.waterBodies.find((water) => water.kind === "river");
  assert.ok(river && river.kind === "river");
  river.splineId = "missing-river-spline";
  assert.equal(hasIssue(brokenReference, "broken_reference"), true);
});

test("v2 migration preserves strokes, settings, offsets, and both inputs", () => {
  const v2 = {
    format: "factoryx-world-studio",
    version: 2,
    environmentId: A17_ENVIRONMENT.id,
    environmentVersion: A17_ENVIRONMENT.version,
    seed: A17_ENVIRONMENT.seed,
    strokes: [
      { brush: "raise", x: 30, z: 30, radius: 4, strength: 2 },
      { brush: "biome", x: -60, z: 18, radius: 8, strength: 1, biomeId: "silicate_sailwood" },
    ],
    timeOfDay: 0.72,
    sunAzimuth: 0.15,
    fogDensity: 0.006,
    weather: "mineral_wind",
    weatherStrength: 0.35,
    scatterDensity: 0.8,
    landmarksVisible: true,
    resourceAnchorsVisible: false,
    quality: "high",
    landmarkOffsets: { iron_ribs: { x: 2, z: -1, rotation: 0.2 } },
  };
  const v2Before = structuredClone(v2);
  const baseBefore = structuredClone(IRONWIND_WORLD_SOURCE_V3);

  const migrated = migrateWorldStudioV2ToV3(v2, A17_ENVIRONMENT, IRONWIND_WORLD_SOURCE_V3);

  if (!migrated.ok) assert.fail(JSON.stringify(migrated.issues));
  assert.equal(migrated.ok, true);
  assert.deepEqual(v2, v2Before);
  assert.deepEqual(IRONWIND_WORLD_SOURCE_V3, baseBefore);
  assert.deepEqual(migrated.value.legacySculptLayer?.strokes, v2.strokes);
  assert.deepEqual(migrated.value.legacySculptLayer?.landmarkOffsets, v2.landmarkOffsets);
  assert.equal(migrated.value.legacySculptLayer?.environmentSettings.weather, v2.weather);
  assert.deepEqual(parseWorldSourceV3Json(stringifyWorldSourceV3(migrated.value)), migrated.value);
});

test("v2 migration fails atomically when legacy input is invalid", () => {
  const invalidV2 = {
    format: "factoryx-world-studio",
    version: 2,
    environmentId: A17_ENVIRONMENT.id,
    environmentVersion: A17_ENVIRONMENT.version,
    seed: A17_ENVIRONMENT.seed,
    strokes: [{ brush: "raise", x: 999, z: 0, radius: 4, strength: 2 }],
    timeOfDay: 0.68,
    sunAzimuth: 0,
    fogDensity: 0.0036,
    weather: "clear",
    weatherStrength: 0,
    scatterDensity: 1,
    landmarksVisible: true,
    resourceAnchorsVisible: true,
    quality: "high",
    landmarkOffsets: {},
  };
  const before = structuredClone(invalidV2);

  const migrated = migrateWorldStudioV2ToV3(invalidV2, A17_ENVIRONMENT, IRONWIND_WORLD_SOURCE_V3);

  assert.equal(migrated.ok, false);
  assert.deepEqual(invalidV2, before);
});
