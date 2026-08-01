export type ItemId = string;
export type RecipeId = string;
export type BuildingId = string;
export type PortId = string;
export type ProjectStageId = string;

export type UnlockId =
  | "start"
  | "phase_1_complete"
  | "phase_2_complete"
  | "phase_3_complete"
  | "chemistry_stable"
  | "thermal_verified";

export type TransportMedium = "solid" | "fluid" | "power";
export type PortDirection = "input" | "output" | "bidirectional";
export type ConnectorProfile =
  | "belt_standard"
  | "pipe_mk1"
  | "power_local"
  | "power_high_voltage";

export type GridCell = Readonly<{ x: number; z: number }>;
export type LocalPosition = Readonly<{ x: number; y: number; z: number }>;

export type PortDefinition = Readonly<{
  id: PortId;
  direction: PortDirection;
  medium: TransportMedium;
  connectorProfile: ConnectorProfile;
  connectionCell: GridCell;
  localPosition: LocalPosition;
  localFacing: GridCell;
  bufferSlots: number;
  acceptedItemIds: readonly ItemId[];
  deliverySlotId?: string;
}>;

export type ItemDefinition = Readonly<{
  id: ItemId;
  name: string;
  category: "resource" | "material" | "part" | "project" | "fluid";
  medium: "solid" | "fluid";
  unlockId: UnlockId;
  stackSize: number;
  modelKey: string;
  hubItem?: boolean;
}>;

export type RecipeAmount = Readonly<{
  itemId: ItemId;
  amount: number;
  portId: PortId;
}>;

export type RecipeOutput = RecipeAmount & Readonly<{
  role: "primary" | "byproduct";
}>;

export type RecipeDefinition = Readonly<{
  id: RecipeId;
  name: string;
  buildingId: BuildingId;
  inputs: readonly RecipeAmount[];
  outputs: readonly RecipeOutput[];
  durationSeconds: number;
  unlockId: UnlockId;
}>;

export type BuildCost = Readonly<{ itemId: ItemId; amount: number }>;

export type BuildingDefinition = Readonly<{
  id: BuildingId;
  name: string;
  unlockId: UnlockId;
  placementMode: "buildable" | "preplaced_unique";
  footprint: Readonly<{ x: number; z: number }>;
  allowedRotations: readonly (0 | 1 | 2 | 3)[];
  ports: readonly PortDefinition[];
  recipeIds: readonly RecipeId[];
  buildCost: readonly BuildCost[];
  storageSlots?: number;
}>;

export type ProjectDeliveryDefinition = Readonly<{
  itemId: ItemId;
  amount: number;
  medium: "solid" | "fluid";
  portId: PortId;
  commitPolicy: "solid_lock_complete" | "fluid_accepted_per_tick";
}>;

export type ProjectStageDefinition = Readonly<{
  id: ProjectStageId;
  prerequisiteIds: readonly ProjectStageId[];
  deliveries: readonly ProjectDeliveryDefinition[];
  rewards: Readonly<{
    itemIds: readonly ItemId[];
    recipeIds: readonly RecipeId[];
    buildingIds: readonly BuildingId[];
  }>;
  dockPowerMode: "manual" | "powered";
}>;

export type DefinitionRegistry = Readonly<{
  items: ReadonlyMap<ItemId, ItemDefinition>;
  recipes: ReadonlyMap<RecipeId, RecipeDefinition>;
  buildings: ReadonlyMap<BuildingId, BuildingDefinition>;
  projectStages: ReadonlyMap<ProjectStageId, ProjectStageDefinition>;
}>;
