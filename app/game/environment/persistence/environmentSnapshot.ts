import type { EnvironmentDefinition } from "../types.ts";
import type { EnvironmentCycleSnapshot } from "../EnvironmentCycle.ts";

export type EnvironmentSnapshot = Readonly<{
  version: 1 | 2;
  environmentId: string;
  environmentVersion: number;
  seed: number;
  removedPropIds: readonly string[];
  stabilizedHazardIds: readonly string[];
  cycle?: EnvironmentCycleSnapshot;
}>;

export const createEnvironmentSnapshot = (
  definition: EnvironmentDefinition,
  deltas: Readonly<{ removedPropIds?: readonly string[]; stabilizedHazardIds?: readonly string[] }> = {},
  cycle?: EnvironmentCycleSnapshot,
): EnvironmentSnapshot => ({
  version: cycle ? 2 : 1,
  environmentId: definition.id,
  environmentVersion: definition.version,
  seed: definition.seed,
  removedPropIds: [...new Set(deltas.removedPropIds ?? [])].sort(),
  stabilizedHazardIds: [...new Set(deltas.stabilizedHazardIds ?? [])].sort(),
  ...(cycle ? { cycle: { ...cycle } } : {}),
});

export const isEnvironmentSnapshotCompatible = (value: unknown, definition: EnvironmentDefinition): value is EnvironmentSnapshot => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<EnvironmentSnapshot>;
  return (snapshot.version === 1 || snapshot.version === 2)
    && snapshot.environmentId === definition.id
    && typeof snapshot.environmentVersion === "number"
    && snapshot.environmentVersion <= definition.version
    && Number.isSafeInteger(snapshot.seed)
    && Array.isArray(snapshot.removedPropIds) && snapshot.removedPropIds.every((id) => typeof id === "string")
    && Array.isArray(snapshot.stabilizedHazardIds) && snapshot.stabilizedHazardIds.every((id) => typeof id === "string")
    && (snapshot.version === 1 || (snapshot.cycle !== undefined
      && typeof snapshot.cycle.dayElapsedSeconds === "number" && Number.isFinite(snapshot.cycle.dayElapsedSeconds) && snapshot.cycle.dayElapsedSeconds >= 0
      && typeof snapshot.cycle.weatherElapsedSeconds === "number" && Number.isFinite(snapshot.cycle.weatherElapsedSeconds) && snapshot.cycle.weatherElapsedSeconds >= 0));
};
