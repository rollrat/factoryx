import { rotatedFootprintSize } from "../domain/placement.ts";
import type { BuildingInstance } from "../domain/types.ts";
import type { DataDrivenWorld, WorldBounds } from "./world.ts";

export type WorldPoint2 = Readonly<{ x: number; z: number }>;
export type WorldAabb2 = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

export type FootprintCollider = Readonly<{
  instanceId: string;
  definitionId: string;
  preplaced: boolean;
  bounds: WorldAabb2;
}>;

export type PlayerCollisionContact = Readonly<{
  kind: "building" | "world_boundary";
  instanceId?: string;
  normal: WorldPoint2;
}>;

export type PlayerMovementResult = Readonly<{
  position: WorldPoint2;
  applied: WorldPoint2;
  contacts: readonly PlayerCollisionContact[];
}>;

export type PlayerStartRecovery = Readonly<{
  position: WorldPoint2;
  corrected: boolean;
  reason: "valid" | "clamped_to_bounds" | "escaped_obstacle" | "no_safe_position";
}>;

const EPSILON = 1e-6;
const bucketKey = (x: number, z: number) => `${x},${z}`;
const expanded = (bounds: WorldAabb2, amount: number): WorldAabb2 => ({
  minX: bounds.minX - amount,
  maxX: bounds.maxX + amount,
  minZ: bounds.minZ - amount,
  maxZ: bounds.maxZ + amount,
});
const overlaps = (a: WorldAabb2, b: WorldAabb2) => (
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
);

export const footprintCollider = (
  world: DataDrivenWorld,
  instance: BuildingInstance,
): FootprintCollider => {
  const definition = world.registry.buildings.get(instance.definitionId);
  if (!definition) throw new Error(`unknown collision building definition: ${instance.definitionId}`);
  const size = rotatedFootprintSize(definition, instance.rotation);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    preplaced: definition.placementMode === "preplaced_unique",
    bounds: {
      minX: instance.position.x,
      maxX: instance.position.x + size.x,
      minZ: instance.position.z,
      maxZ: instance.position.z + size.z,
    },
  };
};

/** Spatial index rebuilt only when DataDrivenWorld placement changes. */
export class WorldCollisionIndex {
  readonly bounds: WorldBounds;
  readonly obstacles: readonly FootprintCollider[];
  readonly bucketSize: number;
  private readonly buckets = new Map<string, FootprintCollider[]>();

  constructor(world: DataDrivenWorld, bucketSize = 8) {
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) throw new RangeError("collision bucketSize must be positive");
    this.bounds = { ...world.bounds };
    this.bucketSize = bucketSize;
    this.obstacles = world.allInstances().map((instance) => footprintCollider(world, instance));
    this.obstacles.forEach((obstacle) => {
      const minX = Math.floor(obstacle.bounds.minX / bucketSize);
      const maxX = Math.floor((obstacle.bounds.maxX - EPSILON) / bucketSize);
      const minZ = Math.floor(obstacle.bounds.minZ / bucketSize);
      const maxZ = Math.floor((obstacle.bounds.maxZ - EPSILON) / bucketSize);
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = bucketKey(x, z);
          this.buckets.set(key, [...(this.buckets.get(key) ?? []), obstacle]);
        }
      }
    });
  }

  query(area: WorldAabb2): readonly FootprintCollider[] {
    const found = new Map<string, FootprintCollider>();
    const minX = Math.floor(area.minX / this.bucketSize);
    const maxX = Math.floor(area.maxX / this.bucketSize);
    const minZ = Math.floor(area.minZ / this.bucketSize);
    const maxZ = Math.floor(area.maxZ / this.bucketSize);
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        (this.buckets.get(bucketKey(x, z)) ?? []).forEach((obstacle) => {
          if (overlaps(area, obstacle.bounds)) found.set(obstacle.instanceId, obstacle);
        });
      }
    }
    return [...found.values()].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }
}

const playableBounds = (bounds: WorldBounds, radius: number): WorldAabb2 => ({
  minX: bounds.minX + radius,
  maxX: bounds.maxX + 1 - radius,
  minZ: bounds.minZ + radius,
  maxZ: bounds.maxZ + 1 - radius,
});
const inExpandedObstacle = (position: WorldPoint2, obstacle: FootprintCollider, radius: number) => {
  const box = expanded(obstacle.bounds, radius);
  return position.x > box.minX + EPSILON && position.x < box.maxX - EPSILON
    && position.z > box.minZ + EPSILON && position.z < box.maxZ - EPSILON;
};

export const canPlayerOccupy = (
  index: WorldCollisionIndex,
  position: WorldPoint2,
  radius = 0.24,
) => {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError("player radius must be positive");
  const bounds = playableBounds(index.bounds, radius);
  if (position.x < bounds.minX || position.x > bounds.maxX
    || position.z < bounds.minZ || position.z > bounds.maxZ) return false;
  const area = { minX: position.x - radius, maxX: position.x + radius, minZ: position.z - radius, maxZ: position.z + radius };
  return !index.query(area).some((obstacle) => inExpandedObstacle(position, obstacle, radius));
};

