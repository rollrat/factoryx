import type {
  ConnectorProfile,
  PortDefinition,
} from "../domain/types.ts";
import type {
  PowerEdge,
  PowerPortRef,
} from "../sim/physicalPowerNetwork.ts";
import {
  portsShareStratumOrShaftPair,
  type WorldPort,
} from "../sim/world.ts";

export type PowerCableProfile = Extract<
  ConnectorProfile,
  "power_local" | "power_high_voltage"
>;

export type PowerCablePortDefinition = PortDefinition & Readonly<{
  medium: "power";
  connectorProfile: PowerCableProfile;
}>;

export type PowerCableWorldPort = Omit<WorldPort, "definition"> & Readonly<{
  definition: PowerCablePortDefinition;
}>;

/**
 * The world/simulation projection needed by first-person cable targeting.
 *
 * `gridId` is deliberately a snapshot: preview code reports which two current
 * grids a successful edge would merge, while topology rebuilding remains the
 * simulation's responsibility.
 */
export type PowerCablePortTarget = Readonly<{
  endpoint: PowerPortRef;
  port: PowerCableWorldPort;
  gridId: string | null;
  maxCableConnections: number | null;
}>;

export type ProjectPowerCablePortOptions = Readonly<{
  gridId?: string | null;
  maxCableConnections?: number | null;
}>;

export const isPowerCableWorldPort = (port: WorldPort): port is PowerCableWorldPort => (
  port.definition.medium === "power"
  && (port.definition.connectorProfile === "power_local"
    || port.definition.connectorProfile === "power_high_voltage")
);

/** Converts an authored world port into a strict cable endpoint, or rejects a non-power port. */
export const projectPowerCablePort = (
  ownerId: string,
  port: WorldPort,
  options: ProjectPowerCablePortOptions = {},
): PowerCablePortTarget | null => {
  if (!isPowerCableWorldPort(port)) return null;
  return {
    endpoint: { ownerId, portId: port.definition.id },
    port,
    gridId: options.gridId ?? null,
    maxCableConnections: options.maxCableConnections ?? null,
  };
};

export type PowerPortAimHit =
  | Readonly<{
    kind: "power_port";
    distance: number;
    target: PowerCablePortTarget;
  }>
  | Readonly<{
    kind: "blocker";
    distance: number;
  }>;

export type ResolvePowerPortAimOptions = Readonly<{
  activeStratumId: string;
  maxDistance: number;
  /** Lets a socket mounted directly on a surface win over a numerically equal surface hit. */
  occlusionTolerance?: number;
}>;

export type PowerPortAimResult =
  | Readonly<{
    kind: "aimed";
    target: PowerCablePortTarget;
    distance: number;
  }>
  | Readonly<{
    kind: "none";
    reason: "no_port";
  }>
  | Readonly<{
    kind: "none";
    reason: "out_of_range";
    distance: number;
  }>
  | Readonly<{
    kind: "none";
    reason: "blocked";
    distance: number;
    blockerDistance: number;
  }>;

const endpointKey = ({ ownerId, portId }: PowerPortRef) => `${ownerId}:${portId}`;

const finiteAimHits = (hits: readonly PowerPortAimHit[]) => hits.filter(
  ({ distance }) => Number.isFinite(distance) && distance >= 0,
);

/**
 * Resolves a center-ray result without depending on Three.js scene objects.
 * A caller supplies dedicated port proxy hits and ordinary blocking geometry.
 */
export const resolvePowerPortAim = (
  hits: readonly PowerPortAimHit[],
  options: ResolvePowerPortAimOptions,
): PowerPortAimResult => {
  const portHit = finiteAimHits(hits)
    .filter((hit): hit is Extract<PowerPortAimHit, { kind: "power_port" }> => (
      hit.kind === "power_port"
      && hit.target.port.stratumId === options.activeStratumId
    ))
    .sort((a, b) => (
      a.distance - b.distance
      || endpointKey(a.target.endpoint).localeCompare(endpointKey(b.target.endpoint))
    ))[0];

  if (!portHit) return { kind: "none", reason: "no_port" };

  const maxDistance = Number.isFinite(options.maxDistance)
    ? Math.max(0, options.maxDistance)
    : 0;
  if (portHit.distance > maxDistance) {
    return { kind: "none", reason: "out_of_range", distance: portHit.distance };
  }

  const blockerDistance = finiteAimHits(hits)
    .filter((hit): hit is Extract<PowerPortAimHit, { kind: "blocker" }> => hit.kind === "blocker")
    .reduce<number | null>((nearest, hit) => (
      nearest === null || hit.distance < nearest ? hit.distance : nearest
    ), null);
  const occlusionTolerance = Number.isFinite(options.occlusionTolerance)
    ? Math.max(0, options.occlusionTolerance ?? 0)
    : 0;

  if (blockerDistance !== null && blockerDistance < portHit.distance - occlusionTolerance) {
    return {
      kind: "none",
      reason: "blocked",
      distance: portHit.distance,
      blockerDistance,
    };
  }

  return { kind: "aimed", target: portHit.target, distance: portHit.distance };
};

