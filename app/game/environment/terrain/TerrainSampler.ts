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

const hashNoise = (x: number, z: number, seed: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.013) * 43758.5453123;
  return (value - Math.floor(value)) * 2 - 1;
};

export class TerrainSampler {
  readonly definition: EnvironmentDefinition;
  private readonly strokes: readonly TerrainAuthoringStroke[];

  constructor(definition: EnvironmentDefinition, strokes: readonly TerrainAuthoringStroke[] = []) {
    this.definition = definition;
    this.strokes = strokes.map((stroke) => ({ ...stroke }));
  }

  private baseBiomeAt(x: number, z: number) {
    let best: BiomeDefinition = BIOMES[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const biome of BIOMES) {
      const dx = x - biome.center.x;
      const dz = z - biome.center.z;
      const score = Math.hypot(dx, dz) / biome.radius;
      if (score < bestScore) {
        best = biome;
        bestScore = score;
      }
    }
    return best;
  }

  biomeAt(x: number, z: number) {
    const painted = [...this.strokes].reverse().find((stroke) => stroke.brush === "biome"
      && stroke.biomeId && Math.hypot(x - stroke.x, z - stroke.z) <= stroke.radius);
    return (painted?.biomeId ? BIOME_BY_ID.get(painted.biomeId) : null) ?? this.baseBiomeAt(x, z);
  }

  private rawHeightAt(x: number, z: number) {
    const padDistance = Math.max(Math.abs(x) - 13.5, Math.abs(z) - 13.5, 0);
    const padBlend = smoothstep(padDistance / 12);
    if (padBlend === 0) return -0.5;
    const folded = Math.sin((x + z * 0.32) * 0.075) * 2.8;
    const strata = Math.sin(x * 0.031 - z * 0.061) * 4.2;
    const detail = hashNoise(Math.floor(x / 4), Math.floor(z / 4), this.definition.seed) * 0.8;
    const biome = this.baseBiomeAt(x, z);
    let regional = 0;
    if (biome.id === "ironwind_faults") regional = Math.max(0, (x - 38) * 0.075);
    if (biome.id === "hematite_crown") regional = Math.max(0, (-x - 34) * 0.09);
    if (biome.id === "blackwater_marsh") regional = -2.2;
    if (biome.id === "thermal_rift") regional = -Math.max(0, 18 - Math.hypot(x - 12, z - 99)) * 0.34;
    return (-0.5 + (folded + strata + detail + regional) * padBlend);
  }

  heightAt(x: number, z: number) {
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
    for (const stroke of this.strokes) {
      if (!["raise", "lower", "flatten", "smooth"].includes(stroke.brush)) continue;
      const distance = Math.hypot(x - stroke.x, z - stroke.z);
      if (distance > stroke.radius) continue;
      const falloff = Math.pow(1 - distance / stroke.radius, 2);
      if (stroke.brush === "raise") height += stroke.strength * falloff;
      if (stroke.brush === "lower") height -= stroke.strength * falloff;
      if (stroke.brush === "flatten") height += ((stroke.targetHeight ?? this.rawHeightAt(stroke.x, stroke.z)) - height) * Math.min(1, stroke.strength * falloff);
      if (stroke.brush === "smooth") height += (this.rawHeightAt(x, z) - height) * Math.min(1, stroke.strength * falloff * 0.45);
    }
    return height;
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
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestHeight = zone.rooms[0].center.y;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
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
    const noise = hashNoise(Math.floor(x / 3), Math.floor(z / 3), this.definition.seed + 91);
    let surface: SurfaceType = "stable";
    const resourcePad = RESOURCE_ANCHORS.find((anchor) => anchor.stratumId === "surface"
      && Math.hypot(x - (anchor.position.x + 1), z - (anchor.position.z + 1)) <= 2.6);
    const paintedSurface = [...this.strokes].reverse().find((stroke) => stroke.brush === "surface"
      && stroke.surface && Math.hypot(x - stroke.x, z - stroke.z) <= stroke.radius)?.surface;
    if (paintedSurface) surface = paintedSurface;
    else if (resourcePad?.itemId === "crude_oil") surface = "hazard";
    else if (resourcePad) surface = "stable";
    else if (slopeDegrees >= 24) surface = "steep";
    else if (biome.id === "blackwater_marsh" && height < -1.4) surface = noise > 0.38 ? "hazard" : "submerged";
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
    const biome = this.biomeAt(x, z);
    return BIOME_BY_ID.get(biome.id)?.palette.ground ?? 0x263a3f;
  }
}
