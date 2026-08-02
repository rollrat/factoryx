import { parseWorldSourceV3 } from "../worldSourceV3/validation.ts";
import type { BiomeRegion, MacroForm, Vec2, WorldSourceV3, WorldSpline } from "../worldSourceV3/types.ts";

export type SourceSamplerBiome = Readonly<{
  biomeId: string | null;
  secondaryBiomeId: string | null;
  transitionWeight: number;
}>;

export type SourceRouteSample = Readonly<{
  splineId: string;
  kind: WorldSpline["kind"];
  operation: WorldSpline["operation"];
  priority: number;
  stratumId: string;
  distance: number;
  progress: number;
  width: number;
  height: number;
}>;

export type WorldSourceHeightSample = Readonly<{
  height: number;
  normal: Readonly<{ x: number; y: number; z: number }>;
  slopeDegrees: number;
  biome: SourceSamplerBiome;
  route: SourceRouteSample | null;
}>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoothMax = (left: number, right: number, radius: number) => {
  if (radius <= 0) return Math.max(left, right);
  const overlap = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.max(left, right) + overlap * overlap * overlap * radius / 6;
};

const rotateIntoLocal = (x: number, z: number, form: MacroForm) => {
  const dx = x - form.center.x;
  const dz = z - form.center.z;
  const cos = Math.cos(form.rotationRadians);
  const sin = Math.sin(form.rotationRadians);
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
};

const rectMask = (x: number, z: number, halfX: number, halfZ: number, falloff: number) => {
  const outside = Math.max(Math.abs(x) - halfX, Math.abs(z) - halfZ, 0);
  return 1 - smoothstep(falloff === 0 ? (outside === 0 ? 0 : 1) : outside / falloff);
};

const ellipseMask = (x: number, z: number, radiusX: number, radiusZ: number, falloff: number) => {
  const normalized = Math.hypot(x / radiusX, z / radiusZ);
  const outerRadius = 1 + falloff / Math.min(radiusX, radiusZ);
  return 1 - smoothstep((normalized - 1) / Math.max(outerRadius - 1, Number.EPSILON));
};

const macroMask = (form: MacroForm, x: number, z: number, spline?: WorldSpline) => {
  const local = rotateIntoLocal(x, z, form);
  const halfX = form.size.x * 0.5;
  const halfZ = form.size.z * 0.5;
  const radial = Math.hypot(local.x / halfX, local.z / halfZ);
  const rectangular = rectMask(local.x, local.z, halfX, halfZ, form.falloff);
  const elliptical = ellipseMask(local.x, local.z, halfX, halfZ, form.falloff);

  switch (form.kind) {
    case "plateau":
      return rectangular;
    case "fault-step":
      return rectangular * smoothstep((local.x + halfX * 0.15) / Math.max(halfX * 0.3, Number.EPSILON));
    case "basin":
      return elliptical;
    case "ridge":
      return elliptical * Math.max(0, 1 - Math.abs(local.x) / halfX);
    case "canyon": {
      const linkedRoute = spline ? routeAt([spline], x, z, spline.stratumId, true) : null;
      const lineMask = linkedRoute
        ? 1 - smoothstep(linkedRoute.distance / Math.max(halfX, Number.EPSILON))
        : Math.max(0, 1 - Math.abs(local.x) / halfX);
      return rectangular * lineMask;
    }
    case "crater-ring": {
      const ringRadius = 0.68;
      const ringHalfWidth = 0.22;
      const ring = 1 - smoothstep((Math.abs(radial - ringRadius) - ringHalfWidth) / Math.max(form.falloff / Math.min(halfX, halfZ), 0.12));
      return rectangular * ring;
    }
    case "sinkhole":
      return elliptical * Math.max(0, 1 - radial * radial);
    case "saddle":
      return rectangular * (1 - 2 * clamp01(Math.abs(local.z) / halfZ));
  }
};

const formOrder = (left: MacroForm, right: MacroForm) => left.priority - right.priority || left.id.localeCompare(right.id);
const splineOrder = (left: WorldSpline, right: WorldSpline) => left.priority - right.priority || left.id.localeCompare(right.id);
const regionOrder = (left: BiomeRegion, right: BiomeRegion) => right.priority - left.priority || left.id.localeCompare(right.id);

const pointOnSegment = (x: number, z: number, from: Readonly<{ x: number; y: number; z: number }>, to: Readonly<{ x: number; y: number; z: number }>) => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0 ? 0 : clamp01(((x - from.x) * dx + (z - from.z) * dz) / lengthSquared);
  const projectedX = from.x + dx * progress;
  const projectedZ = from.z + dz * progress;
  return {
    distance: Math.hypot(x - projectedX, z - projectedZ),
    progress,
    height: lerp(from.y, to.y, progress),
  };
};

