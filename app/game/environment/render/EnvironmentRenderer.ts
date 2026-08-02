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
import type { LandmarkAuthoringOffset, TerrainAuthoringStroke } from "../authoring.ts";
import { TerrainDetailRenderer, type IndustrialFootprint } from "./TerrainDetailRenderer.ts";
import { DistantHorizonRenderer } from "./DistantHorizonRenderer.ts";
import { SurfaceFeatureRenderer } from "./SurfaceFeatureRenderer.ts";
import { IRONWIND_CLIFF_PLACEMENTS } from "../data/ironwindCliffPlacements.ts";
import { CliffKitRenderer } from "./CliffKitRenderer.ts";

export class EnvironmentRenderer {
  readonly sampler: TerrainSampler;
  readonly terrain: TerrainRenderer;
  readonly props: PropScatterRenderer;
  readonly sky: SkySystem;
  readonly weather: WeatherSystem;
  readonly chunks: TerrainChunkManager;
  readonly caves: CaveRenderer;
  readonly exploration: ExplorationRenderer;
  readonly terrainDetail: TerrainDetailRenderer;
  readonly distantHorizon: DistantHorizonRenderer;
  readonly surfaceFeatures: SurfaceFeatureRenderer;
  readonly cliffKit: CliffKitRenderer;
  readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  readonly definition: EnvironmentDefinition;
  readonly quality: EnvironmentQuality;
  private previewQuality: EnvironmentQuality;
  private readonly cycle = new EnvironmentCycle();
  private automaticCycle = false;
  private activeStratumId = "surface";
  private propsVisible = true;
  private readonly fogColor = new THREE.Color(0xb4d2df);
  private surfaceFogDensity: number;
  private scatterDensity = 1;
  private shadowDistance = 42;

  constructor(
    scene: THREE.Scene,
    definition: EnvironmentDefinition,
    quality: EnvironmentQuality = "high",
    sampler?: TerrainSampler,
  ) {
    this.scene = scene;
    this.definition = definition;
    this.quality = quality;
    this.previewQuality = quality;
    this.surfaceFogDensity = quality === "high" ? 0.0036 : 0.0052;
    this.root.name = "a17-environment";
    this.sampler = sampler ?? new TerrainSampler(definition);
    this.terrain = new TerrainRenderer(definition, this.sampler, quality);
    this.props = new PropScatterRenderer(definition, this.sampler, quality);
    this.sky = new SkySystem(scene, quality);
    this.weather = new WeatherSystem(scene, quality);
    this.chunks = new TerrainChunkManager(definition);
    this.caves = new CaveRenderer(scene, this.sampler);
    this.exploration = new ExplorationRenderer(this.sampler);
    this.terrainDetail = new TerrainDetailRenderer(this.sampler, quality);
    this.distantHorizon = new DistantHorizonRenderer(definition.seed, quality);
    this.surfaceFeatures = new SurfaceFeatureRenderer(definition, this.sampler, quality);
    this.cliffKit = new CliffKitRenderer(IRONWIND_CLIFF_PLACEMENTS, quality);
    this.root.add(
      this.terrain.root,
      this.surfaceFeatures.root,
      this.cliffKit.root,
      this.terrainDetail.root,
      this.props.root,
      this.distantHorizon.root,
      this.exploration.root,
    );
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(0x77acd0);
    this.scene.fog = new THREE.FogExp2(0xb4d2df, this.surfaceFogDensity);
  }

