import type { EnvironmentDefinition } from "../types.ts";

export type EnvironmentSnapshot = Readonly<{
  version: 1;
  environmentId: string;
  environmentVersion: number;
  seed: number;
  removedPropIds: readonly string[];
  stabilizedHazardIds: readonly string[];
}>;

export const createEnvironmentSnapshot = (
  definition: EnvironmentDefinition,
  deltas: Readonly<{ removedPropIds?: readonly string[]; stabilizedHazardIds?: readonly string[] }> = {},
): EnvironmentSnapshot => ({
  version: 1,
  environmentId: definition.id,
  environmentVersion: definition.version,
  seed: definition.seed,
  removedPropIds: [...new Set(deltas.removedPropIds ?? [])].sort(),
  stabilizedHazardIds: [...new Set(deltas.stabilizedHazardIds ?? [])].sort(),
});

export const isEnvironmentSnapshotCompatible = (value: unknown, definition: EnvironmentDefinition): value is EnvironmentSnapshot => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<EnvironmentSnapshot>;
  return snapshot.version === 1
    && snapshot.environmentId === definition.id
    && typeof snapshot.environmentVersion === "number"
    && snapshot.environmentVersion <= definition.version
    && Number.isSafeInteger(snapshot.seed)
    && Array.isArray(snapshot.removedPropIds) && snapshot.removedPropIds.every((id) => typeof id === "string")
    && Array.isArray(snapshot.stabilizedHazardIds) && snapshot.stabilizedHazardIds.every((id) => typeof id === "string");
};
