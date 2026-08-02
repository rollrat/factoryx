import { BIOMES, BIOME_BY_ID } from "../data/biomes.ts";
import { CAVE_ZONES } from "../data/caveZones.ts";
import type { BiomeDefinition, EnvironmentDefinition, SurfaceType, TerrainSample } from "../types.ts";
import { RESOURCE_ANCHORS } from "../../data/resourceAnchors.ts";
import type { TerrainAuthoringStroke } from "../authoring.ts";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const latticeNoise = (x: number, z: number, seed: number) => {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff * 2 - 1;
};

/** Deterministic C2-continuous value noise. Coordinates are never quantized at call sites. */
const continuousNoise = (x: number, z: number, scale: number, seed: number) => {
  const px = x / scale;
  const pz = z / scale;
  const x0 = Math.floor(px);
  const z0 = Math.floor(pz);
  const fade = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);
  const tx = fade(px - x0);
  const tz = fade(pz - z0);
  const top = latticeNoise(x0, z0, seed) + (latticeNoise(x0 + 1, z0, seed) - latticeNoise(x0, z0, seed)) * tx;
  const bottom = latticeNoise(x0, z0 + 1, seed) + (latticeNoise(x0 + 1, z0 + 1, seed) - latticeNoise(x0, z0 + 1, seed)) * tx;
  return top + (bottom - top) * tz;
};

const mixHex = (from: number, to: number, amount: number) => {
  const t = clamp01(amount);
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

export const SURFACE_ACCESS_ROUTES = [
  [{ x: 12, z: -10 }, { x: 38, z: -25 }, { x: 69, z: -53 }],
  [{ x: -12, z: 8 }, { x: -38, z: 12 }, { x: -65, z: 21 }],
  [{ x: 12, z: 10 }, { x: 34, z: 27 }, { x: 56, z: 46 }, { x: 69, z: 56 }],
  [{ x: -10, z: -12 }, { x: -31, z: -34 }, { x: -61, z: -74 }],
  [{ x: 8, z: 12 }, { x: 12, z: 42 }, { x: 12, z: 99 }],
] as const;

const closestOnSegment = (x: number, z: number, from: Readonly<{ x: number; z: number }>, to: Readonly<{ x: number; z: number }>) => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  const progress = lengthSq === 0 ? 0 : clamp01(((x - from.x) * dx + (z - from.z) * dz) / lengthSq);
  const projectedX = from.x + dx * progress;
  const projectedZ = from.z + dz * progress;
  return { distance: Math.hypot(x - projectedX, z - projectedZ), progress };
};

export class TerrainSampler {
  readonly definition: EnvironmentDefinition;
  private strokes: TerrainAuthoringStroke[];
  private revision = 0;

  constructor(definition: EnvironmentDefinition, strokes: readonly TerrainAuthoringStroke[] = []) {
    this.definition = definition;
    this.strokes = strokes.map((stroke) => ({ ...stroke }));
  }

  setAuthoringStrokes(strokes: readonly TerrainAuthoringStroke[]) {
    this.strokes = strokes.map((stroke) => ({ ...stroke }));
    this.revision += 1;
  }

  authoringRevision() { return this.revision; }
  scatterClusters() {
    return this.strokes.filter((stroke) => stroke.brush === "rock_scatter" || stroke.brush === "vegetation_scatter")
      .map((stroke) => ({ ...stroke }));
  }

  biomeBlendAt(x: number, z: number) {
    const painted = [...this.strokes].reverse().find((stroke) => stroke.brush === "biome"
      && stroke.biomeId && Math.hypot(x - stroke.x, z - stroke.z) <= stroke.radius);
    if (painted?.biomeId && BIOME_BY_ID.has(painted.biomeId)) {
      const biome = BIOME_BY_ID.get(painted.biomeId)!;
      return { primary: biome, secondary: biome, secondaryWeight: 0 } as const;
    }
    const ranked = BIOMES.map((biome) => ({ biome, score: Math.hypot(x - biome.center.x, z - biome.center.z) / biome.radius }))
      .sort((a, b) => a.score - b.score);
    const primary = ranked[0];
    const secondary = ranked[1] ?? primary;
    const boundary = 1 - clamp01((secondary.score - primary.score) / 0.72);
    return { primary: primary.biome, secondary: secondary.biome, secondaryWeight: smoothstep(boundary) * 0.5 } as const;
  }

  biomeAt(x: number, z: number) {
    return this.biomeBlendAt(x, z).primary;
  }

