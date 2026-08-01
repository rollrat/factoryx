import { STORAGE_CAPACITY } from "../config.ts";
import type { FactorySimulation } from "../simulation.ts";
import type { BuildingId } from "../domain/types.ts";
import type { BuildType, ItemType, MachineState, MachineType, StructureData } from "../types.ts";

export type LiveRuntimeState = "working" | "starved" | "blocked" | "disconnected" | "idle";
export type BeltRuntimeState = "moving" | "jammed" | "idle";

export const LEGACY_BUILDING_IDS = {
  belt: "conveyor_mk1",
  splitter: "splitter",
  merger: "merger",
  miner: "vein_miner",
  smelter: "arc_smelter",
  assembler: "hydraulic_former",
  crusher: "crusher",
  storage: "small_storage",
} as const satisfies Record<BuildType, BuildingId>;

export const LEGACY_ITEM_IDS = {
  iron_ore: "iron_ore",
  copper_ore: "copper_ore",
  iron_ingot: "iron_ingot",
  copper_ingot: "copper_ingot",
  iron_plate: "iron_plate",
  iron_rod: "iron_rod",
  fastener_pack: "fastener_pack",
  limestone: "limestone",
  construction_block: "construction_block",
} as const satisfies Record<ItemType, string>;

export type RuntimeStateCounts = Readonly<Record<LiveRuntimeState, number>>;

export type MachineTelemetry = Readonly<{
  structureId: number;
  type: MachineType;
  buildingId: BuildingId;
  runtimeState: LiveRuntimeState;
  progress: number;
  inputItems: number;
  outputItems: number;
  storedItems: number;
  workInProgress: number;
}>;

export type MachineTypeTelemetry = Readonly<{
  type: MachineType;
  buildingId: BuildingId;
  count: number;
  states: RuntimeStateCounts;
  inputItems: number;
  outputItems: number;
  storedItems: number;
  workInProgress: number;
  averageProgress: number;
}>;

export type BeltTelemetry = Readonly<{
  count: number;
  buildingId: BuildingId;
  moving: number;
  jammed: number;
  idle: number;
  itemsInTransit: number;
  averageProgress: number;
}>;

export type LiveFactoryTelemetry = Readonly<{
  version: 1;
  totals: Readonly<{
    structures: number;
    machines: number;
    belts: number;
    inventoryItems: number;
    workInProgress: number;
  }>;
  stateCounts: RuntimeStateCounts;
  byType: Readonly<Record<MachineType, MachineTypeTelemetry>>;
  belts: BeltTelemetry;
  machines: readonly MachineTelemetry[];
  itemStocks: Readonly<Record<string, number>>;
}>;

export type LiveTelemetryOptions = Readonly<{
  buildingIdByType?: Partial<Record<BuildType, BuildingId>>;
  beltJamProgress?: number;
}>;

type MutableMachineTypeTelemetry = {
  type: MachineType;
  buildingId: BuildingId;
  count: number;
  states: Record<LiveRuntimeState, number>;
  inputItems: number;
  outputItems: number;
  storedItems: number;
  workInProgress: number;
  progressTotal: number;
};

const MACHINE_TYPES: readonly MachineType[] = ["miner", "smelter", "crusher", "assembler", "storage"];
const isTelemetryMachine = (type: BuildType): type is MachineType => (
  type === "miner" || type === "smelter" || type === "crusher" || type === "assembler" || type === "storage"
);

const emptyStateCounts = (): Record<LiveRuntimeState, number> => ({
  working: 0,
  starved: 0,
  blocked: 0,
  disconnected: 0,
  idle: 0,
});

const clampProgress = (progress: number) => Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));

const classifyMachine = (
  simulation: Pick<FactorySimulation, "hasInputConnection" | "hasOutputConnection">,
  type: MachineType,
  structure: StructureData,
  state: MachineState,
): LiveRuntimeState => {
  if (type === "storage") {
    if (state.stored >= STORAGE_CAPACITY) return "blocked";
    if (!simulation.hasInputConnection(structure)) return "disconnected";
    if (state.intakePulse > 0) return "working";
    return "idle";
  }
  if (state.working) return "working";
  if (state.output.length > 0) return "blocked";
  if (type !== "miner" && !simulation.hasInputConnection(structure)) return "disconnected";
  if (type === "miner") return simulation.hasOutputConnection(structure) ? "idle" : "disconnected";
  return "starved";
};

