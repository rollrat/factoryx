import type {
  BuildingDefinition,
  ItemId,
  PortDefinition,
  RecipeId,
} from "../domain/types.ts";
import { FixedStepClock, type FixedStepClockSnapshot } from "./clock.ts";
import { SIMULATION_TICK_SECONDS } from "./contracts.ts";
import { PortInventory, type PortInventoryState } from "./inventory.ts";
import { RecipeProcess, type RecipeProcessSnapshot } from "./process.ts";
import type { PowerGridResult } from "./powerGrid.ts";
import type { DataDrivenWorld, WorldDemolitionResult, WorldPort } from "./world.ts";

export type ProductionConnection = Readonly<{
  fromInstanceId: string;
  fromPortId: string;
  toInstanceId: string;
  toPortId: string;
  medium: "solid" | "fluid" | "power";
  connectorProfile: string;
}>;

export type WorldProductionNodeSnapshot = Readonly<{
  instanceId: string;
  definitionId: string;
  selectedRecipeId: RecipeId | null;
  inputs: readonly PortInventoryState[];
  outputs: readonly PortInventoryState[];
  process: RecipeProcessSnapshot | null;
  internalTransferCredit: number;
}>;

export type WorldProductionSnapshot = Readonly<{
  version: 1;
  paused: boolean;
  clock: FixedStepClockSnapshot;
  powerSatisfaction: readonly Readonly<{ instanceId: string; satisfaction: number }>[];
  nodes: readonly WorldProductionNodeSnapshot[];
}>;

type RuntimeNode = {
  instanceId: string;
  definition: BuildingDefinition;
  inputs: Map<string, PortInventory>;
  outputs: Map<string, PortInventory>;
  selectedRecipeId: RecipeId | null;
  process: RecipeProcess | null;
  internalTransferCredit: number;
};

const accepts = (port: PortDefinition, itemId: ItemId) => (
  port.acceptedItemIds.length === 0 || port.acceptedItemIds.includes(itemId)
);
const allowsInput = (port: PortDefinition) => port.direction !== "output";
const allowsOutput = (port: PortDefinition) => port.direction !== "input";
const endpointKey = (instanceId: string, portId: string) => `${instanceId}:${portId}`;

export class WorldProductionSimulation {
  readonly world: DataDrivenWorld;
  private readonly clock: FixedStepClock;
  private readonly nodes = new Map<string, RuntimeNode>();
  private readonly powerSatisfaction = new Map<string, number>();
  private paused = false;

  constructor(world: DataDrivenWorld, snapshot?: WorldProductionSnapshot) {
    this.world = world;
    this.clock = new FixedStepClock(SIMULATION_TICK_SECONDS, snapshot?.clock);
    this.paused = snapshot?.paused ?? false;
    this.syncWorld();
    if (snapshot) this.restoreNodes(snapshot);
  }

  syncWorld(): void {
    const worldIds = new Set(this.world.allInstances().map(({ id }) => id));
    this.nodes.forEach((_node, id) => {
      if (!worldIds.has(id)) {
        this.nodes.delete(id);
        this.powerSatisfaction.delete(id);
      }
    });
    this.world.allInstances().forEach((instance) => {
      if (this.nodes.has(instance.id)) return;
      const definition = this.world.registry.buildings.get(instance.definitionId);
      if (!definition) throw new Error(`unknown world production definition: ${instance.definitionId}`);
      const sharedBidirectional = new Map<string, PortInventory>();
      const makeInventory = (port: PortDefinition) => {
        if (sharedBidirectional.has(port.id)) return sharedBidirectional.get(port.id)!;
        const stackSize = Math.max(1, ...port.acceptedItemIds.map((id) => this.world.registry.items.get(id)?.stackSize ?? 1));
        const inventory = new PortInventory(port.id, port.bufferSlots * stackSize);
        if (port.direction === "bidirectional") sharedBidirectional.set(port.id, inventory);
        return inventory;
      };
      const inputs = new Map(definition.ports.filter(allowsInput).map((port) => [port.id, makeInventory(port)]));
      const outputs = new Map(definition.ports.filter(allowsOutput).map((port) => [port.id, makeInventory(port)]));
      const selectedRecipeId = instance.selectedRecipeId
        ?? definition.recipeIds.find((id) => this.world.registry.recipes.has(id))
        ?? null;
      const recipe = selectedRecipeId ? this.world.registry.recipes.get(selectedRecipeId) : undefined;
      this.nodes.set(instance.id, {
        instanceId: instance.id,
        definition,
        inputs,
        outputs,
        selectedRecipeId,
        process: recipe ? new RecipeProcess(recipe) : null,
        internalTransferCredit: 0,
      });
    });
  }