  private biomeWeightAt(biomeId: string, x: number, z: number) {
    const blend = this.biomeBlendAt(x, z);
    let weight = blend.primary.id === biomeId ? 1 - blend.secondaryWeight : 0;
    if (blend.secondary.id === biomeId) weight += blend.secondaryWeight;
    return clamp01(weight);
  }

  private rawHeightAt(x: number, z: number) {
    const padDistance = Math.max(Math.abs(x) - 13.5, Math.abs(z) - 13.5, 0);
    const padBlend = smoothstep(padDistance / 12);
    if (padBlend === 0) return -0.5;
    const folded = Math.sin((x + z * 0.32) * 0.075) * 2.25;
    const strata = Math.sin(x * 0.031 - z * 0.061) * 3.4;
    const macro = continuousNoise(x, z, 72, this.definition.seed) * 4.2;
    const detail = continuousNoise(x, z, 15, this.definition.seed + 37) * 0.72
      + continuousNoise(x, z, 5, this.definition.seed + 73) * 0.16;
    const blend = this.biomeBlendAt(x, z);
    const regionalFor = (biome: BiomeDefinition) => {
      if (biome.id === "ironwind_faults") return Math.max(0, (x - 38) * 0.075);
      if (biome.id === "hematite_crown") return Math.max(0, (-x - 34) * 0.09);
      if (biome.id === "blackwater_marsh") return -2.2;
      if (biome.id === "thermal_rift") return -Math.max(0, 18 - Math.hypot(x - 12, z - 99)) * 0.34;
      return 0;
    };
    const regional = regionalFor(blend.primary) + (regionalFor(blend.secondary) - regionalFor(blend.primary)) * blend.secondaryWeight;
    const ironWeight = this.biomeWeightAt("ironwind_faults", x, z);
    const faultLine = 52 + Math.sin(z * 0.065) * 5.5;
    const faultShelf = smoothstep((x - faultLine + 4.5) / 9) * 7.2 * ironWeight;
    const crownWeight = this.biomeWeightAt("hematite_crown", x, z);
    const crownDistance = Math.hypot(x + 62, z + 72);
    const crownShelf = (1 - smoothstep((crownDistance - 27) / 8)) * 6.4 * crownWeight;
    return (-0.5 + (folded + strata + macro + detail + regional + faultShelf + crownShelf) * padBlend);
  }