export const POWER_CABLE_MAX_DISTANCE_BY_PROFILE = Object.freeze({
  power_local: 8,
  power_high_voltage: 24,
} as const satisfies Readonly<Record<PowerCableProfile, number>>);

export const powerCableMaxDistance = (profile: PowerCableProfile) => (
  POWER_CABLE_MAX_DISTANCE_BY_PROFILE[profile]
);

export type PowerCablePreviewIssue =
  | "target_required"
  | "same_port"
  | "same_owner"
  | "profile_mismatch"
  | "direction_mismatch"
  | "stratum_mismatch"
  | "distance_exceeded"
  | "duplicate_connection"
  | "start_port_in_use"
  | "end_port_in_use"
  | "start_owner_connection_limit"
  | "end_owner_connection_limit";

export type PowerCableEndpointCapacity = Readonly<{
  portCableCount: number;
  ownerCableCount: number;
  maxCableConnections: number | null;
}>;

export type PowerCableGridPreview = Readonly<{
  startGridId: string | null;
  endGridId: string | null;
  willMerge: boolean;
}>;

export type PowerCableConnectionPreview = Readonly<{
  state: "waiting_for_target" | "blocked" | "ready";
  primaryIssue: PowerCablePreviewIssue | null;
  issues: readonly PowerCablePreviewIssue[];
  start: PowerCablePortTarget;
  end: PowerCablePortTarget | null;
  profile: PowerCableProfile;
  distance: number | null;
  maxDistance: number;
  startCapacity: PowerCableEndpointCapacity;
  endCapacity: PowerCableEndpointCapacity | null;
  grids: PowerCableGridPreview;
  /** Present only when every preview check passed and the command may commit this exact edge. */
  edge: PowerEdge | null;
}>;

const sameEndpoint = (a: PowerPortRef, b: PowerPortRef) => (
  a.ownerId === b.ownerId && a.portId === b.portId
);

const edgeUsesEndpoint = (edge: PowerEdge, endpoint: PowerPortRef) => (
  sameEndpoint(edge.from, endpoint) || sameEndpoint(edge.to, endpoint)
);

const edgeConnectsEndpoints = (edge: PowerEdge, a: PowerPortRef, b: PowerPortRef) => (
  (sameEndpoint(edge.from, a) && sameEndpoint(edge.to, b))
  || (sameEndpoint(edge.from, b) && sameEndpoint(edge.to, a))
);

const endpointCapacity = (
  target: PowerCablePortTarget,
  edges: readonly PowerEdge[],
): PowerCableEndpointCapacity => ({
  // Disabled cables remain physical cables and continue to occupy their sockets.
  portCableCount: edges.filter((edge) => edgeUsesEndpoint(edge, target.endpoint)).length,
  ownerCableCount: edges.filter((edge) => (
    edge.from.ownerId === target.endpoint.ownerId
    || edge.to.ownerId === target.endpoint.ownerId
  )).length,
  maxCableConnections: target.maxCableConnections,
});

const ownerAtLimit = ({
  ownerCableCount,
  maxCableConnections,
}: PowerCableEndpointCapacity) => (
  maxCableConnections !== null && ownerCableCount >= maxCableConnections
);

const portDistance = (a: PowerCableWorldPort, b: PowerCableWorldPort) => Math.hypot(
  a.localPosition.x - b.localPosition.x,
  a.localPosition.y - b.localPosition.y,
  a.localPosition.z - b.localPosition.z,
);

const orientedEndpoints = (
  start: PowerCablePortTarget,
  end: PowerCablePortTarget,
): Readonly<{ from: PowerPortRef; to: PowerPortRef }> | null => {
  const direct = start.port.definition.direction !== "input"
    && end.port.definition.direction !== "output";
  if (direct) return { from: start.endpoint, to: end.endpoint };

  const reverse = end.port.definition.direction !== "input"
    && start.port.definition.direction !== "output";
  return reverse ? { from: end.endpoint, to: start.endpoint } : null;
};

