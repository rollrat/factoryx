import type {
  BuildingDefinition,
  BuildingId,
  BuildingInstance,
  DefinitionRegistry,
  GridCell,
  ItemId,
  ItemStack,
  LocalPosition,
  PortDefinition,
  UnlockId,
} from "../domain/types.ts";
import {
  RESOURCE_ANCHORS,
  getResourceAnchorAt,
  type ResourceAnchorDefinition,
} from "../data/resourceAnchors.ts";

export type WorldBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

export type WorldTerrainPlacementIssue = Readonly<{
  ok: false;
  reason: "foundation_required" | "terrain_steep" | "terrain_submerged" | "terrain_hazard" | "terrain_clearance";
  cell?: GridCell;
}>;

export type WorldTerrainPlacementValidator = (
  definition: BuildingDefinition,
  position: GridCell,
  rotation: 0 | 1 | 2 | 3,
) => Readonly<{ ok: true }> | WorldTerrainPlacementIssue;

export type WorldSnapshot = Readonly<{
  version: 1;
  bounds: WorldBounds;
  nextInstanceId: number;
  unlockedIds: readonly UnlockId[];
  constructionInventory: readonly ItemStack[];
  instances: readonly BuildingInstance[];
}>;

export type WorldPlacementRequest = Readonly<{
  buildingId: BuildingId;
  position: GridCell;
  rotation: 0 | 1 | 2 | 3;
  /** Campaign construction credits may sponsor one placement without consuming item build costs. */
  waiveBuildCost?: boolean;
  constructionCredit?: Readonly<{ id: string; amount: number }>;
}>;

export type WorldPlacementResult =
  | Readonly<{ ok: true; instance: BuildingInstance; consumedItems: readonly ItemStack[] }>
  | Readonly<{
    ok: false;
    reason:
      | "unknown_building"
      | "locked"
      | "preplaced_unique"
      | "invalid_rotation"
      | "out_of_bounds"
      | "occupied"
      | "invalid_resource_anchor"
      | "resource_locked"
      | "insufficient_materials"
      | "foundation_required"
      | "terrain_steep"
      | "terrain_submerged"
      | "terrain_hazard"
      | "terrain_clearance";
    itemId?: ItemId;
    cell?: GridCell;
  }>;

export type WorldBatchPlacementResult =
  | Readonly<{ ok: true; instances: readonly BuildingInstance[]; consumedItems: readonly ItemStack[] }>
  | Extract<WorldPlacementResult, { ok: false }>;

export type WorldDemolitionResult =
  | Readonly<{ ok: true; instance: BuildingInstance; recoveredItems: readonly ItemStack[] }>
  | Readonly<{ ok: false; reason: "unknown_instance" | "immutable_preplaced" }>;

export type WorldPort = Readonly<{
  definition: PortDefinition;
  connectionCell: GridCell;
  localPosition: LocalPosition;
  localFacing: GridCell;
}>;

type RuntimeContents = Readonly<{
  inputBuffersByPortId: Readonly<Record<string, readonly ItemStack[]>>;
  outputBuffersByPortId: Readonly<Record<string, readonly ItemStack[]>>;
  workInProgress: readonly ItemStack[];
  runtimeState?: string;
  progress?: number;
  selectedRecipeId?: string | null;
}>;

const cellKey = ({ x, z }: GridCell) => `${x},${z}`;
const cloneStacks = (stacks: readonly ItemStack[]) => stacks.map((stack) => ({ ...stack }));
const cloneBufferRecord = (buffers: Readonly<Record<string, readonly ItemStack[]>>) => Object.fromEntries(
  Object.entries(buffers).map(([portId, stacks]) => [portId, cloneStacks(stacks)]),
);
const cloneInstance = (instance: BuildingInstance): BuildingInstance => ({
  ...instance,
  position: { ...instance.position },
  inputBuffersByPortId: cloneBufferRecord(instance.inputBuffersByPortId),
  outputBuffersByPortId: cloneBufferRecord(instance.outputBuffersByPortId),
  workInProgress: cloneStacks(instance.workInProgress),
  ...(instance.paidBuildCost ? { paidBuildCost: cloneStacks(instance.paidBuildCost) } : {}),
  ...(instance.constructionCreditPaid ? { constructionCreditPaid: { ...instance.constructionCreditPaid } } : {}),
});

