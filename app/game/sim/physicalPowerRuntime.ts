import type { ItemId } from "../domain/types.ts";
import {
  buildPhysicalPowerTopology,
  createPowerGridInputs,
  derivePhysicalPowerStates,
  type PhysicalPowerTopology,
  type PhysicalPowerVisualState,
  type PowerEdge,
  type PowerInstanceRuntime,
  type PowerNetworkControls,
} from "./physicalPowerNetwork.ts";
import {
  AdvancedPowerGrid,
  type AdvancedPowerGridSnapshot,
  type PowerGridResult,
} from "./powerGrid.ts";
import type { DataDrivenWorld } from "./world.ts";

const STARTUP_BUFFER_SECONDS = 15;
const EPSILON = 1e-9;

export type GeneratorFuelState = Readonly<{
  generatorId: string;
  fuelItemId: ItemId;
  buffered: number;
  capacity: number;
  consumed: number;
  loadRatio: number;
  operationState: "unconnected" | "manual_off" | "start_pending" | "idle" | "running" | "fuel_starved";
}>;

export type PhysicalGridRestartState = Readonly<{
  gridId: string;
  state: "idle" | "tripped" | "restoring" | "complete";
  shedConsumerIds: readonly string[];
}>;

export type PhysicalPowerRuntimeSnapshot = Readonly<{
  version: 1;
  edges: readonly PowerEdge[];
  controls: PowerNetworkControls;
  generators: readonly Readonly<{ id: string; fuelBuffered: number; started: boolean; operationState: GeneratorFuelState["operationState"] }>[];
  batteries: readonly Readonly<{ id: string; storedMWh: number }>[];
  grids: readonly AdvancedPowerGridSnapshot[];
  restartStates: readonly Readonly<{ gridId: string; state: PhysicalGridRestartState["state"] }>[];
}>;

export type PhysicalPowerRuntimeOptions = Readonly<{
  world: DataDrivenWorld;
  edges?: readonly PowerEdge[];
  controls?: PowerNetworkControls;
  initialGeneratorFuel?: Readonly<Record<string, number>>;
  initialBatteryMWh?: Readonly<Record<string, number>>;
  snapshot?: PhysicalPowerRuntimeSnapshot;
}>;

export type PhysicalPowerStepResult = Readonly<{
  topology: PhysicalPowerTopology;
  grids: readonly PowerGridResult[];
  generators: readonly GeneratorFuelState[];
  visualStates: readonly PhysicalPowerVisualState[];
  restartStates: readonly PhysicalGridRestartState[];
}>;

type MutableGeneratorState = {
  fuelBuffered: number;
  started: boolean;
  consumed: number;
  loadRatio: number;
  operationState: GeneratorFuelState["operationState"];
};

const cloneEdges = (edges: readonly PowerEdge[]) => edges.map((edge) => ({
  ...edge,
  from: { ...edge.from },
  to: { ...edge.to },
}));
const cloneControls = (controls: PowerNetworkControls): PowerNetworkControls => ({
  breakers: { ...(controls.breakers ?? {}) },
  switchboardOutputs: Object.fromEntries(Object.entries(controls.switchboardOutputs ?? {}).map(([id, outputs]) => [id, { ...outputs }])),
});
const assertNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
};

/** Stateful multi-component bridge between physical topology and AdvancedPowerGrid. */
export class PhysicalPowerRuntime {
  readonly world: DataDrivenWorld;
  private edges: PowerEdge[];
  private controls: PowerNetworkControls;
  private topologyValue: PhysicalPowerTopology;
  private readonly grids = new Map<string, AdvancedPowerGrid>();
  private readonly generatorStates = new Map<string, MutableGeneratorState>();
  private readonly batteryEnergy = new Map<string, number>();
  private readonly restartStateByGrid = new Map<string, PhysicalGridRestartState["state"]>();
  private lastResults: readonly PowerGridResult[] = [];

