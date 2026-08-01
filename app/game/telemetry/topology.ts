import { TYPE_NAME, directionForRotation, machinePorts, sameDirection } from "../config.ts";
import type { FactorySimulation } from "../simulation.ts";
import type { ItemType, MachineType, StructureData } from "../types.ts";
import type { LiveRuntimeState } from "./live.ts";

export type RuntimeTopologyNode = Readonly<{
  id: string;
  kind: "machine" | "item";
  label: string;
  column: number;
  order: number;
  structureId: number | null;
  buildingId: string | null;
  itemId?: string;
  status: LiveRuntimeState | "storing";
  statusLabel: string;
  progress: number;
  stock: number;
  capacity?: number;
}>;

export type RuntimeTopologyEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  kind: "physical";
  itemId: string;
  itemName: string;
  amount: number;
  structureId: number;
  connected: boolean;
  beltCount: number;
  jammed: boolean;
  beltIds: readonly number[];
}>;

export type RuntimeTopology = Readonly<{
  graph: Readonly<{
    title: string;
    nodes: readonly RuntimeTopologyNode[];
    edges: readonly RuntimeTopologyEdge[];
  }>;
  live: Readonly<{
    nodeStates: Readonly<Record<string, Readonly<{
      status: LiveRuntimeState | "storing";
      actualRatePerMinute?: number;
      stock?: number;
      capacity?: number;
      progress?: number;
    }>>>;
    updatedAt: number;
  }>;
}>;

const BUILDING_ID: Record<MachineType, string> = {
  miner: "vein_miner",
  smelter: "arc_smelter",
  assembler: "hydraulic_former",
  storage: "small_storage",
};

const STAGE: Record<MachineType, number> = { miner: 0, smelter: 2, assembler: 4, storage: 6 };
const NEXT_TYPE: Partial<Record<MachineType, MachineType>> = {
  miner: "smelter",
  smelter: "assembler",
  assembler: "storage",
};
const ITEM_INFO: Record<ItemType, Readonly<{ id: string; label: string; column: number }>> = {
  iron_ore: { id: "iron_ore", label: "철광석", column: 1 },
  copper_ore: { id: "copper_ore", label: "구리광석", column: 1 },
  iron_ingot: { id: "iron_ingot", label: "철 주괴", column: 3 },
  copper_ingot: { id: "copper_ingot", label: "구리 주괴", column: 3 },
  iron_plate: { id: "iron_plate", label: "철판", column: 5 },
};
const RATE_PER_MINUTE: Record<Exclude<MachineType, "storage">, number> = {
  miner: 60 / 2.1,
  smelter: 60 / 2.7,
  assembler: 60 / 3.4,
};
const STATUS_LABEL: Record<LiveRuntimeState | "storing", string> = {
  working: "가동 중",
  starved: "원료 부족",
  blocked: "출력 막힘",
  disconnected: "연결 끊김",
  idle: "대기",
  storing: "저장 중",
};

const machineNodeId = (id: number) => `structure:${id}`;
const itemNodeId = (item: ItemType) => `item:${ITEM_INFO[item].id}`;
const distance = (a: StructureData, b: StructureData) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

const findTarget = (structures: readonly StructureData[], source: StructureData, targetType: MachineType) =>
  structures
    .filter((candidate) => candidate.type === targetType)
    .sort((a, b) => distance(source, a) - distance(source, b) || a.id - b.id)[0];

const traceBelts = (
  simulation: Pick<FactorySimulation, "structures" | "beltItems" | "getStructureAt">,
  source: StructureData,
  expectedTarget: StructureData,
) => {
  const sourcePorts = machinePorts(source);
  let belt = simulation.getStructureAt(sourcePorts.output.x, sourcePorts.output.z);
  const beltIds: number[] = [];
  const visited = new Set<number>();
  let jammed = false;

  if (!belt || belt.type !== "belt" || !sameDirection(directionForRotation(belt.rotation), sourcePorts.flow)) {
    return { connected: false, beltIds, jammed };
  }

  while (belt?.type === "belt" && !visited.has(belt.id)) {
    visited.add(belt.id);
    beltIds.push(belt.id);
    const item = simulation.beltItems.get(belt.id);
    if (item && item.progress >= 0.979) jammed = true;
    const direction = directionForRotation(belt.rotation);
    const targetPorts = machinePorts(expectedTarget);
    if (targetPorts.inputs.some((input) => input.x === belt!.x && input.z === belt!.z)
      && sameDirection(targetPorts.flow, direction)) {
      return { connected: true, beltIds, jammed };
    }
    const next = simulation.getStructureAt(belt.x + direction.x, belt.z + direction.z);
    if (!next || next.type !== "belt") break;
    belt = next;
  }
  return { connected: false, beltIds, jammed };
};

