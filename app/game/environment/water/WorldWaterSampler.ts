import type { Vec2, Vec3, WaterBody, WorldSourceV3, WorldSpline } from "../worldSourceV3/types.ts";
import { WorldSourceSampler } from "../worldSourceSampler/WorldSourceSampler.ts";

export type WorldWaterKind = WaterBody["kind"];

export type WorldWaterSample = Readonly<{
  waterBodyId: string;
  kind: WorldWaterKind;
  /** Surface elevation, independent of the terrain mesh resolution. */
  level: number;
  /** Authored channel/lake bottom elevation. */
  bedHeight: number;
  depth: number;
  flowSpeed: number;
  flowDirection: Vec3;
  /** Positive distance to the wet-side edge of this body, in metres. */
  shorelineDistance: number;
  shoreNormal: Vec2;
}>;

export type WaterShorelineRibbon = Readonly<{
  waterBodyId: string;
  kind: WorldWaterKind;
  level: number;
  /** Closed for lakes/marshes; paired open edges for rivers and waterfalls. */
  points: readonly Vec3[];
}>;

type SegmentHit = Readonly<{ distance: number; progress: number; x: number; z: number }>;
type Socket = Readonly<{ x: number; y: number; z: number }>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const bodyOrder = (left: WaterBody, right: WaterBody) => right.priority - left.priority || left.id.localeCompare(right.id);

const pointOnSegment = (x: number, z: number, from: Vec2, to: Vec2): SegmentHit => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0 ? 0 : clamp01(((x - from.x) * dx + (z - from.z) * dz) / lengthSquared);
  const projectedX = from.x + dx * progress;
  const projectedZ = from.z + dz * progress;
  return { distance: Math.hypot(x - projectedX, z - projectedZ), progress, x: projectedX, z: projectedZ };
};

const containsPoint = (ring: readonly Vec2[], x: number, z: number) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const before = ring[previous];
    if ((current.z > z) !== (before.z > z) && x <= (before.x - current.x) * (z - current.z) / (before.z - current.z) + current.x) inside = !inside;
  }
  return inside;
};

const polygonContains = (polygon: readonly Vec2[], holes: readonly (readonly Vec2[])[], x: number, z: number) => (
  containsPoint(polygon, x, z) && !holes.some((hole) => containsPoint(hole, x, z))
);

const closestRing = (ring: readonly Vec2[], x: number, z: number) => ring.reduce<SegmentHit | null>((closest, point, index) => {
  const hit = pointOnSegment(x, z, point, ring[(index + 1) % ring.length]);
  return !closest || hit.distance < closest.distance ? hit : closest;
}, null);

const ringCentroid = (ring: readonly Vec2[]) => ring.reduce((total, point) => ({ x: total.x + point.x / ring.length, z: total.z + point.z / ring.length }), { x: 0, z: 0 });
const normalize3 = (x: number, y: number, z: number): Vec3 => {
  const length = Math.hypot(x, y, z);
  return length === 0 ? { x: 0, y: 0, z: 0 } : { x: x / length, y: y / length, z: z / length };
};

/**
 * Pure WorldSourceV3 water interpretation. It deliberately does not depend on
 * the legacy TerrainSampler or a renderer, so bake, review, and gameplay can
 * agree on a single deterministic water answer.
 */
export class WorldWaterSampler {
  readonly source: WorldSourceV3;
  readonly terrain: WorldSourceSampler;
  private readonly waterBodies: readonly WaterBody[];
  private readonly splines = new Map<string, WorldSpline>();

  constructor(source: WorldSourceV3, terrain = new WorldSourceSampler(source)) {
    this.source = source;
    this.terrain = terrain;
    this.waterBodies = [...source.waterBodies].sort(bodyOrder);
    source.splines.forEach((spline) => this.splines.set(spline.id, spline));
  }

  contains(x: number, z: number) { return this.terrain.contains(x, z); }

