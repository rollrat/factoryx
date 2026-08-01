import type { BuildingId } from "../domain/types.ts";
import type { BuildType, StructureData } from "../types.ts";
import type { DataDrivenWorld, WorldPlacementResult } from "./world.ts";

export type LegacyBuildingResolver = (type: BuildType) => BuildingId;

export type LegacyWorldMigrationResult = Readonly<{
  linkedInstanceIds: readonly string[];
  placedInstanceIds: readonly string[];
  skipped: readonly Readonly<{
    structureId: number;
    reason: Extract<WorldPlacementResult, { ok: false }>["reason"] | "unknown_building";
  }>[];
}>;

const sameTransform = (
  instance: ReturnType<DataDrivenWorld["allInstances"]>[number],
  structure: StructureData,
  buildingId: BuildingId,
) => instance.definitionId === buildingId
  && instance.position.x === structure.x
  && instance.position.z === structure.z
  && instance.rotation === structure.rotation;

/**
 * Connects visual-prototype save structures to the definition-driven world.
 *
 * Older saves could contain a populated visual simulation alongside an empty
 * world snapshot. Those structures must become real world instances so
 * production, power, collision, persistence and the live Atlas all observe
 * the same factory. Migration placement waives construction cost because the
 * legacy structure was already paid for in the old economy.
 */
export const migrateLegacyStructuresIntoWorld = (
  world: DataDrivenWorld,
  structures: readonly StructureData[],
  resolveBuildingId: LegacyBuildingResolver,
): LegacyWorldMigrationResult => {
  const claimedInstanceIds = new Set(structures.flatMap(({ worldInstanceId }) => (
    worldInstanceId ? [worldInstanceId] : []
  )));
  const linkedInstanceIds: string[] = [];
  const placedInstanceIds: string[] = [];
  const skipped: Array<{
    structureId: number;
    reason: Extract<WorldPlacementResult, { ok: false }>["reason"] | "unknown_building";
  }> = [];

  structures.forEach((structure) => {
    if (structure.worldInstanceId && world.instance(structure.worldInstanceId)) return;

    const buildingId = structure.buildingId ?? resolveBuildingId(structure.type);
    if (!world.registry.buildings.has(buildingId)) {
      skipped.push({ structureId: structure.id, reason: "unknown_building" });
      return;
    }

    const existing = world.allInstances().find((instance) => (
      !claimedInstanceIds.has(instance.id) && sameTransform(instance, structure, buildingId)
    ));
    if (existing) {
      structure.buildingId = buildingId;
      structure.worldInstanceId = existing.id;
      claimedInstanceIds.add(existing.id);
      linkedInstanceIds.push(existing.id);
      return;
    }

    const placed = world.place({
      buildingId,
      position: { x: structure.x, z: structure.z },
      rotation: structure.rotation as 0 | 1 | 2 | 3,
      waiveBuildCost: true,
    });
    if (!placed.ok) {
      skipped.push({ structureId: structure.id, reason: placed.reason });
      return;
    }

    structure.buildingId = buildingId;
    structure.worldInstanceId = placed.instance.id;
    claimedInstanceIds.add(placed.instance.id);
    placedInstanceIds.push(placed.instance.id);
  });

  return { linkedInstanceIds, placedInstanceIds, skipped };
};