  setPaused(paused: boolean): void { this.paused = paused; }

  advance(deltaSeconds: number) {
    this.syncWorld();
    return this.clock.advance(deltaSeconds, (_tick, fixedDelta) => this.step(fixedDelta));
  }

  selectRecipe(instanceId: string, recipeId: RecipeId): boolean {
    const node = this.nodes.get(instanceId);
    const recipe = this.world.registry.recipes.get(recipeId);
    if (!node || !recipe || recipe.buildingId !== node.definition.id || !node.definition.recipeIds.includes(recipeId)) return false;
    if (node.process?.snapshot().workInProgress) return false;
    if ([...node.inputs.values(), ...node.outputs.values()].some(({ amount }) => amount > 0)) return false;
    node.selectedRecipeId = recipeId;
    node.process = new RecipeProcess(recipe);
    return true;
  }

  setPowerSatisfaction(instanceId: string, satisfaction: number): void {
    if (!this.nodes.has(instanceId)) throw new Error(`unknown production instance: ${instanceId}`);
    if (!Number.isFinite(satisfaction) || satisfaction < 0 || satisfaction > 1) {
      throw new RangeError("power satisfaction must be between zero and one");
    }
    this.powerSatisfaction.set(instanceId, satisfaction);
  }

  applyPowerResult(result: PowerGridResult): void {
    result.consumers.forEach(({ id, satisfaction }) => {
      if (this.nodes.has(id)) this.powerSatisfaction.set(id, satisfaction);
    });
  }

  connections(): readonly ProductionConnection[] {
    const ports = this.world.allInstances().flatMap((instance) => this.world.portsFor(instance.id).map((port) => ({ instance, port })));
    const outputs = ports.filter(({ port }) => allowsOutput(port.definition))
      .sort((a, b) => endpointKey(a.instance.id, a.port.definition.id).localeCompare(endpointKey(b.instance.id, b.port.definition.id)));
    const inputs = ports.filter(({ port }) => allowsInput(port.definition));
    const usedInputs = new Set<string>();
    const connections: ProductionConnection[] = [];
    outputs.forEach((source) => {
      const target = inputs
        .filter((candidate) => candidate.instance.id !== source.instance.id)
        .filter((candidate) => !usedInputs.has(endpointKey(candidate.instance.id, candidate.port.definition.id)))
        .filter((candidate) => this.compatiblePorts(source.port, candidate.port))
        .sort((a, b) => endpointKey(a.instance.id, a.port.definition.id).localeCompare(endpointKey(b.instance.id, b.port.definition.id)))[0];
      if (!target || source.port.definition.medium === "power") return;
      usedInputs.add(endpointKey(target.instance.id, target.port.definition.id));
      connections.push({
        fromInstanceId: source.instance.id,
        fromPortId: source.port.definition.id,
        toInstanceId: target.instance.id,
        toPortId: target.port.definition.id,
        medium: source.port.definition.medium,
        connectorProfile: source.port.definition.connectorProfile,
      });
    });
    return connections;
  }

  machine(instanceId: string): RecipeProcessSnapshot | null {
    return this.nodes.get(instanceId)?.process?.snapshot() ?? null;
  }

  inventory(instanceId: string, portId: string, direction: "input" | "output") {
    const node = this.nodes.get(instanceId);
    const inventory = direction === "input" ? node?.inputs.get(portId) : node?.outputs.get(portId);
    if (!inventory) throw new Error(`unknown ${direction} inventory: ${instanceId}.${portId}`);
    return inventory.snapshot();
  }

  deposit(instanceId: string, portId: string, direction: "input" | "output", itemId: ItemId, amount: number): boolean {
    const node = this.nodes.get(instanceId);
    const inventory = direction === "input" ? node?.inputs.get(portId) : node?.outputs.get(portId);
    const port = node?.definition.ports.find(({ id }) => id === portId);
    return Boolean(inventory && port && accepts(port, itemId) && inventory.deposit(itemId, amount));
  }

  withdraw(instanceId: string, portId: string, direction: "input" | "output", itemId: ItemId, amount: number): boolean {
    const node = this.nodes.get(instanceId);
    const inventory = direction === "input" ? node?.inputs.get(portId) : node?.outputs.get(portId);
    return inventory?.withdraw(itemId, amount) ?? false;
  }

