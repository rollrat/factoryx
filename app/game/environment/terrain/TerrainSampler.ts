import { BIOMES, BIOME_BY_ID } from "../data/biomes.ts";
import type { BiomeDefinition, EnvironmentDefinition, SurfaceType, TerrainSample } from "../types.ts";

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

  constructor(definition: EnvironmentDefinition) {
    this.definition = definition;
  }

  biomeAt(x: number, z: number) {
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

  heightAt(x: number, z: number) {
    const padDistance = Math.max(Math.abs(x) - 13.5, Math.abs(z) - 13.5, 0);
    const padBlend = smoothstep(padDistance / 12);
    if (padBlend === 0) return -0.5;
    const folded = Math.sin((x + z * 0.32) * 0.075) * 2.8;
    const strata = Math.sin(x * 0.031 - z * 0.061) * 4.2;
    const detail = hashNoise(Math.floor(x / 4), Math.floor(z / 4), this.definition.seed) * 0.8;
    const biome = this.biomeAt(x, z);
    let regional = 0;
    if (biome.id === "ironwind_faults") regional = Math.max(0, (x - 38) * 0.075);
    if (biome.id === "hematite_crown") regional = Math.max(0, (-x - 34) * 0.09);
    if (biome.id === "blackwater_marsh") regional = -2.2;
    if (biome.id === "thermal_rift") regional = -Math.max(0, 18 - Math.hypot(x - 12, z - 99)) * 0.34;
    return (-0.5 + (folded + strata + detail + regional) * padBlend);
  }

  constructionHeightAt(x: number, z: number) {
    return Math.max(Math.abs(x), Math.abs(z)) <= 13.5 ? 0 : this.heightAt(x, z);
  }

  sample(x: number, z: number, stratumId: string = "surface"): TerrainSample {
    if (stratumId !== "surface") {
      return {
        height: -12,
        normal: { x: 0, y: 1, z: 0 },
        slopeDegrees: 0,
        biomeId: "thermal_rift",
        surface: "cave_floor",
        buildability: "foundation_required",
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
    if (slopeDegrees >= 24) surface = "steep";
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