const rotateCell = (
  cell: GridCell,
  width: number,
  depth: number,
  rotation: 0 | 1 | 2 | 3,
): GridCell => {
  if (rotation === 0) return { ...cell };
  if (rotation === 1) return { x: depth - 1 - cell.z, z: cell.x };
  if (rotation === 2) return { x: width - 1 - cell.x, z: depth - 1 - cell.z };
  return { x: cell.z, z: width - 1 - cell.x };
};

const rotateVector = <T extends GridCell | LocalPosition>(
  vector: T,
  rotation: 0 | 1 | 2 | 3,
): T => {
  const clean = (value: number) => Object.is(value, -0) ? 0 : value;
  const y = "y" in vector ? { y: vector.y } : {};
  if (rotation === 0) return { ...vector };
  if (rotation === 1) return { x: clean(-vector.z), z: clean(vector.x), ...y } as T;
  if (rotation === 2) return { x: clean(-vector.x), z: clean(-vector.z), ...y } as T;
  return { x: clean(vector.z), z: clean(-vector.x), ...y } as T;
};

const rotatedSize = (definition: BuildingDefinition, rotation: 0 | 1 | 2 | 3) => (
  rotation % 2 === 0
    ? { x: definition.footprint.x, z: definition.footprint.z }
    : { x: definition.footprint.z, z: definition.footprint.x }
);

const occupiedCells = (
  definition: BuildingDefinition,
  position: GridCell,
  rotation: 0 | 1 | 2 | 3,
) => {
  const cells: GridCell[] = [];
  for (let z = 0; z < definition.footprint.z; z += 1) {
    for (let x = 0; x < definition.footprint.x; x += 1) {
      const rotated = rotateCell({ x, z }, definition.footprint.x, definition.footprint.z, rotation);
      cells.push({ x: position.x + rotated.x, z: position.z + rotated.z });
    }
  }
  return cells;
};

const aggregateStacks = (stacks: readonly ItemStack[]) => {
  const amounts = new Map<ItemId, number>();
  stacks.forEach(({ itemId, amount }) => amounts.set(itemId, (amounts.get(itemId) ?? 0) + amount));
  return [...amounts].map(([itemId, amount]) => ({ itemId, amount })).sort((a, b) => a.itemId.localeCompare(b.itemId));
};

export class DataDrivenWorld {
  readonly registry: DefinitionRegistry;
  readonly bounds: WorldBounds;
  private readonly instances = new Map<string, BuildingInstance>();
  private readonly occupancy = new Map<string, string>();
  private readonly inventory = new Map<ItemId, number>();
  private readonly unlockedIds = new Set<UnlockId>();
  private readonly terrainPlacement?: WorldTerrainPlacementValidator;
  private nextInstanceId = 1;

  constructor(options: Readonly<{
    registry: DefinitionRegistry;
    bounds: WorldBounds;
    unlockedIds?: readonly UnlockId[];
    constructionInventory?: readonly ItemStack[];
    snapshot?: WorldSnapshot;
    terrainPlacement?: WorldTerrainPlacementValidator;
  }>) {
    this.registry = options.registry;
    this.bounds = { ...options.bounds };
    this.terrainPlacement = options.terrainPlacement;
    this.validateBounds(this.bounds);
    if (options.snapshot) {
      this.restore(options.snapshot);
      return;
    }
    (options.unlockedIds ?? ["start"]).forEach((id) => this.unlockedIds.add(id));
    (options.constructionInventory ?? []).forEach(({ itemId, amount }) => this.addInventory(itemId, amount));
    this.seedPreplacedBuildings();
  }

