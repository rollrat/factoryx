export type Tool =
  | "inspect"
  | "belt"
  | "miner"
  | "smelter"
  | "assembler"
  | "storage"
  | "demolish";

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
};

export type BeltItem = {
  id: number;
  type: ItemType;
  progress: number;
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
  progress: number;
  inputCount: number;
  outputCount: number;
} | null;

export type GameCallbacks = {
  onCredits: (credits: number) => void;
  onMotors: (motors: number) => void;
  onSelected: (selected: SelectedInfo) => void;
  onToast: (message: string) => void;
  onToolChange: (tool: Tool) => void;
};
