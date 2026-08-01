import type {
  BuildingDefinition,
  BuildingInstance,
  ConnectorProfile,
  PortDefinition,
} from "../domain/types.ts";
import type {
  LoadPriority,
  PowerGridInputSnapshot,
  PowerGridResult,
} from "./powerGrid.ts";
import type { DataDrivenWorld, WorldPort } from "./world.ts";

export type PowerPortRef = Readonly<{ ownerId: string; portId: string }>;

export type PowerEdge = Readonly<{
  id: string;
  from: PowerPortRef;
  to: PowerPortRef;
  cableType?: string;
  enabled?: boolean;
}>;

export type PowerNetworkControls = Readonly<{
  breakers?: Readonly<Record<string, "closed" | "open" | "tripped">>;
  switchboardOutputs?: Readonly<Record<string, Partial<Record<LoadPriority, boolean>>>>;
}>;

export type PowerCableRenderEndpoint = Readonly<{
  ownerId: string;
  definitionId: string;
  portId: string;
  origin: Readonly<{ x: number; y: number; z: number }>;
  rotation: 0 | 1 | 2 | 3;
}>;

export type PowerCableRenderData = Readonly<{
  id: string;
  profile: Extract<ConnectorProfile, "power_local" | "power_high_voltage">;
  source: PowerCableRenderEndpoint;
  target: PowerCableRenderEndpoint;
  enabled: boolean;
  gridId: string | null;
}>;

export type PowerNetworkNode = Readonly<{
  instanceId: string;
  definitionId: string;
  gridId: string;
  connectionState: "disconnected" | "connected";
  priority?: LoadPriority;
  distributionNodeId?: string;
  roles: readonly ("generator" | "consumer" | "battery" | "distribution")[];
}>;

export type PowerNetworkZone = Readonly<{
  id: string;
  instanceIds: readonly string[];
  portKeys: readonly string[];
  edgeIds: readonly string[];
  generatorIds: readonly string[];
  consumerIds: readonly string[];
  batteryIds: readonly string[];
}>;

export type PhysicalPowerTopology = Readonly<{
  zones: readonly PowerNetworkZone[];
  nodes: readonly PowerNetworkNode[];
  cables: readonly PowerCableRenderData[];
  automaticAssignments: readonly Readonly<{ consumerId: string; distributionNodeId: string }>[];
}>;

export type PowerInstanceRuntime = Readonly<{
  active?: boolean;
  requestedMW?: number;
  enabled?: boolean;
  fuelAvailable?: boolean;
  storedMWh?: number;
}>;

export type PhysicalPowerVisualState = Readonly<{
  instanceId: string;
  gridId: string;
  connectionState: "disconnected" | "connected";
  operationState: "unconnected" | "idle" | "running" | "tripped" | "shed" | "restoring";
  powered: boolean;
  restoring: boolean;
  priority?: LoadPriority;
  satisfaction: number;
}>;

type PortRecord = Readonly<{
  key: string;
  instance: BuildingInstance;
  building: BuildingDefinition;
  port: WorldPort;
}>;

class DisjointSet {
  private readonly parents = new Map<string, string>();

