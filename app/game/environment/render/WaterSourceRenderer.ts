import * as THREE from "three";
import type { WaterBody, WorldSourceV3 } from "../worldSourceV3/types.ts";
import { WorldWaterSampler, type WaterShorelineRibbon } from "../water/index.ts";

const bodyOrder = (left: WaterBody, right: WaterBody) => right.priority - left.priority || left.id.localeCompare(right.id);

const bodyColor = (body: WaterBody) => body.kind === "marsh" ? 0x385e55
  : body.kind === "river" ? 0x164f63
    : body.kind === "waterfall" ? 0x72cddd : 0x2f7e99;

const makeWaterMaterial = (body: WaterBody) => new THREE.MeshPhysicalMaterial({
  color: bodyColor(body), emissive: body.kind === "waterfall" ? 0x12353c : 0x071c26,
  emissiveIntensity: body.kind === "waterfall" ? 0.28 : 0.16,
  roughness: body.kind === "marsh" ? 0.46 : 0.18,
  metalness: body.kind === "marsh" ? 0 : 0.06,
  transparent: true, opacity: body.kind === "waterfall" ? 0.72 : 0.8,
  side: THREE.DoubleSide, depthWrite: false,
});

const stripGeometry = (left: readonly THREE.Vector3[], right: readonly THREE.Vector3[]) => {
  if (left.length !== right.length || left.length < 2) return null;
  const positions = new Float32Array(left.length * 6);
  const indices: number[] = [];
  left.forEach((point, index) => {
    positions.set([point.x, point.y, point.z, right[index].x, right[index].y, right[index].z], index * 6);
    if (index > 0) {
      const previous = (index - 1) * 2;
      const current = index * 2;
      indices.push(previous, current, previous + 1, previous + 1, current, current + 1);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

const polygonGeometry = (body: Extract<WaterBody, { kind: "lake" | "marsh" }>) => {
  const contour = body.polygon.map(({ x, z }) => new THREE.Vector2(x, z));
  const holes = body.holes.map((ring) => ring.map(({ x, z }) => new THREE.Vector2(x, z)));
  const points = [...contour, ...holes.flat()];
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set([point.x, body.level, point.y], index * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Source-only water presentation. Each authored body owns its water surface
 * and exact shoreline cues; it has no dependency on EnvironmentRenderer.
 */
export class WaterSourceRenderer {
  readonly root = new THREE.Group();
  readonly waterSurfaces: readonly THREE.Mesh[];
  readonly shorelineCues: readonly THREE.Line[];

  constructor(source: WorldSourceV3 | null | undefined) {
    this.root.name = "world-source-water";
    if (!source || source.waterBodies.length === 0) {
      this.waterSurfaces = [];
      this.shorelineCues = [];
      return;
    }
    const sampler = new WorldWaterSampler(source);
    const ribbonsByBody = new Map<string, WaterShorelineRibbon[]>();
    sampler.shorelineRibbons().forEach((ribbon) => {
      const entries = ribbonsByBody.get(ribbon.waterBodyId) ?? [];
      entries.push(ribbon);
      ribbonsByBody.set(ribbon.waterBodyId, entries);
    });
    const surfaces: THREE.Mesh[] = [];
    const shorelineCues: THREE.Line[] = [];
    [...source.waterBodies].sort(bodyOrder).forEach((body) => {
      const bodyRoot = new THREE.Group();
      bodyRoot.name = `water-body:${body.id}`;
      const ribbons = ribbonsByBody.get(body.id) ?? [];
      const surface = this.surfaceFor(body, ribbons);
      if (surface) {
        surface.name = `water-surface:${body.id}`;
        surface.renderOrder = 2;
        bodyRoot.add(surface);
        surfaces.push(surface);
      }
      ribbons.forEach((ribbon, index) => {
        const points = ribbon.points.map(({ x, y, z }) => new THREE.Vector3(x, y + 0.018, z));
        if (points.length < 2) return;
        const cue = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: body.kind === "marsh" ? 0x1a312b : 0xa6d3d5, transparent: true, opacity: 0.72 }),
        );
        cue.name = `water-shoreline:${body.id}:${index}`;
        cue.renderOrder = 3;
        bodyRoot.add(cue);
        shorelineCues.push(cue);
      });
      if (bodyRoot.children.length > 0) this.root.add(bodyRoot);
    });
    this.waterSurfaces = surfaces;
    this.shorelineCues = shorelineCues;
  }

  waterBodyCount() { return this.waterSurfaces.length; }
  shorelineCueCount() { return this.shorelineCues.length; }

  dispose() {
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
    });
    this.root.clear();
  }

  private surfaceFor(body: WaterBody, ribbons: readonly WaterShorelineRibbon[]) {
    if (body.kind === "lake" || body.kind === "marsh") return new THREE.Mesh(polygonGeometry(body), makeWaterMaterial(body));
    const edges = ribbons.slice(0, 2).map((ribbon) => ribbon.points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
    if (edges.length !== 2) return null;
    const geometry = stripGeometry(edges[0], edges[1]);
    return geometry ? new THREE.Mesh(geometry, makeWaterMaterial(body)) : null;
  }
}