  constructor(options: PhysicalPowerRuntimeOptions) {
    this.world = options.world;
    const snapshot = options.snapshot;
    if (snapshot && snapshot.version !== 1) throw new Error(`unsupported physical power snapshot version: ${snapshot.version}`);
    this.edges = cloneEdges(snapshot?.edges ?? options.edges ?? []);
    this.controls = cloneControls(snapshot?.controls ?? options.controls ?? {});
    this.topologyValue = buildPhysicalPowerTopology(this.world, this.edges, this.controls);

    if (snapshot) {
      snapshot.generators.forEach((generator) => {
        assertNonNegative(generator.fuelBuffered, `${generator.id}.fuelBuffered`);
        if (this.generatorStates.has(generator.id)) throw new Error(`duplicate generator snapshot: ${generator.id}`);
        this.generatorStates.set(generator.id, {
          fuelBuffered: generator.fuelBuffered,
          started: generator.started,
          consumed: 0,
          loadRatio: 0,
          operationState: generator.operationState,
        });
      });
      snapshot.batteries.forEach((battery) => {
        assertNonNegative(battery.storedMWh, `${battery.id}.storedMWh`);
        if (this.batteryEnergy.has(battery.id)) throw new Error(`duplicate battery snapshot: ${battery.id}`);
        this.batteryEnergy.set(battery.id, battery.storedMWh);
      });
      const validGridIds = new Set(this.topologyValue.zones.map(({ id }) => id));
      snapshot.grids.forEach((gridSnapshot) => {
        if (!validGridIds.has(gridSnapshot.gridId)) return;
        if (this.grids.has(gridSnapshot.gridId)) throw new Error(`duplicate power grid snapshot: ${gridSnapshot.gridId}`);
        this.grids.set(gridSnapshot.gridId, new AdvancedPowerGrid(gridSnapshot.gridId, gridSnapshot));
      });
      snapshot.restartStates.forEach(({ gridId, state }) => this.restartStateByGrid.set(gridId, state));
    } else {
      Object.entries(options.initialGeneratorFuel ?? {}).forEach(([id, amount]) => {
        assertNonNegative(amount, `${id}.initialFuel`);
        this.generatorStates.set(id, { fuelBuffered: amount, started: false, consumed: 0, loadRatio: 0, operationState: "start_pending" });
      });
      Object.entries(options.initialBatteryMWh ?? {}).forEach(([id, amount]) => {
        assertNonNegative(amount, `${id}.initialBatteryMWh`);
        this.batteryEnergy.set(id, amount);
      });
    }
    this.ensureComponentGrids();
    this.clampStoredResources();
  }

  topology(): PhysicalPowerTopology { return this.topologyValue; }
  powerResults(): readonly PowerGridResult[] { return this.lastResults; }

  setEdges(edges: readonly PowerEdge[]) {
    this.edges = cloneEdges(edges);
    this.rebuildTopology();
  }

  setBreakerState(instanceId: string, state: "closed" | "open" | "tripped") {
    const instance = this.world.instance(instanceId);
    if (!instance || instance.definitionId !== "power_breaker") throw new Error(`not a power breaker: ${instanceId}`);
    this.controls = cloneControls({
      ...this.controls,
      breakers: { ...(this.controls.breakers ?? {}), [instanceId]: state },
    });
    this.rebuildTopology();
  }

  setSwitchboardOutput(instanceId: string, priority: 1 | 2 | 3 | 4, enabled: boolean) {
    const instance = this.world.instance(instanceId);
    if (!instance || instance.definitionId !== "priority_switchboard") throw new Error(`not a priority switchboard: ${instanceId}`);
    this.controls = cloneControls({
      ...this.controls,
      switchboardOutputs: {
        ...(this.controls.switchboardOutputs ?? {}),
        [instanceId]: { ...(this.controls.switchboardOutputs?.[instanceId] ?? {}), [priority]: enabled },
      },
    });
    this.rebuildTopology();
  }

  /** Adds fuel to the internal 15-second startup buffer and returns the accepted amount. */
  supplyGeneratorFuel(generatorId: string, itemId: ItemId, amount: number): number {
    assertNonNegative(amount, "fuel amount");
    const definition = this.generatorDefinition(generatorId);
    const policy = definition.generatorPolicy!;
    if (!policy.fuelItemId) return 0;
    if (policy.fuelItemId !== itemId) throw new Error(`${generatorId} cannot consume ${itemId}`);
    const capacity = this.startupFuelCapacity(generatorId);
    const state = this.mutableGeneratorState(generatorId);
    const accepted = Math.min(amount, Math.max(0, capacity - state.fuelBuffered));
    state.fuelBuffered += accepted;
    return accepted;
  }

  generatorFuelState(generatorId: string): GeneratorFuelState | null {
    const definition = this.world.instance(generatorId)
      ? this.world.registry.buildings.get(this.world.instance(generatorId)!.definitionId)
      : undefined;
    const fuelItemId = definition?.generatorPolicy?.fuelItemId;
    if (!definition?.generatorPolicy || !fuelItemId) return null;
    const state = this.mutableGeneratorState(generatorId);
    return {
      generatorId,
      fuelItemId,
      buffered: state.fuelBuffered,
      capacity: this.startupFuelCapacity(generatorId),
      consumed: state.consumed,
      loadRatio: state.loadRatio,
      operationState: state.operationState,
    };
  }

