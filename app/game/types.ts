import type { MachineRuntimeState } from "./sim/contracts.ts";

export type Tool =
  | "inspect"
  | "belt"
  | "miner"
  | "smelter"
  | "assembler"
  | "storage"
  | "demolish";

export type CameraMode = "overview" | "firstPerson";

export type BuildType = Exclude<Tool, "inspect" | "demolish">;
export type MachineType = Exclude<BuildType, "belt">;
export type ItemType = "ore" | "ingot" | "component";

export type StructureData = {
  id: number;
  type: BuildType;
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
  input: ItemType[];
  output: ItemType[];
  progress: number;
  working: boolean;
  activity: number;
  animationTime: number;
  stored: number;
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

export type HistoryEntry = {
  added: StructureData[];
  removed: StructureData[];
  creditDelta: number;
};

export type SelectedInfo = {
  id: number;
  type: BuildType;
  status: string;
  runtimeState?: MachineRuntimeState;
  recipeName?: string;
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
