import type { BuildingId, GridCell, ItemId, RecipeId, UnlockId } from "../domain/types.ts";

export type ResourceAnchorDefinition = Readonly<{
  id: string;
  itemId: ItemId;
  position: GridCell;
  extractionBuildingId: BuildingId;
  recipeId: RecipeId;
  unlockId: UnlockId;
  medium: "solid" | "fluid";
  stratumId: string;
  elevation?: number;
}>;

export const RESOURCE_ANCHORS = [
  { id: "iron_vein_a17", itemId: "iron_ore", position: { x: -8, z: -3 }, extractionBuildingId: "vein_miner", recipeId: "mine_iron_ore", unlockId: "start", medium: "solid", stratumId: "surface" },
  { id: "copper_vein_a17", itemId: "copper_ore", position: { x: 7, z: 4 }, extractionBuildingId: "vein_miner", recipeId: "mine_copper_ore", unlockId: "start", medium: "solid", stratumId: "surface" },
  { id: "limestone_vein_a17", itemId: "limestone", position: { x: -7, z: 7 }, extractionBuildingId: "vein_miner", recipeId: "mine_limestone", unlockId: "start", medium: "solid", stratumId: "surface" },
  { id: "coal_vein_a17", itemId: "coal", position: { x: 68, z: -54 }, extractionBuildingId: "vein_miner", recipeId: "mine_coal", unlockId: "phase_1_complete", medium: "solid", stratumId: "surface" },
  { id: "quartz_vein_a17", itemId: "quartz", position: { x: -66, z: 20 }, extractionBuildingId: "vein_miner", recipeId: "mine_quartz", unlockId: "phase_2_complete", medium: "solid", stratumId: "surface" },
  { id: "crude_oil_well_a17", itemId: "crude_oil", position: { x: 72, z: 58 }, extractionBuildingId: "fluid_extractor", recipeId: "extract_crude_oil", unlockId: "phase_3_complete", medium: "fluid", stratumId: "surface" },
  { id: "bauxite_vein_a17", itemId: "bauxite", position: { x: -62, z: -75 }, extractionBuildingId: "vein_miner", recipeId: "mine_bauxite", unlockId: "chemistry_stable", medium: "solid", stratumId: "surface" },
  { id: "tungsten_vein_a17", itemId: "tungsten_ore", position: { x: -7, z: 118 }, extractionBuildingId: "vein_miner", recipeId: "mine_tungsten_ore", unlockId: "thermal_verified", medium: "solid", stratumId: "rift_depths", elevation: -22 },
] as const satisfies readonly ResourceAnchorDefinition[];

const anchorByCell = new Map(RESOURCE_ANCHORS.map((anchor) => [`${anchor.stratumId}:${anchor.position.x},${anchor.position.z}`, anchor]));

export const getResourceAnchorAt = (position: GridCell, stratumId = "surface"): ResourceAnchorDefinition | null => (
  anchorByCell.get(`${stratumId}:${position.x},${position.z}`) ?? null
);

export const getResourceAnchor = (id: string): ResourceAnchorDefinition | null => (
  RESOURCE_ANCHORS.find((anchor) => anchor.id === id) ?? null
);