  allInstances(): readonly BuildingInstance[] {
    return [...this.instances.values()].map(cloneInstance).sort((a, b) => a.id.localeCompare(b.id));
  }

  instance(id: string): BuildingInstance | null {
    const instance = this.instances.get(id);
    return instance ? cloneInstance(instance) : null;
  }

  instanceAt(cell: GridCell): BuildingInstance | null {
    const id = this.occupancy.get(cellKey(cell));
    return id ? this.instance(id) : null;
  }

  inventoryAmount(itemId: ItemId): number {
    return this.inventory.get(itemId) ?? 0;
  }

  unlock(unlockId: UnlockId): void {
    this.unlockedIds.add(unlockId);
  }

  isUnlockActive(unlockId: UnlockId): boolean {
    return this.unlockedIds.has(unlockId);
  }

  resourceAnchors(): readonly Readonly<ResourceAnchorDefinition & { active: boolean }>[] {
    return RESOURCE_ANCHORS.map((anchor) => ({
      ...anchor,
      position: { ...anchor.position },
      active: this.registry.items.has(anchor.itemId) && this.unlockedIds.has(anchor.unlockId),
    }));
  }

  resourceAnchorAt(position: GridCell): Readonly<ResourceAnchorDefinition & { active: boolean }> | null {
    const anchor = getResourceAnchorAt(position);
    return anchor && this.registry.items.has(anchor.itemId)
      ? { ...anchor, position: { ...anchor.position }, active: this.unlockedIds.has(anchor.unlockId) }
      : null;
  }

  grantItems(stacks: readonly ItemStack[]): void {
    stacks.forEach(({ itemId, amount }) => this.addInventory(itemId, amount));
  }

  previewPlace(request: WorldPlacementRequest): Readonly<{ ok: true }> | Extract<WorldPlacementResult, { ok: false }> {
    const definition = this.registry.buildings.get(request.buildingId);
    if (!definition) return { ok: false, reason: "unknown_building" };
    if (definition.placementMode === "preplaced_unique") return { ok: false, reason: "preplaced_unique" };
    if (!this.unlockedIds.has(definition.unlockId)) return { ok: false, reason: "locked" };
    if (definition.id === "vein_miner" || definition.id === "fluid_extractor") {
      const anchor = this.resourceAnchorAt(request.position);
      if (!anchor || anchor.extractionBuildingId !== definition.id) {
        return { ok: false, reason: "invalid_resource_anchor" };
      }
      if (!anchor.active) return { ok: false, reason: "resource_locked", itemId: anchor.itemId };
    }
    const placementIssue = this.validatePlacement(definition, request.position, request.rotation);
    if (placementIssue) return placementIssue;
    for (const cost of request.waiveBuildCost ? [] : aggregateStacks(definition.buildCost)) {
      if (this.inventoryAmount(cost.itemId) < cost.amount) {
        return { ok: false, reason: "insufficient_materials", itemId: cost.itemId };
      }
    }
    return { ok: true };
  }

  place(request: WorldPlacementRequest): WorldPlacementResult {
    const definition = this.registry.buildings.get(request.buildingId);
    if (!definition) return { ok: false, reason: "unknown_building" };
    const preview = this.previewPlace(request);
    if (!preview.ok) return preview;
    const buildCost = request.waiveBuildCost ? [] : aggregateStacks(definition.buildCost);

    const instance = this.createInstance(
      `building-${this.nextInstanceId}`,
      definition,
      request.position,
      request.rotation,
      buildCost,
      request.constructionCredit,
    );
    // Cost, instance and occupancy become visible only after all checks pass.
    buildCost.forEach(({ itemId, amount }) => this.inventory.set(itemId, this.inventoryAmount(itemId) - amount));
    this.nextInstanceId += 1;
    this.insertInstance(instance, definition);
    return { ok: true, instance: cloneInstance(instance), consumedItems: cloneStacks(buildCost) };
  }

