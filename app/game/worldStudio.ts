import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { A17_ENVIRONMENT, BIOMES, EnvironmentRenderer } from "./environment/index.ts";
import type { SurfaceType } from "./environment/types.ts";
import type { WeatherKind } from "./environment/render/WeatherSystem.ts";

export type WorldStudioBrush = "raise" | "lower" | "flatten" | "smooth" | "biome" | "surface";
export type WorldStudioOverlay = "none" | "biome" | "surface" | "buildability" | "chunks";
export type WorldStudioView = "overview" | "firstPerson" | "distance" | "caveCutaway";

export type WorldStudioStroke = Readonly<{
  brush: WorldStudioBrush;
  x: number;
  z: number;
  radius: number;
  strength: number;
  biomeId?: string;
  surface?: SurfaceType;
}>;

export type WorldStudioDocument = Readonly<{
  format: "factoryx-world-studio";
  version: 1;
  environmentId: string;
  environmentVersion: number;
  seed: number;
  strokes: readonly WorldStudioStroke[];
  timeOfDay: number;
  fogDensity: number;
  weather: WeatherKind;
  weatherStrength: number;
}>;

export type WorldStudioStats = Readonly<{
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  activeChunks: number;
  visibleProps: number;
}>;

const SURFACE_COLORS: Readonly<Record<SurfaceType, number>> = {
  stable: 0x52d7c5,
  soft: 0xe7a34d,
  steep: 0xeb654f,
  submerged: 0x4f8fbd,
  hazard: 0xd74968,
  cave_floor: 0xa98ac0,
};