  demolish(instanceId: string): WorldDemolitionResult {
    const node = this.nodes.get(instanceId);
    if (node) this.syncRuntimeContents(node);
    const result = this.world.demolish(instanceId);
    if (result.ok) {
      this.nodes.delete(instanceId);
      this.powerSatisfaction.delete(instanceId);
    }
    return result;
  }

  snapshot(): WorldProductionSnapshot {
    this.nodes.forEach((node) => this.syncRuntimeContents(node));
    return {
      version: 1,
      paused: this.paused,
      clock: this.clock.snapshot(),
      powerSatisfaction: [...this.powerSatisfaction]
        .map(([instanceId, satisfaction]) => ({ instanceId, satisfaction }))
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
      nodes: [...this.nodes.values()]
        .map((node) => ({
          instanceId: node.instanceId,
          definitionId: node.definition.id,
          selectedRecipeId: node.selectedRecipeId,
          inputs: [...node.inputs.values()].map((inventory) => inventory.state()),
          outputs: [...node.outputs.values()].map((inventory) => inventory.state()),
          process: node.process?.snapshot() ?? null,
          internalTransferCredit: node.internalTransferCredit,
        }))
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
    };
  }

  private step(deltaSeconds: number) {
    if (!this.paused) {
      this.transferConnections();
      this.transferInsideLogisticsNodes(deltaSeconds);
    }
    const connectedByNode = new Map<string, Set<string>>();
    this.connections().forEach((connection) => {
      const source = connectedByNode.get(connection.fromInstanceId) ?? new Set<string>();
      source.add(connection.fromPortId);
      connectedByNode.set(connection.fromInstanceId, source);
      const target = connectedByNode.get(connection.toInstanceId) ?? new Set<string>();
      target.add(connection.toPortId);
      connectedByNode.set(connection.toInstanceId, target);
    });
    this.nodes.forEach((node) => {
      if (!node.process) return;
      node.process.step(node.inputs, node.outputs, {
        paused: this.paused,
        connectedPortIds: connectedByNode.get(node.instanceId) ?? new Set(),
        speed: this.powerSatisfaction.get(node.instanceId) ?? 1,
        deltaSeconds,
      });
      this.syncRuntimeContents(node);
    });
  }

  private transferConnections() {
    this.connections().forEach((connection) => {
      const sourceNode = this.nodes.get(connection.fromInstanceId);
      const targetNode = this.nodes.get(connection.toInstanceId);
      const source = sourceNode?.outputs.get(connection.fromPortId);
      const target = targetNode?.inputs.get(connection.toPortId);
      if (!sourceNode || !targetNode || !source || !target || !source.itemId || source.availableAmount <= 0) return;
      const targetPort = targetNode.definition.ports.find(({ id }) => id === connection.toPortId)!;
      if (!accepts(targetPort, source.itemId)) return;
      const amount = Math.min(1, source.availableAmount, target.availableCapacity);
      if (amount <= 0 || !target.canDeposit(source.itemId, amount)) return;
      const itemId = source.itemId;
      if (!source.withdraw(itemId, amount)) return;
      if (!target.deposit(itemId, amount)) source.deposit(itemId, amount);
    });
  }

  private transferInsideLogisticsNodes(deltaSeconds: number) {
    const connections = this.connections();
    this.nodes.forEach((node) => {
      const transportRate = node.definition.transportPolicy?.throughputPerMinute;
      const storageRouting = node.definition.storagePolicy?.defaultRoutingPolicy;
      const isPassThroughStorage = storageRouting === "pass_through";
      const isFillThenOutput = storageRouting === "fill_then_output";
      if (transportRate === undefined && !isPassThroughStorage && !isFillThenOutput) return;

      const throughputPerMinute = transportRate ?? 60;
      const generatedCredit = throughputPerMinute * deltaSeconds / 60;
      node.internalTransferCredit = Math.min(
        node.internalTransferCredit + generatedCredit,
        Math.max(1, generatedCredit),
      );
      const allowedAmount = Math.floor(node.internalTransferCredit + Number.EPSILON);
      if (allowedAmount < 1) return;

      const incomingIds = new Set(connections
        .filter(({ toInstanceId }) => toInstanceId === node.instanceId)
        .map(({ toPortId }) => toPortId));
      const outgoingIds = new Set(connections
        .filter(({ fromInstanceId }) => fromInstanceId === node.instanceId)
        .map(({ fromPortId }) => fromPortId));
      const inputEntry = [...node.inputs]
        .filter(([portId, inventory]) => incomingIds.has(portId) && inventory.itemId && inventory.availableAmount > 0)
        .sort(([a], [b]) => a.localeCompare(b))[0];
      if (!inputEntry) return;
      const [inputPortId, inputInventory] = inputEntry;
      const inputPort = node.definition.ports.find(({ id }) => id === inputPortId)!;
      if (isFillThenOutput && inputInventory.amount < inputInventory.capacity) return;
      const outputEntry = [...node.outputs]
        .filter(([portId, inventory]) => portId !== inputPortId && outgoingIds.has(portId) && inventory.availableCapacity > 0)
        .filter(([portId]) => {
          const outputPort = node.definition.ports.find(({ id }) => id === portId)!;
          return outputPort.medium === inputPort.medium
            && outputPort.connectorProfile === inputPort.connectorProfile
            && Boolean(inputInventory.itemId && accepts(outputPort, inputInventory.itemId));
        })
        .sort(([a], [b]) => a.localeCompare(b))[0];
      if (!outputEntry || !inputInventory.itemId) return;
      const [, outputInventory] = outputEntry;
      const itemId = inputInventory.itemId;
      const amount = Math.min(allowedAmount, inputInventory.availableAmount, outputInventory.availableCapacity);
      if (amount < 1 || !outputInventory.canDeposit(itemId, amount)) return;
      if (!inputInventory.withdraw(itemId, amount)) return;
      if (!outputInventory.deposit(itemId, amount)) {
        inputInventory.deposit(itemId, amount);
        return;
      }
      node.internalTransferCredit = Math.max(0, node.internalTransferCredit - amount);
      this.syncRuntimeContents(node);
    });
  }

