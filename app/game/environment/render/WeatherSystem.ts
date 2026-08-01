import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";

export type WeatherKind = "clear" | "mineral_wind" | "mist";

export class WeatherSystem {
  readonly root = new THREE.Group();
  private readonly particles: THREE.Points;
  private weather: WeatherKind = "mineral_wind";
  private strength = 0.34;
  private readonly positions: Float32Array;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, quality: EnvironmentQuality) {
    this.scene = scene;
    const count = quality === "high" ? 360 : 160;
    this.positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const angle = index * 2.399963;
      const radius = Math.sqrt((index + 0.5) / count) * 58;
      this.positions[offset] = Math.cos(angle) * radius;
      this.positions[offset + 1] = 0.6 + ((index * 17) % 83) / 83 * 16;
      this.positions[offset + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xc0ad8e, size: 0.075, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.particles.frustumCulled = false;
    this.root.add(this.particles);
    this.scene.add(this.root);
  }

  setWeather(kind: WeatherKind, strength = this.strength) {
    this.weather = kind;
    this.strength = THREE.MathUtils.clamp(strength, 0, 1);
    const material = this.particles.material as THREE.PointsMaterial;
    material.color.setHex(kind === "mist" ? 0x9eb9b6 : 0xc0ad8e);
    material.opacity = kind === "clear" ? 0 : 0.08 + this.strength * 0.48;
    material.size = kind === "mist" ? 0.16 : 0.075;
  }

  getWeather() { return { kind: this.weather, strength: this.strength } as const; }

  update(delta: number, camera: THREE.Camera) {
    this.root.position.x = camera.position.x;
    this.root.position.z = camera.position.z;
    if (this.weather === "clear") return;
    const speed = (this.weather === "mineral_wind" ? 9 : 1.2) * (0.25 + this.strength);
    for (let index = 0; index < this.positions.length; index += 3) {
      this.positions[index] += delta * speed;
      this.positions[index + 2] += delta * speed * 0.22;
      if (this.positions[index] > 58) this.positions[index] -= 116;
      if (this.positions[index + 2] > 58) this.positions[index + 2] -= 116;
    }
    (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.root);
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
  }
}
