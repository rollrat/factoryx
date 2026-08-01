import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createFactoryMaterials, createOrePatch, createStructureModel } from "./models";
import { animateMinerModel, createMinerModel } from "./models/miner";

export type MinerStudioMode = "working" | "idle" | "blocked" | "disconnected";
export type MinerStudioView = "threeQuarter" | "output" | "side" | "top";

export type MinerStudioStats = {
  meshes: number;
  triangles: number;
  materials: number;
};

type MinerStudioCallbacks = {
  onProgress: (progress: number) => void;
  onStats: (stats: MinerStudioStats) => void;
};

const VIEW_POSITIONS: Record<MinerStudioView, THREE.Vector3> = {
  threeQuarter: new THREE.Vector3(4.1, 3.05, 4.5),
  output: new THREE.Vector3(5.2, 1.75, -0.45),
  side: new THREE.Vector3(0.15, 1.8, 5.4),
  top: new THREE.Vector3(3.5, 5.5, 3.5),
};

export class MinerStudioRuntime {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  private readonly controls: OrbitControls;
  private readonly miner: THREE.Group;
  private readonly belt: THREE.Group;
  private readonly orePatch: THREE.Group;
  private readonly floor: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x101719 });
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: MinerStudioCallbacks;
  private animationId = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private reportElapsed = 0;
  private progress = 0;
  private activity = 1;
  private speed = 1;
  private playing = true;
  private mode: MinerStudioMode = "working";
  private gridEnabled = true;
  private contextEnabled = true;
  private silhouette = false;

  constructor(mount: HTMLElement, callbacks: MinerStudioCallbacks) {
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color(0x071116);
    this.scene.fog = new THREE.Fog(0x071116, 7.5, 16);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "채굴기 3D 디자인 미리보기");
    mount.appendChild(this.renderer.domElement);

    this.camera.position.copy(VIEW_POSITIONS.threeQuarter);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    const materials = createFactoryMaterials();
    this.miner = createMinerModel(materials);
    this.miner.position.set(0, 0.04, 0);
    this.scene.add(this.miner);

    this.orePatch = createOrePatch(materials);
    this.orePatch.position.set(-0.08, 0.025, 0.02);
    this.orePatch.scale.setScalar(0.62);
    this.scene.add(this.orePatch);

    this.belt = createStructureModel("belt", materials);
    this.belt.position.set(1.52, 0.04, -0.5);
    this.belt.rotation.y = Math.PI / 2;
    this.scene.add(this.belt);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.8, 64),
      new THREE.MeshStandardMaterial({ color: 0x13252a, metalness: 0.12, roughness: 0.84 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.grid = new THREE.GridHelper(10, 20, 0x31545b, 0x183239);
    this.grid.position.y = 0.012;
    this.scene.add(this.grid);

    const hemisphere = new THREE.HemisphereLight(0xbbe9ef, 0x16211d, 1.75);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff3df, 3.1);
    key.position.set(4.5, 7, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6debdc, 1.05);
    fill.position.set(-4, 3.5, 2);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff8b46, 7, 7, 2);
    rim.position.set(1.8, 2.5, -2.6);
    this.scene.add(rim);

    callbacks.onStats(this.collectStats());
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(mount);
    this.resize();
    this.animationId = requestAnimationFrame(this.animate);
  }

  setMode(mode: MinerStudioMode) {
    this.mode = mode;
    if (mode !== "working") this.playing = false;
    if (mode === "blocked") this.progress = 0;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    if (playing) this.mode = "working";
  }

  setProgress(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
  }

  setSpeed(speed: number) {
    this.speed = THREE.MathUtils.clamp(speed, 0.25, 2);
  }

  setGridVisible(visible: boolean) {
    this.gridEnabled = visible;
    this.grid.visible = visible && !this.silhouette;
  }

  setContextVisible(visible: boolean) {
    this.contextEnabled = visible;
    this.orePatch.visible = visible && !this.silhouette;
    this.belt.visible = visible && !this.silhouette;
  }

  setSilhouette(enabled: boolean) {
    this.silhouette = enabled;
    this.scene.overrideMaterial = enabled ? this.silhouetteMaterial : null;
    this.scene.background = new THREE.Color(enabled ? 0xdbe4e2 : 0x071116);
    this.scene.fog = enabled ? null : new THREE.Fog(0x071116, 7.5, 16);
    this.floor.visible = !enabled;
    this.grid.visible = this.gridEnabled && !enabled;
    this.orePatch.visible = this.contextEnabled && !enabled;
    this.belt.visible = this.contextEnabled && !enabled;
  }

  setView(view: MinerStudioView) {
    this.camera.position.copy(VIEW_POSITIONS[view]);
    this.controls.target.set(0, 1.05, 0);
    this.controls.update();
  }

  private collectStats(): MinerStudioStats {
    let meshes = 0;
    let triangles = 0;
    const materials = new Set<THREE.Material>();
    this.miner.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      meshes += 1;
      const geometry = part.geometry;
      const instanceCount = part instanceof THREE.InstancedMesh ? part.count : 1;
      const geometryTriangles = geometry.index
        ? geometry.index.count / 3
        : geometry.attributes.position.count / 3;
      triangles += geometryTriangles * instanceCount;
      const meshMaterials = Array.isArray(part.material) ? part.material : [part.material];
      meshMaterials.forEach((material) => materials.add(material));
    });
    return { meshes, triangles: Math.round(triangles), materials: materials.size };
  }

  private resize = () => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private animate = (now: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.reportElapsed += delta;

    const targetActivity = this.mode === "working" ? 1 : 0;
    this.activity += (targetActivity - this.activity) * (1 - Math.exp(-delta * 8));
    if (this.playing && this.mode === "working") {
      this.progress = (this.progress + (delta / 2.1) * this.speed) % 1;
      this.elapsed += delta * this.activity;
    }

    animateMinerModel(this.miner, {
      time: this.elapsed,
      delta,
      progress: this.progress,
      activity: this.activity,
      working: this.mode === "working",
      outputQueued: this.mode === "blocked",
      outputConnected: this.mode !== "disconnected",
    });

    if (this.reportElapsed >= 0.08) {
      this.callbacks.onProgress(this.progress);
      this.reportElapsed = 0;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      geometries.add(part.geometry);
      const meshMaterials = Array.isArray(part.material) ? part.material : [part.material];
      meshMaterials.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.grid.geometry.dispose();
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    gridMaterials.forEach((material) => material.dispose());
    this.silhouetteMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
