import type { ItemId } from "../domain/types.ts";
import type { MachineRuntimeState } from "../sim/contracts.ts";
import type { WorldProductionSimulation } from "../sim/worldProduction.ts";

export type ProductionMetric = Readonly<{
  itemId: ItemId;
  windowSeconds: number;
  producedPerMinute: number;
  consumedPerMinute: number;
  demandPerMinute: number;
  storedStock: number;
  bufferStock: number;
  inTransit: number;
  workInProgress: number;
  starvedSeconds: number;
  blockedSeconds: number;
  collecting: boolean;
  producerCount: number;
  workingProducerCount: number;
  health: "idle" | "working" | "partial" | "starved" | "blocked";
}>;

type Sample = Readonly<{
  at: number;
  duration: number;
  itemId: ItemId;
  produced: number;
  consumed: number;
  starved: number;
  blocked: number;
}>;

const statusDuration = (status: MachineRuntimeState, expected: MachineRuntimeState, duration: number) => status === expected ? duration : 0;

/** Low-frequency rolling metrics derived from fixed-tick production counters. */
export class ProductionMetricCollector {
  private readonly samples: Sample[] = [];
  private readonly previous = new Map<string, Readonly<{ at: number; cycles: number; state: MachineRuntimeState }>>();
  private startedAt: number | null = null;
  readonly windowSeconds: number;
  readonly warmupSeconds: number;

  constructor(windowSeconds = 60, warmupSeconds = 15) {
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) throw new RangeError("metric window must be positive");
    if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds > windowSeconds) throw new RangeError("metric warmup is invalid");
    this.windowSeconds = windowSeconds;
    this.warmupSeconds = warmupSeconds;
  }

  sample(production: WorldProductionSimulation): ReadonlyMap<ItemId, ProductionMetric> {
    const snapshot = production.snapshot();
    const at = snapshot.clock.elapsedSeconds;
    this.startedAt ??= at;
    snapshot.nodes.forEach((node) => {
      const previous = this.previous.get(node.instanceId);
      const cycles = node.process?.completedCycles ?? 0;
      const state = node.process?.runtimeState ?? "idle";
      if (previous && at > previous.at && cycles >= previous.cycles) {
        const duration = at - previous.at;
        const completed = cycles - previous.cycles;
        const recipe = node.selectedRecipeId ? production.world.registry.recipes.get(node.selectedRecipeId) : undefined;
        recipe?.outputs.forEach((output) => this.samples.push({
          at, duration, itemId: output.itemId, produced: completed * output.amount, consumed: 0,
          starved: 0, blocked: statusDuration(previous.state, "blocked", duration),
        }));
        recipe?.inputs.forEach((input) => this.samples.push({
          at, duration, itemId: input.itemId, produced: 0, consumed: completed * input.amount,
          starved: statusDuration(previous.state, "starved", duration), blocked: 0,
        }));
      }
      this.previous.set(node.instanceId, { at, cycles, state });
    });
    const cutoff = at - this.windowSeconds;
    while (this.samples[0]?.at < cutoff) this.samples.shift();

    const values = new Map<ItemId, Omit<ProductionMetric, "itemId">>();
    production.world.registry.items.forEach((item) => {
      const events = this.samples.filter(({ itemId }) => itemId === item.id);
      const observedFrom = Math.max(cutoff, this.startedAt ?? at);
      const window = Math.max(0, at - observedFrom);
      const produced = events.reduce((sum, event) => sum + event.produced, 0);
      const consumed = events.reduce((sum, event) => sum + event.consumed, 0);
      const demand = snapshot.nodes.reduce((sum, node) => {
        const recipe = node.selectedRecipeId ? production.world.registry.recipes.get(node.selectedRecipeId) : undefined;
        return sum + (recipe?.inputs.filter(({ itemId }) => itemId === item.id)
          .reduce((recipeSum, input) => recipeSum + input.amount * 60 / recipe.durationSeconds, 0) ?? 0);
      }, 0);
      const inventories = snapshot.nodes.flatMap((node) => {
        const definition = production.world.registry.buildings.get(node.definitionId);
        const unique = new Map([...node.inputs, ...node.outputs].map((inventory) => [inventory.portId, inventory]));
        return [...unique.values()]
          .filter(({ itemId }) => itemId === item.id)
          .map((inventory) => ({ definition, inventory }));
      });
      const storedStock = inventories
        .filter(({ definition }) => Boolean(definition?.storagePolicy))
        .reduce((sum, { inventory }) => sum + inventory.amount, 0);
      const inTransit = inventories
        .filter(({ definition }) => Boolean(definition?.transportPolicy))
        .reduce((sum, { inventory }) => sum + inventory.amount, 0);
      const bufferStock = inventories
        .filter(({ definition }) => !definition?.storagePolicy && !definition?.transportPolicy)
        .reduce((sum, { inventory }) => sum + inventory.amount, 0);
      const workInProgress = snapshot.nodes.reduce((sum, node) => sum + (node.process?.workInProgress?.inputs
        .filter(({ itemId }) => itemId === item.id).reduce((total, input) => total + input.amount, 0) ?? 0), 0);
      const producers = snapshot.nodes.filter((node) => {
        const recipe = node.selectedRecipeId ? production.world.registry.recipes.get(node.selectedRecipeId) : undefined;
        return recipe?.outputs.some(({ itemId }) => itemId === item.id);
      });
      const workingProducerCount = producers.filter(({ process }) => process?.runtimeState === "working").length;
      const starvedProducerCount = producers.filter(({ process }) => process?.runtimeState === "starved").length;
      const blockedProducerCount = producers.filter(({ process }) => process?.runtimeState === "blocked").length;
      const health = workingProducerCount > 0 && (starvedProducerCount > 0 || blockedProducerCount > 0)
        ? "partial" as const
        : workingProducerCount > 0 ? "working" as const
          : blockedProducerCount > 0 ? "blocked" as const
            : starvedProducerCount > 0 ? "starved" as const : "idle" as const;
      values.set(item.id, {
        windowSeconds: window,
        producedPerMinute: window > 0 ? produced * 60 / window : 0,
        consumedPerMinute: window > 0 ? consumed * 60 / window : 0,
        demandPerMinute: demand,
        storedStock,
        bufferStock,
        inTransit,
        workInProgress,
        starvedSeconds: events.reduce((sum, event) => sum + event.starved, 0),
        blockedSeconds: events.reduce((sum, event) => sum + event.blocked, 0),
        collecting: window < this.warmupSeconds,
        producerCount: producers.length,
        workingProducerCount,
        health,
      });
    });
    return new Map([...values].map(([itemId, metric]) => [itemId, { itemId, ...metric }]));
  }
}