  /** Places a drag-built route as one transaction; a failed segment rolls back every prior segment. */
  placeBatch(requests: readonly WorldPlacementRequest[]): WorldBatchPlacementResult {
    const before = this.snapshot();
    const instances: BuildingInstance[] = [];
    const consumed: ItemStack[] = [];
    for (const request of requests) {
      const result = this.place(request);
      if (!result.ok) {
        this.restore(before);
        return result;
      }
      instances.push(result.instance);
      consumed.push(...result.consumedItems);
    }
    return { ok: true, instances, consumedItems: aggregateStacks(consumed) };
  }

  demolish(instanceId: string): WorldDemolitionResult {
    const instance = this.instances.get(instanceId);
    if (!instance) return { ok: false, reason: "unknown_instance" };
    const definition = this.registry.buildings.get(instance.definitionId)!;
    if (definition.placementMode === "preplaced_unique" || definition.preplacedPolicy?.canDemolish === false) {
      return { ok: false, reason: "immutable_preplaced" };
    }
    const buffered = [
      ...Object.values(instance.inputBuffersByPortId).flat(),
      ...Object.values(instance.outputBuffersByPortId).flat(),
      ...instance.workInProgress,
    ];
    const recoveredItems = aggregateStacks([...(instance.paidBuildCost ?? definition.buildCost), ...buffered]);
    this.removeInstance(instance, definition);
    recoveredItems.forEach(({ itemId, amount }) => this.addInventory(itemId, amount));
    return { ok: true, instance: cloneInstance(instance), recoveredItems };
  }

