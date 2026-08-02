import type { TerrainBuildability, TerrainSample, SurfaceType } from "../types.ts";
import { WorldWaterSampler } from "../water/WorldWaterSampler.ts";
import { CaveRuntimeSampler } from "../worldSourceCaves/CaveRuntimeSampler.ts";
import { createCaveRuntimeView } from "../worldSourceCaves/CaveRuntimeView.ts";
import { parseWorldSourceV3 } from "../worldSourceV3/validation.ts";
import type { GameplayZone, WorldSourceV3 } from "../worldSourceV3/types.ts";
import { WorldSourceSampler } from "./WorldSourceSampler.ts";

export type WorldSourceEnvironmentSamplerOptions = Readonly<{
  /** Surface slope at or above this angle is not traversable/buildable terrain. */
  steepSlopeDegrees?: number;
  /** Surface slope at or above this angle requires a foundation but is still traversable. */
  foundationSlopeDegrees?: number;
  /** Water deeper than this is classified as submerged. */
  submergedDepth?: number;
}>;

type ZoneVerdict = Readonly<{ surface: SurfaceType; buildability: TerrainBuildability }>;

const DEFAULT_STEEP_SLOPE_DEGREES = 24;
const DEFAULT_FOUNDATION_SLOPE_DEGREES = 12;
const DEFAULT_SUBMERGED_DEPTH = 0.01;
const MIN_TRAVERSABLE_CAVE_CLEARANCE = 2.2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const withoutNegativeZero = (value: number) => Object.is(value, -0) ? 0 : value;

const pointInPolygon = (x: number, z: number, polygon: readonly Readonly<{ x: number; z: number }>[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const from = polygon[previous];
    const to = polygon[index];
    if ((from.z > z) !== (to.z > z) && x <= (to.x - from.x) * (z - from.z) / (to.z - from.z) + from.x) inside = !inside;
  }
  return inside;
};

const containsZone = (zone: GameplayZone, x: number, z: number, height: number) => (
  pointInPolygon(x, z, zone.polygon)
  && !zone.holes.some((hole) => pointInPolygon(x, z, hole))
  && (!zone.elevationRange || (height >= zone.elevationRange.min && height <= zone.elevationRange.max))
);

const compareZone = (left: GameplayZone, right: GameplayZone) => right.priority - left.priority || left.id.localeCompare(right.id);

/**
 * Renderer-neutral TerrainSample adapter for strict WorldSourceV3 data.
 *
 * It is deliberately separate from the legacy TerrainSampler: terrain bakes,
 * collision, and future render paths can share this deterministic answer
 * without importing Three.js, runtime state, or World Studio state.
 */
export class WorldSourceEnvironmentSampler {
  readonly source: WorldSourceV3;
  readonly terrain: WorldSourceSampler;
  readonly water: WorldWaterSampler;
  readonly caves: CaveRuntimeSampler;
  private readonly zones: readonly GameplayZone[];
  private readonly steepSlopeDegrees: number;
  private readonly foundationSlopeDegrees: number;
  private readonly submergedDepth: number;

  constructor(value: unknown, options: WorldSourceEnvironmentSamplerOptions = {}) {
    this.source = parseWorldSourceV3(value);
    this.terrain = new WorldSourceSampler(this.source);
    this.water = new WorldWaterSampler(this.source, this.terrain);
    this.caves = new CaveRuntimeSampler(createCaveRuntimeView(this.source));
    this.zones = [...this.source.gameplayZones].sort(compareZone);
    this.steepSlopeDegrees = finiteAtLeast(options.steepSlopeDegrees, DEFAULT_STEEP_SLOPE_DEGREES, 0, "steepSlopeDegrees");
    this.foundationSlopeDegrees = finiteAtLeast(options.foundationSlopeDegrees, DEFAULT_FOUNDATION_SLOPE_DEGREES, 0, "foundationSlopeDegrees");
    if (this.foundationSlopeDegrees > this.steepSlopeDegrees) throw new RangeError("foundationSlopeDegrees must not exceed steepSlopeDegrees");
    this.submergedDepth = finiteAtLeast(options.submergedDepth, DEFAULT_SUBMERGED_DEPTH, 0, "submergedDepth");
  }

  contains(x: number, z: number) { return this.terrain.contains(x, z); }

  /** Cave room/corridor metadata remains available to collision and placement callers. */
  caveSpaceAt(x: number, z: number, stratumId: string) {
    return this.caves.sampleSpace(x, z, stratumId);
  }

