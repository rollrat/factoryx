import type { GridCell } from "../domain/types.ts";

export type ShaftPairEndpoint = Readonly<{
  stratumId: string;
  position: GridCell;
  rotation: 0 | 1 | 2 | 3;
}>;

export type ShaftPairDefinition = Readonly<{
  id: string;
  zoneId: string;
  surface: ShaftPairEndpoint & Readonly<{ stratumId: "surface" }>;
  underground: ShaftPairEndpoint;
}>;

/**
 * Authored vertical logistics routes. A shaft socket is only allowed to bridge
 * strata when both endpoints occupy the two sites of the same pair.
 *
 * The origins are four cells apart because the 3x3 socket's facing ports meet
 * on the shared hand-off cell between the two authored endpoint footprints.
 */
export const SHAFT_PAIRS = [
  {
    id: "thermal_rift_service_shaft",
    zoneId: "thermal_rift_depths",
    surface: { stratumId: "surface", position: { x: 9, z: 98 }, rotation: 0 },
    underground: { stratumId: "rift_depths", position: { x: 13, z: 98 }, rotation: 0 },
  },
] as const satisfies readonly ShaftPairDefinition[];

export const shaftPairIdAt = (
  position: GridCell,
  rotation: 0 | 1 | 2 | 3,
  stratumId: string,
): string | null => {
  for (const pair of SHAFT_PAIRS) {
    for (const endpoint of [pair.surface, pair.underground]) {
      if (endpoint.stratumId === stratumId
        && endpoint.rotation === rotation
        && endpoint.position.x === position.x
        && endpoint.position.z === position.z) return pair.id;
    }
  }
  return null;
};