const routeAt = (splines: readonly WorldSpline[], x: number, z: number, stratumId: string, includeOutsideWidth = false): SourceRouteSample | null => {
  let nearest: SourceRouteSample | null = null;
  for (const spline of splines) {
    if (spline.stratumId !== stratumId) continue;
    const points = spline.bakedPolyline ?? spline.controlPoints;
    let traversed = 0;
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) totalLength += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const hit = pointOnSegment(x, z, from, to);
      const candidate: SourceRouteSample = {
        splineId: spline.id,
        kind: spline.kind,
        operation: spline.operation,
        priority: spline.priority,
        stratumId,
        distance: hit.distance,
        progress: totalLength === 0 ? 0 : (traversed + length * hit.progress) / totalLength,
        width: spline.width,
        height: hit.height,
      };
      if ((includeOutsideWidth || candidate.distance <= spline.width * 0.5) && (!nearest || candidate.distance < nearest.distance
        || (candidate.distance === nearest.distance && (candidate.priority > nearest.priority
          || (candidate.priority === nearest.priority && candidate.splineId.localeCompare(nearest.splineId) < 0))))) {
        nearest = candidate;
      }
      traversed += length;
    }
  }
  return nearest;
};

const containsPoint = (ring: readonly Vec2[], x: number, z: number) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const before = ring[previous];
    const crosses = (current.z > z) !== (before.z > z)
      && x <= (before.x - current.x) * (z - current.z) / (before.z - current.z) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const segmentDistance = (x: number, z: number, from: Vec2, to: Vec2) => pointOnSegment(x, z, { ...from, y: 0 }, { ...to, y: 0 }).distance;
const ringDistance = (ring: readonly Vec2[], x: number, z: number) => ring.reduce((nearest, current, index) => Math.min(nearest, segmentDistance(x, z, current, ring[(index + 1) % ring.length])), Number.POSITIVE_INFINITY);

const containsRegion = (region: BiomeRegion, x: number, z: number) => containsPoint(region.polygon, x, z) && !region.holes.some((hole) => containsPoint(hole, x, z));
const regionBoundaryDistance = (region: BiomeRegion, x: number, z: number) => Math.min(ringDistance(region.polygon, x, z), ...region.holes.map((hole) => ringDistance(hole, x, z)));

const noiseHash = (x: number, z: number, seed: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.0137) * 43758.5453123;
  return value - Math.floor(value);
};

const valueNoise = (x: number, z: number, seed: number) => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const lower = lerp(noiseHash(ix, iz, seed), noiseHash(ix + 1, iz, seed), fx);
  const upper = lerp(noiseHash(ix, iz + 1, seed), noiseHash(ix + 1, iz + 1, seed), fx);
  return lerp(lower, upper, fz) * 2 - 1;
};

const BIOME_RELIEF: Readonly<Record<string, number>> = {
  windglass_basin: 1.25,
  ironwind_faults: 2.8,
  silicate_sailwood: 3.6,
  blackwater_marsh: 0.55,
  hematite_crown: 3.1,
  thermal_rift: 2.2,
};

/**
 * Pure, source-backed height and metadata sampler. It deliberately has no
 * dependency on the legacy TerrainSampler, renderer, or runtime state.
 */
export class WorldSourceSampler {
  readonly source: WorldSourceV3;
  private readonly macroForms: readonly MacroForm[];
  private readonly splines: readonly WorldSpline[];
  private readonly biomeRegions: readonly BiomeRegion[];
  private readonly detailedSurface: boolean;

  constructor(source: WorldSourceV3) {
    this.source = source;
    this.macroForms = [...source.macroForms].sort(formOrder);
    this.splines = [...source.splines].sort(splineOrder);
    this.biomeRegions = [...source.biomeRegions].sort(regionOrder);
    this.detailedSurface = source.macroForms.length >= 9 && source.biomeRegions.length >= 6;
  }

  contains(x: number, z: number) {
    const { bounds } = this.source;
    return x >= bounds.minX && x < bounds.maxXExclusive && z >= bounds.minZ && z < bounds.maxZExclusive;
  }

