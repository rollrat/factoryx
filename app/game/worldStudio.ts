import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { A17_ENVIRONMENT, BIOMES, EnvironmentRenderer } from "./environment/index.ts";
import { RESOURCE_ANCHORS } from "./data/resourceAnchors.ts";
import type { EnvironmentQuality, SurfaceType } from "./environment/types.ts";
import type { WeatherKind } from "./environment/render/WeatherSystem.ts";
import {
  parseWorldStudioDocument,
  WORLD_STUDIO_DOCUMENT_VERSION,
  type LandmarkAuthoringOffset,
  type TerrainAuthoringBrush,
  type TerrainAuthoringStroke,
  type WorldStudioEnvironmentDocument,
} from "./environment/authoring.ts";

export type WorldStudioBrush = TerrainAuthoringBrush;
export type WorldStudioOverlay = "none" | "biome" | "surface" | "buildability" | "chunks" | "resources" | "shadow";
export type WorldStudioView = "overview" | "firstPerson" | "distance" | "production" | "projectDock" | "caveCutaway";
export type WorldStudioStroke = TerrainAuthoringStroke;
export type WorldStudioDocument = WorldStudioEnvironmentDocument;
export type WorldStudioStats = Readonly<{ fps: number; frameMs: number; drawCalls: number; triangles: number; activeChunks: number; visibleProps: number; assetStatus: "loading" | "ready" | "fallback" }>;

const SURFACE_COLORS: Readonly<Record<SurfaceType, number>> = {
  stable: 0x52d7c5, soft: 0xe7a34d, steep: 0xeb654f, submerged: 0x4f8fbd, hazard: 0xd74968, cave_floor: 0xa98ac0,
};
const LOD_COLORS = [0x55e0c2, 0xe8b456, 0xd96567] as const;

