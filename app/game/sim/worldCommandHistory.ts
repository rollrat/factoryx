import type { BuildingInstance, ItemId } from "../domain/types.ts";
import {
  DataDrivenWorld,
  type WorldBatchPlacementResult,
  type WorldDemolitionResult,
  type WorldPlacementRequest,
  type WorldPlacementResult,
  type WorldSnapshot,
} from "./world.ts";

export type WorldCommandKind = "place" | "place_batch" | "demolish" | "custom";

export type WorldCommandSummary = Readonly<{
  id: number;
  kind: WorldCommandKind;
  label: string;
  affectedInstanceIds: readonly string[];
}>;

export type WorldHistoryResult =
  | Readonly<{ ok: true; command: WorldCommandSummary }>
  | Readonly<{ ok: false; reason: "empty" | "world_changed" | "insufficient_inventory"; itemId?: ItemId }>;

type RecordedWorldCommand = Readonly<{
  summary: WorldCommandSummary;
  before: WorldSnapshot;
  after: WorldSnapshot;
}>;

const snapshotInstances = (snapshot: WorldSnapshot) => new Map(snapshot.instances.map((instance) => [instance.id, instance]));
const snapshotInventory = (snapshot: WorldSnapshot) => new Map(snapshot.constructionInventory.map(({ itemId, amount }) => [itemId, amount]));
const sameInstance = (a: BuildingInstance | undefined, b: BuildingInstance | undefined) => JSON.stringify(a) === JSON.stringify(b);

const changedInstanceIds = (before: WorldSnapshot, after: WorldSnapshot) => {
  const beforeById = snapshotInstances(before);
  const afterById = snapshotInstances(after);
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((id) => !sameInstance(beforeById.get(id), afterById.get(id)))
    .sort();
};

const inventoryDelta = (source: WorldSnapshot, target: WorldSnapshot) => {
  const sourceInventory = snapshotInventory(source);
  const targetInventory = snapshotInventory(target);
  return [...new Set([...sourceInventory.keys(), ...targetInventory.keys()])]
    .map((itemId) => ({
      itemId,
      amount: (targetInventory.get(itemId) ?? 0) - (sourceInventory.get(itemId) ?? 0),
    }))
    .filter(({ amount }) => amount !== 0)
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
};

const nextInstanceId = (current: WorldSnapshot, target: WorldSnapshot, instances: readonly BuildingInstance[]) => {
  const largestBuildingId = instances.reduce((largest, instance) => {
    const match = /^building-(\d+)$/.exec(instance.id);
    return Math.max(largest, match ? Number(match[1]) : 0);
  }, 0);
  return Math.max(current.nextInstanceId, target.nextInstanceId, largestBuildingId + 1);
};

