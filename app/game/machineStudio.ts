import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MachineType } from "./types";
import {
  createFactoryMaterials,
  createItemModel,
  createOrePatch,
  createStructureModel,
} from "./models";
import { animateMinerModel } from "./models/miner";
import { animateSmelterModel } from "./models/smelter";
import { animateAssemblerModel } from "./models/assembler";
import { animateStorageModel } from "./models/storage";
import { triangleCount } from "./models/shared";

export type MachineStudioMode = "working" | "idle" | "blocked" | "disconnected";
export type MachineStudioView = "threeQuarter" | "output" | "side" | "top";
export type MachineStudioStats = ReturnType<typeof triangleCount>;

type MachineStudioCallbacks = {
  onProgress: (progress: number) => void;
  onStats: (stats: MachineStudioStats) => void;
};

const PROCESS_TIME: Record<MachineType, number> = {
  miner: 2.1,
  smelter: 2.7,
  assembler: 3.4,
  storage: 6,
};

const VIEW_POSITIONS: Record<MachineStudioView, THREE.Vector3> = {
  threeQuarter: new THREE.Vector3(4.1, 3.05, 4.5),
  output: new THREE.Vector3(5.2, 1.75, -0.45),
  side: new THREE.Vector3(0.15, 1.8, 5.4),
  top: new THREE.Vector3(3.5, 5.5, 3.5),
};

const INPUT_COUNT: Record<MachineType, number> = {
  miner: 0,
  smelter: 1,
  assembler: 2,
  storage: 0,
};

