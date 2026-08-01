import type { MachineRuntimeState } from "./sim/contracts.ts";
import type { RuntimeItemId } from "./recipes/runtimeRecipes.ts";
import type { BuildingId, RecipeId } from "./domain/types.ts";

export type Tool =
  | "inspect"
  | "belt"
  | "splitter"
  | "merger"
  | "miner"
  | "smelter"
  | "crusher"
  | "assembler"
  | "storage"
  | "demolish";

export type CameraMode = "overview" | "firstPerson";

export type BuildType = Exclude<Tool, "inspect" | "demolish">;
export type MachineType = Exclude<BuildType, "belt" | "splitter" | "merger">;
export type LogisticsType = Extract<BuildType, "belt" | "splitter" | "merger">;
export type ItemType = RuntimeItemId;

export type StructureData = {
  id: number;
  type: BuildType;
  buildingId?: BuildingId;
  x: number;
  z: number;
  rotation: number;
};

export type Cell = { x: number; z: number };
export type Direction = { x: number; z: number };

export type MachinePorts = {
  input: Cell;
  inputs: Cell[];
  output: Cell;
  flow: Direction;
};

export type MachineState = {
  recipeId: RecipeId | null;
  input: ItemType[];
  output: ItemType[];
  progress: number;
  working: boolean;
  activity: number;
  animationTime: number;
  stored: number;
  storedItems: ItemType[];
  intakePulse: number;
};

export type BeltItem = {
  id: number;
  type: ItemType;
  progress: number;
  incoming?: Direction;
};

export type BeltBuildInfo = {
  dragging: boolean;
  length: number;
  cost: number;
  valid: boolean;
  connectedStart: boolean;
};

export type PowerInfo = {
  supplyMW: number;
  demandMW: number;
  servedMW: number;
  overloaded: boolean;
};

export type ProjectInfo = {
  stageName: string;
  delivered: number;
  total: number;
  completed: boolean;
  requirements: readonly Readonly<{
    itemId: ItemType;
    name: string;
    delivered: number;
    total: number;
  }>[];
};

export type HistoryEntry = {
  added: StructureData[];
  removed: StructureData[];
  creditDelta: number;
};

export type SelectedInfo = {
  id: number;
  type: BuildType;
  buildingId?: BuildingId;
  status: string;
  runtimeState?: MachineRuntimeState;
  recipeName?: string;
  inputItems?: readonly Readonly<{ itemId: ItemType; name: string; amount: number }>[];
  outputItems?: readonly Readonly<{ itemId: ItemType; name: string; amount: number }>[];
  progress: number;
  inputCount: number;
  inputCapacity?: number;
  outputCount: number;
  outputCapacity?: number;
} | null;

export type GameCallbacks = {
  onCredits: (credits: number) => void;
  onMotors: (motors: number) => void;
  onSelected: (selected: SelectedInfo) => void;
  onToast: (message: string) => void;
  onToolChange: (tool: Tool) => void;
  onCameraMode: (mode: CameraMode) => void;
  onPointerLock: (locked: boolean) => void;
  onBeltBuildInfo: (info: BeltBuildInfo) => void;
  onPower: (power: PowerInfo) => void;
  onProject: (project: ProjectInfo) => void;
};

// New data-driven contracts live beside the legacy prototype types so the
// runtime can migrate one vertical slice at a time without breaking the game.
export type {
  BuildingDefinition,
  BuildingId,
  DefinitionRegistry,
  ItemDefinition,
  ItemId,
  PortDefinition,
  PortId,
  ProjectStageDefinition,
  RecipeDefinition,
  RecipeId,
  UnlockId,
} from "./domain/types";

export type {
  MachineRuntimeState,
  MachineSnapshot,
  SimulationCommand,
  SimulationSnapshot,
} from "./sim/contracts";