  sample(x: number, z: number, stratumId = "surface"): TerrainSample {
    if (!this.contains(x, z)) throw new RangeError(`Point (${x}, ${z}) is outside WorldSourceV3 bounds`);
    return stratumId === "surface" ? this.sampleSurface(x, z) : this.sampleCave(x, z, stratumId);
  }

  private sampleSurface(x: number, z: number): TerrainSample {
    const terrain = this.terrain.sample(x, z);
    const water = this.water.sample(x, z);
    const zone = this.zoneVerdictAt(x, z, terrain.height, "surface");
    const route = terrain.route;
    let surface: SurfaceType = "stable";
    let buildability: TerrainBuildability = "allowed";

    if (zone) ({ surface, buildability } = zone);
    else if (water && water.depth > this.submergedDepth) ({ surface, buildability } = { surface: "submerged", buildability: "restricted" });
    else if (terrain.slopeDegrees >= this.steepSlopeDegrees) ({ surface, buildability } = { surface: "steep", buildability: "restricted" });
    else if (route || terrain.slopeDegrees >= this.foundationSlopeDegrees) ({ surface, buildability } = { surface: "stable", buildability: route ? "allowed" : "foundation_required" });

    return {
      height: terrain.height,
      normal: terrain.normal,
      slopeDegrees: terrain.slopeDegrees,
      biomeId: terrain.biome.biomeId ?? "unassigned",
      surface,
      buildability,
      stratumId: "surface",
    };
  }

  private sampleCave(x: number, z: number, stratumId: string): TerrainSample {
    const fallback = this.terrain.sample(x, z, stratumId);
    const space = this.caves.sampleSpace(x, z, stratumId);
    if (!space) {
      return {
        height: fallback.height,
        normal: { x: 1, y: 0, z: 0 },
        slopeDegrees: 90,
        biomeId: fallback.biome.biomeId ?? "unassigned",
        surface: "steep",
        buildability: "restricted",
        stratumId,
      };
    }
    const normal = this.caveNormal(x, z, stratumId, space.floorHeight);
    const slopeDegrees = Math.acos(clamp(normal.y, -1, 1)) * 180 / Math.PI;
    const zone = this.zoneVerdictAt(x, z, space.floorHeight, stratumId);
    return {
      height: space.floorHeight,
      normal,
      slopeDegrees,
      biomeId: fallback.biome.biomeId ?? "unassigned",
      surface: zone?.surface === "hazard" ? "hazard" : "cave_floor",
      buildability: space.clearance < MIN_TRAVERSABLE_CAVE_CLEARANCE ? "restricted" : (zone?.buildability ?? "foundation_required"),
      stratumId,
    };
  }

  private caveNormal(x: number, z: number, stratumId: string, height: number) {
    const step = this.source.sampleSpacing;
    const floorAt = (sampleX: number, sampleZ: number) => this.caves.sampleSpace(sampleX, sampleZ, stratumId)?.floorHeight ?? height;
    const dx = floorAt(x + step, z) - floorAt(x - step, z);
    const dz = floorAt(x, z + step) - floorAt(x, z - step);
    const length = Math.hypot(dx, step * 2, dz);
    return {
      x: withoutNegativeZero(-dx / length),
      y: withoutNegativeZero(step * 2 / length),
      z: withoutNegativeZero(-dz / length),
    };
  }

  private zoneVerdictAt(x: number, z: number, height: number, stratumId: string): ZoneVerdict | null {
    const zone = this.zones.find((candidate) => candidate.stratumId === stratumId && containsZone(candidate, x, z, height));
    if (!zone) return null;
    if (zone.kind === "hazard") return { surface: "hazard", buildability: "restricted" };
    if (zone.operation === "exclude" || zone.kind === "build-exclusion") return { surface: "stable", buildability: "restricted" };
    if (zone.kind === "build-patch" || zone.kind === "resource-pad" || zone.kind === "route-corridor") {
      return { surface: "stable", buildability: "allowed" };
    }
    return null;
  }
}

/** Strict external-data entry point for worker and gameplay callers. */
export const createWorldSourceEnvironmentSampler = (value: unknown, options?: WorldSourceEnvironmentSamplerOptions) => (
  new WorldSourceEnvironmentSampler(value, options)
);

function finiteAtLeast(value: number | undefined, fallback: number, minimum: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum) throw new RangeError(`${name} must be finite and >= ${minimum}`);
  return resolved;
}
