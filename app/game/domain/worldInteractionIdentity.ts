import type { BuildingDefinition, BuildingId, BuildingInstance } from "./types.ts";

export type WorldInteractionOwnerId = string;

/**
 * The small part of a legacy StructureData record needed at the migration
 * boundary. StructureData values can be passed directly because they are
 * structurally compatible with this type.
 */
export type LegacyWorldInteractionLink = Readonly<{
  id: number;
  worldInstanceId?: WorldInteractionOwnerId;
}>;

/**
 * Canonical identity shared by selection, inspection, power and world state.
 * ownerId and worldInstanceId intentionally contain the same value: ownerId
 * is the interaction vocabulary while worldInstanceId makes the authority
 * explicit to legacy callers during migration.
 */
export type WorldInteractionIdentity = Readonly<{
  kind: "building";
  ownerId: WorldInteractionOwnerId;
  worldInstanceId: WorldInteractionOwnerId;
  definitionId: BuildingId;
  legacyStructureId: number | null;
  placementMode: BuildingDefinition["placementMode"];
  stratumId: string;
  selectable: true;
  inspectable: true;
  demolishable: boolean;
}>;

export type WorldInteractionIdentityReference =
  | Readonly<{ kind: "owner"; ownerId: WorldInteractionOwnerId }>
  | Readonly<{ kind: "legacy_structure"; structureId: number }>
  | Readonly<{ kind: "preplaced_definition"; definitionId: BuildingId }>;

export type WorldInteractionIdentityFailureReason =
  | "unknown_owner"
  | "unknown_legacy_structure"
  | "legacy_structure_unlinked"
  | "stale_legacy_link"
  | "unknown_definition"
  | "not_preplaced_unique"
  | "preplaced_instance_missing";

export type WorldInteractionIdentityResolution =
  | Readonly<{ ok: true; target: WorldInteractionIdentity }>
  | Readonly<{ ok: false; reason: WorldInteractionIdentityFailureReason }>;

export type WorldInteractionIdentitySource = Readonly<{
  instances: readonly BuildingInstance[];
  definitions: ReadonlyMap<BuildingId, BuildingDefinition>;
  legacyStructures?: readonly LegacyWorldInteractionLink[];
}>;

export type WorldInteractionIdentityResolver = Readonly<{
  /** Stable, owner-ID-sorted snapshot of every selectable world building. */
  targets: readonly WorldInteractionIdentity[];
  resolve: (reference: WorldInteractionIdentityReference) => WorldInteractionIdentityResolution;
  find: (reference: WorldInteractionIdentityReference) => WorldInteractionIdentity | null;
}>;

const success = (target: WorldInteractionIdentity): WorldInteractionIdentityResolution => ({
  ok: true,
  target,
});

const failure = (
  reason: WorldInteractionIdentityFailureReason,
): WorldInteractionIdentityResolution => ({ ok: false, reason });

/**
 * Builds an immutable identity index from a world snapshot plus the temporary
 * numeric-ID bridge used by legacy render groups.
 *
 * Preplaced definitions are resolved by the instance actually present in the
 * snapshot. No `preplaced:${definitionId}` string is synthesized, so restored
 * or migrated worlds remain authoritative.
 */
export const createWorldInteractionIdentityResolver = (
  source: WorldInteractionIdentitySource,
): WorldInteractionIdentityResolver => {
  const definitions = new Map(source.definitions);
  const instancesByOwnerId = new Map<WorldInteractionOwnerId, BuildingInstance>();
  source.instances.forEach((instance) => {
    if (instancesByOwnerId.has(instance.id)) {
      throw new Error(`duplicate world interaction owner ID: ${instance.id}`);
    }
    if (!definitions.has(instance.definitionId)) {
      throw new Error(`world interaction instance references unknown definition: ${instance.definitionId}`);
    }
    instancesByOwnerId.set(instance.id, instance);
  });

  const legacyLinksById = new Map<number, LegacyWorldInteractionLink>();
  const legacyIdByOwnerId = new Map<WorldInteractionOwnerId, number>();
  (source.legacyStructures ?? []).forEach((link) => {
    if (!Number.isSafeInteger(link.id) || link.id <= 0) {
      throw new RangeError(`legacy structure ID must be a positive safe integer: ${link.id}`);
    }
    if (legacyLinksById.has(link.id)) {
      throw new Error(`duplicate legacy structure ID: ${link.id}`);
    }
    legacyLinksById.set(link.id, { ...link });
    if (link.worldInstanceId === undefined) return;
    const prior = legacyIdByOwnerId.get(link.worldInstanceId);
    if (prior !== undefined) {
      throw new Error(
        `multiple legacy structures reference world owner ${link.worldInstanceId}: ${prior}, ${link.id}`,
      );
    }
    legacyIdByOwnerId.set(link.worldInstanceId, link.id);
  });

  const targetsByOwnerId = new Map<WorldInteractionOwnerId, WorldInteractionIdentity>();
  const preplacedByDefinitionId = new Map<BuildingId, WorldInteractionIdentity>();
  instancesByOwnerId.forEach((instance) => {
    const definition = definitions.get(instance.definitionId)!;
    const target: WorldInteractionIdentity = Object.freeze({
      kind: "building",
      ownerId: instance.id,
      worldInstanceId: instance.id,
      definitionId: instance.definitionId,
      legacyStructureId: legacyIdByOwnerId.get(instance.id) ?? null,
      placementMode: definition.placementMode,
      stratumId: instance.stratumId ?? "surface",
      selectable: true,
      inspectable: true,
      demolishable: definition.placementMode === "buildable"
        && definition.preplacedPolicy?.canDemolish !== false,
    });
    targetsByOwnerId.set(instance.id, target);

    if (definition.placementMode !== "preplaced_unique") return;
    if (preplacedByDefinitionId.has(definition.id)) {
      throw new Error(`multiple preplaced world instances use definition: ${definition.id}`);
    }
    preplacedByDefinitionId.set(definition.id, target);
  });

  const resolve = (
    reference: WorldInteractionIdentityReference,
  ): WorldInteractionIdentityResolution => {
    switch (reference.kind) {
      case "owner": {
        const target = targetsByOwnerId.get(reference.ownerId);
        return target ? success(target) : failure("unknown_owner");
      }
      case "legacy_structure": {
        const link = legacyLinksById.get(reference.structureId);
        if (!link) return failure("unknown_legacy_structure");
        if (link.worldInstanceId === undefined) return failure("legacy_structure_unlinked");
        const target = targetsByOwnerId.get(link.worldInstanceId);
        return target ? success(target) : failure("stale_legacy_link");
      }
      case "preplaced_definition": {
        const definition = definitions.get(reference.definitionId);
        if (!definition) return failure("unknown_definition");
        if (definition.placementMode !== "preplaced_unique") {
          return failure("not_preplaced_unique");
        }
        const target = preplacedByDefinitionId.get(reference.definitionId);
        return target ? success(target) : failure("preplaced_instance_missing");
      }
    }
  };

  const targets = Object.freeze(
    [...targetsByOwnerId.values()].sort((left, right) => left.ownerId.localeCompare(right.ownerId)),
  );

  return Object.freeze({
    targets,
    resolve,
    find: (reference: WorldInteractionIdentityReference) => {
      const resolution = resolve(reference);
      return resolution.ok ? resolution.target : null;
    },
  });
};
