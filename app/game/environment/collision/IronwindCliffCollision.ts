import {
  IRONWIND_CLIFF_PLACEMENTS,
  type IronwindCliffPlacement,
} from "../data/ironwindCliffPlacements.ts";

export type CliffCollider2D = Readonly<{
  id: string;
  placementId: string;
  collisionNode: "COL_WALL";
  center: Readonly<{ x: number; z: number }>;
  halfExtents: Readonly<{ x: number; z: number }>;
  rotation: number;
  minY: number;
  maxY: number;
}>;

export type CliffPassage2D = Readonly<{
  id: string;
  placementId: string;
  center: Readonly<{ x: number; z: number }>;
  heading: number;
  halfWidth: number;
  halfLength: number;
  minY: number;
  maxY: number;
}>;

type LocalCollisionRect = Readonly<{
  id: string;
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
  minY: number;
  maxY: number;
}>;

const LOCAL_COLLISION_RECTS: Readonly<Record<string, readonly LocalCollisionRect[]>> = {
  ironwind_cliff_straight_16m: [
    { id: "wall", centerX: 0, centerZ: 1.775, halfX: 8, halfZ: 2.125, minY: 0, maxY: 12 },
  ],
  ironwind_cliff_outer_corner: [
    { id: "wall-x", centerX: -4, centerZ: 1.775, halfX: 4, halfZ: 2.125, minY: 0, maxY: 12 },
    { id: "wall-z", centerX: -1.775, centerZ: 4, halfX: 2.125, halfZ: 4, minY: 0, maxY: 12 },
  ],
  ironwind_natural_arch: [
    { id: "wall-left", centerX: -6, centerZ: 0, halfX: 2, halfZ: 2.5, minY: 0, maxY: 8 },
    { id: "wall-right", centerX: 6, centerZ: 0, halfX: 2, halfZ: 2.5, minY: 0, maxY: 8 },
  ],
  ironwind_cliff_arch_transition: [
    { id: "wall-lower", centerX: 0, centerZ: 1.85, halfX: 8, halfZ: 2.15, minY: 0, maxY: 8 },
    { id: "wall-upper", centerX: -3, centerZ: 1.825, halfX: 5, halfZ: 2.075, minY: 8, maxY: 12 },
  ],
  ironwind_cliff_breached_16m: [
    { id: "wall-left", centerX: -4.85, centerZ: 1.8, halfX: 3.15, halfZ: 2.1, minY: 0, maxY: 12 },
    { id: "wall-right", centerX: 5, centerZ: 1.8, halfX: 3, halfZ: 2.1, minY: 0, maxY: 10.4 },
    { id: "rubble", centerX: 0.3, centerZ: -0.4, halfX: 2.1, halfZ: 0.8, minY: 0, maxY: 2.1 },
  ],
};

const rotateLocal = (x: number, z: number, rotation: number) => ({
  x: x * Math.cos(rotation) + z * Math.sin(rotation),
  z: -x * Math.sin(rotation) + z * Math.cos(rotation),
});

/** Convert the validated Blender COL_WALL boxes into runtime 2D OBBs. */
export const createIronwindCliffCollision = (
  placements: readonly IronwindCliffPlacement[] = IRONWIND_CLIFF_PLACEMENTS,
) => {
  const colliders: CliffCollider2D[] = [];
  const passages: CliffPassage2D[] = [];
  placements.forEach((placement) => {
    const { position, rotation, scale } = placement.transform;
    (LOCAL_COLLISION_RECTS[placement.assetId] ?? []).forEach((rect) => {
      const offset = rotateLocal(rect.centerX * scale.x, rect.centerZ * scale.z, rotation.y);
      colliders.push({
        id: `${placement.id}:${rect.id}`,
        placementId: placement.id,
        collisionNode: "COL_WALL",
        center: { x: position.x + offset.x, z: position.z + offset.z },
        halfExtents: { x: rect.halfX * scale.x, z: rect.halfZ * scale.z },
        rotation: rotation.y,
        minY: position.y + rect.minY * scale.y,
        maxY: position.y + rect.maxY * scale.y,
      });
    });
    if (placement.metadata.passage) {
      passages.push({
        id: `${placement.id}:passage`,
        placementId: placement.id,
        center: { x: position.x, z: position.z },
        heading: placement.metadata.passage.heading,
        halfWidth: placement.metadata.passage.width * 0.5,
        // Long enough to carve an overlapping height-field cliff module while
        // remaining local to the visible arch and its talus shoulders.
        halfLength: 8,
        minY: position.y,
        maxY: position.y + placement.metadata.passage.height * scale.y,
      });
    }
  });
  return { colliders, passages } as const;
};

export const IRONWIND_CLIFF_COLLISION = createIronwindCliffCollision();

const localPoint = (point: Readonly<{ x: number; z: number }>, center: Readonly<{ x: number; z: number }>, rotation: number) => {
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  return {
    x: dx * Math.cos(rotation) - dz * Math.sin(rotation),
    z: dx * Math.sin(rotation) + dz * Math.cos(rotation),
  };
};

const segmentBoxInterval = (
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  collider: CliffCollider2D,
  radius: number,
) => {
  const start = localPoint(from, collider.center, collider.rotation);
  const end = localPoint(to, collider.center, collider.rotation);
  const delta = { x: end.x - start.x, z: end.z - start.z };
  let near = 0;
  let far = 1;
  for (const axis of ["x", "z"] as const) {
    const extent = collider.halfExtents[axis] + radius;
    if (Math.abs(delta[axis]) < 1e-9) {
      if (Math.abs(start[axis]) > extent) return null;
      continue;
    }
    const first = (-extent - start[axis]) / delta[axis];
    const second = (extent - start[axis]) / delta[axis];
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  return { near, far } as const;
};

const passageContains = (
  passage: CliffPassage2D,
  point: Readonly<{ x: number; z: number }>,
  feetY: number,
  playerHeight: number,
  radius: number,
) => {
  if (feetY < passage.minY - 0.35 || feetY + playerHeight > passage.maxY + 0.08) return false;
  const dx = point.x - passage.center.x;
  const dz = point.z - passage.center.z;
  const along = dx * Math.sin(passage.heading) + dz * Math.cos(passage.heading);
  const across = dx * Math.cos(passage.heading) - dz * Math.sin(passage.heading);
  return Math.abs(along) <= passage.halfLength + radius
    && Math.abs(across) <= passage.halfWidth - radius;
};

/** Swept-circle collision preserves sliding because callers resolve X and Z separately. */
export const cliffMovementBlocked = (
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  fromY: number,
  toY: number,
  collision = IRONWIND_CLIFF_COLLISION,
  radius = 0.38,
  playerHeight = 1.8,
) => collision.colliders.some((collider) => {
  const interval = segmentBoxInterval(from, to, collider, radius);
  if (!interval) return false;
  const progress = (interval.near + interval.far) * 0.5;
  const feetY = fromY + (toY - fromY) * progress;
  if (feetY >= collider.maxY - 0.12 || feetY + playerHeight <= collider.minY + 0.12) return false;
  const contact = {
    x: from.x + (to.x - from.x) * progress,
    z: from.z + (to.z - from.z) * progress,
  };
  return !collision.passages.some((passage) => passageContains(passage, contact, feetY, playerHeight, radius));
});