  private foundationHeightAt(x: number, z: number) {
    const raw = this.rawHeightAt(x, z);
    const anchor = RESOURCE_ANCHORS
      .filter(({ stratumId }) => stratumId === "surface")
      .map((candidate) => ({ candidate, distance: Math.hypot(x - (candidate.position.x + 1), z - (candidate.position.z + 1)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    let height = raw;
    if (anchor && anchor.distance < 5) {
      const plateau = this.rawHeightAt(anchor.candidate.position.x + 1, anchor.candidate.position.z + 1);
      const blend = 1 - smoothstep((anchor.distance - 2.4) / 2.6);
      height = raw + (plateau - raw) * blend;
    }
    const route = this.accessRouteAt(x, z);
    if (route) {
      const fromHeight = this.rawHeightAt(route.from.x, route.from.z);
      const toHeight = this.rawHeightAt(route.to.x, route.to.z);
      const routeHeight = fromHeight + (toHeight - fromHeight) * route.progress;
      const blend = 1 - smoothstep(Math.max(0, route.distance - 1.7) / 1.3);
      height += (routeHeight - height) * blend;
    }
    return height;
  }

  accessRouteAt(x: number, z: number) {
    let closest: Readonly<{ distance: number; progress: number; from: Readonly<{ x: number; z: number }>; to: Readonly<{ x: number; z: number }> }> | null = null;
    SURFACE_ACCESS_ROUTES.forEach((points) => points.slice(1).forEach((to, index) => {
      const from = points[index];
      const projection = closestOnSegment(x, z, from, to);
      if (projection.distance <= 3 && (!closest || projection.distance < closest.distance)) closest = { ...projection, from, to };
    }));
    return closest;
  }

  private authoredHeightAt(x: number, z: number, strokeCount: number, includeSmooth = true): number {
    let height = this.foundationHeightAt(x, z);
    for (let index = 0; index < strokeCount; index += 1) {
      const stroke = this.strokes[index];
      if (!["raise", "lower", "flatten", "smooth"].includes(stroke.brush)) continue;
      const distance = Math.hypot(x - stroke.x, z - stroke.z);
      if (distance > stroke.radius) continue;
      const falloff = Math.pow(1 - distance / stroke.radius, 2);
      if (stroke.brush === "raise") height += stroke.strength * falloff;
      if (stroke.brush === "lower") height -= stroke.strength * falloff;
      if (stroke.brush === "flatten") height += ((stroke.targetHeight ?? this.rawHeightAt(stroke.x, stroke.z)) - height) * Math.min(1, stroke.strength * falloff);
      if (stroke.brush === "smooth" && includeSmooth) {
        const step = Math.max(0.75, Math.min(3, stroke.radius * 0.2));
        const neighborhood = [
          [-step, -step], [0, -step], [step, -step],
          [-step, 0], [step, 0],
          [-step, step], [0, step], [step, step],
        ].reduce((sum, [dx, dz]) => sum + this.authoredHeightAt(x + dx, z + dz, index, false), 0) / 8;
        height += (neighborhood - height) * Math.min(1, stroke.strength * falloff * 0.55);
      }
    }
    return height;
  }

  heightAt(x: number, z: number) {
    return this.authoredHeightAt(x, z, this.strokes.length);
  }

  /** Authored surface water; null means dry terrain at this coordinate. */
  waterLevelAt(x: number, z: number) {
    if (this.accessRouteAt(x, z)) return null;
    if (RESOURCE_ANCHORS.some((anchor) => anchor.stratumId === "surface"
      && Math.hypot(x - (anchor.position.x + 1), z - (anchor.position.z + 1)) < 5)) return null;
    const marshWeight = this.biomeWeightAt("blackwater_marsh", x, z);
    if (marshWeight < 0.32) return null;
    const level = -1.05 + continuousNoise(x, z, 38, this.definition.seed + 901) * 0.11;
    return this.heightAt(x, z) < level - 0.08 ? level : null;
  }

  constructionHeightAt(x: number, z: number) {
    return Math.max(Math.abs(x), Math.abs(z)) <= 13.5 ? 0 : this.heightAt(x, z);
  }

  caveHeightAt(x: number, z: number, stratumId: string) {
    const zone = CAVE_ZONES.find((candidate) => candidate.stratumId === stratumId);
    if (!zone) return -12;
    const points = [
      { x: zone.portals[0].x, y: zone.portals[0].y - 2, z: zone.portals[0].z },
      ...zone.rooms.map(({ center }) => center),
      { x: zone.portals[1].x, y: zone.portals[1].y - 2, z: zone.portals[1].z },
    ];
    const segments = points.slice(1).map((to, index) => ({ from: points[index], to }));
    zone.corridors.forEach((corridor) => {
      const from = zone.rooms.find(({ id }) => id === corridor.fromRoomId)?.center;
      const to = zone.rooms.find(({ id }) => id === corridor.toRoomId)?.center;
      if (from && to) segments.push({ from, to });
    });
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestHeight = zone.rooms[0].center.y;
    for (const { from, to } of segments) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq === 0 ? 0 : clamp01(((x - from.x) * dx + (z - from.z) * dz) / lengthSq);
      const projectedX = from.x + dx * t;
      const projectedZ = from.z + dz * t;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestHeight = from.y + (to.y - from.y) * t;
      }
    }
    return bestHeight;
  }

  isCaveFloorAt(x: number, z: number, stratumId: string) {
    const zone = CAVE_ZONES.find((candidate) => candidate.stratumId === stratumId);
    if (!zone) return false;
    if (zone.rooms.some((room) => Math.hypot(x - room.center.x, z - room.center.z) <= room.radius * 0.82)) return true;
    const points = [
      { x: zone.portals[0].x, z: zone.portals[0].z },
      ...zone.rooms.map(({ center }) => ({ x: center.x, z: center.z })),
      { x: zone.portals[1].x, z: zone.portals[1].z },
    ];
    const lineContains = (from: { x: number; z: number }, to: { x: number; z: number }, width = 3) => {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq === 0 ? 0 : clamp01(((x - from.x) * dx + (z - from.z) * dz) / lengthSq);
      return Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)) <= width;
    };
    if (points.slice(1).some((to, index) => lineContains(points[index], to))) return true;
    return zone.corridors.some((corridor) => {
      const from = zone.rooms.find(({ id }) => id === corridor.fromRoomId)?.center;
      const to = zone.rooms.find(({ id }) => id === corridor.toRoomId)?.center;
      return Boolean(from && to && lineContains(from, to, corridor.width));
    });
  }

