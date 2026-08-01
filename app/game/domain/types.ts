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
  | "thermal_verified"
  | "survey_casting";

export type TransportMedium = "solid" | "fluid" | "power";
export type PortDirection = "input" | "output" | "bidirectional";
export type ConnectorProfile =
  | "belt_standard"
  | "pipe_mk1"
  | "power_local"
  | "power_high_voltage";

export type GridCell = Readonly<{ x: number; z: number }>;
export type LocalPosition = Readonly<{ x: number; y: number; z: number }>;
export type ItemUnit = "item" | "m3";
export type ItemGeometryType =
  | "ore_chunk"
  | "crystal_cluster"
  | "ingot"
  | "plate"
  | "rod"
  | "rod_bundle"
  | "block"
  | "parts_pack"
  | "wire_coil"
  | "billet"
  | "gear_set"
  | "coil"
  | "motor"
  | "frame"
  | "circuit_board"
  | "core"
  | "resin_pellet"
  | "sheet"
  | "powder"
  | "sensor"
  | "electrode"
  | "case"
  | "beam"
  | "power_cell"
  | "actuator"
  | "shell"
  | "component"
  | "module"
  | "seed"
  | "mechanical_part"
  | "electronic_part"
  | "container"
  | "project_part"
  | "fluid";

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
  unit: ItemUnit;
  unlockId: UnlockId;
  milestoneId?: string;
  defaultColor: number | `#${string}`;
  geometryType: ItemGeometryType;
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

export type StoragePolicy = Readonly<{
  slotCount: number;
  lockToSingleItem: boolean;
  supportsInputFilter: boolean;
  supportsOutputFilter: boolean;
  defaultRoutingPolicy: "pass_through" | "fill_then_output" | "output_disabled";
}>;

export type BufferPolicy = Readonly<{
  reserveInputsAtomically: boolean;
  reserveAllOutputsBeforeStart: boolean;
  returnContentsOnRecipeChange: boolean;
  returnContentsOnDemolish: boolean;
}>;

export type PreplacedPolicy = Readonly<{
  worldAnchor: GridCell;
  fixedRotation: 0 | 1 | 2 | 3;
  canBuild: false;
  canClone: false;
  canDemolish: false;
}>;

export type TransportPolicy = Readonly<{
  throughputPerMinute: number;
  maxSegmentLengthTiles?: number;
}>;

export type GeneratorPolicy = Readonly<{
  capacityMW: number;
  fuelItemId?: ItemId;
  fuelRatePerMinute?: number;
  minimumLoadRatio: number;
  dispatchPriority: number;
}>;

export type PowerStoragePolicy = Readonly<{
  capacityMWh: number;
  maxChargeMW: number;
  maxDischargeMW: number;
}>;

export type DistributionPolicy = Readonly<{
  radiusTiles?: number;
  maxConsumers?: number;
  maxCableConnections: number;
}>;

export type FluidStoragePolicy = Readonly<{
  capacityM3: number;
  throughputM3PerMinute: number;
  locksFluidType: boolean;
}>;

export type FluidPumpPolicy = Readonly<{
  /** Maximum vertical lift at full power satisfaction. */
  headMeters: number;
}>;

export type TerrainInfrastructureRole =
  | "foundation"
  | "ramp"
  | "bridge"
  | "conveyor_lift"
  | "pipe_riser"
  | "wall_socket"
  | "shaft_socket"
  | "hazard_stabilizer";

export type TerrainPolicy = Readonly<{
  role?: TerrainInfrastructureRole;
  stabilizesSurface?: boolean;
  allowedOnRestrictedSurface?: boolean;
  elevationStep?: number;
  connectsStrata?: boolean;
}>;

export type BuildingDefinition = Readonly<{
  id: BuildingId;
  name: string;
  unlockId: UnlockId;
  placementMode: "buildable" | "preplaced_unique";
  footprint: Readonly<{ x: number; z: number }>;
  allowedRotations: readonly (0 | 1 | 2 | 3)[];
  ports: readonly PortDefinition[];
  recipeIds: readonly RecipeId[];
  processingSpeed?: number;
  activeMW?: number;
  idleMW?: number;
  buildCost: readonly BuildCost[];
  storageSlots?: number;
  storagePolicy?: StoragePolicy;
  bufferPolicy?: BufferPolicy;
  modelKey?: string;
  animationKey?: string;
  preplacedPolicy?: PreplacedPolicy;
  transportPolicy?: TransportPolicy;
  generatorPolicy?: GeneratorPolicy;
  powerStoragePolicy?: PowerStoragePolicy;
  distributionPolicy?: DistributionPolicy;
  fluidStoragePolicy?: FluidStoragePolicy;
  fluidPumpPolicy?: FluidPumpPolicy;
  terrainPolicy?: TerrainPolicy;
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
  completionUnlockId?: UnlockId;
  prerequisiteIds: readonly ProjectStageId[];
  deliveries: readonly ProjectDeliveryDefinition[];
  rewards: Readonly<{
    resourceIds?: readonly ItemId[];
    itemIds?: readonly ItemId[];
    recipeIds: readonly RecipeId[];
    buildingIds: readonly BuildingId[];
    constructionCredits?: Readonly<Record<string, number>>;
  }>;
  dockPowerMode: "manual" | "powered";
  requiredPowerMW?: number;
  completionSequence?: string;
  repeatable?: boolean;
}>;

export type ItemStack = Readonly<{ itemId: ItemId; amount: number }>;

export type BuildingInstance = Readonly<{
  id: string;
  definitionId: BuildingId;
  position: GridCell;
  rotation: 0 | 1 | 2 | 3;
  selectedRecipeId?: RecipeId;
  runtimeState: string;
  progress: number;
  inputBuffersByPortId: Readonly<Record<PortId, readonly ItemStack[]>>;
  outputBuffersByPortId: Readonly<Record<PortId, readonly ItemStack[]>>;
  workInProgress: readonly ItemStack[];
  /** Exact item cost paid for this instance, so sponsored construction cannot mint materials on demolition. */
  paidBuildCost?: readonly ItemStack[];
  constructionCreditPaid?: Readonly<{ id: string; amount: number }>;
  powerGridId?: string;
  elevation?: number;
  stratumId?: string;
}>;

export type StorageState = Readonly<{
  structureId: string;
  lockedItemId?: ItemId;
  inventory: number;
  reservedIncoming: number;
  reservedOutgoing: number;
  inputTransferItemId?: ItemId;
  inputEnabled: boolean;
  outputEnabled: boolean;
  outputFilterItemId?: ItemId;
  minimumReserve: number;
  routingPolicy: "pass_through" | "fill_then_output" | "output_disabled";
}>;

export type DefinitionRegistry = Readonly<{
  items: ReadonlyMap<ItemId, ItemDefinition>;
  recipes: ReadonlyMap<RecipeId, RecipeDefinition>;
  buildings: ReadonlyMap<BuildingId, BuildingDefinition>;
  projectStages: ReadonlyMap<ProjectStageId, ProjectStageDefinition>;
}>;
