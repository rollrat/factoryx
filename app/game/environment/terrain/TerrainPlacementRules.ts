import type { BuildingDefinition, GridCell } from "../../domain/types.ts";
import type { WorldTerrainPlacementValidator } from "../../sim/world.ts";
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

/**
 * Bridges authored terrain samples into the data-driven construction contract.
 * Keeping this policy beside the sampler prevents save restoration, previews,
 * and live placement from drifting into separate interpretations of A-17.
 */
export const createTerrainPlacementValidator = (sampler: TerrainSampler): WorldTerrainPlacementValidator => (
  definition,
  position,
  rotation,
  context,
) => {
  // Authored world anchors are structural parts of the survey pad. Legacy
  // saves predate elevations and must always be restorable at their anchors.
  if (definition.placementMode === "preplaced_unique") return { ok: true };
  if (context.stratumId !== "surface") {
    const width = rotation % 2 === 0 ? definition.footprint.x : definition.footprint.z;
    const depth = rotation % 2 === 0 ? definition.footprint.z : definition.footprint.x;
    const center = { x: position.x + width / 2, z: position.z + depth / 2 };
    const caveSpace = sampler.caveSpaceAt(center.x, center.z, context.stratumId);
    const requiredClearance = 2.2 + Math.max(width, depth) * 0.9;
    if (caveSpace.clearance < requiredClearance || (caveSpace.shortcut && width * depth > 4)) {
      return { ok: false, reason: "terrain_clearance", cell: position };
    }
  }
  const verdict = evaluateTerrainPlacement(sampler, definition, position, rotation, context.stratumId);
  const expectedElevation = context.supportElevation ?? (context.stratumId === "surface"
    ? sampler.constructionHeightAt(position.x, position.z)
    : sampler.caveHeightAt(position.x, position.z, context.stratumId));
  if (context.elevation !== undefined && Math.abs(context.elevation - expectedElevation) > 0.2) {
    return { ok: false, reason: "terrain_clearance", cell: position };
  }
  if (definition.terrainPolicy?.role === "hazard_stabilizer") return { ok: true };
  if (verdict.reason === "terrain_hazard" && context.hazardStabilized) return { ok: true };
  if (context.foundationCoverage && verdict.reason !== "terrain_hazard") return { ok: true };
  if (definition.terrainPolicy?.allowedOnRestrictedSurface && verdict.reason !== "terrain_hazard") return { ok: true };
  if (!verdict.allowed) return { ok: false, reason: verdict.reason ?? "terrain_clearance", cell: position };
  if (verdict.requiresFoundation && !context.foundationCoverage && definition.footprint.x * definition.footprint.z > 4) {
    return { ok: false, reason: "foundation_required", cell: position };
  }
  return { ok: true };
};