  setRuntimeContents(instanceId: string, contents: RuntimeContents): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    const definition = this.registry.buildings.get(instance.definitionId)!;
    const inputPortIds = new Set(definition.ports.filter(({ direction }) => direction !== "output").map(({ id }) => id));
    const outputPortIds = new Set(definition.ports.filter(({ direction }) => direction !== "input").map(({ id }) => id));
    if (Object.keys(contents.inputBuffersByPortId).some((id) => !inputPortIds.has(id))) return false;
    if (Object.keys(contents.outputBuffersByPortId).some((id) => !outputPortIds.has(id))) return false;
    this.validateStacks([
      ...Object.values(contents.inputBuffersByPortId).flat(),
      ...Object.values(contents.outputBuffersByPortId).flat(),
      ...contents.workInProgress,
    ]);
    const updated: BuildingInstance = {
      ...instance,
      inputBuffersByPortId: cloneBufferRecord(contents.inputBuffersByPortId),
      outputBuffersByPortId: cloneBufferRecord(contents.outputBuffersByPortId),
      workInProgress: cloneStacks(contents.workInProgress),
      ...(contents.runtimeState !== undefined ? { runtimeState: contents.runtimeState } : {}),
      ...(contents.progress !== undefined ? { progress: contents.progress } : {}),
      ...(contents.selectedRecipeId ? { selectedRecipeId: contents.selectedRecipeId } : {}),
    };
    if (contents.selectedRecipeId === null) delete (updated as { selectedRecipeId?: string }).selectedRecipeId;
    this.instances.set(instanceId, updated);
    return true;
  }

  portsFor(instanceId: string): readonly WorldPort[] {
    const instance = this.instances.get(instanceId);
    if (!instance) return [];
    const definition = this.registry.buildings.get(instance.definitionId)!;
    const size = rotatedSize(definition, instance.rotation);
    const center = { x: instance.position.x + size.x / 2, z: instance.position.z + size.z / 2 };
    return definition.ports.map((port) => {
      const connection = rotateCell(port.connectionCell, definition.footprint.x, definition.footprint.z, instance.rotation);
      const localPosition = rotateVector(port.localPosition, instance.rotation);
      return {
        definition: port,
        connectionCell: { x: instance.position.x + connection.x, z: instance.position.z + connection.z },
        localPosition: { x: center.x + localPosition.x, y: localPosition.y, z: center.z + localPosition.z },
        localFacing: rotateVector(port.localFacing, instance.rotation),
      };
    });
  }

  snapshot(): WorldSnapshot {
    return {
      version: 1,
      bounds: { ...this.bounds },
      nextInstanceId: this.nextInstanceId,
      unlockedIds: [...this.unlockedIds].sort(),
      constructionInventory: [...this.inventory]
        .filter(([, amount]) => amount > 0)
        .map(([itemId, amount]) => ({ itemId, amount }))
        .sort((a, b) => a.itemId.localeCompare(b.itemId)),
      instances: this.allInstances(),
    };
  }

  restore(snapshot: WorldSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`unsupported world snapshot version: ${snapshot.version}`);
    if (JSON.stringify(snapshot.bounds) !== JSON.stringify(this.bounds)) throw new Error("world snapshot bounds do not match");
    if (!Number.isSafeInteger(snapshot.nextInstanceId) || snapshot.nextInstanceId < 1) {
      throw new RangeError("world snapshot nextInstanceId is invalid");
    }

    this.instances.clear();
    this.occupancy.clear();
    this.inventory.clear();
    this.unlockedIds.clear();
    snapshot.unlockedIds.forEach((id) => this.unlockedIds.add(id));
    snapshot.constructionInventory.forEach(({ itemId, amount }) => this.addInventory(itemId, amount));
    snapshot.instances.forEach((saved) => {
      const definition = this.registry.buildings.get(saved.definitionId);
      if (!definition) throw new Error(`unknown snapshot building definition: ${saved.definitionId}`);
      if (definition.placementMode === "preplaced_unique") {
        const policy = definition.preplacedPolicy!;
        if (saved.position.x !== policy.worldAnchor.x || saved.position.z !== policy.worldAnchor.z
          || saved.rotation !== policy.fixedRotation) {
          throw new Error(`preplaced snapshot transform mismatch: ${saved.definitionId}`);
        }
      }
      const issue = this.validatePlacement(definition, saved.position, saved.rotation);
      if (issue) throw new Error(`invalid snapshot placement for ${saved.id}: ${issue.reason}`);
      this.validateStacks([
        ...Object.values(saved.inputBuffersByPortId).flat(),
        ...Object.values(saved.outputBuffersByPortId).flat(),
        ...saved.workInProgress,
        ...(saved.paidBuildCost ?? []),
      ]);
      this.insertInstance(cloneInstance(saved), definition);
    });
    this.assertAllPreplacedPresent();
    this.nextInstanceId = snapshot.nextInstanceId;
  }

  private seedPreplacedBuildings() {
    this.registry.buildings.forEach((definition) => {
      if (definition.placementMode !== "preplaced_unique") return;
      const policy = definition.preplacedPolicy;
      if (!policy) throw new Error(`preplaced definition lacks policy: ${definition.id}`);
      const issue = this.validatePlacement(definition, policy.worldAnchor, policy.fixedRotation);
      if (issue) throw new Error(`cannot seed ${definition.id}: ${issue.reason}`);
      const instance = this.createInstance(`preplaced:${definition.id}`, definition, policy.worldAnchor, policy.fixedRotation);
      this.insertInstance(instance, definition);
    });
  }

  private assertAllPreplacedPresent() {
    this.registry.buildings.forEach((definition) => {
      if (definition.placementMode !== "preplaced_unique") return;
      const matching = [...this.instances.values()].filter(({ definitionId }) => definitionId === definition.id);
      if (matching.length !== 1) throw new Error(`snapshot requires exactly one preplaced ${definition.id}`);
    });
  }

  private createInstance(
    id: string,
    definition: BuildingDefinition,
    position: GridCell,
    rotation: 0 | 1 | 2 | 3,
    paidBuildCost?: readonly ItemStack[],
    constructionCreditPaid?: Readonly<{ id: string; amount: number }>,
  ): BuildingInstance {
    const inputBuffersByPortId: Record<string, readonly ItemStack[]> = {};
    const outputBuffersByPortId: Record<string, readonly ItemStack[]> = {};
    definition.ports.forEach((port) => {
      if (port.direction !== "output") inputBuffersByPortId[port.id] = [];
      if (port.direction !== "input") outputBuffersByPortId[port.id] = [];
    });
    const anchor = this.resourceAnchorAt(position);
    const extractionRecipeId = anchor?.extractionBuildingId === definition.id ? anchor.recipeId : undefined;
    return {
      id,
      definitionId: definition.id,
      position: { ...position },
      rotation,
      runtimeState: "idle",
      progress: 0,
      inputBuffersByPortId,
      outputBuffersByPortId,
      workInProgress: [],
      ...(paidBuildCost ? { paidBuildCost: cloneStacks(paidBuildCost) } : {}),
      ...(constructionCreditPaid ? { constructionCreditPaid: { ...constructionCreditPaid } } : {}),
      ...(extractionRecipeId ? { selectedRecipeId: extractionRecipeId } : {}),
    };
  }

  private validatePlacement(
    definition: BuildingDefinition,
    position: GridCell,
    rotation: 0 | 1 | 2 | 3,
  ): Extract<WorldPlacementResult, { ok: false }> | null {
    if (!definition.allowedRotations.includes(rotation)) return { ok: false, reason: "invalid_rotation" };
    const cells = occupiedCells(definition, position, rotation);
    for (const cell of cells) {
      if (cell.x < this.bounds.minX || cell.x > this.bounds.maxX
        || cell.z < this.bounds.minZ || cell.z > this.bounds.maxZ) {
        return { ok: false, reason: "out_of_bounds", cell };
      }
      if (this.occupancy.has(cellKey(cell))) return { ok: false, reason: "occupied", cell };
    }
    const terrainIssue = this.terrainPlacement?.(definition, position, rotation);
    if (terrainIssue && !terrainIssue.ok) return terrainIssue;
    return null;
  }

  private insertInstance(instance: BuildingInstance, definition: BuildingDefinition) {
    if (this.instances.has(instance.id)) throw new Error(`duplicate world instance id: ${instance.id}`);
    this.instances.set(instance.id, instance);
    occupiedCells(definition, instance.position, instance.rotation).forEach((cell) => this.occupancy.set(cellKey(cell), instance.id));
  }

  private removeInstance(instance: BuildingInstance, definition: BuildingDefinition) {
    occupiedCells(definition, instance.position, instance.rotation).forEach((cell) => this.occupancy.delete(cellKey(cell)));
    this.instances.delete(instance.id);
  }

  private addInventory(itemId: ItemId, amount: number) {
    if (!this.registry.items.has(itemId)) throw new Error(`unknown construction item: ${itemId}`);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("construction item amount must be a non-negative safe integer");
    this.inventory.set(itemId, this.inventoryAmount(itemId) + amount);
  }

  private validateStacks(stacks: readonly ItemStack[]) {
    stacks.forEach(({ itemId, amount }) => {
      if (!this.registry.items.has(itemId)) throw new Error(`unknown buffered item: ${itemId}`);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("buffered item amount must be a positive safe integer");
    });
  }

  private validateBounds(bounds: WorldBounds) {
    [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].forEach((value) => {
      if (!Number.isSafeInteger(value)) throw new RangeError("world bounds must use safe integers");
    });
    if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new RangeError("world bounds are inverted");
  }
}

/** Expands a saved authored world without rewriting stable instance ids or simulation contents. */
export const migrateWorldSnapshotBounds = (snapshot: WorldSnapshot, bounds: WorldBounds): WorldSnapshot => {
  if (bounds.minX > snapshot.bounds.minX || bounds.maxX < snapshot.bounds.maxX
    || bounds.minZ > snapshot.bounds.minZ || bounds.maxZ < snapshot.bounds.maxZ) {
    throw new RangeError("world bounds migration may only expand the playable area");
  }
  return { ...snapshot, bounds: { ...bounds } };
};