const moveAxis = (
  index: WorldCollisionIndex,
  position: WorldPoint2,
  delta: number,
  axis: "x" | "z",
  radius: number,
) => {
  if (Math.abs(delta) <= EPSILON) return { value: position[axis], contacts: [] as PlayerCollisionContact[] };
  const other = axis === "x" ? "z" : "x";
  const world = playableBounds(index.bounds, radius);
  const desired = position[axis] + delta;
  let value = Math.min(world[`max${axis.toUpperCase()}` as "maxX" | "maxZ"], Math.max(
    world[`min${axis.toUpperCase()}` as "minX" | "minZ"], desired,
  ));
  const contacts: PlayerCollisionContact[] = [];
  if (Math.abs(value - desired) > EPSILON) {
    contacts.push({ kind: "world_boundary", normal: axis === "x" ? { x: -Math.sign(delta), z: 0 } : { x: 0, z: -Math.sign(delta) } });
  }
  const sweep: WorldAabb2 = axis === "x"
    ? { minX: Math.min(position.x, value) - radius, maxX: Math.max(position.x, value) + radius, minZ: position.z - radius, maxZ: position.z + radius }
    : { minX: position.x - radius, maxX: position.x + radius, minZ: Math.min(position.z, value) - radius, maxZ: Math.max(position.z, value) + radius };
  index.query(sweep).forEach((obstacle) => {
    const box = expanded(obstacle.bounds, radius);
    if (position[other] <= box[`min${other.toUpperCase()}` as "minX" | "minZ"] + EPSILON
      || position[other] >= box[`max${other.toUpperCase()}` as "maxX" | "maxZ"] - EPSILON) return;
    const near = delta > 0
      ? box[`min${axis.toUpperCase()}` as "minX" | "minZ"]
      : box[`max${axis.toUpperCase()}` as "maxX" | "maxZ"];
    const crosses = delta > 0
      ? position[axis] <= near && value > near
      : position[axis] >= near && value < near;
    if (!crosses) return;
    value = near;
    contacts.push({
      kind: "building",
      instanceId: obstacle.instanceId,
      normal: axis === "x" ? { x: -Math.sign(delta), z: 0 } : { x: 0, z: -Math.sign(delta) },
    });
  });
  return { value, contacts };
};

/** Continuous axis sweeps prevent tunnelling and preserve the unblocked axis for wall sliding. */
export const resolvePlayerMovement = (
  index: WorldCollisionIndex,
  start: WorldPoint2,
  displacement: WorldPoint2,
  radius = 0.24,
): PlayerMovementResult => {
  if (!canPlayerOccupy(index, start, radius)) throw new Error("player movement must start from a valid position");
  if (![displacement.x, displacement.z].every(Number.isFinite)) throw new RangeError("player displacement must be finite");
  const xMove = moveAxis(index, start, displacement.x, "x", radius);
  const afterX = { x: xMove.value, z: start.z };
  const zMove = moveAxis(index, afterX, displacement.z, "z", radius);
  const position = { x: afterX.x, z: zMove.value };
  return {
    position,
    applied: { x: position.x - start.x, z: position.z - start.z },
    contacts: [...xMove.contacts, ...zMove.contacts],
  };
};

/** Corrects saved/default first-person starts that became invalid after world changes. */
export const recoverPlayerStart = (
  index: WorldCollisionIndex,
  requested: WorldPoint2,
  radius = 0.24,
): PlayerStartRecovery => {
  const bounds = playableBounds(index.bounds, radius);
  const clamped = {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, requested.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, requested.z)),
  };
  if (canPlayerOccupy(index, requested, radius)) return { position: { ...requested }, corrected: false, reason: "valid" };
  if (canPlayerOccupy(index, clamped, radius)) return { position: clamped, corrected: true, reason: "clamped_to_bounds" };

  const candidates: WorldPoint2[] = [];
  index.obstacles.forEach((obstacle) => {
    const box = expanded(obstacle.bounds, radius);
    const xValues = [box.minX, Math.min(box.maxX, Math.max(box.minX, clamped.x)), box.maxX];
    const zValues = [box.minZ, Math.min(box.maxZ, Math.max(box.minZ, clamped.z)), box.maxZ];
    xValues.forEach((x) => zValues.forEach((z) => candidates.push({
      x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
      z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
    })));
  });
  const safe = candidates.filter((candidate) => canPlayerOccupy(index, candidate, radius)).sort((a, b) => {
    const aDistance = (a.x - requested.x) ** 2 + (a.z - requested.z) ** 2;
    const bDistance = (b.x - requested.x) ** 2 + (b.z - requested.z) ** 2;
    return aDistance - bDistance || a.x - b.x || a.z - b.z;
  })[0];
  return safe
    ? { position: safe, corrected: true, reason: "escaped_obstacle" }
    : { position: clamped, corrected: true, reason: "no_safe_position" };
};