/** Builds an immutable, side-effect-free read model from the live prototype simulation. */
export const buildLiveTelemetry = (
  simulation: Pick<FactorySimulation, "structures" | "machines" | "beltItems" | "hasInputConnection" | "hasOutputConnection">,
  options: LiveTelemetryOptions = {},
): LiveFactoryTelemetry => {
  const ids = {
    ...LEGACY_BUILDING_IDS,
    ...options.buildingIdByType,
  } as Record<BuildType, BuildingId>;
  const beltJamProgress = options.beltJamProgress ?? 0.979;
  if (!Number.isFinite(beltJamProgress) || beltJamProgress < 0 || beltJamProgress > 1) {
    throw new RangeError("beltJamProgress must be between zero and one");
  }

  const stateCounts = emptyStateCounts();
  const mutableByType = Object.fromEntries(MACHINE_TYPES.map((type) => [type, {
    type,
    buildingId: ids[type],
    count: 0,
    states: emptyStateCounts(),
    inputItems: 0,
    outputItems: 0,
    storedItems: 0,
    workInProgress: 0,
    progressTotal: 0,
  }])) as Record<MachineType, MutableMachineTypeTelemetry>;
  const machines: MachineTelemetry[] = [];
  const itemStocks: Record<string, number> = {};
  const addItemStock = (item: ItemType, amount = 1) => {
    const itemId = LEGACY_ITEM_IDS[item];
    itemStocks[itemId] = (itemStocks[itemId] ?? 0) + amount;
  };

  for (const [structureId, structure] of simulation.structures) {
    if (!isTelemetryMachine(structure.type)) continue;
    const machine = simulation.machines.get(structureId);
    if (!machine) continue;
    const type = structure.type;
    const runtimeState = classifyMachine(simulation, type, structure, machine);
    const progress = type === "storage"
      ? clampProgress(machine.stored / STORAGE_CAPACITY)
      : clampProgress(machine.progress);
    const workInProgress = machine.working ? 1 : 0;
    const telemetry: MachineTelemetry = {
      structureId,
      type,
      buildingId: ids[type],
      runtimeState,
      progress,
      inputItems: machine.input.length,
      outputItems: machine.output.length,
      storedItems: type === "storage" ? machine.stored : 0,
      workInProgress,
    };
    machine.input.forEach((item) => addItemStock(item));
    machine.output.forEach((item) => addItemStock(item));
    if (type === "storage") machine.storedItems.forEach((item) => addItemStock(item));
    machines.push(telemetry);
    stateCounts[runtimeState] += 1;
    const aggregate = mutableByType[type];
    aggregate.count += 1;
    aggregate.states[runtimeState] += 1;
    aggregate.inputItems += telemetry.inputItems;
    aggregate.outputItems += telemetry.outputItems;
    aggregate.storedItems += telemetry.storedItems;
    aggregate.workInProgress += workInProgress;
    aggregate.progressTotal += progress;
  }

  let moving = 0;
  let jammed = 0;
  let beltProgress = 0;
  let beltCount = 0;
  for (const [structureId, structure] of simulation.structures) {
    if (structure.type !== "belt") continue;
    beltCount += 1;
    const item = simulation.beltItems.get(structureId);
    if (!item) continue;
    addItemStock(item.type);
    beltProgress += clampProgress(item.progress);
    if (item.progress >= beltJamProgress) jammed += 1;
    else moving += 1;
  }
  const idleBelts = beltCount - moving - jammed;
  const byType = Object.fromEntries(MACHINE_TYPES.map((type) => {
    const { progressTotal, ...aggregate } = mutableByType[type];
    return [type, { ...aggregate, averageProgress: aggregate.count ? progressTotal / aggregate.count : 0 }];
  })) as Record<MachineType, MachineTypeTelemetry>;
  const inventoryItems = machines.reduce(
    (total, machine) => total + machine.inputItems + machine.outputItems + machine.storedItems,
    0,
  ) + moving + jammed;

  return {
    version: 1,
    totals: {
      structures: simulation.structures.size,
      machines: machines.length,
      belts: beltCount,
      inventoryItems,
      workInProgress: machines.reduce((total, machine) => total + machine.workInProgress, 0),
    },
    stateCounts: { ...stateCounts },
    byType,
    belts: {
      count: beltCount,
      buildingId: ids.belt,
      moving,
      jammed,
      idle: idleBelts,
      itemsInTransit: moving + jammed,
      averageProgress: moving + jammed ? beltProgress / (moving + jammed) : 0,
    },
    machines: machines.sort((a, b) => a.structureId - b.structureId),
    itemStocks: { ...itemStocks },
  };
};
