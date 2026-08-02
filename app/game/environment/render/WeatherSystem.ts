import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";

export type WeatherKind = "clear" | "mineral_wind" | "mist" | "electrical_storm";

/**
 * P8 keeps weather readable without turning every biome into a dusty global fog.
 * The particle field is camera-local; only marsh mist is allowed to feed scene fog.
 */
export type WeatherVisibilityProfile = Readonly<{
  visibilityMeters: number;
  horizonOpacity: number;
  cloudShadowStrength: number;
  localParticlesOnly: boolean;
}>;

export const weatherVisibilityProfile = (kind: WeatherKind, strength: number): WeatherVisibilityProfile => {
  const amount = THREE.MathUtils.clamp(strength, 0, 1);
  if (kind === "mist") return {
    visibilityMeters: THREE.MathUtils.lerp(220, 110, amount),
    horizonOpacity: THREE.MathUtils.lerp(1, 0.42, amount),
    cloudShadowStrength: THREE.MathUtils.lerp(0.12, 0.38, amount),
    localParticlesOnly: true,
  };
  if (kind === "electrical_storm") return {
    visibilityMeters: THREE.MathUtils.lerp(220, 150, amount),
    horizonOpacity: THREE.MathUtils.lerp(1, 0.62, amount),
    cloudShadowStrength: THREE.MathUtils.lerp(0.12, 0.62, amount),
    localParticlesOnly: true,
  };
  if (kind === "mineral_wind") return {
    visibilityMeters: THREE.MathUtils.lerp(240, 195, amount),
    horizonOpacity: THREE.MathUtils.lerp(1, 0.76, amount),
    cloudShadowStrength: THREE.MathUtils.lerp(0.12, 0.08, amount),
    localParticlesOnly: true,
  };
  return { visibilityMeters: 240, horizonOpacity: 1, cloudShadowStrength: 0.12, localParticlesOnly: true };
};

export class WeatherSystem {
  readonly root = new THREE.Group();
  private readonly particles: THREE.Points;
  private readonly stormLight = new THREE.PointLight(0xb8d9ff, 0, 95, 2);
  private weather: WeatherKind = "clear";
  private strength = 0;
  private displayedStrength = 0;
  private phase = 0;
  private biomeId = "windglass_basin";
  private readonly positions: Float32Array;
  private readonly particleCapacity: number;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, quality: EnvironmentQuality) {
    this.scene = scene;
    const count = quality === "high" ? 360 : 160;
    this.particleCapacity = count;
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
    this.particles.name = "local-weather-particles";
    this.particles.geometry.setDrawRange(0, count);
    this.particles.frustumCulled = false;
    this.root.add(this.particles);
    this.stormLight.position.set(0, 34, 0);
    this.root.add(this.stormLight);
    this.scene.add(this.root);
  }

  setWeather(kind: WeatherKind, strength = this.strength) {
    this.weather = kind;
    this.strength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  getWeather() { return { kind: this.weather, strength: this.strength } as const; }
  visibilityProfile() { return weatherVisibilityProfile(this.weather, this.strength); }

  setBiome(biomeId: string) { this.biomeId = biomeId; }

  setPreviewQuality(quality: EnvironmentQuality) {
    this.particles.geometry.setDrawRange(0, Math.min(this.particleCapacity, quality === "high" ? 360 : 160));
  }

  activeParticleCount() {
    return this.particles.geometry.drawRange.count;
  }

  update(delta: number, camera: THREE.Camera) {
    this.root.position.x = camera.position.x;
    this.root.position.z = camera.position.z;
    this.phase += delta;
    this.displayedStrength = THREE.MathUtils.lerp(this.displayedStrength, this.strength, 1 - Math.exp(-delta * 1.4));
    const material = this.particles.material as THREE.PointsMaterial;
    const biomeColor = this.biomeId === "blackwater_marsh" ? 0x8fa9a2
      : this.biomeId === "ironwind_faults" ? 0xb88a70
        : this.biomeId === "silicate_sailwood" ? 0xc8bed5
          : this.biomeId === "hematite_crown" ? 0xa87c68
            : this.biomeId === "thermal_rift" ? 0xd8ccb5 : 0xc0ad8e;
    const targetColor = this.weather === "mist" ? 0x9eb9b6 : this.weather === "electrical_storm" ? 0x8f9aa8 : biomeColor;
    material.color.lerp(new THREE.Color(targetColor), 1 - Math.exp(-delta * 1.2));
    material.opacity = THREE.MathUtils.lerp(material.opacity, this.weather === "clear" ? 0 : 0.06 + this.displayedStrength * 0.5, 1 - Math.exp(-delta * 1.8));
    material.size = THREE.MathUtils.lerp(material.size, this.weather === "mist" ? 0.16 : 0.075, 1 - Math.exp(-delta * 1.8));
    const flash = this.weather === "electrical_storm" && Math.sin(this.phase * 0.71) > 0.985
      ? this.displayedStrength * 8
      : 0;
    this.stormLight.intensity = THREE.MathUtils.lerp(this.stormLight.intensity, flash, 1 - Math.exp(-delta * 24));
    if (this.weather === "clear" && material.opacity < 0.001) return;
    const speed = (this.weather === "mineral_wind" || this.weather === "electrical_storm" ? 9 : 1.2) * (0.25 + this.displayedStrength);
    for (let index = 0; index < this.positions.length; index += 3) {
      this.positions[index] += delta * speed;
      this.positions[index + 2] += delta * speed * 0.22;
      if (this.biomeId === "thermal_rift") this.positions[index + 1] += delta * (0.4 + this.displayedStrength);
      if (this.positions[index] > 58) this.positions[index] -= 116;
      if (this.positions[index + 2] > 58) this.positions[index + 2] -= 116;
      if (this.positions[index + 1] > 17) this.positions[index + 1] = 0.6;
    }
    (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.root);
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
  }
}
