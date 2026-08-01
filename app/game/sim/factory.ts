import type { ItemId, PortId, RecipeDefinition } from "../domain/types.ts";
import { FixedStepClock, type FixedStepClockSnapshot } from "./clock.ts";
import { SIMULATION_TICK_SECONDS } from "./contracts.ts";
import { PortInventory, type PortInventoryState } from "./inventory.ts";
import { RecipeProcess, type RecipeProcessSnapshot } from "./process.ts";

export type FactoryEndpoint = Readonly<{ nodeId: string; portId: PortId }>;

export type FactoryLink = Readonly<{
  from: FactoryEndpoint;
  to: FactoryEndpoint;
  maxAmountPerTick?: number;
}>;

export type FactoryMachineConfig = Readonly<{
  id: string;
  recipe: RecipeDefinition;
  inputCapacity?: number | Readonly<Record<PortId, number>>;
  outputCapacity?: number | Readonly<Record<PortId, number>>;
}>;

export type FactoryStorageConfig = Readonly<{
  id: string;
  portId: PortId;
  capacity: number;
  acceptedItemId?: ItemId;
}>;

export type FactoryTransferContext = Readonly<{
  tick: number;
  link: FactoryLink;
  source: PortInventory;
  destination: PortInventory;
}>;

export type FactoryTransfer = (context: FactoryTransferContext) => number;

export type FactoryConfig = Readonly<{
  machines: readonly FactoryMachineConfig[];
  storages: readonly FactoryStorageConfig[];
  links: readonly FactoryLink[];
  transfer?: FactoryTransfer;
}>;

export type FactoryNodeSnapshot = Readonly<{
  id: string;
  inputs: readonly PortInventoryState[];
  outputs: readonly PortInventoryState[];
  process: RecipeProcessSnapshot;
}>;

export type FactoryStorageSnapshot = Readonly<{
  id: string;
  inventory: PortInventoryState;
}>;

export type FactorySnapshot = Readonly<{
  version: 1;
  paused: boolean;
  clock: FixedStepClockSnapshot;
  machines: readonly FactoryNodeSnapshot[];
  storages: readonly FactoryStorageSnapshot[];
}>;

type MachineNode = {
  id: string;
  inputs: Map<PortId, PortInventory>;
  outputs: Map<PortId, PortInventory>;
  process: RecipeProcess;
};

const capacityFor = (
  capacities: number | Readonly<Record<PortId, number>> | undefined,
  portId: PortId,
) => typeof capacities === "number" ? capacities : capacities?.[portId] ?? 8;

const assertUniqueIds = (configs: readonly Readonly<{ id: string }>[], label: string) => {
  const ids = new Set<string>();
  for (const config of configs) {
    if (ids.has(config.id)) throw new Error(`duplicate ${label} id: ${config.id}`);
    ids.add(config.id);
  }
};

const inventoryFromState = (state: PortInventoryState) => new PortInventory(
  state.portId,
  state.capacity,
  { itemId: state.itemId, amount: state.amount, reservedAmount: state.reservedAmount },
);

/** Default instantaneous boundary. A later belt/transport layer can replace it. */
export const transferDirectly: FactoryTransfer = ({ link, source, destination }) => {
  if (!source.itemId || source.availableAmount <= 0) return 0;
  const limit = link.maxAmountPerTick ?? 1;
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError("maxAmountPerTick must be non-negative");
  const amount = Math.min(limit, source.availableAmount, destination.availableCapacity);
  if (amount <= 0 || !destination.canDeposit(source.itemId, amount)) return 0;
  const itemId = source.itemId;
  if (!source.withdraw(itemId, amount)) return 0;
  if (!destination.deposit(itemId, amount)) {
    // This should be unreachable after preflight; restoring source protects
    // conservation if a custom inventory implementation changes later.
    source.deposit(itemId, amount);
    return 0;
  }
  return amount;
};

export class HeadlessFactory {
  private readonly clock: FixedStepClock;
  private readonly machines = new Map<string, MachineNode>();
  private readonly storages = new Map<string, PortInventory>();
  private readonly storageAcceptedItems = new Map<string, ItemId | undefined>();
  private readonly links: readonly FactoryLink[];
  private readonly transfer: FactoryTransfer;
  private paused = false;

