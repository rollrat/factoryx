import type { CaveRuntimeCorridor, CaveRuntimeGraph, CaveRuntimeView } from "./CaveRuntimeView.ts";

export type CaveRoutePosition = Readonly<{
  x: number;
  y: number;
  z: number;
  tangent: Readonly<{ x: number; y: number; z: number }>;
  gradeDegrees: number;
}>;

export type CaveSpaceSample = Readonly<{
  graphId: string;
  roomId: string | null;
  corridorId: string | null;
  floorHeight: number;
  clearance: number;
}>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const pointInPolygon = (x: number, z: number, polygon: readonly Readonly<{ x: number; z: number }>[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const from = polygon[previous];
    const to = polygon[index];
    if ((from.z > z) !== (to.z > z) && x < (to.x - from.x) * (z - from.z) / (to.z - from.z) + from.x) inside = !inside;
  }
  return inside;
};

const distanceToRoute = (corridor: CaveRuntimeCorridor, x: number, z: number) => {
  let best = { distance: Number.POSITIVE_INFINITY, distanceAlongRoute: 0 };
  corridor.segments.forEach((segment) => {
    const dx = segment.to.x - segment.from.x;
    const dz = segment.to.z - segment.from.z;
    const lengthSquared = dx * dx + dz * dz;
    const progress = lengthSquared === 0 ? 0 : clamp(((x - segment.from.x) * dx + (z - segment.from.z) * dz) / lengthSquared, 0, 1);
    const distance = Math.hypot(x - (segment.from.x + dx * progress), z - (segment.from.z + dz * progress));
    if (distance < best.distance) best = { distance, distanceAlongRoute: segment.startDistance + segment.length * progress };
  });
  return best;
};

/** Source-only collision/query facade. It deliberately has no Three.js or legacy CAVE_ZONES dependency. */
export class CaveRuntimeSampler {
  readonly view: CaveRuntimeView;
  private readonly graphByStratum: ReadonlyMap<string, CaveRuntimeGraph>;
  private readonly corridorById: ReadonlyMap<string, CaveRuntimeCorridor>;

  constructor(view: CaveRuntimeView) {
    this.view = view;
    this.graphByStratum = new Map(view.graphs.map((graph) => [graph.stratumId, graph]));
    this.corridorById = new Map(view.graphs.flatMap((graph) => graph.corridors.map((corridor) => [corridor.id, corridor] as const)));
  }

  graphForStratum(stratumId: string) { return this.graphByStratum.get(stratumId) ?? null; }

  routePosition(corridorId: string, distance: number): CaveRoutePosition | null {
    const corridor = this.corridorById.get(corridorId);
    if (!corridor || corridor.segments.length === 0) return null;
    const clampedDistance = clamp(distance, 0, corridor.routeLength);
    const segment = corridor.segments.find(({ endDistance }) => clampedDistance <= endDistance) ?? corridor.segments.at(-1)!;
    const progress = segment.length === 0 ? 0 : (clampedDistance - segment.startDistance) / segment.length;
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const dz = segment.to.z - segment.from.z;
    return {
      x: segment.from.x + dx * progress,
      y: segment.from.y + dy * progress,
      z: segment.from.z + dz * progress,
      tangent: { x: dx / segment.length, y: dy / segment.length, z: dz / segment.length },
      gradeDegrees: segment.gradeDegrees,
    };
  }

  sampleSpace(x: number, z: number, stratumId: string): CaveSpaceSample | null {
    const graph = this.graphForStratum(stratumId);
    if (!graph) return null;
    const room = graph.rooms.find((candidate) => pointInPolygon(x, z, candidate.floorPolygon));
    if (room) return { graphId: graph.id, roomId: room.id, corridorId: null, floorHeight: room.floorHeight, clearance: room.clearance };
    const corridors = graph.corridors
      .map((corridor) => ({ corridor, sample: distanceToRoute(corridor, x, z) }))
      .filter(({ corridor, sample }) => sample.distance <= corridor.width / 2)
      .sort((left, right) => left.sample.distance - right.sample.distance || left.corridor.id.localeCompare(right.corridor.id));
    const closest = corridors[0];
    if (!closest) return null;
    const route = this.routePosition(closest.corridor.id, closest.sample.distanceAlongRoute)!;
    return {
      graphId: graph.id,
      roomId: null,
      corridorId: closest.corridor.id,
      floorHeight: route.y,
      clearance: closest.corridor.clearance,
    };
  }
}