  add(key: string) { if (!this.parents.has(key)) this.parents.set(key, key); }
  find(key: string): string {
    const parent = this.parents.get(key);
    if (!parent) throw new Error(`unknown power port: ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.parents.set(key, root);
    return root;
  }
  union(a: string, b: string) {
    const aRoot = this.find(a);
    const bRoot = this.find(b);
    if (aRoot === bRoot) return;
    const [root, child] = aRoot.localeCompare(bRoot) <= 0 ? [aRoot, bRoot] : [bRoot, aRoot];
    this.parents.set(child, root);
  }
}

const portKey = ({ ownerId, portId }: PowerPortRef) => `${ownerId}:${portId}`;
const isPowerProfile = (profile: ConnectorProfile): profile is PowerCableRenderData["profile"] => (
  profile === "power_local" || profile === "power_high_voltage"
);
const canConnect = (a: PortDefinition, b: PortDefinition) => {
  const aOut = a.direction === "output" || a.direction === "bidirectional";
  const aIn = a.direction === "input" || a.direction === "bidirectional";
  const bOut = b.direction === "output" || b.direction === "bidirectional";
  const bIn = b.direction === "input" || b.direction === "bidirectional";
  return (aOut && bIn) || (bOut && aIn);
};
const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();

const instanceCenter = (instance: BuildingInstance, building: BuildingDefinition) => {
  const rotated = instance.rotation % 2 === 1;
  return {
    x: instance.position.x + (rotated ? building.footprint.z : building.footprint.x) / 2,
    y: 0,
    z: instance.position.z + (rotated ? building.footprint.x : building.footprint.z) / 2,
  };
};

const collectPorts = (world: DataDrivenWorld) => {
  const records = new Map<string, PortRecord>();
  world.allInstances().forEach((instance) => {
    const building = world.registry.buildings.get(instance.definitionId);
    if (!building) return;
    world.portsFor(instance.id).forEach((port) => {
      if (port.definition.medium !== "power" || !isPowerProfile(port.definition.connectorProfile)) return;
      const key = portKey({ ownerId: instance.id, portId: port.definition.id });
      records.set(key, { key, instance, building, port });
    });
  });
  return records;
};

const validateEdges = (edges: readonly PowerEdge[], ports: ReadonlyMap<string, PortRecord>) => {
  const ids = new Set<string>();
  edges.forEach((edge) => {
    if (!edge.id) throw new Error("power edge id is required");
    if (ids.has(edge.id)) throw new Error(`duplicate power edge id: ${edge.id}`);
    ids.add(edge.id);
    const from = ports.get(portKey(edge.from));
    const to = ports.get(portKey(edge.to));
    if (!from) throw new Error(`unknown power edge endpoint: ${portKey(edge.from)}`);
    if (!to) throw new Error(`unknown power edge endpoint: ${portKey(edge.to)}`);
    if (from.key === to.key) throw new Error(`power edge ${edge.id} connects a port to itself`);
    if (from.port.definition.connectorProfile !== to.port.definition.connectorProfile) {
      throw new Error(`power edge ${edge.id} mixes ${from.port.definition.connectorProfile} and ${to.port.definition.connectorProfile}`);
    }
    if (!canConnect(from.port.definition, to.port.definition)) {
      throw new Error(`power edge ${edge.id} has incompatible port directions`);
    }
  });
};

const powerPortsFor = (instanceId: string, ports: ReadonlyMap<string, PortRecord>) => (
  [...ports.values()].filter(({ instance }) => instance.id === instanceId)
);

/** Infers the short cable created when two opposite power ports touch a grid cell. */
export const inferAdjacentPowerEdges = (world: DataDrivenWorld): readonly PowerEdge[] => {
  const ports = [...collectPorts(world).values()].sort((a, b) => a.key.localeCompare(b.key));
  const edges: PowerEdge[] = [];
  const seen = new Set<string>();
  ports.forEach((from, index) => {
    ports.slice(index + 1).forEach((to) => {
      if (from.instance.id === to.instance.id
        || from.port.connectionCell.x !== to.port.connectionCell.x
        || from.port.connectionCell.z !== to.port.connectionCell.z
        || from.port.definition.connectorProfile !== to.port.definition.connectorProfile
        || from.port.localFacing.x !== -to.port.localFacing.x
        || from.port.localFacing.z !== -to.port.localFacing.z
        || !canConnect(from.port.definition, to.port.definition)) return;
      const key = [from.key, to.key].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({
        id: `auto-power:${key}`,
        from: { ownerId: from.instance.id, portId: from.port.definition.id },
        to: { ownerId: to.instance.id, portId: to.port.definition.id },
        cableType: from.port.definition.connectorProfile,
        enabled: true,
      });
    });
  });
  return edges;
};

/**
 * Rebuilds physical power components. Call only after placement, demolition,
 * cable, breaker, or switchboard state changes; numeric grid dispatch remains per tick.
 */
export const buildPhysicalPowerTopology = (
  world: DataDrivenWorld,
  edges: readonly PowerEdge[],
  controls: PowerNetworkControls = {},
): PhysicalPowerTopology => {
  const ports = collectPorts(world);
  validateEdges(edges, ports);
  const grid = new DisjointSet();
  const branches = new DisjointSet();
  ports.forEach(({ key }) => { grid.add(key); branches.add(key); });
  const attached = new Set<string>();

  edges.filter(({ enabled = true }) => enabled).forEach((edge) => {
    const from = portKey(edge.from);
    const to = portKey(edge.to);
    grid.union(from, to);
    branches.union(from, to);
    attached.add(edge.from.ownerId);
    attached.add(edge.to.ownerId);
  });

  world.allInstances().forEach((instance) => {
    const building = world.registry.buildings.get(instance.definitionId);
    const instancePorts = powerPortsFor(instance.id, ports);
    if (!building || instancePorts.length < 2) return;
    if (building.id === "power_breaker") {
      if ((controls.breakers?.[instance.id] ?? "closed") !== "closed") return;
    }
    if (building.id === "priority_switchboard") {
      const input = instancePorts.find(({ port }) => port.definition.id === "grid_in");
      if (!input) return;
      instancePorts.filter(({ port }) => port.definition.id.startsWith("priority_")).forEach((output) => {
        const priority = Number(output.port.definition.id.slice(-1)) as LoadPriority;
        if (controls.switchboardOutputs?.[instance.id]?.[priority] === false) return;
        grid.union(input.key, output.key);
      });
      return;
    }
    if (!building.distributionPolicy && building.id !== "substation") return;
    const first = instancePorts[0].key;
    instancePorts.slice(1).forEach(({ key }) => {
      grid.union(first, key);
      branches.union(first, key);
    });
  });

  const cableEndpointKeys = new Set(edges.filter(({ enabled = true }) => enabled).flatMap((edge) => [
    portKey(edge.from), portKey(edge.to),
  ]));
  const poleUse = new Map<string, number>();
  const assignments: { consumerId: string; distributionNodeId: string }[] = [];
  const consumerRecords = world.allInstances()
    .map((instance) => ({ instance, building: world.registry.buildings.get(instance.definitionId) }))
    .filter(({ building }) => building && (building.activeMW !== undefined || building.idleMW !== undefined))
    .sort((a, b) => a.instance.id.localeCompare(b.instance.id));
  const poles = world.allInstances()
    .map((instance) => ({ instance, building: world.registry.buildings.get(instance.definitionId) }))
    .filter((entry): entry is { instance: BuildingInstance; building: BuildingDefinition } => (
      entry.building?.distributionPolicy?.radiusTiles !== undefined
    ));

  consumerRecords.forEach(({ instance, building }) => {
    if (!building || building.powerStoragePolicy || building.distributionPolicy) return;
    const consumerPort = powerPortsFor(instance.id, ports).find(({ port }) => (
      port.definition.connectorProfile === "power_local"
      && (port.definition.direction === "input" || port.definition.direction === "bidirectional")
    ));
    if (!consumerPort || cableEndpointKeys.has(consumerPort.key)) return;
    const origin = instanceCenter(instance, building);
    const candidate = poles
      .map(({ instance: pole, building: poleBuilding }) => {
        const center = instanceCenter(pole, poleBuilding);
        return { pole, poleBuilding, distance: Math.hypot(center.x - origin.x, center.z - origin.z) };
      })
      .filter(({ pole, poleBuilding, distance }) => (
        distance <= (poleBuilding.distributionPolicy?.radiusTiles ?? 0)
        && (poleUse.get(pole.id) ?? 0) < (poleBuilding.distributionPolicy?.maxConsumers ?? 0)
      ))
      .sort((a, b) => a.distance - b.distance || a.pole.id.localeCompare(b.pole.id))[0];
    if (!candidate) return;
    const polePort = powerPortsFor(candidate.pole.id, ports)[0];
    if (!polePort) return;
    grid.union(consumerPort.key, polePort.key);
    branches.union(consumerPort.key, polePort.key);
    attached.add(instance.id);
    attached.add(candidate.pole.id);
    poleUse.set(candidate.pole.id, (poleUse.get(candidate.pole.id) ?? 0) + 1);
    assignments.push({ consumerId: instance.id, distributionNodeId: candidate.pole.id });
  });

  const priorityByBranch = new Map<string, LoadPriority>();
  world.allInstances().filter(({ definitionId }) => definitionId === "priority_switchboard").forEach((instance) => {
    powerPortsFor(instance.id, ports).forEach(({ key, port }) => {
      if (!port.definition.id.startsWith("priority_")) return;
      const priority = Number(port.definition.id.slice(-1)) as LoadPriority;
      if (controls.switchboardOutputs?.[instance.id]?.[priority] === false) return;
      const root = branches.find(key);
      priorityByBranch.set(root, Math.min(priorityByBranch.get(root) ?? 4, priority) as LoadPriority);
    });
  });

  const rootToPorts = new Map<string, string[]>();
  ports.forEach(({ key }) => {
    const root = grid.find(key);
    rootToPorts.set(root, [...(rootToPorts.get(root) ?? []), key]);
  });
  const roots = [...rootToPorts.keys()].sort();
  const gridIdByRoot = new Map(roots.map((root) => [root, `power-grid:${root}`]));
  const assignmentByConsumer = new Map(assignments.map((entry) => [entry.consumerId, entry.distributionNodeId]));

  const nodes = world.allInstances().flatMap((instance): PowerNetworkNode[] => {
    const building = world.registry.buildings.get(instance.definitionId);
    const instancePorts = powerPortsFor(instance.id, ports);
    if (!building || instancePorts.length === 0) return [];
    const roles: PowerNetworkNode["roles"][number][] = [];
    if (building.generatorPolicy) roles.push("generator");
    if (building.activeMW !== undefined || building.idleMW !== undefined) roles.push("consumer");
    if (building.powerStoragePolicy) roles.push("battery");
    if (building.distributionPolicy) roles.push("distribution");
    const primary = instancePorts.find(({ port }) => port.definition.direction === "input") ?? instancePorts[0];
    const priority = roles.includes("consumer")
      ? (priorityByBranch.get(branches.find(primary.key)) ?? 3)
      : undefined;
    return [{
      instanceId: instance.id,
      definitionId: instance.definitionId,
      gridId: gridIdByRoot.get(grid.find(primary.key))!,
      connectionState: attached.has(instance.id) ? "connected" : "disconnected",
      ...(priority === undefined ? {} : { priority }),
      ...(assignmentByConsumer.has(instance.id) ? { distributionNodeId: assignmentByConsumer.get(instance.id)! } : {}),
      roles,
    }];
  });

  const zones = roots.map((root): PowerNetworkZone => {
    const zonePorts = sortedUnique(rootToPorts.get(root) ?? []);
    const instanceIds = sortedUnique(zonePorts.map((key) => ports.get(key)!.instance.id));
    const zoneNodes = nodes.filter(({ gridId }) => gridId === gridIdByRoot.get(root));
    return {
      id: gridIdByRoot.get(root)!,
      instanceIds,
      portKeys: zonePorts,
      edgeIds: edges.filter(({ enabled = true, from }) => enabled && grid.find(portKey(from)) === root).map(({ id }) => id).sort(),
      generatorIds: zoneNodes.filter(({ roles }) => roles.includes("generator")).map(({ instanceId }) => instanceId).sort(),
      consumerIds: zoneNodes.filter(({ roles }) => roles.includes("consumer")).map(({ instanceId }) => instanceId).sort(),
      batteryIds: zoneNodes.filter(({ roles }) => roles.includes("battery")).map(({ instanceId }) => instanceId).sort(),
    };
  });

  const cables = edges.map((edge): PowerCableRenderData => {
    const from = ports.get(portKey(edge.from))!;
    const to = ports.get(portKey(edge.to))!;
    const enabled = edge.enabled ?? true;
    return {
      id: edge.id,
      profile: from.port.definition.connectorProfile as PowerCableRenderData["profile"],
      source: {
        ownerId: from.instance.id,
        definitionId: from.instance.definitionId,
        portId: from.port.definition.id,
        origin: instanceCenter(from.instance, from.building),
        rotation: from.instance.rotation,
      },
      target: {
        ownerId: to.instance.id,
        definitionId: to.instance.definitionId,
        portId: to.port.definition.id,
        origin: instanceCenter(to.instance, to.building),
        rotation: to.instance.rotation,
      },
      enabled,
      gridId: enabled ? gridIdByRoot.get(grid.find(from.key))! : null,
    };
  });
  assignments.forEach(({ consumerId, distributionNodeId }) => {
    const source = powerPortsFor(distributionNodeId, ports).find(({ port }) => port.definition.connectorProfile === "power_local");
    const target = powerPortsFor(consumerId, ports).find(({ port }) => port.definition.connectorProfile === "power_local");
    if (!source || !target) return;
    cables.push({
      id: `auto-distribution:${distributionNodeId}>${consumerId}`,
      profile: "power_local",
      source: {
        ownerId: source.instance.id,
        definitionId: source.instance.definitionId,
        portId: source.port.definition.id,
        origin: instanceCenter(source.instance, source.building),
        rotation: source.instance.rotation,
      },
      target: {
        ownerId: target.instance.id,
        definitionId: target.instance.definitionId,
        portId: target.port.definition.id,
        origin: instanceCenter(target.instance, target.building),
        rotation: target.instance.rotation,
      },
      enabled: true,
      gridId: gridIdByRoot.get(grid.find(source.key))!,
    });
  });
  cables.sort((a, b) => a.id.localeCompare(b.id));

  return {
    zones: zones.sort((a, b) => a.id.localeCompare(b.id)),
    nodes: nodes.sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
    cables,
    automaticAssignments: assignments.sort((a, b) => a.consumerId.localeCompare(b.consumerId)),
  };
};

/** Creates one AdvancedPowerGrid input per physical connected component. */
export const createPowerGridInputs = (
  world: DataDrivenWorld,
  topology: PhysicalPowerTopology,
  deltaSeconds: number,
  runtime: Readonly<Record<string, PowerInstanceRuntime>> = {},
): readonly PowerGridInputSnapshot[] => topology.zones.map((zone) => {
  const zoneNodes = topology.nodes.filter(({ gridId }) => gridId === zone.id);
  const generators = [];
  const consumers = [];
  const batteries = [];
  zoneNodes.forEach((node) => {
    const instance = world.instance(node.instanceId);
    const definition = instance && world.registry.buildings.get(instance.definitionId);
    if (!instance || !definition) return;
    const override = runtime[node.instanceId] ?? {};
    const connected = node.connectionState === "connected";
    if (definition.generatorPolicy) generators.push({
      id: instance.id,
      nameplateMW: definition.generatorPolicy.capacityMW,
      minimumLoadMW: definition.generatorPolicy.capacityMW * definition.generatorPolicy.minimumLoadRatio,
      dispatchPriority: definition.generatorPolicy.dispatchPriority,
      connected,
      enabled: override.enabled,
      requiresFuel: definition.generatorPolicy.fuelItemId !== undefined,
      fuelAvailable: override.fuelAvailable ?? definition.generatorPolicy.fuelItemId === undefined,
    });
    if (definition.activeMW !== undefined || definition.idleMW !== undefined) consumers.push({
      id: instance.id,
      active: override.active ?? instance.runtimeState === "working",
      activeMW: definition.activeMW ?? 0,
      idleMW: definition.idleMW ?? 0,
      requestedMW: override.requestedMW,
      priority: node.priority,
      connected,
    });
    if (definition.powerStoragePolicy) batteries.push({
      id: instance.id,
      capacityMWh: definition.powerStoragePolicy.capacityMWh,
      storedMWh: override.storedMWh ?? 0,
      maxChargeMW: definition.powerStoragePolicy.maxChargeMW,
      maxDischargeMW: definition.powerStoragePolicy.maxDischargeMW,
      connected,
    });
  });
  return { gridId: zone.id, deltaSeconds, generators, consumers, batteries };
});

export const createSequentialRestartPlan = (topology: PhysicalPowerTopology, gridId: string) => {
  const consumers = topology.nodes.filter(({ gridId: id, roles }) => id === gridId && roles.includes("consumer"));
  return ([1, 2, 3, 4] as const).map((priority) => ({
    priority,
    consumerIds: consumers.filter((node) => (node.priority ?? 3) === priority).map(({ instanceId }) => instanceId).sort(),
  })).filter(({ consumerIds }) => consumerIds.length > 0);
};

/** Maps AdvancedPowerGrid results back to stable world/UI operation states. */
export const derivePhysicalPowerStates = (
  topology: PhysicalPowerTopology,
  results: readonly PowerGridResult[],
  restoringGridIds: ReadonlySet<string> = new Set(),
): readonly PhysicalPowerVisualState[] => {
  const resultByGrid = new Map(results.map((result) => [result.gridId, result]));
  return topology.nodes.map((node) => {
    const result = resultByGrid.get(node.gridId);
    const consumer = result?.consumers.find(({ id }) => id === node.instanceId);
    const disconnected = node.connectionState === "disconnected";
    const tripped = result?.mainBreakerTripped === true;
    const restoring = restoringGridIds.has(node.gridId) && !tripped;
    const shed = consumer?.shed === true && !disconnected;
    const satisfaction = consumer?.satisfaction ?? (tripped || disconnected ? 0 : 1);
    const operationState = disconnected ? "unconnected"
      : tripped ? "tripped"
        : restoring ? "restoring"
          : shed ? "shed"
            : satisfaction > 0 ? "running" : "idle";
    return {
      instanceId: node.instanceId,
      gridId: node.gridId,
      connectionState: node.connectionState,
      operationState,
      powered: !disconnected && !tripped && !shed && satisfaction > 0,
      restoring,
      ...(node.priority === undefined ? {} : { priority: node.priority }),
      satisfaction,
    };
  }).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
};