export class MachineStudioRuntime {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  private readonly controls: OrbitControls;
  private readonly models: Record<MachineType, THREE.Group>;
  private readonly contextEntries: Array<{ object: THREE.Object3D; machines: MachineType[] }> = [];
  private readonly floor: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x101719 });
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: MachineStudioCallbacks;
  private animationId = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private reportElapsed = 0;
  private progress = 0;
  private activity = 1;
  private speed = 1;
  private playing = true;
  private mode: MachineStudioMode = "working";
  private machine: MachineType = "miner";
  private gridEnabled = true;
  private contextEnabled = true;
  private silhouette = false;
  private storagePulse = 0;
  private previousPreviewStored = 0;

  constructor(mount: HTMLElement, callbacks: MachineStudioCallbacks) {
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
    this.renderer.domElement.setAttribute("aria-label", "공장 설비 3D 디자인 미리보기");
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
    this.models = {
      miner: createStructureModel("miner", materials),
      smelter: createStructureModel("smelter", materials),
      assembler: createStructureModel("assembler", materials),
      storage: createStructureModel("storage", materials),
    };
    Object.entries(this.models).forEach(([type, model]) => {
      model.position.y = 0.04;
      model.visible = type === this.machine;
      this.scene.add(model);
    });

    const orePatch = createOrePatch(materials);
    orePatch.position.set(-0.08, 0.065, 0.02);
    orePatch.scale.setScalar(0.62);
    this.addContext(orePatch, ["miner"]);

    const inputBelt = createStructureModel("belt", materials);
    inputBelt.position.set(-1.52, 0.04, -0.5);
    inputBelt.rotation.y = Math.PI / 2;
    this.addContext(inputBelt, ["smelter", "assembler", "storage"]);

    const secondaryInputBelt = createStructureModel("belt", materials);
    secondaryInputBelt.position.set(-1.52, 0.04, 0.5);
    secondaryInputBelt.rotation.y = Math.PI / 2;
    this.addContext(secondaryInputBelt, ["assembler"]);

    const outputBelt = createStructureModel("belt", materials);
    outputBelt.position.set(1.52, 0.04, -0.5);
    outputBelt.rotation.y = Math.PI / 2;
    this.addContext(outputBelt, ["miner", "smelter", "assembler"]);

    const ore = createItemModel("ore", materials);
    ore.position.set(-1.55, 0.53, -0.5);
    this.addContext(ore, ["smelter"]);

    const ingotA = createItemModel("ingot", materials);
    ingotA.position.set(-1.55, 0.53, -0.5);
    this.addContext(ingotA, ["assembler"]);
    const ingotB = createItemModel("ingot", materials);
    ingotB.position.set(-1.55, 0.53, 0.5);
    this.addContext(ingotB, ["assembler"]);

    const component = createItemModel("component", materials);
    component.position.set(-1.55, 0.53, -0.5);
    this.addContext(component, ["storage"]);

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

    this.updateContextVisibility();
    callbacks.onStats(triangleCount(this.models[this.machine]));
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(mount);
    this.resize();
    this.animationId = requestAnimationFrame(this.animate);
  }

  private addContext(object: THREE.Object3D, machines: MachineType[]) {
    this.contextEntries.push({ object, machines });
    this.scene.add(object);
  }

  setMachine(machine: MachineType) {
    this.models[this.machine].visible = false;
    this.machine = machine;
    this.models[this.machine].visible = true;
    this.renderer.domElement.setAttribute("aria-label", `${machine} 3D 디자인 미리보기`);
    this.elapsed = 0;
    this.storagePulse = 0;
    this.previousPreviewStored = 0;
    this.updateContextVisibility();
    this.callbacks.onStats(triangleCount(this.models[this.machine]));
  }

  setMode(mode: MachineStudioMode) {
    this.mode = mode;
    if (mode !== "working") this.playing = false;
    if (mode === "blocked") this.progress = this.machine === "storage" ? 1 : 0;
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
    this.updateContextVisibility();
  }

  setSilhouette(enabled: boolean) {
    this.silhouette = enabled;
    this.scene.overrideMaterial = enabled ? this.silhouetteMaterial : null;
    this.scene.background = new THREE.Color(enabled ? 0xdbe4e2 : 0x071116);
    this.scene.fog = enabled ? null : new THREE.Fog(0x071116, 7.5, 16);
    this.floor.visible = !enabled;
    this.grid.visible = this.gridEnabled && !enabled;
    this.updateContextVisibility();
  }

  setView(view: MachineStudioView) {
    this.camera.position.copy(VIEW_POSITIONS[view]);
    this.controls.target.set(0, this.machine === "storage" ? 1.1 : 1.02, 0);
    this.controls.update();
  }

  private updateContextVisibility() {
    this.contextEntries.forEach(({ object, machines }) => {
      object.visible = this.contextEnabled && !this.silhouette && machines.includes(this.machine);
    });
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
      this.progress = (this.progress + (delta / PROCESS_TIME[this.machine]) * this.speed) % 1;
      this.elapsed += delta * this.activity;
    }

    const model = this.models[this.machine];
    const working = this.mode === "working";
    const outputQueued = this.mode === "blocked" && this.machine !== "storage";
    const inputConnected = this.mode !== "disconnected";
    const outputConnected = this.mode !== "disconnected";

    if (this.machine === "miner") {
      animateMinerModel(model, {
        time: this.elapsed,
        delta,
        progress: this.progress,
        activity: this.activity,
        working,
        outputQueued,
        outputConnected,
      });
    }
    if (this.machine === "smelter") {
      animateSmelterModel(model, {
        time: this.elapsed,
        delta,
        progress: this.progress,
        activity: this.activity,
        working,
        inputCount: working ? INPUT_COUNT.smelter : 0,
        outputQueued,
        inputConnected,
        outputConnected,
      });
    }
    if (this.machine === "assembler") {
      animateAssemblerModel(model, {
        time: this.elapsed,
        delta,
        progress: this.progress,
        activity: this.activity,
        working,
        inputCount: working ? INPUT_COUNT.assembler : 0,
        outputQueued,
        inputConnected,
        outputConnected,
      });
    }
    if (this.machine === "storage") {
      const stored = this.mode === "blocked"
        ? 400
        : this.mode === "idle" ? 0 : Math.round(this.progress * 24);
      if (working && stored > this.previousPreviewStored) this.storagePulse = 1;
      this.previousPreviewStored = stored;
      this.storagePulse = Math.max(0, this.storagePulse - delta / 0.42);
      animateStorageModel(model, {
        time: now / 1000,
        delta,
        stored,
        capacity: this.mode === "blocked" ? 400 : 24,
        intakePulse: this.storagePulse,
        inputConnected,
      });
    }

    model.traverse((part) => {
      const role = part.userData.animationRole as string | undefined;
      if ((role !== "inputPort" && role !== "outputPort") || !(part instanceof THREE.Mesh)) return;
      const connected = role === "inputPort" ? inputConnected : outputConnected;
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = connected ? 1.6 : 0.15;
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