  caveSpaceAt(x: number, z: number, stratumId: string) {
    const zone = CAVE_ZONES.find((candidate) => candidate.stratumId === stratumId);
    if (!zone) return { clearance: 0, shortcut: false } as const;
    // The authored shortcut remains a narrow reserved logistics path even
    // while it crosses the edge of a larger chamber.
    for (const corridor of zone.corridors) {
      const from = zone.rooms.find(({ id }) => id === corridor.fromRoomId)?.center;
      const to = zone.rooms.find(({ id }) => id === corridor.toRoomId)?.center;
      if (from && to && closestOnSegment(x, z, from, to).distance <= corridor.width) {
        return { clearance: Math.max(3.5, corridor.width * 1.8), shortcut: true } as const;
      }
    }
    const room = zone.rooms.find((candidate) => Math.hypot(x - candidate.center.x, z - candidate.center.z) <= candidate.radius * 0.82);
    if (room) return { clearance: room.clearance, shortcut: false } as const;
    const points = [
      { x: zone.portals[0].x, z: zone.portals[0].z },
      ...zone.rooms.map(({ center }) => ({ x: center.x, z: center.z })),
      { x: zone.portals[1].x, z: zone.portals[1].z },
    ];
    const inMainGallery = points.slice(1).some((to, index) => closestOnSegment(x, z, points[index], to).distance <= 3);
    return { clearance: inMainGallery ? 6.2 : 0, shortcut: false } as const;
  }

  sample(x: number, z: number, stratumId: string = "surface"): TerrainSample {
    if (stratumId !== "surface") {
      const height = this.caveHeightAt(x, z, stratumId);
      const inside = this.isCaveFloorAt(x, z, stratumId);
      return {
        height,
        normal: inside ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 },
        slopeDegrees: inside ? 0 : 90,
        biomeId: "thermal_rift",
        surface: inside ? "cave_floor" : "steep",
        buildability: inside ? "foundation_required" : "restricted",
        stratumId,
      };
    }
    const height = this.heightAt(x, z);
    const step = 0.5;
    const dx = this.heightAt(x + step, z) - this.heightAt(x - step, z);
    const dz = this.heightAt(x, z + step) - this.heightAt(x, z - step);
    const length = Math.hypot(dx, step * 2, dz);
    const normal = { x: -dx / length, y: (step * 2) / length, z: -dz / length };
    const slopeDegrees = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
    const biome = this.biomeAt(x, z);
    const noise = continuousNoise(x, z, 7, this.definition.seed + 91);
    let surface: SurfaceType = "stable";
    const resourcePad = RESOURCE_ANCHORS.find((anchor) => anchor.stratumId === "surface"
      && Math.hypot(x - (anchor.position.x + 1), z - (anchor.position.z + 1)) <= 2.6);
    const paintedSurface = [...this.strokes].reverse().find((stroke) => stroke.brush === "surface"
      && stroke.surface && Math.hypot(x - stroke.x, z - stroke.z) <= stroke.radius)?.surface;
    if (paintedSurface) surface = paintedSurface;
    else if (resourcePad?.itemId === "crude_oil") surface = "hazard";
    else if (resourcePad) surface = "stable";
    else if (this.accessRouteAt(x, z)) surface = "stable";
    else if (slopeDegrees >= 24) surface = "steep";
    else if (this.waterLevelAt(x, z) !== null) surface = noise > 0.55 ? "hazard" : "submerged";
    else if ((biome.id === "blackwater_marsh" || biome.id === "windglass_basin") && noise > 0.38) surface = "soft";
    else if (biome.id === "thermal_rift" && noise > 0.5) surface = "hazard";
    const buildability = surface === "stable"
      ? "allowed"
      : surface === "soft"
        ? "foundation_required"
        : "restricted";
    return { height, normal, slopeDegrees, biomeId: biome.id, surface, buildability, stratumId: "surface" };
  }

  colorAt(x: number, z: number) {
    const blend = this.biomeBlendAt(x, z);
    const detail = clamp01(0.22 + (continuousNoise(x, z, 11, this.definition.seed + 414) * 0.5 + 0.5) * 0.34);
    const primary = mixHex(blend.primary.palette.ground, blend.primary.palette.groundSecondary, detail);
    const secondary = mixHex(blend.secondary.palette.ground, blend.secondary.palette.groundSecondary, detail);
    return mixHex(primary, secondary, blend.secondaryWeight);
  }
}
