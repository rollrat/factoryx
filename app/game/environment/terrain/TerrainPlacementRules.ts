import type { BuildingDefinition, GridCell } from "../../domain/types.ts";
import type { TerrainBuildability, TerrainSample } from "../types.ts";
import { TerrainSampler } from "./TerrainSampler.ts";

export type TerrainPlacementVerdict = Readonly<{
  allowed: boolean;
  requiresFoundation: boolean;
  reason?: "terrain_steep" | "terrain_submerged" | "terrain_hazard" | "terrain_clearance";
  worst: TerrainSample;
}>;

const rank: Readonly<Record<TerrainBuildability, number>> = { allowed: 0, foundation_required: 1, restricted: 2 };

export const evaluateTerrainPlacement = (
  sampler: TerrainSampler,
  definition: BuildingDefinition,
  position: GridCell,
  rotation: 0 | 1 | 2 | 3,
  stratumId = "surface",
): TerrainPlacementVerdict => {
  const width = rotation % 2 === 0 ? definition.footprint.x : definition.footprint.z;
  const depth = rotation % 2 === 0 ? definition.footprint.z : definition.footprint.x;
  const samples: TerrainSample[] = [];
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) samples.push(sampler.sample(position.x + x, position.z + z, stratumId));
  }
  const worst = samples.reduce((a, b) => rank[b.buildability] > rank[a.buildability] ? b : a);
  if (worst.surface === "steep") return { allowed: false, requiresFoundation: false, reason: "terrain_steep", worst };
  if (worst.surface === "submerged") return { allowed: false, requiresFoundation: false, reason: "terrain_submerged", worst };
  if (worst.surface === "hazard") return { allowed: false, requiresFoundation: false, reason: "terrain_hazard", worst };
  const heights = samples.map(({ height }) => height);
  if (Math.max(...heights) - Math.min(...heights) > 0.7) {
    return { allowed: false, requiresFoundation: true, reason: "terrain_clearance", worst };
  }
  return { allowed: true, requiresFoundation: worst.buildability === "foundation_required", worst };
};
