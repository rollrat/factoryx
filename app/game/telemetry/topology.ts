import { TYPE_NAME, directionForRotation, machinePorts, sameDirection } from "../config.ts";
import { START_REGISTRY } from "../data/index.ts";
import type { FactorySimulation } from "../simulation.ts";
import { FIELD_CORE_CAPACITY_MW, POWER_DEMAND_MW } from "../sim/power.ts";
import type { ItemType, MachineType, StructureData } from "../types.ts";
import type { LiveRuntimeState } from "./live.ts";
import type { MachineRuntimeState } from "../sim/contracts.ts";

export type RuntimeTopologyNode = Readonly<{
  id: string;
  kind: "machine" | "item" | "infrastructure" | "contract";
  label: string;
  column: number;
  order: number;
  structureId: number | string | null;
  instanceId?: string;
  buildingId: string | null;
  itemId?: string;
  recipeId?: string | null;
  inputStock?: number;
  outputStock?: number;
  workInProgress?: number;
  stopReason?: string | null;
  status: MachineRuntimeState | "storing";
  statusLabel: string;
  progress: number;
  stock: number;
  capacity?: number;
}>;

export type RuntimeTopologyEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  kind: "physical" | "power";
  medium: "solid" | "fluid" | "power";
  itemId: string;
  itemName: string;
  amount: number;
  structureId: number | string | null;
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
      status: MachineRuntimeState | "storing";
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
  crusher: "crusher",
  assembler: "hydraulic_former",
  storage: "small_storage",
};