export class WorldStudioRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly environment: EnvironmentRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly brushCursor: THREE.Mesh;
  private readonly resourceOverlay = new THREE.Group();
  private readonly chunkOverlay = new THREE.Group();
  private readonly shadowOverlay: THREE.LineLoop;
  private readonly chunkCells = new Map<string, THREE.Mesh>();
  private animationId = 0;
  private lastTime = performance.now();
  private statsClock = 0;
  private frameAverage = 16.7;
  private strokes: WorldStudioStroke[] = [];
  private landmarkOffsets: Record<string, LandmarkAuthoringOffset> = {};
  private brush: WorldStudioBrush = "raise";
  private brushRadius = 8;
  private brushStrength = 0.6;
  private biomeId = BIOMES[0].id as string;
  private surface: SurfaceType = "stable";
  private overlay: WorldStudioOverlay = "none";
  private pointerPainting = false;
  private timeOfDay = 0.68;
  private sunAzimuth = 0;
  private fogDensity = 0.0085;
  private weather: WeatherKind = "mineral_wind";
  private weatherStrength = 0.34;
  private scatterDensity = 1;
  private landmarksVisible = true;
  private resourceAnchorsVisible = true;
  private quality: EnvironmentQuality = "high";
  private shadowDistance = 42;

  constructor(private readonly mount: HTMLDivElement, private readonly onStats: (stats: WorldStudioStats) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "A-17 환경 제작 뷰포트");
    this.mount.appendChild(this.renderer.domElement);

    this.environment = new EnvironmentRenderer(this.scene, A17_ENVIRONMENT, "high");
    this.environment.terrain.setEditorMode(true);
    this.camera.position.set(48, 54, 52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 230;
    this.controls.minDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.brushCursor = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x69ead7, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.brushCursor.rotation.x = -Math.PI / 2;
    this.brushCursor.scale.setScalar(this.brushRadius);
    this.brushCursor.visible = false;
    this.scene.add(this.brushCursor);
    this.createResourceOverlay();
    this.createChunkOverlay();
    this.shadowOverlay = this.createShadowOverlay();
    this.rebuildShadowOverlay();
    this.scene.add(this.resourceOverlay, this.chunkOverlay, this.shadowOverlay);
    this.bindEvents();
    this.resize();
    this.applyOverlayVisibility();
    this.animate(performance.now());
  }

  setBrush(brush: WorldStudioBrush) { this.brush = brush; }
  setBrushRadius(radius: number) { this.brushRadius = THREE.MathUtils.clamp(radius, 1, 24); this.brushCursor.scale.setScalar(this.brushRadius); }
  setBrushStrength(strength: number) { this.brushStrength = THREE.MathUtils.clamp(strength, 0.05, 2); }
  setBiome(id: string) { if (BIOMES.some((biome) => biome.id === id)) this.biomeId = id; }
  setSurface(surface: SurfaceType) { this.surface = surface; }
  setPropsVisible(visible: boolean) { this.environment.setPropsVisible(visible); }
  setScatterDensity(value: number) { this.scatterDensity = THREE.MathUtils.clamp(value, 0, 1); this.environment.setScatterDensity(this.scatterDensity); }
  setLandmarksVisible(visible: boolean) { this.landmarksVisible = visible; this.environment.setLandmarksVisible(visible); }
  setResourceAnchorsVisible(visible: boolean) { this.resourceAnchorsVisible = visible; this.applyOverlayVisibility(); }
  setLandmarkOffset(id: string, offset: LandmarkAuthoringOffset) {
    if (!A17_ENVIRONMENT.landmarks.some((landmark) => landmark.id === id)) return;
    this.landmarkOffsets[id] = { x: THREE.MathUtils.clamp(offset.x, -64, 64), z: THREE.MathUtils.clamp(offset.z, -64, 64), rotation: THREE.MathUtils.clamp(offset.rotation, -Math.PI * 2, Math.PI * 2) };
    this.environment.setLandmarkOffsets(this.landmarkOffsets);
  }
  setTimeOfDay(value: number) { this.timeOfDay = THREE.MathUtils.clamp(value, 0, 1); this.environment.setTimeOfDay(this.timeOfDay); }
  setSunAzimuth(value: number) { this.sunAzimuth = THREE.MathUtils.clamp(value, -1, 1); this.environment.setSunAzimuth(this.sunAzimuth); }
  setShadowDistance(value: number) { this.shadowDistance = THREE.MathUtils.clamp(value, 12, 96); this.environment.setShadowDistance(this.shadowDistance); this.rebuildShadowOverlay(); }
  setFogDensity(value: number) { this.fogDensity = THREE.MathUtils.clamp(value, 0, 0.04); this.environment.setFogDensity(this.fogDensity); }
  setWeather(weather: WeatherKind, strength = this.weatherStrength) { this.weather = weather; this.weatherStrength = THREE.MathUtils.clamp(strength, 0, 1); this.environment.setWeather(weather, this.weatherStrength); }
  setQuality(value: EnvironmentQuality) {
    this.quality = value;
    this.environment.setPreviewQuality(value);
    this.renderer.setPixelRatio(value === "high" ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.renderer.shadowMap.enabled = value === "high";
    this.rebuildShadowOverlay();
    this.resize();
  }
  setOverlay(overlay: WorldStudioOverlay) { this.overlay = overlay; this.refreshTerrainColors(); this.applyOverlayVisibility(); }

  setView(view: WorldStudioView) {
    const views: Readonly<Record<WorldStudioView, readonly [THREE.Vector3Tuple, THREE.Vector3Tuple, number]>> = {
      overview: [[48, 54, 52], [0, 0, 0], 52],
      firstPerson: [[0, 1.7, 10], [0, 1.5, 0], 68],
      distance: [[112, 72, 118], [0, 5, 0], 48],
      production: [[12, 8, 11], [-1, 0.5, -3], 50],
      projectDock: [[20, 10, 20], [8, 1, 8], 48],
      caveCutaway: [[45, 20, 112], [7, -10, 105], 52],
    };
    const [position, target, fov] = views[view];
    this.camera.position.fromArray(position);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.fromArray(target);
    this.environment.setCaveCutaway(view === "caveCutaway");
    this.controls.maxPolarAngle = view === "caveCutaway" ? Math.PI * 0.8 : Math.PI * 0.49;
    this.controls.update();
  }

  exportDocument(): WorldStudioDocument {
    return {
      format: "factoryx-world-studio", version: WORLD_STUDIO_DOCUMENT_VERSION,
      environmentId: A17_ENVIRONMENT.id, environmentVersion: A17_ENVIRONMENT.version, seed: A17_ENVIRONMENT.seed,
      strokes: this.strokes.map((stroke) => ({ ...stroke })), timeOfDay: this.timeOfDay, sunAzimuth: this.sunAzimuth,
      fogDensity: this.fogDensity, weather: this.weather, weatherStrength: this.weatherStrength,
      scatterDensity: this.scatterDensity, landmarksVisible: this.landmarksVisible,
      resourceAnchorsVisible: this.resourceAnchorsVisible, quality: this.quality,
      landmarkOffsets: Object.fromEntries(Object.entries(this.landmarkOffsets).map(([id, offset]) => [id, { ...offset }])),
    };
  }

  importDocument(value: unknown) {
    const document = parseWorldStudioDocument(value, A17_ENVIRONMENT);
    if (!document) return false;
    this.strokes = document.strokes.map((stroke) => ({ ...stroke }));
    this.landmarkOffsets = Object.fromEntries(Object.entries(document.landmarkOffsets).map(([id, offset]) => [id, { ...offset }]));
    this.environment.setAuthoringStrokes(this.strokes);
    this.environment.setLandmarkOffsets(this.landmarkOffsets);
    this.setTimeOfDay(document.timeOfDay);
    this.setSunAzimuth(document.sunAzimuth);
    this.setFogDensity(document.fogDensity);
    this.setWeather(document.weather, document.weatherStrength);
    this.setScatterDensity(document.scatterDensity);
    this.setLandmarksVisible(document.landmarksVisible);
    this.setResourceAnchorsVisible(document.resourceAnchorsVisible);
    this.setQuality(document.quality);
    this.refreshTerrainColors();
    this.refreshDebugHeights();
    return true;
  }

  reset() {
    this.strokes = [];
    this.landmarkOffsets = {};
    this.environment.setAuthoringStrokes([]);
    this.environment.setLandmarkOffsets({});
    this.refreshTerrainColors();
    this.refreshDebugHeights();
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.controls.dispose();
    this.environment.dispose();
    [this.brushCursor, this.resourceOverlay, this.chunkOverlay, this.shadowOverlay].forEach((object) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
      });
      this.scene.remove(object);
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) this.mount.removeChild(this.renderer.domElement);
  }

  private bindEvents() {
    window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }
  private resize = () => { const width = this.mount.clientWidth; const height = Math.max(1, this.mount.clientHeight); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height); };
  private pickTerrain(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.environment.terrain.terrain, false)[0]?.point ?? null;
  }
  private onPointerMove = (event: PointerEvent) => {
    const point = this.pickTerrain(event);
    this.brushCursor.visible = point !== null;
    if (!point) return;
    this.brushCursor.position.set(point.x, point.y + 0.08, point.z);
    if (this.pointerPainting && event.buttons === 1) this.paint(point.x, point.z);
  };
  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.altKey) return;
    const point = this.pickTerrain(event);
    if (!point) return;
    this.pointerPainting = true;
    this.controls.enabled = false;
    this.paint(point.x, point.z);
  };
  private onPointerUp = () => { this.pointerPainting = false; this.controls.enabled = true; };

  private paint(x: number, z: number) {
    const previous = this.strokes.at(-1);
    if (previous && previous.brush === this.brush && Math.hypot(previous.x - x, previous.z - z) < this.brushRadius * 0.18) return;
    const targetHeight = this.environment.sampler.heightAt(x, z);
    const stroke: WorldStudioStroke = {
      brush: this.brush, x, z, radius: this.brushRadius, strength: this.brushStrength,
      ...(this.brush === "biome" ? { biomeId: this.biomeId } : {}),
      ...(this.brush === "surface" ? { surface: this.surface } : {}),
      ...(this.brush === "flatten" ? { targetHeight } : {}),
    };
    this.strokes.push(stroke);
    this.environment.setAuthoringStrokes(this.strokes, { x, z, radius: this.brushRadius });
    this.environment.setLandmarkOffsets(this.landmarkOffsets);
    this.refreshTerrainColors();
    this.refreshDebugHeights();
  }

  private refreshTerrainColors() {
    const geometry = this.environment.terrain.terrain.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index); const z = positions.getZ(index); const sample = this.environment.sampler.sample(x, z);
      let value = this.environment.sampler.colorAt(x, z);
      if (this.overlay === "surface") value = SURFACE_COLORS[sample.surface];
      if (this.overlay === "buildability") value = sample.buildability === "allowed" ? 0x43c98e : sample.buildability === "foundation_required" ? 0xe5a34a : 0xe05261;
      if (this.overlay === "chunks") value = ((Math.floor((x + 128) / 32) + Math.floor((z + 128) / 32)) & 1) === 0 ? 0x315b60 : 0x513f55;
      if (this.overlay === "biome") value = BIOMES.find(({ id }) => id === sample.biomeId)?.palette.accent ?? value;
      color.setHex(value); colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    const material = this.environment.terrain.terrain.material as THREE.MeshStandardMaterial;
    material.wireframe = this.overlay === "chunks";
  }

  private createResourceOverlay() {
    this.resourceOverlay.name = "studio-resource-anchors";
    RESOURCE_ANCHORS.filter(({ stratumId }) => stratumId === "surface").forEach((anchor) => {
      const group = new THREE.Group(); group.name = `resource:${anchor.id}`;
      const color = anchor.medium === "fluid" ? 0xd98b48 : 0x67e8d1;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.2, 7, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }));
      beacon.position.y = 3.5;
      group.add(ring, beacon);
      group.position.set(anchor.position.x + 1, this.environment.sampler.heightAt(anchor.position.x + 1, anchor.position.z + 1) + 0.12, anchor.position.z + 1);
      this.resourceOverlay.add(group);
    });
  }

  private createChunkOverlay() {
    const size = A17_ENVIRONMENT.chunkSize;
    for (let z = -4; z < 4; z += 1) for (let x = -4; x < 4; x += 1) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.35, size - 0.35), new THREE.MeshBasicMaterial({ color: LOD_COLORS[2], transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x * size + size / 2, 0.22, z * size + size / 2);
      mesh.visible = false;
      this.chunkCells.set(`${x},${z}`, mesh);
      this.chunkOverlay.add(mesh);
    }
  }

  private createShadowOverlay() {
    const material = new THREE.LineBasicMaterial({ color: 0xffbd62, transparent: true, opacity: 0.9, depthTest: false });
    return new THREE.LineLoop(new THREE.BufferGeometry(), material);
  }
  private rebuildShadowOverlay() {
    const effectiveDistance = this.quality === "high" ? this.shadowDistance : Math.min(this.shadowDistance, 24);
    const points = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * effectiveDistance, 0, Math.sin(angle) * effectiveDistance);
    });
    this.shadowOverlay.geometry.dispose();
    this.shadowOverlay.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }
  private applyOverlayVisibility() {
    this.resourceOverlay.visible = this.resourceAnchorsVisible && this.overlay === "resources";
    this.chunkOverlay.visible = this.overlay === "chunks";
    this.shadowOverlay.visible = this.overlay === "shadow";
  }
  private refreshDebugHeights() {
    this.resourceOverlay.children.forEach((group) => { group.position.y = this.environment.sampler.heightAt(group.position.x, group.position.z) + 0.12; });
  }
  private updateChunkOverlay() {
    if (!this.chunkOverlay.visible) return;
    const active = new Map(this.environment.chunks.snapshot().map((chunk) => [`${chunk.x},${chunk.z}`, chunk.lod]));
    this.chunkCells.forEach((mesh, id) => {
      const lod = active.get(id);
      mesh.visible = lod !== undefined;
      if (lod !== undefined) (mesh.material as THREE.MeshBasicMaterial).color.setHex(LOD_COLORS[lod]);
    });
  }

  private animate = (time: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min((time - this.lastTime) / 1000, 0.05); this.lastTime = time;
    this.frameAverage += ((delta * 1000) - this.frameAverage) * 0.08; this.statsClock += delta;
    this.controls.update();
    this.environment.update(delta, this.camera);
    this.shadowOverlay.position.set(this.camera.position.x, this.environment.sampler.heightAt(this.camera.position.x, this.camera.position.z) + 0.35, this.camera.position.z);
    this.updateChunkOverlay();
    this.renderer.render(this.scene, this.camera);
    if (this.statsClock >= 0.3) {
      this.statsClock = 0;
      const stats = this.environment.stats(this.renderer);
      this.onStats({ fps: Math.round(1000 / Math.max(1, this.frameAverage)), frameMs: Number(this.frameAverage.toFixed(1)), ...stats });
    }
  };
}
