import type { ItemStack, ProjectStageId, UnlockId } from "../domain/types.ts";

export type CampaignMode = "campaign" | "sandbox";

export const CAMPAIGN_UNLOCK_STAGE: Readonly<Partial<Record<UnlockId, ProjectStageId>>> = {
  phase_1_complete: "phase_1_settlement_package",
  phase_2_complete: "phase_2_industrial_power_node",
  phase_3_complete: "phase_3_automation_core",
  chemistry_stable: "phase_4_chemistry_stabilization",
  thermal_verified: "phase_4_thermal_management_verification",
};

// Enough to place the first iron line, its local distribution pole and a short belt run.
export const CAMPAIGN_START_INVENTORY = [
  { itemId: "iron_plate", amount: 80 },
  { itemId: "iron_rod", amount: 24 },
  { itemId: "fastener_pack", amount: 24 },
  { itemId: "construction_block", amount: 20 },
] as const satisfies readonly ItemStack[];

export const SANDBOX_PROJECT_TARGET = { itemId: "automation_core", amount: 20 } as const;
