import type { ProjectStageDefinition } from "../domain/types.ts";

export const START_PROJECT_STAGES = [
  {
    id: "phase_1_settlement_package",
    prerequisiteIds: [],
    deliveries: [
      { itemId: "iron_plate", amount: 120, medium: "solid", portId: "phase1_plate_in", commitPolicy: "solid_lock_complete" },
      { itemId: "construction_block", amount: 80, medium: "solid", portId: "phase1_block_in", commitPolicy: "solid_lock_complete" },
      { itemId: "fastener_pack", amount: 40, medium: "solid", portId: "phase1_fastener_in", commitPolicy: "solid_lock_complete" },
    ],
    // Later slices append phase_1_complete definitions and their IDs here.
    rewards: { itemIds: [], recipeIds: [], buildingIds: [] },
    dockPowerMode: "manual",
  },
] as const satisfies readonly ProjectStageDefinition[];
