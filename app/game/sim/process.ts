import type { ItemId, RecipeDefinition, RecipeId } from "../domain/types.ts";
import { SIMULATION_TICK_SECONDS, type MachineRuntimeState } from "./contracts.ts";
import {
  consumeInputsAtomically,
  canProduceOutputsAtomically,
  produceOutputsAtomically,
  type InventoryTransactionResult,
  type PortInventoryMap,
} from "./inventory.ts";

export type WorkInProgress = Readonly<{
  recipeId: RecipeId;
  inputs: readonly Readonly<{ itemId: ItemId; amount: number }>[];
  elapsedSeconds: number;
  completed: boolean;
}>;

export type RecipeProcessSnapshot = Readonly<{
  recipeId: RecipeId;
  runtimeState: MachineRuntimeState;
  progress: number;
  workInProgress: WorkInProgress | null;
  completedCycles: number;
}>;

export type ProcessStepOptions = Readonly<{
  paused?: boolean;
  connectedPortIds?: ReadonlySet<string>;
  speed?: number;
  deltaSeconds?: number;
}>;

const aggregateWipInputs = (recipe: RecipeDefinition) => {
  const amounts = new Map<ItemId, number>();
  recipe.inputs.forEach(({ itemId, amount }) => amounts.set(itemId, (amounts.get(itemId) ?? 0) + amount));
  return [...amounts].map(([itemId, amount]) => ({ itemId, amount }));
};

const isDisconnected = (recipe: RecipeDefinition, connected?: ReadonlySet<string>) => {
  if (!connected) return false;
  return [...recipe.inputs, ...recipe.outputs].some(({ portId }) => !connected.has(portId));
};

const progressFor = (wip: WorkInProgress | null, durationSeconds: number) => {
  if (!wip) return 0;
  return Math.min(1, wip.elapsedSeconds / durationSeconds);
};

/**
 * Stateful recipe runner with transactional input consumption and output
 * creation. Its only side effects are changes to the supplied port inventories.
 */
export class RecipeProcess {
  readonly recipe: RecipeDefinition;
  private wip: WorkInProgress | null = null;
  private state: MachineRuntimeState = "idle";
  private cycles = 0;

  constructor(recipe: RecipeDefinition, snapshot?: RecipeProcessSnapshot) {
    if (!Number.isFinite(recipe.durationSeconds) || recipe.durationSeconds <= 0) {
      throw new RangeError("recipe durationSeconds must be greater than zero");
    }
    this.recipe = recipe;
    if (snapshot) this.restore(snapshot);
  }

  step(inputs: PortInventoryMap, outputs: PortInventoryMap, options: ProcessStepOptions = {}) {
    const deltaSeconds = options.deltaSeconds ?? SIMULATION_TICK_SECONDS;
    const speed = options.speed ?? 1;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be non-negative");
    if (!Number.isFinite(speed) || speed < 0) throw new RangeError("speed must be non-negative");

    if (options.paused) {
      this.state = "paused";
      return this.snapshot();
    }
    if (isDisconnected(this.recipe, options.connectedPortIds)) {
      this.state = "disconnected";
      return this.snapshot();
    }

    if (!this.wip) {
      const outputSpace = canProduceOutputsAtomically(outputs, this.recipe.outputs);
      if (!outputSpace.ok) {
        this.state = outputSpace.reason === "missing_port" ? "disconnected" : "blocked";
        return this.snapshot();
      }
      const start = consumeInputsAtomically(inputs, this.recipe.inputs);
      if (!start.ok) {
        this.state = start.reason === "missing_port" ? "disconnected" : "starved";
        return this.snapshot();
      }
      this.wip = {
        recipeId: this.recipe.id,
        inputs: aggregateWipInputs(this.recipe),
        elapsedSeconds: 0,
        completed: false,
      };
    }

    if (!this.wip.completed) {
      const elapsedSeconds = Math.min(
        this.recipe.durationSeconds,
        this.wip.elapsedSeconds + deltaSeconds * speed,
      );
      this.wip = {
        ...this.wip,
        elapsedSeconds,
        completed: elapsedSeconds >= this.recipe.durationSeconds,
      };
    }

    if (this.wip.completed) {
      const result = produceOutputsAtomically(outputs, this.recipe.outputs);
      if (!result.ok) {
        this.state = result.reason === "missing_port" ? "disconnected" : "blocked";
        return this.snapshot();
      }
      this.wip = null;
      this.cycles += 1;
      this.state = "idle";
      return this.snapshot();
    }

    this.state = "working";
    return this.snapshot();
  }

  snapshot(): RecipeProcessSnapshot {
    return {
      recipeId: this.recipe.id,
      runtimeState: this.state,
      progress: progressFor(this.wip, this.recipe.durationSeconds),
      workInProgress: this.wip ? {
        ...this.wip,
        inputs: this.wip.inputs.map((input) => ({ ...input })),
      } : null,
      completedCycles: this.cycles,
    };
  }

  restore(snapshot: RecipeProcessSnapshot) {
    if (snapshot.recipeId !== this.recipe.id) throw new Error("process snapshot recipe does not match");
    if (!Number.isInteger(snapshot.completedCycles) || snapshot.completedCycles < 0) {
      throw new RangeError("completedCycles must be a non-negative integer");
    }
    if (snapshot.workInProgress) {
      if (snapshot.workInProgress.recipeId !== this.recipe.id) throw new Error("WIP recipe does not match");
      if (snapshot.workInProgress.elapsedSeconds < 0
        || snapshot.workInProgress.elapsedSeconds > this.recipe.durationSeconds) {
        throw new RangeError("WIP elapsedSeconds is outside the recipe duration");
      }
    }
    this.wip = snapshot.workInProgress ? {
      ...snapshot.workInProgress,
      inputs: snapshot.workInProgress.inputs.map((input) => ({ ...input })),
    } : null;
    this.state = snapshot.runtimeState;
    this.cycles = snapshot.completedCycles;
  }
}

export const classifyInventoryFailure = (result: InventoryTransactionResult): MachineRuntimeState => {
  if (result.ok) return "idle";
  if (result.reason === "missing_port") return "disconnected";
  if (result.reason === "insufficient_capacity") return "blocked";
  return "starved";
};