  /** Returns null where authored routes, resource pads, and build patches reserve dry ground. */
  private infrastructureProtected(x: number, z: number) {
    for (const spline of this.source.splines) {
      if (spline.kind !== "route" || spline.stratumId !== "surface") continue;
      const points = spline.bakedPolyline ?? spline.controlPoints;
      if (points.slice(1).some((to, index) => pointOnSegment(x, z, points[index], to).distance <= spline.width * 0.5)) return true;
    }
    if (this.source.resourceAnchors.some((anchor) => anchor.stratumId === "surface"
      && Math.hypot(x - anchor.position.x, z - anchor.position.z) <= anchor.padRadius)) return true;
    return this.source.gameplayZones.some((zone) => zone.stratumId === "surface"
      && (zone.kind === "build-patch" || zone.kind === "resource-pad")
      && polygonContains(zone.polygon, zone.holes, x, z));
  }

  private lakeSample(body: Extract<WaterBody, { kind: "lake" | "marsh" }>, x: number, z: number): WorldWaterSample | null {
    if (!polygonContains(body.polygon, body.holes, x, z)) return null;
    const nearest = [body.polygon, ...body.holes].reduce<SegmentHit | null>((best, ring) => {
      const hit = closestRing(ring, x, z);
      return hit && (!best || hit.distance < best.distance) ? hit : best;
    }, null);
    if (!nearest) return null;
    const normal = normalize3(x - nearest.x, 0, z - nearest.z);
    const bedHeight = this.terrain.heightAt(x, z);
    return {
      waterBodyId: body.id, kind: body.kind, level: body.level, bedHeight,
      depth: Math.max(0, body.level - bedHeight), flowSpeed: 0, flowDirection: { x: 0, y: 0, z: 0 },
      shorelineDistance: nearest.distance, shoreNormal: { x: normal.x, z: normal.z },
    };
  }

  private riverSample(body: Extract<WaterBody, { kind: "river" }>, x: number, z: number): WorldWaterSample | null {
    const spline = this.splines.get(body.splineId);
    if (!spline || spline.kind !== "river") return null;
    const points = spline.controlPoints;
    let nearest: (SegmentHit & { index: number }) | null = null;
    for (let index = 1; index < points.length; index += 1) {
      const hit = pointOnSegment(x, z, points[index - 1], points[index]);
      if (!nearest || hit.distance < nearest.distance) nearest = { ...hit, index: index - 1 };
    }
    if (!nearest) return null;
    const index = nearest.index;
    const width = lerp(body.widthProfile[index], body.widthProfile[index + 1], nearest.progress);
    if (nearest.distance > width * 0.5) return null;
    const from = points[index];
    const to = points[index + 1];
    const level = lerp(from.y, to.y, nearest.progress);
    const bedHeight = lerp(body.bedProfile[index], body.bedProfile[index + 1], nearest.progress);
    const direction = normalize3(to.x - from.x, 0, to.z - from.z);
    const shore = normalize3(x - nearest.x, 0, z - nearest.z);
    return {
      waterBodyId: body.id, kind: body.kind, level, bedHeight, depth: Math.max(0, level - bedHeight),
      flowSpeed: body.flowSpeed, flowDirection: direction, shorelineDistance: width * 0.5 - nearest.distance,
      shoreNormal: { x: shore.x, z: shore.z },
    };
  }

  private socketAt(reference: string, defaultEnd: boolean): Socket | null {
    const match = /^(.*?)(?::(start|end|first|last|\d+))?$/.exec(reference);
    const id = match?.[1] ?? reference;
    const selector = match?.[2];
    const spline = this.splines.get(id);
    if (spline) {
      const points = spline.controlPoints;
      const selected = selector === "start" || selector === "first" ? 0
        : selector === "end" || selector === "last" ? points.length - 1
          : selector ? Math.max(0, Math.min(points.length - 1, Number(selector))) : (defaultEnd ? points.length - 1 : 0);
      return points[selected] ?? null;
    }
    const water = this.source.waterBodies.find((body) => body.id === id);
    if (water?.kind === "lake" || water?.kind === "marsh") return { ...ringCentroid(water.polygon), y: water.level };
    if (water?.kind === "river") return this.socketAt(`${water.splineId}:${defaultEnd ? "end" : "start"}`, defaultEnd);
    const placement = this.source.placements.find((entry) => entry.id === id);
    if (placement) return placement.transform.position;
    return this.source.resourceAnchors.find((entry) => entry.id === id)?.position ?? null;
  }