  update(delta: number, camera: THREE.Camera) {
    if (this.automaticCycle) {
      const state = this.cycle.advance(delta);
      this.sky.setTimeOfDay(state.timeOfDay);
      this.weather.setWeather(state.weather, state.weatherStrength);
    }
    if (this.activeStratumId === "surface") {
      this.sky.update(camera, delta);
      this.weather.setBiome(this.sampler.biomeAt(camera.position.x, camera.position.z).id);
      this.weather.update(delta, camera);
      const activeChunks = this.chunks.update(camera.position.x, camera.position.z, this.previewQuality);
      this.terrain.updateChunks(activeChunks);
      const currentWeather = this.weather.getWeather();
      this.sky.setWeatherInfluence(currentWeather.kind, currentWeather.strength);
      this.props.setWindStrength(0.55 + currentWeather.strength * (currentWeather.kind === "mineral_wind" ? 1.2 : 0.55));
      this.props.update(delta, camera, activeChunks);
      this.terrainDetail.setWeather(currentWeather.kind, currentWeather.strength);
      this.terrainDetail.update(camera);
      this.distantHorizon.setWeather(currentWeather.kind, currentWeather.strength);
      this.distantHorizon.update(camera);
      this.surfaceFeatures.update(delta);
      this.cliffKit.update(camera);
    }
    this.exploration.update(delta, this.activeStratumId);
    if (this.activeStratumId === "surface" && this.scene.fog instanceof THREE.FogExp2) {
      const blend = this.sampler.biomeBlendAt(camera.position.x, camera.position.z);
      const biome = BIOME_BY_ID.get(blend.primary.id);
      if (biome) {
        const biomeFog = new THREE.Color(biome.palette.fog).lerp(new THREE.Color(blend.secondary.palette.fog), blend.secondaryWeight);
        const targetFog = new THREE.Color(0xb4d2df).lerp(biomeFog, 0.28);
        this.fogColor.lerp(targetFog, 1 - Math.exp(-delta * 0.18));
        this.scene.fog.color.copy(this.fogColor);
        if (this.automaticCycle) {
          const weather = this.weather.getWeather();
          const weatherFog = weather.kind === "mist" ? 0.007 : weather.kind === "electrical_storm" ? 0.0045 : weather.kind === "mineral_wind" ? 0.0025 : 0;
          const targetDensity = this.surfaceFogDensity + weatherFog * weather.strength;
          this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, targetDensity, 1 - Math.exp(-delta * 0.32));
        }
      }
    }
  }

  setAutomaticCycle(enabled: boolean) { this.automaticCycle = enabled; }
  seedCycle(timeOfDay: number, weather: WeatherKind, strength: number) {
    const state = this.cycle.seed(timeOfDay, weather, strength);
    this.sky.setTimeOfDay(state.timeOfDay);
    this.weather.setWeather(state.weather, state.weatherStrength);
  }
  cycleSnapshot() { return this.cycle.snapshot(); }
  restoreCycle(snapshot: EnvironmentCycleSnapshot) {
    if (!this.cycle.restore(snapshot)) return false;
    const state = this.cycle.state();
    this.sky.setTimeOfDay(state.timeOfDay);
    this.weather.setWeather(state.weather, state.weatherStrength);
    return true;
  }
  setTimeOfDay(value: number) { this.automaticCycle = false; this.sky.setTimeOfDay(value); }
  setSunAzimuth(value: number) { this.sky.setSunAzimuth(value); }
  setShadowDistance(value: number) {
    this.shadowDistance = THREE.MathUtils.clamp(value, 12, 96);
    this.sky.setShadowDistance(this.previewQuality === "low" ? Math.min(this.shadowDistance, 24) : this.shadowDistance);
  }
  setPreviewQuality(value: EnvironmentQuality) {
    this.previewQuality = value;
    const densityMultiplier = value === "high" ? 1 : 0.48;
    this.props.setDensity(this.scatterDensity * densityMultiplier);
    this.terrainDetail.setPreviewQuality(value);
    this.weather.setPreviewQuality(value);
    this.cliffKit.setPreviewQuality(value);
    this.sky.setShadowDistance(value === "high" ? this.shadowDistance : Math.min(this.shadowDistance, 24));
  }
  setAuthoringStrokes(strokes: readonly TerrainAuthoringStroke[], region?: Readonly<{ x: number; z: number; radius: number }>) {
    this.sampler.setAuthoringStrokes(strokes);
    this.terrain.refreshFromSampler(region);
    this.props.setAuthoringClusters();
  }
  setLandmarkOffsets(offsets: Readonly<Record<string, LandmarkAuthoringOffset>>) {
    this.props.root.children.forEach((child) => {
      if (!child.name.startsWith("landmark:")) return;
      const id = child.name.slice("landmark:".length);
      const base = (child.userData.authoringBase as { x: number; z: number; rotation: number } | undefined)
        ?? { x: child.position.x, z: child.position.z, rotation: child.rotation.y };
      child.userData.authoringBase = base;
      const offset = offsets[id] ?? { x: 0, z: 0, rotation: 0 };
      child.position.x = base.x + offset.x;
      child.position.z = base.z + offset.z;
      child.position.y = this.sampler.heightAt(child.position.x, child.position.z);
      child.rotation.y = base.rotation + offset.rotation;
    });
  }
  setWeather(kind: WeatherKind, strength?: number) { this.automaticCycle = false; this.weather.setWeather(kind, strength); }
  setFogDensity(value: number) {
    this.surfaceFogDensity = THREE.MathUtils.clamp(value, 0, 0.04);
    if (this.activeStratumId === "surface" && this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = this.surfaceFogDensity;
  }
  setPropsVisible(visible: boolean) { this.propsVisible = visible; this.props.root.visible = visible && this.activeStratumId === "surface"; }
  setIndustrialFootprints(footprints: readonly IndustrialFootprint[]) {
    this.terrainDetail.setIndustrialFootprints(footprints);
  }
  setScatterDensity(density: number) {
    this.scatterDensity = THREE.MathUtils.clamp(density, 0, 1);
    this.props.setDensity(this.scatterDensity * (this.previewQuality === "high" ? 1 : 0.48));
  }
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
    this.terrainDetail.root.visible = surface;
    this.distantHorizon.root.visible = surface;
    this.surfaceFeatures.root.visible = surface;
    this.cliffKit.root.visible = surface;
    this.props.root.visible = surface && this.propsVisible;
    this.exploration.root.visible = true;
    this.sky.root.visible = surface;
    this.weather.root.visible = surface;
    this.caves.setVisible(!surface);
    this.scene.background = new THREE.Color(surface ? 0x77acd0 : 0x0b1518);
    this.scene.fog = new THREE.FogExp2(surface ? 0xb4d2df : 0x263d3f, surface ? this.surfaceFogDensity : 0.025);
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
      quality: this.previewQuality,
      explorationDiscovered: 0,
      explorationTotal: 0,
      audioMuted: false,
    };
  }
  setCaveCutaway(visible: boolean) {
    this.caves.setCutaway(visible);
    this.terrain.root.visible = !visible;
    this.terrainDetail.root.visible = !visible;
    this.surfaceFeatures.root.visible = !visible;
    this.cliffKit.root.visible = !visible;
    this.props.root.visible = !visible && this.propsVisible;
    this.distantHorizon.root.visible = !visible;
    this.sky.root.visible = !visible;
    this.weather.root.visible = !visible;
    this.scene.background = new THREE.Color(visible ? 0x0b1518 : 0x77acd0);
    this.scene.fog = new THREE.FogExp2(visible ? 0x263d3f : 0xb4d2df, visible ? 0.012 : this.surfaceFogDensity);
  }

  stats(renderer?: THREE.WebGLRenderer): EnvironmentFrameStats {
    const propAssets = this.props.assetStatus();
    const cliffAssets = this.cliffKit.assetStatus();
    const assetStatus = propAssets === "fallback" || cliffAssets === "fallback"
      ? "fallback"
      : propAssets === "ready" && cliffAssets === "ready"
        ? "ready"
        : "loading";
    return {
      activeChunks: this.chunks.snapshot().length,
      visibleProps: this.props.visibleInstanceCount(),
      triangles: renderer?.info.render.triangles ?? 0,
      drawCalls: renderer?.info.render.calls ?? 0,
      assetStatus,
    };
  }

  dispose() {
    this.scene.remove(this.root);
    this.terrain.dispose();
    this.terrainDetail.dispose();
    this.distantHorizon.dispose();
    this.surfaceFeatures.dispose();
    this.cliffKit.dispose();
    this.props.dispose();
    this.sky.dispose();
    this.weather.dispose();
    this.caves.dispose();
    this.exploration.dispose();
  }
}
