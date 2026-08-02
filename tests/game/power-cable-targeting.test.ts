import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConnectorProfile,
  PortDefinition,
} from "../../app/game/domain/types.ts";
import {
  POWER_CABLE_MAX_DISTANCE_BY_PROFILE,
  listPowerCableEndpointPreviews,
  powerCableEdgeId,
  previewPowerCableConnection,
  projectPowerCablePort,
  resolvePowerPortAim,
  type PowerCablePortTarget,
} from "../../app/game/interaction/powerCableTargeting.ts";
import type { PowerEdge } from "../../app/game/sim/physicalPowerNetwork.ts";
import type { WorldPort } from "../../app/game/sim/world.ts";

type WorldPortOptions = Readonly<{
  id?: string;
  direction?: PortDefinition["direction"];
  medium?: PortDefinition["medium"];
  profile?: ConnectorProfile;
  x?: number;
  y?: number;
  z?: number;
  stratumId?: string;
  connectsStrata?: boolean;
  shaftPairId?: string | null;
}>;

const worldPort = (options: WorldPortOptions = {}): WorldPort => ({
  definition: {
    id: options.id ?? "power",
    direction: options.direction ?? "bidirectional",
    medium: options.medium ?? "power",
    connectorProfile: options.profile ?? "power_local",
    connectionCell: { x: Math.round(options.x ?? 0), z: Math.round(options.z ?? 0) },
    localPosition: { x: options.x ?? 0, y: options.y ?? 1, z: options.z ?? 0 },
    localFacing: { x: 1, z: 0 },
    bufferSlots: 0,
    acceptedItemIds: [],
  },
  connectionCell: { x: Math.round(options.x ?? 0), z: Math.round(options.z ?? 0) },
  localPosition: { x: options.x ?? 0, y: options.y ?? 1, z: options.z ?? 0 },
  localFacing: { x: 1, z: 0 },
  stratumId: options.stratumId ?? "surface",
  connectsStrata: options.connectsStrata ?? false,
  shaftPairId: options.shaftPairId ?? null,
});

const cableTarget = (
  ownerId: string,
  options: WorldPortOptions = {},
  gridId: string | null = null,
  maxCableConnections: number | null = null,
): PowerCablePortTarget => {
  const result = projectPowerCablePort(ownerId, worldPort(options), {
    gridId,
    maxCableConnections,
  });
  assert.ok(result);
  return result;
};

test("projects only authored power ports and preserves the exact owner/port identity", () => {
  const authored = worldPort({ id: "P4", direction: "output", x: 3 });
  const projected = projectPowerCablePort("pole-a", authored, {
    gridId: "grid-a",
    maxCableConnections: 4,
  });
  assert.ok(projected);
  assert.deepEqual(projected.endpoint, { ownerId: "pole-a", portId: "P4" });
  assert.equal(projected.port, authored);
  assert.equal(projected.gridId, "grid-a");
  assert.equal(projected.maxCableConnections, 4);

  assert.equal(projectPowerCablePort("belt-a", worldPort({
    medium: "solid",
    profile: "belt_standard",
  })), null);
});

test("center-ray aiming chooses the nearest active-stratum port and respects range and occlusion", () => {
  const near = cableTarget("near", { id: "P1" });
  const far = cableTarget("far", { id: "P2" });
  const underground = cableTarget("underground", { id: "P3", stratumId: "underground" });
  const hits = [
    { kind: "power_port", distance: 5, target: far },
    { kind: "power_port", distance: 1, target: underground },
    { kind: "power_port", distance: 3, target: near },
  ] as const;

  const aimed = resolvePowerPortAim(hits, { activeStratumId: "surface", maxDistance: 4 });
  assert.equal(aimed.kind, "aimed");
  if (aimed.kind !== "aimed") assert.fail("expected an aimed power port");
  assert.equal(aimed.target, near);
  assert.equal(aimed.distance, 3);

  assert.deepEqual(resolvePowerPortAim([
    ...hits,
    { kind: "blocker", distance: 2 },
  ], { activeStratumId: "surface", maxDistance: 4 }), {
    kind: "none",
    reason: "blocked",
    distance: 3,
    blockerDistance: 2,
  });

  assert.deepEqual(resolvePowerPortAim(hits, {
    activeStratumId: "surface",
    maxDistance: 2,
  }), { kind: "none", reason: "out_of_range", distance: 3 });

  // A socket proxy mounted on a surface may tie that surface's ray distance.
  assert.equal(resolvePowerPortAim([
    { kind: "blocker", distance: 2.995 },
    { kind: "power_port", distance: 3, target: near },
  ], {
    activeStratumId: "surface",
    maxDistance: 4,
    occlusionTolerance: 0.01,
  }).kind, "aimed");
});

