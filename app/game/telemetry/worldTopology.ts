import type { BuildingInstance, PortDefinition } from "../domain/types.ts";
import type { CampaignWorldRuntime } from "../sim/campaignWorld.ts";
import type { MachineRuntimeState } from "../sim/contracts.ts";
import type { PowerGridResult } from "../sim/powerGrid.ts";
import type { PhysicalPowerTopology } from "../sim/physicalPowerNetwork.ts";
import type {
  ProductionConnection,
  WorldProductionConnectionState,
  WorldProductionNodeSnapshot,
  WorldProductionSimulation,
} from "../sim/worldProduction.ts";
import { portsShareStratumOrShaftPair, type WorldPort } from "../sim/world.ts";
import type { RuntimeTopology, RuntimeTopologyEdge, RuntimeTopologyNode } from "./topology.ts";
import type { ProductionMetric } from "./productionMetrics.ts";

type TelemetryStatus = MachineRuntimeState | "storing";

const STATUS_REASON: Readonly<Record<TelemetryStatus, string>> = {
  working: "생산 중",
  starved: "입력 품목 부족",
  blocked: "출력 공간 또는 전력 부족",
  disconnected: "필수 포트 연결 없음",
  paused: "생산 일시 정지",
  idle: "대기 중",
  storing: "재고 보관 중",
};

const nodeId = (instanceId: string) => `world:${instanceId}`;
const endpointKey = (instanceId: string, portId: string) => `${instanceId}:${portId}`;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const uniqueInventories = (node: WorldProductionNodeSnapshot) => {
  const inventories = new Map<string, (typeof node.inputs)[number]>();
  node.inputs.forEach((inventory) => inventories.set(inventory.portId, inventory));
  node.outputs.forEach((inventory) => inventories.set(inventory.portId, inventory));
  return [...inventories.values()];
};

const inputStock = (node: WorldProductionNodeSnapshot) => sum(node.inputs.map(({ amount }) => amount));
const outputStock = (node: WorldProductionNodeSnapshot) => sum(
  node.outputs.filter(({ portId }) => !node.inputs.some((input) => input.portId === portId)).map(({ amount }) => amount),
);
const wipStock = (node: WorldProductionNodeSnapshot) => sum(
  node.process?.workInProgress?.inputs.map(({ amount }) => amount) ?? [],
);

const connectionsByInstance = (connections: readonly ProductionConnection[]) => {
  const result = new Map<string, Set<string>>();
  connections.forEach((connection) => {
    const source = result.get(connection.fromInstanceId) ?? new Set<string>();
    source.add(connection.fromPortId);
    result.set(connection.fromInstanceId, source);
    const target = result.get(connection.toInstanceId) ?? new Set<string>();
    target.add(connection.toPortId);
    result.set(connection.toInstanceId, target);
  });
  return result;
};

const powerStateFor = (power: PowerGridResult | readonly PowerGridResult[] | null, instanceId: string) => {
  const grids = Array.isArray(power) ? power : power ? [power] : [];
  const consumer = grids.flatMap(({ consumers }) => consumers).find(({ id }) => id === instanceId);
  const generator = grids.flatMap(({ generators }) => generators).find(({ id }) => id === instanceId);
  const battery = grids.flatMap(({ batteries }) => batteries).find(({ id }) => id === instanceId);
  return { consumer, generator, battery };
};

