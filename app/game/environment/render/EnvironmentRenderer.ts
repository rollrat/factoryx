import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentFrameStats, EnvironmentQuality } from "../types.ts";
import { TerrainChunkManager } from "../terrain/TerrainChunkManager.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import { PropScatterRenderer } from "./PropScatterRenderer.ts";
import { SkySystem } from "./SkySystem.ts";
import { TerrainRenderer } from "./TerrainRenderer.ts";
import { WeatherSystem, type WeatherKind } from "./WeatherSystem.ts";
import { CaveRenderer } from "./CaveRenderer.ts";
import { EnvironmentCycle, type EnvironmentCycleSnapshot } from "../EnvironmentCycle.ts";
import { BIOME_BY_ID } from "../data/biomes.ts";
import type { EnvironmentRuntimeInfo } from "../types.ts";
import { ExplorationRenderer } from "./ExplorationRenderer.ts";

export class EnvironmentRenderer {
  readonly sampler: TerrainSampler;
  readonly terrain: TerrainRenderer;
  readonly props: PropScatterRenderer;
  readonly sky: SkySystem;
  readonly weather: WeatherSystem;
  readonly chunks: TerrainChunkManager;
  readonly caves: CaveRenderer;
  readonly exploration: ExplorationRenderer;
  readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  readonly definition: EnvironmentDefinition;
  readonly quality: EnvironmentQuality;
  private readonly cycle = new EnvironmentCycle();
  private automaticCycle = false;
  private activeStratumId = "surface";
  private propsVisible = true;
  private readonly fogColor = new THREE.Color(0x607877);

  constructor(
    scene: THREE.Scene,
    definition: EnvironmentDefinition,
    quality: EnvironmentQuality = "high",
    sampler?: TerrainSampler,
  ) {
    this.scene = scene;
    this.definition = definition;
    this.quality = quality;
    this.root.name = "a17-environment";
    this.sampler = sampler ?? new TerrainSampler(definition);
    this.terrain = new TerrainRenderer(definition, this.sampler, quality);
    this.props = new PropScatterRenderer(definition, this.sampler, quality);
    this.sky = new SkySystem(scene, quality);
    this.weather = new WeatherSystem(scene, quality);
    this.chunks = new TerrainChunkManager(definition);
    this.caves = new CaveRenderer(scene);
    this.exploration = new ExplorationRenderer(this.sampler);
    this.root.add(this.terrain.root, this.props.root, this.exploration.root);
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(0x263d42);
    this.scene.fog = new THREE.FogExp2(0x607877, quality === "high" ? 0.0085 : 0.011);
  }

  update(delta: number, camera: THREE.Camera) {
    if (this.automaticCycle) {
      const state = this.cycle.advance(delta);
      this.sky.setTimeOfDay(state.timeOfDay);
      this.weather.setWeather(state.weather, state.weatherStrength);
    }
    this.sky.update(camera);
    this.weather.update(delta, camera);
    const activeChunks = this.chunks.update(camera.position.x, camera.position.z, this.quality);
    this.terrain.updateChunks(activeChunks);
    this.props.update(camera, activeChunks);
    this.exploration.update(delta, this.activeStratumId);
    if (this.activeStratumId === "surface" && this.scene.fog instanceof THREE.FogExp2) {
      const biome = BIOME_BY_ID.get(this.sampler.sample(camera.position.x, camera.position.z).biomeId);
      if (biome) {
        this.fogColor.lerp(new THREE.Color(biome.palette.fog), 1 - Math.exp(-delta * 0.18));
        this.scene.fog.color.copy(this.fogColor);
        if (this.automaticCycle) {
          const weather = this.weather.getWeather();
          const weatherFog = weather.kind === "mist" ? 0.007 : weather.kind === "electrical_storm" ? 0.0045 : weather.kind === "mineral_wind" ? 0.0025 : 0;
          const targetDensity = (this.quality === "high" ? 0.0068 : 0.0095) + weatherFog * weather.strength;
          this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, targetDensity, 1 - Math.exp(-delta * 0.32));
        }
      }
    }
  }

  setAutomaticCycle(enabled: boolean) { this.automaticCycle = enabled; }
  cycleSnapshot() { return this.cycle.snapshot(); }
  restoreCycle(snapshot: EnvironmentCycleSnapshot) {
    if (!this.cycle.restore(snapshot)) return false;
    const state = this.cycle.state();
    this.sky.setTimeOfDay(state.timeOfDay);
    this.weather.setWeather(state.weather, state.weatherStrength);
    return true;
  }
  setTimeOfDay(value: number) { this.automaticCycle = false; this.sky.setTimeOfDay(value); }
  setWeather(kind: WeatherKind, strength?: number) { this.automaticCycle = false; this.weather.setWeather(kind, strength); }
  setFogDensity(value: number) {
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = THREE.MathUtils.clamp(value, 0, 0.04);
  }
  setPropsVisible(visible: boolean) { this.propsVisible = visible; this.props.root.visible = visible && this.activeStratumId === "surface"; }
  setLandmarksVisible(visible: boolean) {
    this.props.setLandmarksVisible(visible);
    this.props.root.children.forEach((child) => {
      if (child.name.startsWith("landmark:")) child.visible = visible;
    });
  }
  setStratum(stratumId: string) {
    this.activeStratumId = stratumId;
    const surface = stratumId === "surface";
    this.terrain.root.visible = surface;
    this.props.root.visible = surface && this.propsVisible;
    this.exploration.root.visible = true;
    this.sky.root.visible = surface;
    this.weather.root.visible = surface;
    this.caves.setVisible(!surface);
    this.scene.background = new THREE.Color(surface ? 0x263d42 : 0x0b1518);
    this.scene.fog = new THREE.FogExp2(surface ? 0x607877 : 0x263d3f, surface ? 0.0085 : 0.025);
  }
  runtimeInfo(x: number, z: number, stratumId = this.activeStratumId): EnvironmentRuntimeInfo {
    const sample = this.sampler.sample(x, z, stratumId);
    const biome = BIOME_BY_ID.get(sample.biomeId);
    const weather = this.weather.getWeather();
    return {
      biomeId: sample.biomeId,
      biomeName: biome?.name ?? sample.biomeId,
      stratumId,
      surface: sample.surface,
      timeOfDay: this.sky.getTimeOfDay(),
      weather: weather.kind,
      weatherStrength: weather.strength,
      quality: this.quality,
    };
  }
  setCaveCutaway(visible: boolean) {
    this.caves.setVisible(visible);
    this.terrain.root.visible = !visible;
  }

  stats(renderer?: THREE.WebGLRenderer): EnvironmentFrameStats {
    return {
      activeChunks: this.chunks.snapshot().length,
      visibleProps: this.props.root.visible ? this.props.instanceCount : 0,
      triangles: renderer?.info.render.triangles ?? 0,
      drawCalls: renderer?.info.render.calls ?? 0,
    };
  }

  dispose() {
    this.scene.remove(this.root);
    this.terrain.dispose();
    this.props.dispose();
    this.sky.dispose();
    this.weather.dispose();
    this.caves.dispose();
    this.exploration.dispose();
  }
}
