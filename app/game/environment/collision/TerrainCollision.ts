import type { WorldPoint2 } from "../../sim/firstPersonCollision.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";

export type TerrainMovementResult = Readonly<{
  position: WorldPoint2;
  blocked: boolean;
  elevation: number;
}>;

const canTraverse = (sampler: TerrainSampler, from: WorldPoint2, to: WorldPoint2) => {
  const start = sampler.sample(from.x, from.z);
  const end = sampler.sample(to.x, to.z);
  if (["submerged", "hazard"].includes(end.surface)) return false;
  if (end.slopeDegrees > 38) return false;
  return Math.abs(end.height - start.height) <= 0.72;
};

/** Axis-separated terrain traversal preserves wall sliding against authored cliffs. */
export const resolveTerrainMovement = (
  sampler: TerrainSampler,
  start: WorldPoint2,
  desired: WorldPoint2,
): TerrainMovementResult => {
  const afterX = canTraverse(sampler, start, { x: desired.x, z: start.z })
    ? { x: desired.x, z: start.z }
    : { ...start };
  const afterZ = canTraverse(sampler, afterX, { x: afterX.x, z: desired.z })
    ? { x: afterX.x, z: desired.z }
    : afterX;
  return {
    position: afterZ,
    blocked: afterZ.x !== desired.x || afterZ.z !== desired.z,
    elevation: sampler.constructionHeightAt(afterZ.x, afterZ.z),
  };
};