const stateForNode = (
  node: WorldProductionNodeSnapshot,
  instance: BuildingInstance,
  portConnections: ReadonlySet<string>,
  power: PowerGridResult | readonly PowerGridResult[] | null,
): Readonly<{ status: TelemetryStatus; reason: string }> => {
  const definitionHasPorts = uniqueInventories(node).length > 0;
  const powerState = powerStateFor(power, instance.id);
  if (powerState.consumer && powerState.consumer.requestedMW > 0 && powerState.consumer.satisfaction <= 0) {
    return { status: "blocked", reason: "전력 공급 중단" };
  }
  if (powerState.generator && powerState.generator.generationMW > 0) {
    return { status: "working", reason: "발전 중" };
  }
  if (powerState.consumer && powerState.consumer.servedMW > 0 && !node.process) {
    return { status: "working", reason: "전력 사용 중" };
  }
  if (powerState.battery && (powerState.battery.chargeMW > 0 || powerState.battery.dischargeMW > 0)) {
    return { status: "working", reason: powerState.battery.chargeMW > 0 ? "충전 중" : "방전 중" };
  }
  if (node.process) {
    const status = node.process.runtimeState;
    const voltage = powerState.consumer && powerState.consumer.satisfaction < 0.999
      ? ` · 전력 ${Math.round(powerState.consumer.satisfaction * 100)}%`
      : "";
    return { status, reason: `${STATUS_REASON[status]}${voltage}` };
  }
  const stock = sum(uniqueInventories(node).map(({ amount }) => amount));
  if (definitionHasPorts && portConnections.size === 0) return { status: "disconnected", reason: STATUS_REASON.disconnected };
  const fullOutput = node.outputs.some(({ amount, capacity }) => capacity > 0 && amount >= capacity);
  if (fullOutput) return { status: "blocked", reason: "출력 버퍼 가득 참" };
  if (stock > 0) return { status: "storing", reason: STATUS_REASON.storing };
  return { status: "idle", reason: STATUS_REASON.idle };
};

const actualRate = (node: WorldProductionNodeSnapshot, elapsedSeconds: number, outputPerCycle: number) => {
  if (!node.process || elapsedSeconds <= 0) return 0;
  const recipe = node.process;
  return recipe.completedCycles > 0 ? recipe.completedCycles * outputPerCycle * 60 / elapsedSeconds : 0;
};

const itemForConnection = (
  campaign: CampaignWorldRuntime,
  productionNode: WorldProductionNodeSnapshot | undefined,
  connection: ProductionConnection,
) => {
  const live = productionNode?.outputs.find(({ portId }) => portId === connection.fromPortId)?.itemId;
  const recipe = productionNode?.selectedRecipeId
    ? campaign.registry.recipes.get(productionNode.selectedRecipeId)
    : undefined;
  const recipeItem = recipe?.outputs.find(({ portId }) => portId === connection.fromPortId)?.itemId;
  const definition = productionNode ? campaign.registry.buildings.get(productionNode.definitionId) : undefined;
  const port = definition?.ports.find(({ id }) => id === connection.fromPortId);
  const itemId = live ?? recipeItem ?? port?.acceptedItemIds[0] ?? connection.medium;
  return {
    itemId,
    itemName: campaign.registry.items.get(itemId)?.name ?? (connection.medium === "fluid" ? "유체" : "품목"),
  };
};

const physicalEdges = (
  campaign: CampaignWorldRuntime,
  nodes: ReadonlyMap<string, WorldProductionNodeSnapshot>,
  connections: readonly WorldProductionConnectionState[],
): RuntimeTopologyEdge[] => connections.map((connection) => ({
  id: `world-link:${endpointKey(connection.fromInstanceId, connection.fromPortId)}>${endpointKey(connection.toInstanceId, connection.toPortId)}`,
  source: nodeId(connection.fromInstanceId),
  target: nodeId(connection.toInstanceId),
  kind: "physical",
  medium: connection.medium,
  ...(connection.itemId ? {
    itemId: connection.itemId,
    itemName: campaign.registry.items.get(connection.itemId)?.name ?? connection.itemId,
  } : itemForConnection(campaign, nodes.get(connection.fromInstanceId), connection)),
  amount: connection.sourceAmount,
  structureId: connection.fromInstanceId,
  connected: true,
  beltCount: 1,
  jammed: connection.blocked,
  beltIds: [],
}));

type PortEndpoint = Readonly<{ instance: BuildingInstance; port: WorldPort }>;
const allowsPowerOutput = (port: PortDefinition) => port.medium === "power" && port.direction !== "input";
const allowsPowerInput = (port: PortDefinition) => port.medium === "power" && port.direction !== "output";
const opposing = (source: WorldPort, target: WorldPort) => (
  source.connectionCell.x === target.connectionCell.x
  && source.connectionCell.z === target.connectionCell.z
  && portsShareStratumOrShaftPair(source, target)
  && source.definition.connectorProfile === target.definition.connectorProfile
  && source.localFacing.x === -target.localFacing.x
  && source.localFacing.z === -target.localFacing.z
);