const STAGE: Record<MachineType, number> = { miner: 0, smelter: 2, crusher: 2, assembler: 4, storage: 6 };
const NEXT_TYPE: Partial<Record<Exclude<MachineType, "miner">, MachineType>> = {
  smelter: "assembler",
  crusher: "storage",
  assembler: "storage",
};
const ITEM_INFO: Record<ItemType, Readonly<{ id: string; label: string; column: number }>> = {
  iron_ore: { id: "iron_ore", label: "철광석", column: 1 },
  copper_ore: { id: "copper_ore", label: "구리광석", column: 1 },
  iron_ingot: { id: "iron_ingot", label: "철 주괴", column: 3 },
  copper_ingot: { id: "copper_ingot", label: "구리 주괴", column: 3 },
  iron_plate: { id: "iron_plate", label: "철판", column: 5 },
  iron_rod: { id: "iron_rod", label: "철봉", column: 5 },
  fastener_pack: { id: "fastener_pack", label: "체결재 팩", column: 5 },
  limestone: { id: "limestone", label: "석회암", column: 1 },
  construction_block: { id: "construction_block", label: "건축 블록", column: 3 },
};
const RATE_PER_MINUTE: Record<Exclude<MachineType, "storage">, number> = {
  miner: 60 / 2.1,
  smelter: 60 / 2.7,
  crusher: 30,
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
const PROJECT_DOCK_NODE_ID = "infrastructure:project_dock";
const FIELD_POWER_CORE_NODE_ID = "infrastructure:field_power_core";
const DOCK_INPUT_CELL: Record<string, Readonly<{ x: number; z: number }>> = {
  phase1_plate_in: { x: 5, z: 7 },
  phase1_block_in: { x: 5, z: 8 },
  phase1_fastener_in: { x: 5, z: 9 },
};
const distance = (a: StructureData, b: StructureData) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const isTransportStructure = (structure: StructureData | null): structure is StructureData => Boolean(
  structure && (structure.type === "belt" || structure.type === "splitter" || structure.type === "merger"),
);

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
  const first = simulation.getStructureAt(sourcePorts.output.x, sourcePorts.output.z);
  const beltIds: number[] = [];
  const visited = new Set<number>();

  if (!isTransportStructure(first) || !sameDirection(directionForRotation(first.rotation), sourcePorts.flow)) {
    return { connected: false, beltIds, jammed: false };
  }

  const queue = [{ transport: first, path: [] as number[], jammed: false }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const belt = current.transport;
    if (visited.has(belt.id)) continue;
    visited.add(belt.id);
    const path = [...current.path, belt.id];
    const item = simulation.beltItems.get(belt.id);
    const jammed = current.jammed || Boolean(item && item.progress >= 0.979);
    const direction = directionForRotation(belt.rotation);
    const targetPorts = machinePorts(expectedTarget);
    if (targetPorts.inputs.some((input) => input.x === belt.x && input.z === belt.z)
      && sameDirection(targetPorts.flow, direction)) {
      return { connected: true, beltIds: path, jammed };
    }
    const left = { x: direction.z, z: -direction.x };
    const right = { x: -direction.z, z: direction.x };
    const directions = belt.type === "splitter" ? [direction, left, right] : [direction];
    directions.forEach((outgoing) => {
      const next = simulation.getStructureAt(belt.x + outgoing.x, belt.z + outgoing.z);
      if (isTransportStructure(next) && sameDirection(directionForRotation(next.rotation), outgoing)) {
        queue.push({ transport: next, path, jammed });
      }
    });
  }
  return { connected: false, beltIds: [...visited], jammed: false };
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
  if (structure.type === "miner") {
    const recipeId = simulation.machines.get(structure.id)?.recipeId;
    if (recipeId === "mine_copper_ore") return "copper_ore";
    if (recipeId === "mine_limestone") return "limestone";
    return "iron_ore";
  }
  if (structure.type === "crusher") return "construction_block";
  if (structure.type === "assembler") {
    const recipeId = simulation.machines.get(structure.id)?.recipeId;
    if (recipeId === "form_iron_rod") return "iron_rod";
    if (recipeId === "form_fastener_pack") return "fastener_pack";
    return "iron_plate";
  }
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
  const machines = structures.filter((structure): structure is StructureData & { type: MachineType } => (
    structure.type === "miner" || structure.type === "smelter"
      || structure.type === "crusher" || structure.type === "assembler" || structure.type === "storage"
  ));
  const nodes: RuntimeTopologyNode[] = [];
  const nodeStates: Record<string, RuntimeTopology["live"]["nodeStates"][string]> = {};
  const usedItems = new Set<ItemType>();

  machines.forEach((structure) => {
    if (structure.type === "miner") {
      const item = outputItemFor(simulation, structure) ?? "iron_ore";
      usedItems.add(item);
    }
    if (structure.type === "smelter") {
      const copper = simulation.machines.get(structure.id)?.recipeId === "smelt_copper_ingot";
      usedItems.add(copper ? "copper_ore" : "iron_ore");
      usedItems.add(copper ? "copper_ingot" : "iron_ingot");
    }
    if (structure.type === "assembler") {
      const outputItem = outputItemFor(simulation, structure) ?? "iron_plate";
      usedItems.add(outputItem === "fastener_pack" ? "iron_rod" : "iron_ingot");
      usedItems.add(outputItem);
    }
    if (structure.type === "crusher") { usedItems.add("limestone"); usedItems.add("construction_block"); }
    if (structure.type === "storage") {
      simulation.machines.get(structure.id)?.storedItems.forEach((item) => usedItems.add(item));
    }
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
    iron_rod: 0,
    fastener_pack: 0,
    limestone: 0,
    construction_block: 0,
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

  const powerGrid = simulation.getPowerGrid();
  const projectProgress = simulation.getProjectProgress();
  const powerStatus = powerGrid.overloaded ? "blocked" : "working";
  nodes.push({
    id: FIELD_POWER_CORE_NODE_ID,
    kind: "infrastructure",
    label: "현장 전력 코어",
    column: -1,
    order: 0,
    structureId: null,
    buildingId: "field_power_core",
    status: powerStatus,
    statusLabel: `${powerGrid.servedMW} / ${FIELD_CORE_CAPACITY_MW} MW`,
    progress: Math.min(1, powerGrid.demandMW / FIELD_CORE_CAPACITY_MW),
    stock: powerGrid.servedMW,
    capacity: FIELD_CORE_CAPACITY_MW,
  });
  nodeStates[FIELD_POWER_CORE_NODE_ID] = {
    status: powerStatus,
    stock: powerGrid.servedMW,
    capacity: FIELD_CORE_CAPACITY_MW,
    progress: Math.min(1, powerGrid.demandMW / FIELD_CORE_CAPACITY_MW),
  };

  nodes.push({
    id: PROJECT_DOCK_NODE_ID,
    kind: "infrastructure",
    label: "개척 프로젝트 도크",
    column: 8,
    order: 0,
    structureId: null,
    buildingId: "project_dock",
    status: projectProgress.completed ? "storing" : "idle",
    statusLabel: projectProgress.completed ? "1단계 납품 완료" : "1단계 납품 대기",
    progress: projectProgress.totalProgress,
    stock: projectProgress.deliveredTotal,
    capacity: projectProgress.requiredTotal,
  });
  nodeStates[PROJECT_DOCK_NODE_ID] = {
    status: projectProgress.completed ? "storing" : "idle",
    stock: projectProgress.deliveredTotal,
    capacity: projectProgress.requiredTotal,
    progress: projectProgress.totalProgress,
  };

  const edges: RuntimeTopologyEdge[] = [];
  machines.forEach((source) => {
    const outputItem = outputItemFor(simulation, source);
    const targetType = source.type === "miner"
      ? outputItem === "limestone" ? "crusher" : "smelter"
      : NEXT_TYPE[source.type];
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
      medium: "solid",
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

  powerGrid.structures.filter((power) => machines.some(({ id }) => id === power.structureId)).forEach((power) => {
    edges.push({
      id: `power:${power.structureId}`,
      source: FIELD_POWER_CORE_NODE_ID,
      target: machineNodeId(power.structureId),
      kind: "power",
      medium: "power",
      itemId: "power",
      itemName: "전력",
      amount: POWER_DEMAND_MW[power.type],
      structureId: power.structureId,
      connected: power.powered,
      beltCount: 0,
      jammed: false,
      beltIds: [],
    });
  });

  const phaseOne = START_REGISTRY.projectStages.get("phase_1_settlement_package");
  phaseOne?.deliveries.forEach((delivery, order) => {
    const inputCell = DOCK_INPUT_CELL[delivery.portId];
    const transport = inputCell ? simulation.getStructureAt(inputCell.x, inputCell.z) : null;
    const connected = Boolean(transport && isTransportStructure(transport)
      && sameDirection(directionForRotation(transport.rotation), { x: 1, z: 0 }));
    const beltItem = transport ? simulation.beltItems.get(transport.id) : undefined;
    const existingItemNode = nodes.find((node) => node.kind === "item" && node.itemId === delivery.itemId);
    const source = existingItemNode?.id ?? `contract:${delivery.itemId}`;
    if (!existingItemNode) {
      const label = START_REGISTRY.items.get(delivery.itemId)?.name ?? delivery.itemId;
      nodes.push({
        id: source,
        kind: "contract",
        label,
        column: 7,
        order,
        structureId: null,
        buildingId: null,
        itemId: delivery.itemId,
        status: "idle",
        statusLabel: "납품 생산선 미설치",
        progress: 0,
        stock: 0,
      });
      nodeStates[source] = { status: "idle", stock: 0, progress: 0 };
    }
    edges.push({
      id: `dock:${delivery.portId}`,
      source,
      target: PROJECT_DOCK_NODE_ID,
      kind: "physical",
      medium: "solid",
      itemId: delivery.itemId,
      itemName: START_REGISTRY.items.get(delivery.itemId)?.name ?? delivery.itemId,
      amount: delivery.amount,
      structureId: null,
      connected,
      beltCount: connected ? 1 : 0,
      jammed: Boolean(beltItem && beltItem.progress >= 0.979),
      beltIds: connected && transport ? [transport.id] : [],
    });
  });

  return {
    graph: { title: "실제 공장 생산 계보", nodes, edges },
    live: { nodeStates, updatedAt: Date.now() },
  };
}
