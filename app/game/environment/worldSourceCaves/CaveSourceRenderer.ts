import * as THREE from "three";
import type { WorldSourceV3 } from "../worldSourceV3/types.ts";
import { CaveRuntimeSampler } from "./CaveRuntimeSampler.ts";
import { CaveRuntimeValidationError, safeCreateCaveRuntimeView, type CaveRuntimeRoom, type CaveRuntimeView } from "./CaveRuntimeView.ts";

export type CaveSourceRenderCounts = Readonly<{
  rooms: number;
  corridors: number;
  entrances: number;
}>;

const createRoomVolume = (room: CaveRuntimeRoom) => {
  const shape = new THREE.Shape();
  room.floorPolygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: room.clearance, bevelEnabled: false, curveSegments: 1 });
  // ExtrudeGeometry grows along +Z. Rotating it makes authored X/Z the floor
  // and spans the validated room floor-to-ceiling clearance along Y.
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const disposeChildren = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    geometries.add(object.geometry);
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
};

/**
 * Minimal, source-only cave debug geometry. It intentionally does not depend on
 * CaveRenderer or EnvironmentRenderer, so source authoring can be inspected in
 * isolation before production shells and portal assets are available.
 */
export class CaveSourceRenderer {
  readonly root = new THREE.Group();
  readonly view: CaveRuntimeView | null;
  readonly sampler: CaveRuntimeSampler | null;
  private counts: CaveSourceRenderCounts = { rooms: 0, corridors: 0, entrances: 0 };

  constructor(source?: WorldSourceV3 | null) {
    this.root.name = "world-source-cave-network";
    if (!source) {
      this.view = null;
      this.sampler = null;
      return;
    }
    const result = safeCreateCaveRuntimeView(source);
    if (!result.ok) throw new CaveRuntimeValidationError(result.issues);
    this.view = result.value;
    this.sampler = new CaveRuntimeSampler(this.view);
    this.renderView(this.view);
    this.root.updateMatrixWorld(true);
  }

  setVisible(visible: boolean) { this.root.visible = visible; }
  renderCounts() { return { ...this.counts }; }

  dispose() {
    disposeChildren(this.root);
    this.root.clear();
    this.root.removeFromParent();
    this.counts = { rooms: 0, corridors: 0, entrances: 0 };
  }

  private renderView(view: CaveRuntimeView) {
    view.graphs.forEach((graph) => {
      const graphRoot = new THREE.Group();
      graphRoot.name = `world-source-cave:${graph.id}`;
      graphRoot.userData.stratumId = graph.stratumId;
      graph.rooms.forEach((room) => {
        const volume = new THREE.Mesh(
          createRoomVolume(room),
          new THREE.MeshBasicMaterial({ color: 0x72d6c5, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false }),
        );
        volume.name = `world-source-cave-room:${graph.id}:${room.id}`;
        volume.position.y = room.ceilingHeight;
        volume.userData = { roomId: room.id, floorHeight: room.floorHeight, ceilingHeight: room.ceilingHeight, clearance: room.clearance };
        graphRoot.add(volume);
        this.counts = { ...this.counts, rooms: this.counts.rooms + 1 };
      });
      graph.corridors.forEach((corridor) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(corridor.route.map(({ x, y, z }) => new THREE.Vector3(x, y, z)));
        const path = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc66a, transparent: true, opacity: 0.9 }));
        path.name = `world-source-cave-corridor:${graph.id}:${corridor.id}`;
        path.userData = { corridorId: corridor.id, width: corridor.width, clearance: corridor.clearance, routeLength: corridor.routeLength };
        graphRoot.add(path);
        this.counts = { ...this.counts, corridors: this.counts.corridors + 1 };
      });
      graph.portals.forEach((portal) => {
        const marker = new THREE.Mesh(
          new THREE.ConeGeometry(0.7, 1.8, 5),
          new THREE.MeshBasicMaterial({ color: 0x94e8e0, transparent: true, opacity: 0.9 }),
        );
        const space = this.sampler!.sampleSpace(portal.position.x, portal.position.z, graph.stratumId);
        marker.name = `world-source-cave-entrance:${graph.id}:${portal.id}`;
        marker.position.set(portal.position.x, portal.position.y, portal.position.z);
        marker.userData = { portalId: portal.id, roomId: portal.roomId, floorHeight: space?.floorHeight ?? null };
        graphRoot.add(marker);
        this.counts = { ...this.counts, entrances: this.counts.entrances + 1 };
      });
      this.root.add(graphRoot);
    });
  }
}
