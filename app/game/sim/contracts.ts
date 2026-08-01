import type { BuildingId, ItemId, PortId, RecipeId } from "../domain/types";

export const SIMULATION_TICK_SECONDS = 1 / 20;

export type PortInventorySnapshot = Readonly<{
  portId: PortId;
  itemId: ItemId | null;
  amount: number;
  capacity: number;
}>;

export type MachineRuntimeState =
  | "idle"
  | "working"
  | "starved"
  | "blocked"
  | "disconnected"
  | "paused";

export type MachineSnapshot = Readonly<{
  structureId: number;
  buildingId: BuildingId;
  recipeId: RecipeId | null;
  runtimeState: MachineRuntimeState;
  progress: number;
  inputBuffers: readonly PortInventorySnapshot[];
  outputBuffers: readonly PortInventorySnapshot[];
  workInProgress: readonly Readonly<{ itemId: ItemId; amount: number }>[];
}>;

export type SimulationSnapshot = Readonly<{
  version: 1;
  tick: number;
  elapsedSeconds: number;
  machines: readonly MachineSnapshot[];
}>;

export type SimulationCommand =
  | Readonly<{ type: "pause" }>
  | Readonly<{ type: "resume" }>
  | Readonly<{ type: "select_recipe"; structureId: number; recipeId: RecipeId }>;