const runtimeStateFor = (simulation: FactorySimulation, structure: StructureData) => {
  const selected = simulation.getSelectedInfo(structure.id);
  const status = selected?.runtimeState ?? "idle";
  const normalized = structure.type === "storage" && selected && selected.inputCount > 0 && status === "idle"
    ? "storing"
    : status;
  return {
    status: normalized,
    statusLabel: STATUS_LABEL[normalized],
    progress: selected?.progress ?? 0,
    stock: (selected?.inputCount ?? 0) + (structure.type === "storage" ? 0 : selected?.outputCount ?? 0),
    capacity: structure.type === "storage" ? selected?.inputCapacity : undefined,
  };
};

const outputItemFor = (simulation: FactorySimulation, structure: StructureData & { type: MachineType }): ItemType | null => {
  if (structure.type === "miner") return structure.x === 7 && structure.z === 4 ? "copper_ore" : "iron_ore";
  if (structure.type === "assembler") return "iron_plate";
  if (structure.type === "smelter") {
    return simulation.machines.get(structure.id)?.recipeId === "smelt_copper_ingot"
      ? "copper_ingot"
      : "iron_ingot";
  }
  return null;
};

/** Builds the graph from placed structure instances and their current belt paths only. */
export function buildRuntimeTopology(simulation: FactorySimulation): RuntimeTopology {
  const structures = [...simulation.structures.values()];
  const machines = structures.filter((structure): structure is StructureData & { type: MachineType } => structure.type !== "belt");
  const nodes: RuntimeTopologyNode[] = [];
  const nodeStates: Record<string, RuntimeTopology["live"]["nodeStates"][string]> = {};
  const usedItems = new Set<ItemType>();

  machines.forEach((structure) => {
    if (structure.type === "miner") {
      const item = structure.x === 7 && structure.z === 4 ? "copper_ore" : "iron_ore";
      usedItems.add(item);
    }
    if (structure.type === "smelter") {
      const copper = simulation.machines.get(structure.id)?.recipeId === "smelt_copper_ingot";
      usedItems.add(copper ? "copper_ore" : "iron_ore");
      usedItems.add(copper ? "copper_ingot" : "iron_ingot");
    }
    if (structure.type === "assembler") { usedItems.add("iron_ingot"); usedItems.add("iron_plate"); }
    if (structure.type === "storage") usedItems.add("iron_plate");
    const runtime = runtimeStateFor(simulation, structure);
    const id = machineNodeId(structure.id);
    nodes.push({
      id,
      kind: "machine",
      label: TYPE_NAME[structure.type],
      column: STAGE[structure.type],
      order: structure.id,
      structureId: structure.id,
      buildingId: BUILDING_ID[structure.type],
      ...runtime,
    });
    const actualRatePerMinute = structure.type !== "storage" && runtime.status === "working"
      ? RATE_PER_MINUTE[structure.type]
      : 0;
    nodeStates[id] = { ...runtime, actualRatePerMinute };
  });

  const stockByItem: Record<ItemType, number> = {
    iron_ore: 0,
    copper_ore: 0,
    iron_ingot: 0,
    copper_ingot: 0,
    iron_plate: 0,
  };
  simulation.machines.forEach((state, structureId) => {
    state.input.forEach((item) => { stockByItem[item] += 1; });
    state.output.forEach((item) => { stockByItem[item] += 1; });
    if (simulation.structures.get(structureId)?.type === "storage") {
      state.storedItems.forEach((item) => { stockByItem[item] += 1; });
    }
  });
  simulation.beltItems.forEach((item) => { stockByItem[item.type] += 1; });
  [...usedItems].forEach((item, order) => {
    const info = ITEM_INFO[item];
    const id = itemNodeId(item);
    const stock = stockByItem[item];
    nodes.push({
      id,
      kind: "item",
      label: info.label,
      column: info.column,
      order,
      structureId: null,
      buildingId: null,
      itemId: info.id,
      status: stock > 0 ? "storing" : "idle",
      statusLabel: stock > 0 ? "재고 있음" : "재고 없음",
      progress: 0,
      stock,
    });
    nodeStates[id] = { status: stock > 0 ? "storing" : "idle", stock };
  });

  const edges: RuntimeTopologyEdge[] = [];
  machines.forEach((source) => {
    const targetType = NEXT_TYPE[source.type];
    const outputItem = outputItemFor(simulation, source);
    if (!targetType || !outputItem) return;
    const target = findTarget(machines, source, targetType);
    if (!target) return;
    const trace = traceBelts(simulation, source, target);
    const info = ITEM_INFO[outputItem];
    edges.push({
      id: `physical:${source.id}:${target.id}`,
      source: machineNodeId(source.id),
      target: machineNodeId(target.id),
      kind: "physical",
      itemId: info.id,
      itemName: info.label,
      amount: 1,
      structureId: source.id,
      connected: trace.connected,
      beltCount: trace.beltIds.length,
      jammed: trace.jammed,
      beltIds: trace.beltIds,
    });
  });

  return {
    graph: { title: "실제 공장 생산 계보", nodes, edges },
    live: { nodeStates, updatedAt: Date.now() },
  };
}