  constructor(config: FactoryConfig, snapshot?: FactorySnapshot) {
    assertUniqueIds(config.machines, "machine");
    assertUniqueIds(config.storages, "storage");
    const machineIds = new Set(config.machines.map(({ id }) => id));
    config.storages.forEach(({ id }) => {
      if (machineIds.has(id)) throw new Error(`factory node id is used twice: ${id}`);
    });

    const savedMachines = new Map(snapshot?.machines.map((machine) => [machine.id, machine]));
    for (const machineConfig of config.machines) {
      const saved = savedMachines.get(machineConfig.id);
      const inputIds = [...new Set(machineConfig.recipe.inputs.map(({ portId }) => portId))];
      const outputIds = [...new Set(machineConfig.recipe.outputs.map(({ portId }) => portId))];
      const savedInputs = new Map(saved?.inputs.map((state) => [state.portId, state]));
      const savedOutputs = new Map(saved?.outputs.map((state) => [state.portId, state]));
      const inputs = new Map(inputIds.map((portId) => [
        portId,
        savedInputs.has(portId)
          ? inventoryFromState(savedInputs.get(portId)!)
          : new PortInventory(portId, capacityFor(machineConfig.inputCapacity, portId)),
      ]));
      const outputs = new Map(outputIds.map((portId) => [
        portId,
        savedOutputs.has(portId)
          ? inventoryFromState(savedOutputs.get(portId)!)
          : new PortInventory(portId, capacityFor(machineConfig.outputCapacity, portId)),
      ]));
      this.machines.set(machineConfig.id, {
        id: machineConfig.id,
        inputs,
        outputs,
        process: new RecipeProcess(machineConfig.recipe, saved?.process),
      });
    }

    const savedStorages = new Map(snapshot?.storages.map((storage) => [storage.id, storage]));
    for (const storage of config.storages) {
      const saved = savedStorages.get(storage.id);
      const inventory = saved
        ? inventoryFromState(saved.inventory)
        : new PortInventory(storage.portId, storage.capacity);
      if (storage.acceptedItemId && inventory.itemId && inventory.itemId !== storage.acceptedItemId) {
        throw new Error(`storage ${storage.id} snapshot contains an unsupported item`);
      }
      this.storages.set(storage.id, inventory);
      this.storageAcceptedItems.set(storage.id, storage.acceptedItemId);
    }

    this.links = [...config.links];
    this.transfer = config.transfer ?? transferDirectly;
    this.validateLinks();
    this.clock = new FixedStepClock(SIMULATION_TICK_SECONDS, snapshot?.clock);
    this.paused = snapshot?.paused ?? false;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  advance(deltaSeconds: number) {
    return this.clock.advance(deltaSeconds, (tick, fixedDelta) => this.step(tick, fixedDelta));
  }

  machine(id: string) {
    const machine = this.machines.get(id);
    if (!machine) throw new Error(`unknown machine: ${id}`);
    return machine.process.snapshot();
  }

  inventory(endpoint: FactoryEndpoint) {
    return this.resolveInventory(endpoint).snapshot();
  }

  snapshot(): FactorySnapshot {
    return {
      version: 1,
      paused: this.paused,
      clock: this.clock.snapshot(),
      machines: [...this.machines.values()].map((machine) => ({
        id: machine.id,
        inputs: [...machine.inputs.values()].map((inventory) => inventory.state()),
        outputs: [...machine.outputs.values()].map((inventory) => inventory.state()),
        process: machine.process.snapshot(),
      })),
      storages: [...this.storages].map(([id, inventory]) => ({ id, inventory: inventory.state() })),
    };
  }

  private step(tick: number, deltaSeconds: number) {
    if (!this.paused) {
      for (const link of this.links) {
        this.transfer({
          tick,
          link,
          source: this.resolveOutput(link.from),
          destination: this.resolveInput(link.to),
        });
      }
    }
    for (const machine of this.machines.values()) {
      machine.process.step(machine.inputs, machine.outputs, {
        paused: this.paused,
        deltaSeconds,
      });
    }
  }

  private resolveOutput(endpoint: FactoryEndpoint) {
    const machine = this.machines.get(endpoint.nodeId);
    const inventory = machine?.outputs.get(endpoint.portId);
    if (!inventory) throw new Error(`unknown output endpoint: ${endpoint.nodeId}.${endpoint.portId}`);
    return inventory;
  }

  private resolveInput(endpoint: FactoryEndpoint) {
    const machineInput = this.machines.get(endpoint.nodeId)?.inputs.get(endpoint.portId);
    if (machineInput) return machineInput;
    const storage = this.storages.get(endpoint.nodeId);
    if (storage?.portId === endpoint.portId) return storage;
    throw new Error(`unknown input endpoint: ${endpoint.nodeId}.${endpoint.portId}`);
  }

  private resolveInventory(endpoint: FactoryEndpoint) {
    const machine = this.machines.get(endpoint.nodeId);
    const inventory = machine?.inputs.get(endpoint.portId) ?? machine?.outputs.get(endpoint.portId);
    if (inventory) return inventory;
    const storage = this.storages.get(endpoint.nodeId);
    if (storage?.portId === endpoint.portId) return storage;
    throw new Error(`unknown inventory endpoint: ${endpoint.nodeId}.${endpoint.portId}`);
  }

  private validateLinks() {
    for (const link of this.links) {
      this.resolveOutput(link.from);
      this.resolveInput(link.to);
      if (link.maxAmountPerTick !== undefined
        && (!Number.isFinite(link.maxAmountPerTick) || link.maxAmountPerTick < 0)) {
        throw new RangeError("maxAmountPerTick must be non-negative");
      }
      const sourceRecipe = this.machines.get(link.from.nodeId)!.process.recipe;
      const sourceItems = new Set(
        sourceRecipe.outputs
          .filter(({ portId }) => portId === link.from.portId)
          .map(({ itemId }) => itemId),
      );
      const destinationMachine = this.machines.get(link.to.nodeId);
      const destinationItems = destinationMachine
        ? new Set(
          destinationMachine.process.recipe.inputs
            .filter(({ portId }) => portId === link.to.portId)
            .map(({ itemId }) => itemId),
        )
        : null;
      const storageConfigItem = destinationMachine
        ? undefined
        : this.storageAcceptedItem(link.to.nodeId);
      const compatible = [...sourceItems].every((itemId) => (
        destinationItems ? destinationItems.has(itemId) : !storageConfigItem || storageConfigItem === itemId
      ));
      if (!compatible) {
        throw new Error(`incompatible factory link: ${link.from.nodeId}.${link.from.portId} -> ${link.to.nodeId}.${link.to.portId}`);
      }
    }
  }

  private storageAcceptedItem(id: string) {
    return this.storageAcceptedItems.get(id);
  }
}