  private waterfallSample(body: Extract<WaterBody, { kind: "waterfall" }>, x: number, z: number): WorldWaterSample | null {
    const from = this.socketAt(body.fromSocket, false);
    const to = this.socketAt(body.toSocket, true);
    if (!from || !to) return null;
    const hit = pointOnSegment(x, z, from, to);
    if (hit.distance > body.width * 0.5) return null;
    const level = lerp(from.y, to.y, hit.progress);
    const direction = normalize3(to.x - from.x, to.y - from.y, to.z - from.z);
    const shore = normalize3(x - hit.x, 0, z - hit.z);
    return {
      waterBodyId: body.id, kind: body.kind, level, bedHeight: level - Math.max(0.15, body.width * 0.08),
      depth: Math.max(0.15, body.width * 0.08), flowSpeed: Math.max(1, Math.sqrt(Math.abs(to.y - from.y) * 2)),
      flowDirection: direction, shorelineDistance: body.width * 0.5 - hit.distance, shoreNormal: { x: shore.x, z: shore.z },
    };
  }

  sample(x: number, z: number): WorldWaterSample | null {
    if (!this.contains(x, z) || this.infrastructureProtected(x, z)) return null;
    for (const body of this.waterBodies) {
      const sample = body.kind === "river" ? this.riverSample(body, x, z)
        : body.kind === "waterfall" ? this.waterfallSample(body, x, z)
          : this.lakeSample(body, x, z);
      if (sample) return sample;
    }
    return null;
  }

  /** Exact authored shoreline paths for inspection and ribbon rendering, independent of grid resolution. */
  shorelineRibbons(): readonly WaterShorelineRibbon[] {
    const ribbons: WaterShorelineRibbon[] = [];
    for (const body of this.waterBodies) {
      if (body.kind === "lake" || body.kind === "marsh") {
        for (const ring of [body.polygon, ...body.holes]) ribbons.push({
          waterBodyId: body.id, kind: body.kind, level: body.level,
          points: [...ring.map((point) => ({ x: point.x, y: body.level, z: point.z })), { x: ring[0].x, y: body.level, z: ring[0].z }],
        });
      } else if (body.kind === "river") {
        const spline = this.splines.get(body.splineId);
        if (!spline) continue;
        const edge = (side: 1 | -1) => spline.controlPoints.map((point, index, points) => {
          const before = points[Math.max(0, index - 1)];
          const after = points[Math.min(points.length - 1, index + 1)];
          const direction = normalize3(after.x - before.x, 0, after.z - before.z);
          const width = body.widthProfile[index] ?? body.widthProfile[body.widthProfile.length - 1];
          return { x: point.x - direction.z * width * 0.5 * side, y: point.y, z: point.z + direction.x * width * 0.5 * side };
        });
        ribbons.push({ waterBodyId: body.id, kind: body.kind, level: spline.controlPoints[0]?.y ?? 0, points: edge(1) });
        ribbons.push({ waterBodyId: body.id, kind: body.kind, level: spline.controlPoints[0]?.y ?? 0, points: edge(-1) });
      } else {
        const from = this.socketAt(body.fromSocket, false);
        const to = this.socketAt(body.toSocket, true);
        if (!from || !to) continue;
        const direction = normalize3(to.x - from.x, 0, to.z - from.z);
        const side = direction.x === 0 && direction.z === 0 ? { x: 1, z: 0 } : { x: -direction.z, z: direction.x };
        for (const sign of [-1, 1] as const) ribbons.push({
          waterBodyId: body.id, kind: body.kind, level: from.y,
          points: [
            { x: from.x + side.x * body.width * 0.5 * sign, y: from.y, z: from.z + side.z * body.width * 0.5 * sign },
            { x: to.x + side.x * body.width * 0.5 * sign, y: to.y, z: to.z + side.z * body.width * 0.5 * sign },
          ],
        });
      }
    }
    return ribbons;
  }
}
