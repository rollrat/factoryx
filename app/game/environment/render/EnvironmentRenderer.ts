import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentFrameStats, EnvironmentQuality } from "../types.ts";
import { TerrainChunkManager } from "../terrain/TerrainChunkManager.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import { PropScatterRenderer } from "./PropScatterRenderer.ts";
import { SkySystem } from "./SkySystem.ts";
import { TerrainRenderer } from "./TerrainRenderer.ts";
import { WeatherSystem, type WeatherKind } from "./WeatherSystem.ts";
import { CaveRenderer } from "./CaveRenderer.ts";

export class EnvironmentRenderer {
  readonly sampler: TerrainSampler;
  readonly terrain: TerrainRenderer;
  readonly props: PropScatterRenderer;
  readonly sky: SkySystem;
  readonly weather: WeatherSystem;
  readonly chunks: TerrainChunkManager;
  readonly caves: CaveRenderer;
  readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  readonly definition: EnvironmentDefinition;
  readonly quality: EnvironmentQuality;

  constructor(
    scene: THREE.Scene,
    definition: EnvironmentDefinition,
    quality: EnvironmentQuality = "high",
  ) {
    this.scene = scene;
    this.definition = definition;
    this.quality = quality;
    this.root.name = "a17-environment";
    this.sampler = new TerrainSampler(definition);
    this.terrain = new TerrainRenderer(definition, this.sampler, quality);
    this.props = new PropScatterRenderer(definition, this.sampler, quality);
    this.sky = new SkySystem(scene);
    this.weather = new WeatherSystem(scene, quality);
    this.chunks = new TerrainChunkManager(definition);
    this.caves = new CaveRenderer(scene);
    this.root.add(this.terrain.root, this.props.root);
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(0x263d42);
    this.scene.fog = new THREE.FogExp2(0x607877, quality === "high" ? 0.0085 : 0.011);
  }

  update(delta: number, camera: THREE.Camera) {
    this.sky.update(camera);
    this.weather.update(delta, camera);
    this.props.update(camera);
    this.chunks.update(camera.position.x, camera.position.z, this.quality);
  }

  setTimeOfDay(value: number) { this.sky.setTimeOfDay(value); }
  setWeather(kind: WeatherKind, strength?: number) { this.weather.setWeather(kind, strength); }
  setFogDensity(value: number) {
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = THREE.MathUtils.clamp(value, 0, 0.04);
  }
  setPropsVisible(visible: boolean) { this.props.root.visible = visible; }
  setLandmarksVisible(visible: boolean) {
    this.props.root.children.forEach((child) => {
      if (child.name.startsWith("landmark:")) child.visible = visible;
    });
  }
  setStratum(stratumId: string) {
    const surface = stratumId === "surface";
    this.terrain.root.visible = surface;
    this.props.root.visible = surface;
    this.sky.root.visible = surface;
    this.weather.root.visible = surface;
    this.caves.setVisible(!surface);
    this.scene.background = new THREE.Color(surface ? 0x263d42 : 0x0b1518);
    this.scene.fog = new THREE.FogExp2(surface ? 0x607877 : 0x263d3f, surface ? 0.0085 : 0.025);
  }
  setCaveCutaway(visible: boolean) {
    this.caves.setVisible(visible);
    this.terrain.terrain.visible = !visible;
    this.terrain.surveyPad.visible = !visible;
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
  }
}
