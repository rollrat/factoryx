import type { WorldPoint2 } from "../../sim/firstPersonCollision.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";

export type TerrainMovementResult = Readonly<{
  position: WorldPoint2;
  blocked: boolean;
  elevation: number;
}>;

export type TerrainInfrastructureSurface = Readonly<{
  minX: number; maxX: number; minZ: number; maxZ: number;
  baseElevation: number;
  rise: number;
  rotation: 0 | 1 | 2 | 3;
  kind: "foundation" | "ramp" | "bridge";
}>;

export const infrastructureHeightAt = (
  x: number,
  z: number,
  surfaces: readonly TerrainInfrastructureSurface[],
) => {
  const surface = [...surfaces].reverse().find((candidate) => x >= candidate.minX && x <= candidate.maxX
    && z >= candidate.minZ && z <= candidate.maxZ);
  if (!surface) return null;
  if (surface.kind === "foundation") return surface.baseElevation;
  if (surface.kind === "bridge") return surface.baseElevation + surface.rise;
  const xProgress = (x - surface.minX) / Math.max(0.001, surface.maxX - surface.minX);
  const zProgress = (z - surface.minZ) / Math.max(0.001, surface.maxZ - surface.minZ);
  const progress = surface.rotation === 0 ? zProgress : surface.rotation === 1 ? xProgress
    : surface.rotation === 2 ? 1 - zProgress : 1 - xProgress;
  return surface.baseElevation + surface.rise * Math.max(0, Math.min(1, progress));
};

const canTraverse = (sampler: TerrainSampler, from: WorldPoint2, to: WorldPoint2, stratumId: string, surfaces: readonly TerrainInfrastructureSurface[]) => {
  const start = sampler.sample(from.x, from.z, stratumId);
  const end = sampler.sample(to.x, to.z, stratumId);
  const startInfrastructure = infrastructureHeightAt(from.x, from.z, surfaces);
  const endInfrastructure = infrastructureHeightAt(to.x, to.z, surfaces);
  if (endInfrastructure === null && ["submerged", "hazard"].includes(end.surface)) return false;
  if (endInfrastructure === null && end.slopeDegrees > 38) return false;
  return Math.abs((endInfrastructure ?? end.height) - (startInfrastructure ?? start.height)) <= 0.72;
};

/** Axis-separated terrain traversal preserves wall sliding against authored cliffs. */
export const resolveTerrainMovement = (
  sampler: TerrainSampler,
  start: WorldPoint2,
  desired: WorldPoint2,
  stratumId = "surface",
  surfaces: readonly TerrainInfrastructureSurface[] = [],
): TerrainMovementResult => {
  const afterX = canTraverse(sampler, start, { x: desired.x, z: start.z }, stratumId, surfaces)
    ? { x: desired.x, z: start.z }
    : { ...start };
  const afterZ = canTraverse(sampler, afterX, { x: afterX.x, z: desired.z }, stratumId, surfaces)
    ? { x: afterX.x, z: desired.z }
    : afterX;
  return {
    position: afterZ,
    blocked: afterZ.x !== desired.x || afterZ.z !== desired.z,
    elevation: infrastructureHeightAt(afterZ.x, afterZ.z, surfaces)
      ?? (stratumId === "surface" ? sampler.constructionHeightAt(afterZ.x, afterZ.z) : sampler.sample(afterZ.x, afterZ.z, stratumId).height),
  };
};