/** Finds only physically adjacent power ports; it never invents a grid/core node. */
const actualPowerEdges = (
  campaign: CampaignWorldRuntime,
  physical?: Readonly<{ topology: PhysicalPowerTopology; results: readonly PowerGridResult[] }>,
): RuntimeTopologyEdge[] => {
  if (physical) return physical.topology.cables.map((cable) => {
    const result = physical.results.find(({ gridId }) => gridId === cable.gridId);
    const targetConsumer = result?.consumers.find(({ id }) => id === cable.target.ownerId);
    const amount = targetConsumer?.servedMW ?? 0;
    return {
      id: `world-power:${cable.id}`,
      source: nodeId(cable.source.ownerId),
      target: nodeId(cable.target.ownerId),
      kind: "power" as const,
      medium: "power" as const,
      itemId: "power",
      itemName: `${amount} MW 전력`,
      amount,
      structureId: cable.source.ownerId,
      connected: cable.enabled,
      beltCount: 0,
      jammed: !cable.enabled || result?.mainBreakerTripped === true,
      beltIds: [],
    };
  });
  const endpoints: PortEndpoint[] = campaign.world.allInstances().flatMap((instance) => (
    campaign.world.portsFor(instance.id).map((port) => ({ instance, port }))
  ));
  const seen = new Set<string>();
  const edges: RuntimeTopologyEdge[] = [];
  endpoints.filter(({ port }) => allowsPowerOutput(port.definition)).forEach((source) => {
    endpoints.filter(({ port }) => allowsPowerInput(port.definition)).forEach((target) => {
      if (source.instance.id === target.instance.id || !opposing(source.port, target.port)) return;
      const pairKey = [endpointKey(source.instance.id, source.port.definition.id), endpointKey(target.instance.id, target.port.definition.id)].sort().join("|");
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      const sourceDefinition = campaign.registry.buildings.get(source.instance.definitionId);
      const targetDefinition = campaign.registry.buildings.get(target.instance.definitionId);
      const generatorFirst = Boolean(targetDefinition?.generatorPolicy) && !sourceDefinition?.generatorPolicy;
      const from = generatorFirst ? target : source;
      const to = generatorFirst ? source : target;
      const power = campaign.powerResult();
      const consumer = power?.consumers.find(({ id }) => id === to.instance.id);
      edges.push({
        id: `world-power:${pairKey}`,
        source: nodeId(from.instance.id),
        target: nodeId(to.instance.id),
        kind: "power",
        medium: "power",
        itemId: "power",
        itemName: `${consumer?.servedMW ?? 0} MW 전력`,
        amount: consumer?.servedMW ?? 0,
        structureId: from.instance.id,
        connected: true,
        beltCount: 0,
        jammed: false,
        beltIds: [],
      });
    });
  });
  return edges;
};

/**
 * Production Atlas adapter backed exclusively by installed data-driven world
 * instances and their live production/power state.
 */
