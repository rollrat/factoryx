import type { ItemDefinition } from "../domain/types.ts";

export const START_ITEMS = [
  { id: "iron_ore", name: "철광석", category: "resource", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "ore_iron" },
  { id: "copper_ore", name: "구리광석", category: "resource", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "ore_copper" },
  { id: "limestone", name: "석회암", category: "resource", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "ore_limestone" },
  { id: "iron_ingot", name: "철 주괴", category: "material", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "ingot_iron", hubItem: true },
  { id: "copper_ingot", name: "구리 주괴", category: "material", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "ingot_copper" },
  { id: "iron_plate", name: "철판", category: "material", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "plate_iron", hubItem: true },
  { id: "iron_rod", name: "철봉", category: "material", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "rod_iron", hubItem: true },
  { id: "construction_block", name: "건축 블록", category: "material", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "block_construction" },
  { id: "fastener_pack", name: "체결재 팩", category: "part", medium: "solid", unlockId: "start", stackSize: 100, modelKey: "pack_fastener" },
] as const satisfies readonly ItemDefinition[];