  requestSequentialRestart(gridId: string): boolean {
    const grid = this.grids.get(gridId);
    if (!grid || !grid.snapshot().mainBreakerTripped) return false;
    grid.sequentialRestart();
    this.restartStateByGrid.set(gridId, "restoring");
    return true;
  }

  step(
    deltaSeconds: number,
    overrides: Readonly<Record<string, PowerInstanceRuntime>> = {},
  ): PhysicalPowerStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) throw new RangeError("deltaSeconds must be positive");
    this.ensureComponentGrids();
    const runtime: Record<string, PowerInstanceRuntime> = { ...overrides };
    this.topologyValue.nodes.filter(({ roles }) => roles.includes("generator")).forEach((node) => {
      const definition = this.generatorDefinition(node.instanceId);
      const policy = definition.generatorPolicy!;
      if (!policy.fuelItemId) return;
      const state = this.mutableGeneratorState(node.instanceId);
      state.consumed = 0;
      state.loadRatio = 0;
      const enabled = overrides[node.instanceId]?.enabled ?? true;
      const connected = node.connectionState === "connected";
      const startupFuel = this.startupFuelCapacity(node.instanceId);
      if (!connected || !enabled) state.started = false;
      else if (!state.started && state.fuelBuffered + EPSILON >= startupFuel) state.started = true;
      const fuelLimitedMW = policy.fuelRatePerMinute && state.started
        ? policy.capacityMW * state.fuelBuffered * 60 / (policy.fuelRatePerMinute * deltaSeconds)
        : 0;
      const dispatchableMW = Math.min(policy.capacityMW, Math.max(0, fuelLimitedMW));
      runtime[node.instanceId] = {
        ...overrides[node.instanceId],
        enabled,
        fuelAvailable: state.started && dispatchableMW > EPSILON,
        dispatchableMW,
      };
    });
    this.topologyValue.nodes.filter(({ roles }) => roles.includes("battery")).forEach(({ instanceId }) => {
      runtime[instanceId] = { ...overrides[instanceId], storedMWh: this.batteryEnergy.get(instanceId) ?? overrides[instanceId]?.storedMWh ?? 0 };
    });

    const inputs = createPowerGridInputs(this.world, this.topologyValue, deltaSeconds, runtime).map((input) => ({
      ...input,
      generators: input.generators.map((generator) => ({
        ...generator,
        minimumLoadMW: Math.min(generator.minimumLoadMW ?? 0, generator.dispatchableMW ?? generator.nameplateMW),
      })),
    }));
    const results = inputs.map((input) => this.grids.get(input.gridId)!.step(input));
    this.lastResults = results;

    results.forEach((result) => {
      result.generators.forEach((generator) => {
        const definition = this.world.instance(generator.id)
          ? this.world.registry.buildings.get(this.world.instance(generator.id)!.definitionId)
          : undefined;
        const policy = definition?.generatorPolicy;
        if (!policy?.fuelItemId || !policy.fuelRatePerMinute) return;
        const state = this.mutableGeneratorState(generator.id);
        const loadRatio = policy.capacityMW === 0 ? 0 : generator.generationMW / policy.capacityMW;
        const consumed = policy.fuelRatePerMinute * loadRatio * deltaSeconds / 60;
        state.fuelBuffered = Math.max(0, state.fuelBuffered - consumed);
        state.consumed = consumed;
        state.loadRatio = loadRatio;
        if (state.fuelBuffered <= EPSILON) state.started = false;
      });
      result.batteries.forEach(({ id, storedMWh }) => this.batteryEnergy.set(id, storedMWh));
      const previous = this.restartStateByGrid.get(result.gridId) ?? "idle";
      const restartStable = result.satisfaction >= 1
        && result.operatingReserveRatio + EPSILON >= 0.1;
      const state = result.mainBreakerTripped ? "tripped"
        : previous === "restoring" && (result.shedConsumerIds.length > 0 || !restartStable) ? "restoring"
          : previous === "restoring" ? "complete"
            : previous === "complete" ? "complete" : "idle";
      this.restartStateByGrid.set(result.gridId, state);
    });
    this.refreshGeneratorOperationStates(overrides);

    const restarting = new Set([...this.restartStateByGrid].filter(([, state]) => state === "restoring").map(([id]) => id));
    return {
      topology: this.topologyValue,
      grids: results,
      generators: this.allGeneratorFuelStates(),
      visualStates: derivePhysicalPowerStates(this.topologyValue, results, restarting),
      restartStates: this.restartStates(),
    };
  }

  snapshot(): PhysicalPowerRuntimeSnapshot {
    return {
      version: 1,
      edges: cloneEdges(this.edges),
      controls: cloneControls(this.controls),
      generators: [...this.generatorStates].map(([id, state]) => ({
        id,
        fuelBuffered: state.fuelBuffered,
        started: state.started,
        operationState: state.operationState,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      batteries: [...this.batteryEnergy].map(([id, storedMWh]) => ({ id, storedMWh })).sort((a, b) => a.id.localeCompare(b.id)),
      grids: [...this.grids.values()].map((grid) => grid.snapshot()).sort((a, b) => a.gridId.localeCompare(b.gridId)),
      restartStates: [...this.restartStateByGrid].map(([gridId, state]) => ({ gridId, state })).sort((a, b) => a.gridId.localeCompare(b.gridId)),
    };
  }

  private rebuildTopology() {
    this.topologyValue = buildPhysicalPowerTopology(this.world, this.edges, this.controls);
    this.ensureComponentGrids();
  }

  private ensureComponentGrids() {
    const zoneIds = new Set(this.topologyValue.zones.map(({ id }) => id));
    this.grids.forEach((_grid, id) => { if (!zoneIds.has(id)) this.grids.delete(id); });
    this.restartStateByGrid.forEach((_state, id) => { if (!zoneIds.has(id)) this.restartStateByGrid.delete(id); });
    zoneIds.forEach((id) => {
      if (!this.grids.has(id)) this.grids.set(id, new AdvancedPowerGrid(id));
      if (!this.restartStateByGrid.has(id)) this.restartStateByGrid.set(id, "idle");
    });
  }

  private clampStoredResources() {
    this.world.allInstances().forEach((instance) => {
      const definition = this.world.registry.buildings.get(instance.definitionId);
      if (definition?.generatorPolicy?.fuelItemId) {
        const state = this.mutableGeneratorState(instance.id);
        state.fuelBuffered = Math.min(this.startupFuelCapacity(instance.id), state.fuelBuffered);
      }
      if (definition?.powerStoragePolicy && this.batteryEnergy.has(instance.id)) {
        const stored = this.batteryEnergy.get(instance.id)!;
        if (stored > definition.powerStoragePolicy.capacityMWh + EPSILON) {
          throw new RangeError(`${instance.id}.storedMWh exceeds capacity`);
        }
      }
    });
  }

  private generatorDefinition(generatorId: string) {
    const instance = this.world.instance(generatorId);
    const definition = instance && this.world.registry.buildings.get(instance.definitionId);
    if (!definition?.generatorPolicy) throw new Error(`not a power generator: ${generatorId}`);
    return definition;
  }

  private startupFuelCapacity(generatorId: string) {
    const policy = this.generatorDefinition(generatorId).generatorPolicy!;
    return (policy.fuelRatePerMinute ?? 0) * STARTUP_BUFFER_SECONDS / 60;
  }

  private mutableGeneratorState(generatorId: string) {
    let state = this.generatorStates.get(generatorId);
    if (!state) {
      state = { fuelBuffered: 0, started: false, consumed: 0, loadRatio: 0, operationState: "start_pending" };
      this.generatorStates.set(generatorId, state);
    }
    return state;
  }

  private refreshGeneratorOperationStates(overrides: Readonly<Record<string, PowerInstanceRuntime>>) {
    const resultByGenerator = new Map(this.lastResults.flatMap((result) => result.generators.map((generator) => [generator.id, generator] as const)));
    this.topologyValue.nodes.filter(({ roles }) => roles.includes("generator")).forEach((node) => {
      const definition = this.generatorDefinition(node.instanceId);
      if (!definition.generatorPolicy?.fuelItemId) return;
      const state = this.mutableGeneratorState(node.instanceId);
      const enabled = overrides[node.instanceId]?.enabled ?? true;
      const generation = resultByGenerator.get(node.instanceId)?.generationMW ?? 0;
      state.operationState = node.connectionState === "disconnected" ? "unconnected"
        : !enabled ? "manual_off"
          : state.fuelBuffered <= EPSILON ? "fuel_starved"
            : !state.started ? "start_pending"
              : generation > EPSILON ? "running" : "idle";
    });
  }

  private allGeneratorFuelStates() {
    return this.topologyValue.nodes
      .map(({ instanceId }) => this.generatorFuelState(instanceId))
      .filter((state): state is GeneratorFuelState => state !== null)
      .sort((a, b) => a.generatorId.localeCompare(b.generatorId));
  }

  private restartStates(): PhysicalGridRestartState[] {
    const resultByGrid = new Map(this.lastResults.map((result) => [result.gridId, result]));
    return [...this.restartStateByGrid].map(([gridId, state]) => ({
      gridId,
      state,
      shedConsumerIds: resultByGrid.get(gridId)?.shedConsumerIds ?? [],
    })).sort((a, b) => a.gridId.localeCompare(b.gridId));
  }
}