export const powerCableEdgeId = (a: PowerPortRef, b: PowerPortRef) => (
  `manual-power:${[endpointKey(a), endpointKey(b)].sort().join("|")}`
);

/**
 * Evaluates the exact two ports selected by the player. It never searches for
 * a more convenient sibling port, so P1-P4 choices survive through commit.
 */
export const previewPowerCableConnection = (
  start: PowerCablePortTarget,
  end: PowerCablePortTarget | null,
  existingEdges: readonly PowerEdge[],
): PowerCableConnectionPreview => {
  const profile = start.port.definition.connectorProfile;
  const maxDistance = powerCableMaxDistance(profile);
  const startCapacity = endpointCapacity(start, existingEdges);
  const startIssues: PowerCablePreviewIssue[] = [];
  if (startCapacity.portCableCount > 0) startIssues.push("start_port_in_use");
  if (ownerAtLimit(startCapacity)) startIssues.push("start_owner_connection_limit");

  if (end === null) {
    const issues = [...startIssues, "target_required" as const];
    return {
      state: startIssues.length > 0 ? "blocked" : "waiting_for_target",
      primaryIssue: issues[0],
      issues,
      start,
      end: null,
      profile,
      distance: null,
      maxDistance,
      startCapacity,
      endCapacity: null,
      grids: {
        startGridId: start.gridId,
        endGridId: null,
        willMerge: false,
      },
      edge: null,
    };
  }

  const endCapacity = endpointCapacity(end, existingEdges);
  const distance = portDistance(start.port, end.port);
  const oriented = orientedEndpoints(start, end);
  const issues: PowerCablePreviewIssue[] = [];

  if (sameEndpoint(start.endpoint, end.endpoint)) issues.push("same_port");
  if (start.endpoint.ownerId === end.endpoint.ownerId) issues.push("same_owner");
  if (profile !== end.port.definition.connectorProfile) issues.push("profile_mismatch");
  if (oriented === null) issues.push("direction_mismatch");
  if (!portsShareStratumOrShaftPair(start.port, end.port)) issues.push("stratum_mismatch");
  if (distance > maxDistance) issues.push("distance_exceeded");
  if (existingEdges.some((edge) => edgeConnectsEndpoints(edge, start.endpoint, end.endpoint))) {
    issues.push("duplicate_connection");
  }
  issues.push(...startIssues);
  if (endCapacity.portCableCount > 0) issues.push("end_port_in_use");
  if (ownerAtLimit(endCapacity)) issues.push("end_owner_connection_limit");

  const valid = issues.length === 0 && oriented !== null;
  const edge: PowerEdge | null = valid ? {
    id: powerCableEdgeId(oriented.from, oriented.to),
    from: oriented.from,
    to: oriented.to,
    cableType: profile,
    enabled: true,
  } : null;

  return {
    state: valid ? "ready" : "blocked",
    primaryIssue: issues[0] ?? null,
    issues,
    start,
    end,
    profile,
    distance,
    maxDistance,
    startCapacity,
    endCapacity,
    grids: {
      startGridId: start.gridId,
      endGridId: end.gridId,
      willMerge: valid
        && start.gridId !== null
        && end.gridId !== null
        && start.gridId !== end.gridId,
    },
    edge,
  };
};

/** Returns every authored endpoint evaluation, with connectable ports first and deterministic ordering. */
export const listPowerCableEndpointPreviews = (
  start: PowerCablePortTarget,
  candidates: readonly PowerCablePortTarget[],
  existingEdges: readonly PowerEdge[],
): readonly PowerCableConnectionPreview[] => {
  const uniqueCandidates = new Map<string, PowerCablePortTarget>();
  candidates.forEach((candidate) => {
    const key = endpointKey(candidate.endpoint);
    if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  });

  return [...uniqueCandidates.values()]
    .map((candidate) => previewPowerCableConnection(start, candidate, existingEdges))
    .sort((a, b) => (
      Number(b.state === "ready") - Number(a.state === "ready")
      || (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
      || endpointKey(a.end?.endpoint ?? a.start.endpoint)
        .localeCompare(endpointKey(b.end?.endpoint ?? b.start.endpoint))
    ));
};