export function buildWorldRuntimeTopology(
  campaign: CampaignWorldRuntime,
  production: WorldProductionSimulation,
  physical?: Readonly<{ topology: PhysicalPowerTopology; results: readonly PowerGridResult[] }>,
  metrics?: ReadonlyMap<string, ProductionMetric>,
): RuntimeTopology {
  production.syncWorld();
  const snapshot = production.snapshot();
  const productionNodes = new Map(snapshot.nodes.map((node) => [node.instanceId, node]));
  const connections = production.connectionStates();
  const connectedPorts = connectionsByInstance(connections);
  const power = physical?.results ?? campaign.powerResult();
  const edges = [...physicalEdges(campaign, productionNodes, connections), ...actualPowerEdges(campaign, physical)];
  edges.forEach((edge) => {
    connectedPorts.set(edge.source.slice("world:".length), new Set([
      ...(connectedPorts.get(edge.source.slice("world:".length)) ?? []), edge.id,
    ]));
    connectedPorts.set(edge.target.slice("world:".length), new Set([
      ...(connectedPorts.get(edge.target.slice("world:".length)) ?? []), edge.id,
    ]));
  });

  const nodes: RuntimeTopologyNode[] = [];
  const nodeStates: RuntimeTopology["live"]["nodeStates"] extends Readonly<infer T> ? T : never = {};
  campaign.world.allInstances().forEach((instance, order) => {
    const definition = campaign.registry.buildings.get(instance.definitionId);
    const productionNode = productionNodes.get(instance.id);
    if (!definition || !productionNode) return;
    const inventories = uniqueInventories(productionNode);
    const inputs = inputStock(productionNode);
    const outputs = outputStock(productionNode);
    const wip = wipStock(productionNode);
    const stock = sum(inventories.map(({ amount }) => amount)) + wip;
    const capacity = sum(inventories.map((inventory) => inventory.capacity));
    const state = stateForNode(productionNode, instance, connectedPorts.get(instance.id) ?? new Set(), power);
    const recipe = productionNode.selectedRecipeId ? campaign.registry.recipes.get(productionNode.selectedRecipeId) : undefined;
    const project = definition.id === "project_dock"
      ? campaign.campaign.allProgress().find((progress) => !progress.completed && campaign.campaign.isUnlocked(progress.stageId))
        ?? campaign.campaign.allProgress().at(-1)
      : undefined;
    const powerState = powerStateFor(power, instance.id);
    const details = [
      recipe ? `레시피 · ${recipe.name}` : "레시피 없음",
      `입력 ${inputs} · 출력 ${outputs} · 작업중 ${wip}`,
      state.reason,
    ];
    if (powerState.consumer) details.push(`전력 ${powerState.consumer.servedMW}/${powerState.consumer.requestedMW} MW`);
    if (powerState.generator) details.push(`발전 ${powerState.generator.generationMW}/${powerState.generator.dispatchableMW} MW`);
    if (powerState.battery) details.push(`저장 ${powerState.battery.storedMWh} MWh`);
    if (project) details.push(`계약 ${project.stageId} · 납품 ${project.deliveredTotal}/${project.requiredTotal}`);
    const id = nodeId(instance.id);
    nodes.push({
      id,
      kind: definition.placementMode === "preplaced_unique" ? "infrastructure" : "machine",
      label: definition.name,
      column: instance.position.x,
      order,
      structureId: instance.id,
      instanceId: instance.id,
      buildingId: definition.id,
      recipeId: productionNode.selectedRecipeId,
      inputStock: inputs,
      outputStock: outputs,
      workInProgress: wip,
      stopReason: state.reason,
      status: state.status,
      statusLabel: details.join(" · "),
      progress: project?.totalProgress ?? productionNode.process?.progress ?? 0,
      stock: project?.deliveredTotal ?? stock,
      capacity: project?.requiredTotal ?? capacity,
    });
    nodeStates[id] = {
      status: state.status,
      actualRatePerMinute: actualRate(
        productionNode,
        snapshot.clock.elapsedSeconds,
        sum(recipe?.outputs.map(({ amount }) => amount) ?? [1]),
      ),
      stock: project?.deliveredTotal ?? stock,
      capacity: project?.requiredTotal ?? capacity,
      progress: project?.totalProgress ?? productionNode.process?.progress ?? 0,
    };
  });

  return {
    graph: { title: "실제 공장 생산 Atlas", nodes, edges },
    live: {
      nodeStates,
      updatedAt: snapshot.clock.elapsedSeconds * 1_000,
      ...(metrics ? {
        itemMetrics: Object.fromEntries([...metrics].map(([itemId, metric]) => [itemId, {
          producedPerMinute: metric.producedPerMinute,
          consumedPerMinute: metric.consumedPerMinute,
          stock: metric.storedStock + metric.bufferStock + metric.inTransit + metric.workInProgress,
          collecting: metric.collecting,
          health: metric.health,
          producerCount: metric.producerCount,
          workingProducerCount: metric.workingProducerCount,
        }])),
      } : {}),
    },
  };
}
