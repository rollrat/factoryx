import * as THREE from "three";
import { CAVE_ZONES } from "../data/caveZones.ts";

const cylinderBetween = (from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) => {
  const delta = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10, 1, true), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
};

export class CaveRenderer {
  readonly root = new THREE.Group();
  readonly interactionRoot = new THREE.Group();
  readonly stratumId = CAVE_ZONES[0].stratumId;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = "a17-caves";
    const rock = new THREE.MeshStandardMaterial({ color: 0x19272a, roughness: 0.97, side: THREE.DoubleSide });
    const calcite = new THREE.MeshStandardMaterial({ color: 0xb9ccc2, roughness: 0.72, emissive: 0x233b38, emissiveIntensity: 0.32 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x29383a, roughness: 0.93 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x79c7b5, emissive: 0x3a9b86, emissiveIntensity: 1.4, roughness: 0.55 });

    CAVE_ZONES.forEach((zone) => {
      const zoneGroup = new THREE.Group();
      zoneGroup.name = `cave-zone:${zone.id}`;
      const points = [
        new THREE.Vector3(zone.portals[0].x, zone.portals[0].y - 2, zone.portals[0].z),
        ...zone.rooms.map(({ center }) => new THREE.Vector3(center.x, center.y, center.z)),
        new THREE.Vector3(zone.portals[1].x, zone.portals[1].y - 2, zone.portals[1].z),
      ];
      for (let index = 1; index < points.length; index += 1) {
        const tunnel = cylinderBetween(points[index - 1], points[index], 3.1, rock);
        tunnel.receiveShadow = true;
        zoneGroup.add(tunnel);
      }
      zone.rooms.forEach((room, roomIndex) => {
        const chamber = new THREE.Mesh(new THREE.SphereGeometry(room.radius, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), rock);
        chamber.scale.y = room.clearance / room.radius;
        chamber.position.set(room.center.x, room.center.y, room.center.z);
        chamber.rotation.x = Math.PI;
        zoneGroup.add(chamber);
        const roomFloor = new THREE.Mesh(new THREE.CylinderGeometry(room.radius * 0.82, room.radius * 0.9, 0.28, 24), floor);
        roomFloor.position.set(room.center.x, room.center.y - 0.08, room.center.z);
        roomFloor.receiveShadow = true;
        roomFloor.userData.caveFloor = true;
        roomFloor.userData.stratumId = zone.stratumId;
        this.interactionRoot.add(roomFloor);
        for (let shard = 0; shard < 6; shard += 1) {
          const angle = shard / 6 * Math.PI * 2 + roomIndex * 0.3;
          const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.4 + (shard % 3) * 0.5, 5), shard % 3 === 0 ? glow : calcite);
          crystal.position.set(room.center.x + Math.cos(angle) * room.radius * 0.66, room.center.y + 0.55, room.center.z + Math.sin(angle) * room.radius * 0.66);
          crystal.rotation.z = (shard % 2 ? 1 : -1) * 0.28;
          zoneGroup.add(crystal);
        }
        const light = new THREE.PointLight(0x72dbc5, roomIndex === 1 ? 7 : 4, room.radius * 2.2, 2);
        light.position.set(room.center.x, room.center.y + 2.4, room.center.z);
        zoneGroup.add(light);
      });
      zone.portals.forEach((portal) => {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.65, 8, 28), rock);
        rim.position.set(portal.x, portal.y, portal.z);
        rim.rotation.x = Math.PI / 2;
        zoneGroup.add(rim);
      });
      this.root.add(zoneGroup);
    });
    this.root.add(this.interactionRoot);
    this.root.visible = false;
    this.scene.add(this.root);
  }

  setVisible(visible: boolean) { this.root.visible = visible; }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