const candidateSnapshot = (
  current: WorldSnapshot,
  source: WorldSnapshot,
  target: WorldSnapshot,
  affectedInstanceIds: readonly string[],
): WorldSnapshot | Readonly<{ error: "world_changed" | "insufficient_inventory"; itemId?: ItemId }> => {
  const currentById = snapshotInstances(current);
  const sourceById = snapshotInstances(source);
  const targetById = snapshotInstances(target);

  for (const id of affectedInstanceIds) {
    if (!sameInstance(currentById.get(id), sourceById.get(id))) return { error: "world_changed" };
  }

  const inventory = snapshotInventory(current);
  for (const delta of inventoryDelta(source, target)) {
    const next = (inventory.get(delta.itemId) ?? 0) + delta.amount;
    if (next < 0) return { error: "insufficient_inventory", itemId: delta.itemId };
    if (next === 0) inventory.delete(delta.itemId);
    else inventory.set(delta.itemId, next);
  }

  affectedInstanceIds.forEach((id) => currentById.delete(id));
  affectedInstanceIds.forEach((id) => {
    const instance = targetById.get(id);
    if (instance) currentById.set(id, instance);
  });
  const instances = [...currentById.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: 1,
    bounds: { ...current.bounds },
    nextInstanceId: nextInstanceId(current, target, instances),
    // Campaign progression is external to construction history and must never roll back.
    unlockedIds: [...current.unlockedIds],
    constructionInventory: [...inventory]
      .map(([itemId, amount]) => ({ itemId, amount }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
    instances,
  };
};

/**
 * Transactional history for DataDrivenWorld construction mutations.
 *
 * Commands store their local instance/inventory difference. Undo and redo merge
 * that difference into the current world, preserving later campaign unlocks and
 * inventory grants. A touched instance changed by production causes a safe
 * conflict instead of silently discarding buffers or WIP.
 */
export class WorldCommandHistory {
  private readonly undoStack: RecordedWorldCommand[] = [];
  private readonly redoStack: RecordedWorldCommand[] = [];
  private nextCommandId = 1;
  private readonly limit: number;

  constructor(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("history limit must be a positive integer");
    this.limit = limit;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoDepth() { return this.undoStack.length; }
  get redoDepth() { return this.redoStack.length; }

  place(world: DataDrivenWorld, request: WorldPlacementRequest): WorldPlacementResult {
    return this.execute(world, "place", `건설 · ${request.buildingId}`, () => world.place(request));
  }

  placeBatch(world: DataDrivenWorld, requests: readonly WorldPlacementRequest[]): WorldBatchPlacementResult {
    return this.execute(world, "place_batch", `경로 건설 · ${requests.length}개`, () => world.placeBatch(requests));
  }

  demolish(world: DataDrivenWorld, instanceId: string): WorldDemolitionResult {
    return this.execute(world, "demolish", `철거 · ${instanceId}`, () => world.demolish(instanceId));
  }

  execute<T extends Readonly<{ ok: boolean }>>(
    world: DataDrivenWorld,
    kind: WorldCommandKind,
    label: string,
    operation: () => T,
  ): T {
    const before = world.snapshot();
    let result: T;
    try {
      result = operation();
    } catch (error) {
      world.restore(before);
      throw error;
    }
    if (!result.ok) {
      // Keep the command boundary atomic even for a future mutator that reports
      // failure after changing part of the world.
      if (JSON.stringify(world.snapshot()) !== JSON.stringify(before)) world.restore(before);
      return result;
    }
    const after = world.snapshot();
    const affectedInstanceIds = changedInstanceIds(before, after);
    const changedInventory = inventoryDelta(before, after).length > 0;
    if (affectedInstanceIds.length === 0 && !changedInventory) return result;
    const summary = {
      id: this.nextCommandId,
      kind,
      label,
      affectedInstanceIds,
    } as const;
    this.nextCommandId += 1;
    this.undoStack.push({ summary, before, after });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return result;
  }

  undo(world: DataDrivenWorld): WorldHistoryResult {
    const command = this.undoStack.at(-1);
    if (!command) return { ok: false, reason: "empty" };
    const result = this.apply(world, command.after, command.before, command.summary.affectedInstanceIds);
    if (!result.ok) return result;
    this.undoStack.pop();
    this.redoStack.push(command);
    return { ok: true, command: command.summary };
  }

  redo(world: DataDrivenWorld): WorldHistoryResult {
    const command = this.redoStack.at(-1);
    if (!command) return { ok: false, reason: "empty" };
    const result = this.apply(world, command.before, command.after, command.summary.affectedInstanceIds);
    if (!result.ok) return result;
    this.redoStack.pop();
    this.undoStack.push(command);
    return { ok: true, command: command.summary };
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private apply(
    world: DataDrivenWorld,
    source: WorldSnapshot,
    target: WorldSnapshot,
    affectedInstanceIds: readonly string[],
  ): Exclude<WorldHistoryResult, { ok: true }> | Readonly<{ ok: true }> {
    const candidate = candidateSnapshot(world.snapshot(), source, target, affectedInstanceIds);
    if ("error" in candidate) return { ok: false, reason: candidate.error, ...(candidate.itemId ? { itemId: candidate.itemId } : {}) };
    try {
      // Validate in isolation first because DataDrivenWorld.restore mutates while validating.
      new DataDrivenWorld({ registry: world.registry, bounds: world.bounds, snapshot: candidate });
    } catch {
      return { ok: false, reason: "world_changed" };
    }
    world.restore(candidate);
    return { ok: true };
  }
}
