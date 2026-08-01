import type { BuildType } from "../types.ts";

export const FIELD_CORE_CAPACITY_MW = 24;

export const POWER_DEMAND_MW = {
  miner: 4,
  smelter: 8,
  crusher: 6,
  assembler: 10,
  storage: 1,
  belt: 0,
  splitter: 0,
  merger: 0,
} as const satisfies Record<BuildType, number>;

export type PowerLoad = Readonly<{
  structureId: number;
  type: BuildType;
  /** Lower values are served first. Equal priorities use structureId order. */
  priority?: number;
}>;

export type PowerStructureResult = Readonly<{
  structureId: number;
  type: BuildType;
  priority: number;
  demandMW: number;
  servedMW: number;
  powered: boolean;
}>;

export type PowerGridResult = Readonly<{
  supplyMW: number;
  demandMW: number;
  servedMW: number;
  overloaded: boolean;
  structures: readonly PowerStructureResult[];
  poweredByStructureId: ReadonlyMap<number, boolean>;
}>;

const assertFiniteNonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
};

/**
 * Computes a binary, deterministic power dispatch. Loads are never partially
 * powered: each receives its full demand or is shed for this snapshot.
 */
export function computePowerGrid(
  loads: readonly PowerLoad[],
  supplyMW = FIELD_CORE_CAPACITY_MW,
): PowerGridResult {
  assertFiniteNonNegative(supplyMW, "supplyMW");
  const ids = new Set<number>();
  const normalized = loads.map((load) => {
    if (!Number.isSafeInteger(load.structureId) || load.structureId < 0) {
      throw new RangeError("structureId must be a non-negative safe integer");
    }
    if (ids.has(load.structureId)) throw new Error(`duplicate power load structureId: ${load.structureId}`);
    ids.add(load.structureId);
    const priority = load.priority ?? 0;
    if (!Number.isFinite(priority)) throw new RangeError("priority must be finite");
    return { ...load, priority, demandMW: POWER_DEMAND_MW[load.type] };
  });

  const demandMW = normalized.reduce((total, load) => total + load.demandMW, 0);
  const dispatchOrder = [...normalized].sort((a, b) => (
    a.priority - b.priority || a.structureId - b.structureId
  ));
  const resultById = new Map<number, PowerStructureResult>();
  let remainingMW = supplyMW;
  let servedMW = 0;

  dispatchOrder.forEach((load) => {
    const powered = load.demandMW === 0 || load.demandMW <= remainingMW;
    const structureServedMW = powered ? load.demandMW : 0;
    remainingMW -= structureServedMW;
    servedMW += structureServedMW;
    resultById.set(load.structureId, {
      structureId: load.structureId,
      type: load.type,
      priority: load.priority,
      demandMW: load.demandMW,
      servedMW: structureServedMW,
      powered,
    });
  });

  const structures = [...resultById.values()].sort((a, b) => a.structureId - b.structureId);
  return {
    supplyMW,
    demandMW,
    servedMW,
    overloaded: demandMW > supplyMW,
    structures,
    poweredByStructureId: new Map(structures.map((structure) => [structure.structureId, structure.powered])),
  };
}

