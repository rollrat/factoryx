import type { BuildingId, GridCell, ItemId, RecipeId, UnlockId } from "../domain/types.ts";

export type ResourceAnchorDefinition = Readonly<{
  id: string;
  itemId: ItemId;
  position: GridCell;
  extractionBuildingId: BuildingId;
  recipeId: RecipeId;
  unlockId: UnlockId;
  medium: "solid" | "fluid";
}>;

export const RESOURCE_ANCHORS = [
  { id: "iron_vein_a17", itemId: "iron_ore", position: { x: -8, z: -3 }, extractionBuildingId: "vein_miner", recipeId: "mine_iron_ore", unlockId: "start", medium: "solid" },
  { id: "copper_vein_a17", itemId: "copper_ore", position: { x: 7, z: 4 }, extractionBuildingId: "vein_miner", recipeId: "mine_copper_ore", unlockId: "start", medium: "solid" },
  { id: "limestone_vein_a17", itemId: "limestone", position: { x: -7, z: 7 }, extractionBuildingId: "vein_miner", recipeId: "mine_limestone", unlockId: "start", medium: "solid" },
  { id: "coal_vein_a17", itemId: "coal", position: { x: 34, z: -28 }, extractionBuildingId: "vein_miner", recipeId: "mine_coal", unlockId: "phase_1_complete", medium: "solid" },
  { id: "quartz_vein_a17", itemId: "quartz", position: { x: -36, z: 12 }, extractionBuildingId: "vein_miner", recipeId: "mine_quartz", unlockId: "phase_2_complete", medium: "solid" },
  { id: "crude_oil_well_a17", itemId: "crude_oil", position: { x: 38, z: 32 }, extractionBuildingId: "fluid_extractor", recipeId: "extract_crude_oil", unlockId: "phase_3_complete", medium: "fluid" },
  { id: "bauxite_vein_a17", itemId: "bauxite", position: { x: -38, z: -38 }, extractionBuildingId: "vein_miner", recipeId: "mine_bauxite", unlockId: "chemistry_stable", medium: "solid" },
  { id: "tungsten_vein_a17", itemId: "tungsten_ore", position: { x: 8, z: 44 }, extractionBuildingId: "vein_miner", recipeId: "mine_tungsten_ore", unlockId: "thermal_verified", medium: "solid" },
] as const satisfies readonly ResourceAnchorDefinition[];

const anchorByCell = new Map(RESOURCE_ANCHORS.map((anchor) => [`${anchor.position.x},${anchor.position.z}`, anchor]));

export const getResourceAnchorAt = (position: GridCell): ResourceAnchorDefinition | null => (
  anchorByCell.get(`${position.x},${position.z}`) ?? null
);

export const getResourceAnchor = (id: string): ResourceAnchorDefinition | null => (
  RESOURCE_ANCHORS.find((anchor) => anchor.id === id) ?? null
);