export class WorldStudioRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly environment: EnvironmentRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly brushCursor: THREE.Mesh;
  private animationId = 0;
  private lastTime = performance.now();
  private statsClock = 0;
  private frameAverage = 16.7;
  private strokes: WorldStudioStroke[] = [];
  private brush: WorldStudioBrush = "raise";
  private brushRadius = 8;
  private brushStrength = 0.6;
  private biomeId = BIOMES[0].id as string;
  private surface: SurfaceType = "stable";
  private overlay: WorldStudioOverlay = "none";
  private pointerPainting = false;
  private timeOfDay = 0.68;
  private fogDensity = 0.0085;
  private weather: WeatherKind = "mineral_wind";
  private weatherStrength = 0.34;

  constructor(
    private readonly mount: HTMLDivElement,
    private readonly onStats: (stats: WorldStudioStats) => void,
  ) {
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
    this.bindEvents();
    this.resize();
    this.animate(performance.now());
  }

  setBrush(brush: WorldStudioBrush) { this.brush = brush; }
  setBrushRadius(radius: number) {
    this.brushRadius = THREE.MathUtils.clamp(radius, 1, 24);
    this.brushCursor.scale.setScalar(this.brushRadius);
  }
  setBrushStrength(strength: number) { this.brushStrength = THREE.MathUtils.clamp(strength, 0.05, 2); }
  setBiome(id: string) { if (BIOMES.some((biome) => biome.id === id)) this.biomeId = id; }
  setSurface(surface: SurfaceType) { this.surface = surface; }
  setPropsVisible(visible: boolean) { this.environment.setPropsVisible(visible); }
  setLandmarksVisible(visible: boolean) { this.environment.setLandmarksVisible(visible); }
  setTimeOfDay(value: number) {
    this.timeOfDay = THREE.MathUtils.clamp(value, 0, 1);
    this.environment.setTimeOfDay(this.timeOfDay);
  }
  setFogDensity(value: number) {
    this.fogDensity = THREE.MathUtils.clamp(value, 0, 0.04);
    this.environment.setFogDensity(this.fogDensity);
  }
  setWeather(weather: WeatherKind, strength = this.weatherStrength) {
    this.weather = weather;
    this.weatherStrength = THREE.MathUtils.clamp(strength, 0, 1);
    this.environment.setWeather(weather, this.weatherStrength);
  }
  setOverlay(overlay: WorldStudioOverlay) {
    this.overlay = overlay;
    this.refreshTerrainColors();
  }
  setView(view: WorldStudioView) {
    const views: Readonly<Record<WorldStudioView, readonly [THREE.Vector3Tuple, THREE.Vector3Tuple]>> = {
      overview: [[48, 54, 52], [0, 0, 0]],
      firstPerson: [[0, 1.7, 10], [0, 1.5, 0]],
      distance: [[112, 72, 118], [0, 5, 0]],
      caveCutaway: [[45, 20, 112], [7, -10, 105]],
    };
    const [position, target] = views[view];
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.environment.setCaveCutaway(view === "caveCutaway");
    this.controls.maxPolarAngle = view === "caveCutaway" ? Math.PI * 0.8 : Math.PI * 0.49;
    this.controls.update();
  }

  exportDocument(): WorldStudioDocument {
    return {
      format: "factoryx-world-studio",
      version: 1,
      environmentId: A17_ENVIRONMENT.id,
      environmentVersion: A17_ENVIRONMENT.version,
      seed: A17_ENVIRONMENT.seed,
      strokes: this.strokes.map((stroke) => ({ ...stroke })),
      timeOfDay: this.timeOfDay,
      fogDensity: this.fogDensity,
      weather: this.weather,
      weatherStrength: this.weatherStrength,
    };
  }

  importDocument(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const document = value as Partial<WorldStudioDocument>;
    if (document.format !== "factoryx-world-studio" || document.version !== 1
      || document.environmentId !== A17_ENVIRONMENT.id || !Array.isArray(document.strokes)) return false;
    this.resetTerrain();
    this.strokes = [];
    for (const stroke of document.strokes) {
      if (!stroke || typeof stroke !== "object" || typeof stroke.x !== "number" || typeof stroke.z !== "number"
        || typeof stroke.radius !== "number" || typeof stroke.strength !== "number") continue;
      this.applyStroke(stroke as WorldStudioStroke, false);
    }
    if (typeof document.timeOfDay === "number") this.setTimeOfDay(document.timeOfDay);
    if (typeof document.fogDensity === "number") this.setFogDensity(document.fogDensity);
    if (document.weather === "clear" || document.weather === "mineral_wind" || document.weather === "mist") {
      this.setWeather(document.weather, document.weatherStrength);
    }
    this.refreshTerrainColors();
    return true;
  }

  reset() {
    this.strokes = [];
    this.resetTerrain();
    this.refreshTerrainColors();
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.controls.dispose();
    this.environment.dispose();
    this.brushCursor.geometry.dispose();
    (this.brushCursor.material as THREE.Material).dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) this.mount.removeChild(this.renderer.domElement);
  }

  private bindEvents() {
    window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private resize = () => {
    const width = this.mount.clientWidth;
    const height = Math.max(1, this.mount.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

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
  private onPointerUp = () => {
    this.pointerPainting = false;
    this.controls.enabled = true;
  };

  private paint(x: number, z: number) {
    const previous = this.strokes.at(-1);
    if (previous && previous.brush === this.brush && Math.hypot(previous.x - x, previous.z - z) < this.brushRadius * 0.18) return;
    this.applyStroke({ brush: this.brush, x, z, radius: this.brushRadius, strength: this.brushStrength, biomeId: this.biomeId, surface: this.surface }, true);
  }

  private applyStroke(stroke: WorldStudioStroke, record: boolean) {
    if (record) this.strokes.push({ ...stroke });
    else this.strokes.push({ ...stroke });
    const geometry = this.environment.terrain.terrain.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    if (["raise", "lower", "flatten", "smooth"].includes(stroke.brush)) {
      const targetHeight = this.heightNear(stroke.x, stroke.z, positions);
      for (let index = 0; index < positions.count; index += 1) {
        const dx = positions.getX(index) - stroke.x;
        const dz = positions.getZ(index) - stroke.z;
        const distance = Math.hypot(dx, dz);
        if (distance > stroke.radius) continue;
        const falloff = Math.pow(1 - distance / stroke.radius, 2);
        const current = positions.getY(index);
        let next = current;
        if (stroke.brush === "raise") next += stroke.strength * falloff;
        if (stroke.brush === "lower") next -= stroke.strength * falloff;
        if (stroke.brush === "flatten") next = THREE.MathUtils.lerp(current, targetHeight, Math.min(1, stroke.strength * falloff));
        if (stroke.brush === "smooth") next = THREE.MathUtils.lerp(current, this.environment.sampler.heightAt(positions.getX(index), positions.getZ(index)), Math.min(1, stroke.strength * falloff * 0.45));
        positions.setY(index, next);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    this.refreshTerrainColors();
  }

  private heightNear(x: number, z: number, positions: THREE.BufferAttribute) {
    let bestDistance = Number.POSITIVE_INFINITY;
    let height = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const distance = Math.hypot(positions.getX(index) - x, positions.getZ(index) - z);
      if (distance < bestDistance) { bestDistance = distance; height = positions.getY(index); }
    }
    return height;
  }

  private resetTerrain() {
    const geometry = this.environment.terrain.terrain.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, this.environment.sampler.heightAt(positions.getX(index), positions.getZ(index)));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  private refreshTerrainColors() {
    const geometry = this.environment.terrain.terrain.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const sample = this.environment.sampler.sample(x, z);
      let value = this.environment.sampler.colorAt(x, z);
      if (this.overlay === "surface") value = SURFACE_COLORS[sample.surface];
      if (this.overlay === "buildability") value = sample.buildability === "allowed" ? 0x43c98e : sample.buildability === "foundation_required" ? 0xe5a34a : 0xe05261;
      if (this.overlay === "chunks") value = ((Math.floor(x / 32) + Math.floor(z / 32)) & 1) === 0 ? 0x315b60 : 0x513f55;
      if (this.overlay === "biome") value = BIOMES.find(({ id }) => id === sample.biomeId)?.palette.accent ?? value;
      const paint = [...this.strokes].reverse().find((stroke) => Math.hypot(stroke.x - x, stroke.z - z) <= stroke.radius && (stroke.brush === "biome" || stroke.brush === "surface"));
      if (paint?.brush === "biome") value = BIOMES.find(({ id }) => id === paint.biomeId)?.palette.ground ?? value;
      if (paint?.brush === "surface" && paint.surface) value = SURFACE_COLORS[paint.surface];
      color.setHex(value);
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    const material = this.environment.terrain.terrain.material as THREE.MeshStandardMaterial;
    material.wireframe = this.overlay === "chunks";
  }

  private animate = (time: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.frameAverage += ((delta * 1000) - this.frameAverage) * 0.08;
    this.statsClock += delta;
    this.controls.update();
    this.environment.update(delta, this.camera);
    this.renderer.render(this.scene, this.camera);
    if (this.statsClock >= 0.3) {
      this.statsClock = 0;
      const stats = this.environment.stats(this.renderer);
      this.onStats({
        fps: Math.round(1000 / Math.max(1, this.frameAverage)),
        frameMs: Number(this.frameAverage.toFixed(1)),
        ...stats,
      });
    }
  };
}