  private compatiblePorts(source: WorldPort, target: WorldPort) {
    return source.connectionCell.x === target.connectionCell.x
      && source.connectionCell.z === target.connectionCell.z
      && source.definition.medium === target.definition.medium
      && source.definition.connectorProfile === target.definition.connectorProfile
      && source.localFacing.x === -target.localFacing.x
      && source.localFacing.z === -target.localFacing.z;
  }

  private syncRuntimeContents(node: RuntimeNode) {
    const stacks = (inventories: Map<string, PortInventory>) => Object.fromEntries(
      [...inventories].map(([portId, inventory]) => [
        portId,
        inventory.itemId && inventory.amount > 0 ? [{ itemId: inventory.itemId, amount: inventory.amount }] : [],
      ]),
    );
    this.world.setRuntimeContents(node.instanceId, {
      inputBuffersByPortId: stacks(node.inputs),
      outputBuffersByPortId: stacks(node.outputs),
      workInProgress: node.process?.snapshot().workInProgress?.inputs ?? [],
    });
  }

  private restoreNodes(snapshot: WorldProductionSnapshot) {
    if (snapshot.version !== 1) throw new Error(`unsupported world production snapshot version: ${snapshot.version}`);
    snapshot.powerSatisfaction.forEach(({ instanceId, satisfaction }) => this.setPowerSatisfaction(instanceId, satisfaction));
    const savedIds = new Set<string>();
    snapshot.nodes.forEach((saved) => {
      if (savedIds.has(saved.instanceId)) throw new Error(`duplicate production snapshot node: ${saved.instanceId}`);
      savedIds.add(saved.instanceId);
      const node = this.nodes.get(saved.instanceId);
      const recipe = saved.selectedRecipeId ? this.world.registry.recipes.get(saved.selectedRecipeId) : undefined;
      if (!node || node.definition.id !== saved.definitionId
        || (saved.selectedRecipeId !== null && (!recipe || recipe.buildingId !== node.definition.id))
        || (saved.selectedRecipeId === null && saved.process !== null)) {
        throw new Error(`production snapshot node does not match world: ${saved.instanceId}`);
      }
      const restoreMap = (target: Map<string, PortInventory>, states: readonly PortInventoryState[]) => {
        states.forEach((state) => {
          const current = target.get(state.portId);
          if (!current || current.capacity !== state.capacity) throw new Error(`production snapshot port mismatch: ${saved.instanceId}.${state.portId}`);
          target.set(state.portId, new PortInventory(state.portId, state.capacity, state));
        });
      };
      restoreMap(node.inputs, saved.inputs);
      restoreMap(node.outputs, saved.outputs);
      node.selectedRecipeId = saved.selectedRecipeId;
      node.process = recipe && saved.process ? new RecipeProcess(recipe, saved.process) : null;
      if (!Number.isFinite(saved.internalTransferCredit) || saved.internalTransferCredit < 0) {
        throw new RangeError(`invalid internal transfer credit: ${saved.instanceId}`);
      }
      node.internalTransferCredit = saved.internalTransferCredit;
    });
  }
}