test("a start-only preview exposes the cable profile, limit, capacity, and current grid", () => {
  const start = cableTarget(
    "pole-a",
    { id: "P2", direction: "bidirectional", profile: "power_local" },
    "grid-a",
    4,
  );
  const preview = previewPowerCableConnection(start, null, []);

  assert.equal(preview.state, "waiting_for_target");
  assert.equal(preview.primaryIssue, "target_required");
  assert.deepEqual(preview.issues, ["target_required"]);
  assert.equal(preview.profile, "power_local");
  assert.equal(preview.maxDistance, POWER_CABLE_MAX_DISTANCE_BY_PROFILE.power_local);
  assert.deepEqual(preview.startCapacity, {
    portCableCount: 0,
    ownerCableCount: 0,
    maxCableConnections: 4,
  });
  assert.deepEqual(preview.grids, {
    startGridId: "grid-a",
    endGridId: null,
    willMerge: false,
  });
  assert.equal(preview.edge, null);
});

test("a ready preview commits the exact aimed ports and orients output to input", () => {
  const clickedInput = cableTarget(
    "dock",
    { id: "power_in", direction: "input", x: 6 },
    "grid-dock",
  );
  const clickedOutput = cableTarget(
    "pole",
    { id: "P4", direction: "output", x: 0 },
    "grid-pole",
    4,
  );
  const preview = previewPowerCableConnection(clickedInput, clickedOutput, []);

  assert.equal(preview.state, "ready");
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.distance, 6);
  assert.deepEqual(preview.grids, {
    startGridId: "grid-dock",
    endGridId: "grid-pole",
    willMerge: true,
  });
  assert.deepEqual(preview.edge, {
    id: powerCableEdgeId(clickedInput.endpoint, clickedOutput.endpoint),
    from: { ownerId: "pole", portId: "P4" },
    to: { ownerId: "dock", portId: "power_in" },
    cableType: "power_local",
    enabled: true,
  });
});

test("preview reports profile, direction, stratum, distance, and self-connection failures", () => {
  const start = cableTarget("source", { id: "out", direction: "output", x: 0 });
  const cases = [
    ["profile_mismatch", cableTarget("target-profile", {
      id: "in",
      direction: "input",
      profile: "power_high_voltage",
      x: 2,
    })],
    ["direction_mismatch", cableTarget("target-direction", {
      id: "out",
      direction: "output",
      x: 2,
    })],
    ["stratum_mismatch", cableTarget("target-stratum", {
      id: "in",
      direction: "input",
      x: 2,
      stratumId: "underground",
    })],
    ["distance_exceeded", cableTarget("target-distance", {
      id: "in",
      direction: "input",
      x: 8.01,
    })],
    ["same_owner", cableTarget("source", {
      id: "other",
      direction: "input",
      x: 2,
    })],
  ] as const;

  cases.forEach(([issue, end]) => {
    const preview = previewPowerCableConnection(start, end, []);
    assert.equal(preview.state, "blocked", issue);
    assert.ok(preview.issues.includes(issue), issue);
    assert.equal(preview.edge, null, issue);
  });

  const same = previewPowerCableConnection(start, start, []);
  assert.ok(same.issues.includes("same_port"));
});