  heightAt(x: number, z: number, stratumId = "surface") {
    if (!this.contains(x, z)) throw new RangeError(`Point (${x}, ${z}) is outside WorldSourceV3 bounds`);
    let height = 0;
    for (const form of this.macroForms) {
      const mask = macroMask(form, x, z, form.splineId ? this.splines.find((spline) => spline.id === form.splineId) : undefined);
      if (mask <= 0) continue;
      const candidate = form.height * mask;
      switch (form.operation) {
        case "add": height += candidate; break;
        case "min": height = Math.min(height, candidate); break;
        case "max": height = Math.max(height, candidate); break;
        case "carve": height -= Math.abs(form.height) * mask; break;
        case "smooth-union": height = lerp(height, smoothMax(height, form.height, Math.max(form.falloff, 0.001)), mask); break;
      }
    }
    if (stratumId === "surface" && this.detailedSurface) height += this.surfaceReliefAt(x, z);
    for (const spline of this.splines) {
      if (spline.stratumId !== stratumId || spline.operation === "mark") continue;
      const route = routeAt([spline], x, z, stratumId);
      if (!route) continue;
      const mask = 1 - smoothstep(route.distance / Math.max(spline.width * 0.5, Number.EPSILON));
      if (spline.operation === "flatten") height = lerp(height, route.height, mask);
      if (spline.operation === "carve") height = Math.min(height, lerp(height, route.height, mask));
    }
    return height;
  }

  private surfaceReliefAt(x: number, z: number) {
    const biomeId = this.biomeAt(x, z).biomeId ?? "unassigned";
    const amplitude = BIOME_RELIEF[biomeId] ?? 0.8;
    const broad = valueNoise(x * 0.037, z * 0.037, this.source.seed);
    const medium = valueNoise(x * 0.091 + 19, z * 0.091 - 7, this.source.seed + 17);
    const fine = valueNoise(x * 0.21 - 11, z * 0.21 + 23, this.source.seed + 41);
    let protection = 1;
    for (const anchor of this.source.resourceAnchors) {
      if (anchor.stratumId !== "surface") continue;
      const distance = Math.hypot(x - anchor.position.x, z - anchor.position.z);
      protection = Math.min(protection, smoothstep((distance - anchor.protectionRadius) / 7));
    }
    for (const zone of this.source.gameplayZones) {
      if (zone.stratumId !== "surface" || (zone.kind !== "build-patch" && zone.kind !== "resource-pad")) continue;
      if (containsPoint(zone.polygon, x, z) && !zone.holes.some((hole) => containsPoint(hole, x, z))) protection = Math.min(protection, 0.08);
    }
    return (broad * 0.58 + medium * 0.3 + fine * 0.12) * amplitude * protection;
  }

  routeAt(x: number, z: number, stratumId = "surface") {
    if (!this.contains(x, z)) return null;
    return routeAt(this.splines, x, z, stratumId);
  }

  biomeAt(x: number, z: number): SourceSamplerBiome {
    if (!this.contains(x, z)) return { biomeId: null, secondaryBiomeId: null, transitionWeight: 0 };
    const matches = this.biomeRegions.filter((region) => containsRegion(region, x, z));
    const primary = matches[0];
    const secondary = matches[1];
    if (!primary) return { biomeId: null, secondaryBiomeId: null, transitionWeight: 0 };
    return {
      biomeId: primary.biomeId,
      secondaryBiomeId: secondary?.biomeId ?? null,
      transitionWeight: secondary ? 1 - smoothstep(regionBoundaryDistance(primary, x, z) / primary.transition.terrain) : 0,
    };
  }

  sample(x: number, z: number, stratumId = "surface"): WorldSourceHeightSample {
    const height = this.heightAt(x, z, stratumId);
    const step = this.source.sampleSpacing;
    // Number.EPSILON is smaller than one ULP at world-scale coordinates such
    // as 128, so subtracting it can still equal the exclusive bound exactly.
    const sampleX = Math.min(this.source.bounds.maxXExclusive - 1e-6, Math.max(this.source.bounds.minX, x + step));
    const sampleZ = Math.min(this.source.bounds.maxZExclusive - 1e-6, Math.max(this.source.bounds.minZ, z + step));
    const dx = this.heightAt(sampleX, z, stratumId) - this.heightAt(Math.max(this.source.bounds.minX, x - step), z, stratumId);
    const dz = this.heightAt(x, sampleZ, stratumId) - this.heightAt(x, Math.max(this.source.bounds.minZ, z - step), stratumId);
    const spanX = sampleX - Math.max(this.source.bounds.minX, x - step);
    const spanZ = sampleZ - Math.max(this.source.bounds.minZ, z - step);
    const normalLength = Math.hypot(dx / Math.max(spanX, Number.EPSILON), 1, dz / Math.max(spanZ, Number.EPSILON));
    const normal = { x: -(dx / Math.max(spanX, Number.EPSILON)) / normalLength, y: 1 / normalLength, z: -(dz / Math.max(spanZ, Number.EPSILON)) / normalLength };
    return { height, normal, slopeDegrees: Math.acos(clamp01(normal.y)) * 180 / Math.PI, biome: this.biomeAt(x, z), route: this.routeAt(x, z, stratumId) };
  }
}

/** Strict external-data entry point shared by World Studio and game loading. */
export const createWorldSourceSampler = (value: unknown) => new WorldSourceSampler(parseWorldSourceV3(value));