test("authored shaft pairs may cross strata and high-voltage range is inclusive", () => {
  const start = cableTarget("tower-top", {
    id: "shaft_power_in",
    direction: "output",
    profile: "power_high_voltage",
    x: 0,
    y: 2,
    stratumId: "surface",
    connectsStrata: true,
    shaftPairId: "shaft-a",
  });
  const end = cableTarget("tower-bottom", {
    id: "shaft_power_out",
    direction: "input",
    profile: "power_high_voltage",
    x: 24,
    y: 2,
    stratumId: "underground",
    connectsStrata: true,
    shaftPairId: "shaft-a",
  });

  const boundary = previewPowerCableConnection(start, end, []);
  assert.equal(boundary.maxDistance, POWER_CABLE_MAX_DISTANCE_BY_PROFILE.power_high_voltage);
  assert.equal(boundary.distance, 24);
  assert.equal(boundary.state, "ready");

  const beyond = cableTarget("far-tower", {
    id: "shaft_power_out",
    direction: "input",
    profile: "power_high_voltage",
    x: 24.001,
    y: 2,
    stratumId: "underground",
    connectsStrata: true,
    shaftPairId: "shaft-a",
  });
  assert.ok(previewPowerCableConnection(start, beyond, []).issues.includes("distance_exceeded"));
});

test("used ports, disabled cables, duplicate edges, and owner cable limits block commit", () => {
  const start = cableTarget("pole-a", { id: "P1", direction: "output" }, null, 2);
  const end = cableTarget("pole-b", { id: "P2", direction: "input", x: 2 }, null, 1);
  const occupiedStartEdge: PowerEdge = {
    id: "disabled-but-physical",
    from: start.endpoint,
    to: { ownerId: "old-load", portId: "power_in" },
    enabled: false,
  };
  const endOwnerEdge: PowerEdge = {
    id: "end-at-limit",
    from: { ownerId: "other-source", portId: "power_out" },
    to: { ownerId: end.endpoint.ownerId, portId: "P3" },
  };
  const occupied = previewPowerCableConnection(start, end, [occupiedStartEdge, endOwnerEdge]);

  assert.equal(occupied.startCapacity.portCableCount, 1);
  assert.equal(occupied.startCapacity.ownerCableCount, 1);
  assert.equal(occupied.endCapacity?.portCableCount, 0);
  assert.equal(occupied.endCapacity?.ownerCableCount, 1);
  assert.ok(occupied.issues.includes("start_port_in_use"));
  assert.ok(occupied.issues.includes("end_owner_connection_limit"));
  assert.equal(occupied.edge, null);

  const exact: PowerEdge = {
    id: "already-there",
    from: start.endpoint,
    to: end.endpoint,
  };
  const duplicate = previewPowerCableConnection(start, end, [exact]);
  assert.ok(duplicate.issues.includes("duplicate_connection"));
  assert.ok(duplicate.issues.includes("start_port_in_use"));
  assert.ok(duplicate.issues.includes("end_port_in_use"));
});

test("endpoint previews keep authored P1-P4 choices, deduplicate hits, and sort valid ports first", () => {
  const start = cableTarget("source", { id: "out", direction: "output", x: 0 });
  const invalidNear = cableTarget("pole", { id: "P1", direction: "output", x: 1 });
  const validNear = cableTarget("pole", { id: "P3", direction: "input", x: 2 });
  const validFar = cableTarget("pole", { id: "P4", direction: "input", x: 4 });

  const previews = listPowerCableEndpointPreviews(start, [
    invalidNear,
    validFar,
    validNear,
    validNear,
  ], []);

  assert.equal(previews.length, 3);
  assert.deepEqual(previews.map(({ state, end }) => [state, end?.endpoint.portId]), [
    ["ready", "P3"],
    ["ready", "P4"],
    ["blocked", "P1"],
  ]);
  assert.equal(previews[1].edge?.to.portId, "P4");
});
