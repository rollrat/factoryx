import * as THREE from "three";
import { COST, STORAGE_CAPACITY, TYPE_NAME, cellKey, directionForRotation, machinePorts, sameDirection } from "./config";
import {
  createBuildingModel,
  createFactoryMaterials,
  createItemModel,
  createOrePatch,
  createStructureModel,
} from "./models";
import { animateMinerModel } from "./models/miner";
import { animateSmelterModel } from "./models/smelter";
import { animateAssemblerModel } from "./models/assembler";
import { animateStorageModel } from "./models/storage";
import { animateLogisticsModel } from "./models/logistics";
import { animateCrusherModel } from "./models/crusher";
import { animateGenericBuildingModel } from "./models/genericBuilding.ts";
import {
  animateDistributionPoleModel,
  animateFieldPowerCoreModel,
  createDistributionPoleModel,
  createFieldPowerCoreModel,
} from "./models/power";
import { animateProjectDockModel, createProjectDockModel } from "./models/projectDock";
import { applyGridVisualState, removeGridVisualState } from "./models/gridState";
import { CAMPAIGN_START_INVENTORY, START_REGISTRY } from "./data/index.ts";
import { FactorySimulation } from "./simulation";
import type { DataDrivenWorld } from "./sim/world.ts";
import { CampaignWorldRuntime, type PowerInstanceOverride } from "./sim/campaignWorld.ts";
import {
  createFactoryRuntimeSaveStorage,
  type FactoryRuntimeSnapshot,
} from "./visualPersistence.ts";
import { buildLiveTelemetry } from "./telemetry/live.ts";
import { buildRuntimeTopology } from "./telemetry/topology.ts";
import type {
  BuildingId,
  BuildType,
  CameraMode,
  Cell,
  GameCallbacks,
  HistoryEntry,
  StructureData,
  Tool,
} from "./types";

const isTransportType = (type: BuildType) => type === "belt" || type === "splitter" || type === "merger";

const modelPosition = (type: BuildType, x: number, z: number) =>
  isTransportType(type)
    ? new THREE.Vector3(x, 0, z)
    : new THREE.Vector3(x + 0.5, 0, z + 0.5);

const legacyTypeForBuilding = (buildingId: BuildingId): BuildType => {
  if (buildingId.startsWith("conveyor_") || buildingId === "pipe_mk1") return "belt";
  if (buildingId === "splitter" || buildingId === "pipe_t_junction") return "splitter";
  if (buildingId === "merger") return "merger";
  if (buildingId === "vein_miner" || buildingId === "fluid_extractor") return "miner";
  if (["arc_smelter", "alloy_furnace", "electrolytic_reducer"].includes(buildingId)) return "smelter";
  if (buildingId === "crusher") return "crusher";
  if (buildingId.includes("storage") || buildingId === "fluid_tank" || buildingId === "industrial_accumulator") return "storage";
  return "assembler";
};

const defaultBuildingForLegacyType = (type: BuildType): BuildingId => ({
  belt: "conveyor_mk1",
  splitter: "splitter",
  merger: "merger",
  miner: "vein_miner",
  smelter: "arc_smelter",
  crusher: "crusher",
  assembler: "hydraulic_former",
  storage: "small_storage",
})[type];

export class FactoryRuntime {
  private readonly scene = new THREE.Scene();
  private readonly powerCoreGroup: THREE.Group;
  private readonly powerPoleGroup: THREE.Group;
  private readonly projectDockGroup: THREE.Group;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 120);
  private readonly firstPersonCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  private readonly materials = createFactoryMaterials();
  private readonly simulation: FactorySimulation;
  private readonly world: DataDrivenWorld;
  private readonly campaignWorld: CampaignWorldRuntime;
  private readonly saveStorage: ReturnType<typeof createFactoryRuntimeSaveStorage>;
  private readonly groups = new Map<number, THREE.Group>();
  private readonly itemMeshes = new Map<number, THREE.Group>();
  private readonly history: HistoryEntry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly pressed = new Set<string>();
  private readonly hoverTile: THREE.Mesh;
  private readonly ghostMaterialValid = new THREE.MeshStandardMaterial({
    color: 0x65f2dc,
    emissive: 0x1c7c72,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  private readonly ghostMaterialInvalid = new THREE.MeshStandardMaterial({
    color: 0xff6174,
    emissive: 0x8a1525,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  private readonly ghostDirectionValid = new THREE.MeshStandardMaterial({
    color: 0xd7fff9,
    emissive: 0x36dcc7,
    emissiveIntensity: 2.4,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  private readonly ghostDirectionInvalid = new THREE.MeshStandardMaterial({
    color: 0xffc1c9,
    emissive: 0xff4058,
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  private nextId = 1;
  private credits = 1200;
  private selectedId: number | null = null;
  private activeTool: Tool = "inspect";
  private rotation = 0;
  private currentCell: Cell = { x: 0, z: 0 };
  private ghost: THREE.Group | null = null;
  private ghostType: BuildType | null = null;
  private ghostBuildingId: BuildingId | null = null;
  private selectedBuildingId: BuildingId | null = null;
  private ghostValid = false;
  private beltStart: Cell | null = null;
  private beltPreview: THREE.Group | null = null;
  private beltPreviewCells: Array<Cell & { rotation: number }> = [];
  private beltBuildSignature = "";
  private panning = false;
  private capturedPointerId: number | null = null;
  private inputLocked = false;
  private panOrigin = { x: 0, y: 0 };
  private pointerDown = { x: 0, y: 0 };
  private cameraAngle = Math.PI * 0.25;
  private desiredCameraAngle = this.cameraAngle;
  private cameraAngularVelocity = 0;
  private cameraZoom = 1;
  private cameraMode: CameraMode = "overview";
  private readonly cameraTarget = new THREE.Vector3(0, 0, 0);
  private readonly desiredTarget = new THREE.Vector3(0, 0, 0);
  private readonly playerPosition = new THREE.Vector3(0, 1.62, 5.5);
  private readonly playerVelocity = new THREE.Vector3();
  private firstPersonYaw = 0;
  private firstPersonPitch = -0.08;
  private animationId = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private lastPowerSignature = "";
  private lastProjectSignature = "";
  private lastMotorCount = -1;
  private selectedUiClock = 0;
  private lastAutoSaveTime = 0;

  constructor(
    private readonly mount: HTMLDivElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.saveStorage = createFactoryRuntimeSaveStorage(window.localStorage);
    const loaded = this.saveStorage.load();
    const restored = loaded.ok ? loaded.value?.snapshot ?? null : null;
    this.simulation = new FactorySimulation(24, restored?.simulation);
    this.campaignWorld = new CampaignWorldRuntime({
      registry: START_REGISTRY,
      bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
      constructionInventory: CAMPAIGN_START_INVENTORY,
      ...(restored?.campaignWorld
        ? { snapshot: restored.campaignWorld }
        : restored?.world ? { worldSnapshot: restored.world } : {}),
    });
    this.world = this.campaignWorld.world;
    if (restored && !restored.world && !restored.campaignWorld) this.rebuildWorldFromLegacySave();
    if (restored) {
      this.credits = restored.credits;
      this.nextId = restored.nextId;
      this.cameraMode = restored.cameraMode;
      this.cameraAngle = restored.cameraAngle;
      this.desiredCameraAngle = restored.cameraAngle;
      this.cameraZoom = restored.cameraZoom;
      this.cameraTarget.fromArray(restored.cameraTarget);
      this.desiredTarget.fromArray(restored.cameraTarget);
      this.playerPosition.fromArray(restored.playerPosition);
      this.firstPersonYaw = restored.firstPersonYaw;
      this.firstPersonPitch = restored.firstPersonPitch;
    }
    this.scene.background = new THREE.Color(0x071419);
    this.scene.fog = new THREE.FogExp2(0x071419, 0.027);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-label", "Factory X 3D 건설 영역");
    this.renderer.domElement.tabIndex = 0;
    this.mount.appendChild(this.renderer.domElement);

    this.hoverTile = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.035, 0.94),
      new THREE.MeshBasicMaterial({ color: 0x5de4d1, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.hoverTile.position.y = 0.035;

    const powerModels = this.setupWorld();
    this.powerCoreGroup = powerModels.core;
    this.powerPoleGroup = powerModels.pole;
    this.projectDockGroup = powerModels.projectDock;
    if (restored) this.simulation.structures.forEach((structure) => this.mountStructure(structure));
    this.bindEvents();
    this.resize();
    this.updateCamera();
    this.callbacks.onCredits(this.credits);
    this.publishPower();
    this.publishProject();
    this.publishConstructionState();
    this.callbacks.onMotors(0);
    this.callbacks.onCameraMode(this.cameraMode);
    this.callbacks.onPointerLock(false);
    this.updateBeltBuildInfo(false);
    this.animate(performance.now());
  }

  setTool(tool: Tool) {
    if (this.inputLocked) return;
    this.activeTool = tool;
    this.selectedBuildingId = null;
    this.callbacks.onToolChange(tool);
    this.beltStart = null;
    if (this.beltPreview) this.scene.remove(this.beltPreview);
    this.beltPreview = null;
    this.beltPreviewCells = [];
    this.updateBeltBuildInfo(false);
    this.renderer.domElement.style.cursor =
      tool === "demolish" ? "not-allowed" : tool === "inspect" ? "default" : "crosshair";
    this.updateGhost();
  }

  selectBuilding(buildingId: BuildingId) {
    const definition = START_REGISTRY.buildings.get(buildingId);
    if (!definition || definition.placementMode !== "buildable") {
      this.callbacks.onToast("건설할 수 없는 설비입니다");
      return false;
    }
    if (!this.world.snapshot().unlockedIds.includes(definition.unlockId)) {
      this.callbacks.onToast("아직 해금되지 않은 설비입니다");
      return false;
    }
    const type = legacyTypeForBuilding(buildingId);
    this.setTool(type);
    this.selectedBuildingId = buildingId;
    this.updateGhost();
    this.callbacks.onToast(`${definition.name} 배치 · R 회전`);
    return true;
  }

  /** Suspends every world/camera command while a modal UI owns player input. */
  setInputLocked(locked: boolean) {
    if (this.inputLocked === locked) return;
    this.inputLocked = locked;
    this.pressed.clear();
    this.playerVelocity.set(0, 0, 0);

    if (locked) {
      if (this.capturedPointerId !== null && this.renderer.domElement.hasPointerCapture(this.capturedPointerId)) {
        this.renderer.domElement.releasePointerCapture(this.capturedPointerId);
      }
      this.capturedPointerId = null;
      this.panning = false;
      this.beltStart = null;
      if (this.beltPreview) this.scene.remove(this.beltPreview);
      this.beltPreview = null;
      this.beltPreviewCells = [];
      this.clearGhost();
      this.hoverTile.visible = false;
      this.updateBeltBuildInfo(false);
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      this.renderer.domElement.style.cursor = "default";
      return;
    }

    this.hoverTile.visible = this.cameraMode === "overview";
    this.renderer.domElement.style.cursor = this.cameraMode === "firstPerson"
      ? "crosshair"
      : this.activeTool === "demolish" ? "not-allowed" : this.activeTool === "inspect" ? "default" : "crosshair";
    if (this.cameraMode === "overview") this.updateGhost();
  }

  getLiveTelemetry() {
    return buildLiveTelemetry(this.simulation);
  }

  getProductionTopology() {
    return buildRuntimeTopology(this.simulation);
  }

  toggleCameraMode() {
    if (this.inputLocked) return;
    if (this.cameraMode === "overview") {
      this.cameraMode = "firstPerson";
      this.setTool("inspect");
      this.selectStructure(null);
      this.hoverTile.visible = false;
      this.clearGhost();
      this.renderer.domElement.style.cursor = "crosshair";
      this.callbacks.onToast("1인칭 탐험 모드 · 화면을 클릭해 둘러보세요");
    } else {
      this.cameraMode = "overview";
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      this.hoverTile.visible = true;
      this.renderer.domElement.style.cursor = "default";
      this.callbacks.onToast("건설 시점으로 돌아왔습니다");
    }
    this.callbacks.onCameraMode(this.cameraMode);
  }

  dispose() {
    this.save(false);
    cancelAnimationFrame(this.animationId);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener("wheel", this.onWheel);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("mousemove", this.onFirstPersonLook);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) this.mount.removeChild(this.renderer.domElement);
  }

  private setupWorld() {
    this.scene.add(new THREE.HemisphereLight(0xbdefff, 0x142328, 2.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 4.3);
    sun.position.set(-12, 22, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(27, 0.45, 27),
      new THREE.MeshStandardMaterial({ color: 0x16272c, roughness: 0.88, metalness: 0.18 }),
    );
    platform.position.y = -0.27;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const underGlow = new THREE.Mesh(
      new THREE.BoxGeometry(27.4, 0.18, 27.4),
      new THREE.MeshBasicMaterial({ color: 0x173d42 }),
    );
    underGlow.position.y = -0.51;
    this.scene.add(underGlow);

    const grid = new THREE.GridHelper(26, 26, 0x4c7a7e, 0x29474d);
    grid.position.y = 0.012;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.38;
    });
    this.scene.add(grid);

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x274249,
      emissive: 0x0a2528,
      emissiveIntensity: 0.8,
      metalness: 0.55,
      roughness: 0.35,
    });
    const horizontal = new THREE.BoxGeometry(27.7, 0.3, 0.28);
    const vertical = new THREE.BoxGeometry(0.28, 0.3, 27.7);
    [
      new THREE.Mesh(horizontal, edgeMaterial),
      new THREE.Mesh(horizontal, edgeMaterial),
      new THREE.Mesh(vertical, edgeMaterial),
      new THREE.Mesh(vertical, edgeMaterial),
    ].forEach((edge, index) => {
      if (index < 2) edge.position.set(0, 0.08, index === 0 ? -13.65 : 13.65);
      else edge.position.set(index === 2 ? -13.65 : 13.65, 0.08, 0);
      edge.castShadow = true;
      this.scene.add(edge);
    });

    const ironPatch = createOrePatch(this.materials);
    ironPatch.position.set(-7.5, 0, -2.5);
    this.scene.add(ironPatch);
    const copperPatch = createOrePatch(this.materials, true);
    copperPatch.position.set(7.5, 0, 4.5);
    this.scene.add(copperPatch);
    const limestonePatch = createOrePatch(this.materials, false, true);
    limestonePatch.position.set(-6.5, 0, 7.5);
    this.scene.add(limestonePatch);
    const core = createFieldPowerCoreModel(this.materials);
    core.position.set(9.5, 0, -9.5);
    this.scene.add(core);
    const pole = createDistributionPoleModel(this.materials);
    pole.position.set(7.5, 0, -9.5);
    this.scene.add(pole);
    const projectDock = createProjectDockModel(this.materials);
    projectDock.position.set(8.5, 0, 8.5);
    this.scene.add(projectDock);
    this.scene.add(this.hoverTile);
    return { core, pole, projectDock };
  }

  private seedFactory() {
    const seed: Array<Omit<StructureData, "id">> = [
      { type: "miner", x: -8, z: -3, rotation: 0 },
      { type: "belt", x: -6, z: -3, rotation: 1 },
      { type: "belt", x: -5, z: -3, rotation: 1 },
      { type: "belt", x: -4, z: -3, rotation: 1 },
      { type: "belt", x: -3, z: -3, rotation: 1 },
      { type: "smelter", x: -2, z: -3, rotation: 0 },
      { type: "belt", x: 0, z: -3, rotation: 1 },
      { type: "belt", x: 1, z: -3, rotation: 1 },
      { type: "assembler", x: 2, z: -3, rotation: 0 },
      { type: "belt", x: 4, z: -3, rotation: 1 },
      { type: "storage", x: 5, z: -3, rotation: 0 },
    ];
    seed.forEach((data) => this.addStructure({ ...data, id: this.nextId++ }));
  }

  private addStructure(data: StructureData) {
    this.simulation.addStructure(data);
    this.mountStructure(data);
    this.nextId = Math.max(this.nextId, data.id + 1);
    return data;
  }

  private mountStructure(data: StructureData) {
    const group = data.buildingId
      ? createBuildingModel(data.buildingId, this.materials)
      : createStructureModel(data.type, this.materials);
    const definition = data.buildingId ? START_REGISTRY.buildings.get(data.buildingId) : null;
    group.position.copy(definition
      ? new THREE.Vector3(data.x + definition.footprint.x / 2, 0, data.z + definition.footprint.z / 2)
      : modelPosition(data.type, data.x, data.z));
    group.rotation.y = data.rotation * (Math.PI / 2);
    group.userData.structureId = data.id;
    group.traverse((child) => {
      child.userData.structureId = data.id;
    });
    this.groups.set(data.id, group);
    this.scene.add(group);
  }

  private removeStructure(id: number) {
    const data = this.simulation.removeStructure(id);
    const group = this.groups.get(id);
    if (group) {
      removeGridVisualState(group);
      this.scene.remove(group);
    }
    this.groups.delete(id);
    if (this.selectedId === id) this.selectStructure(null);
    return data;
  }

  private bindEvents() {
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("mousemove", this.onFirstPersonLook);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
  }

  private snapshot(): FactoryRuntimeSnapshot {
    return {
      version: 1,
      simulation: this.simulation.snapshot(),
      world: this.world.snapshot(),
      campaignWorld: this.campaignWorld.snapshot(),
      credits: this.credits,
      nextId: this.nextId,
      cameraMode: this.cameraMode,
      cameraAngle: this.cameraAngle,
      cameraZoom: this.cameraZoom,
      cameraTarget: this.cameraTarget.toArray(),
      playerPosition: this.playerPosition.toArray(),
      firstPersonYaw: this.firstPersonYaw,
      firstPersonPitch: this.firstPersonPitch,
    };
  }

  private rebuildWorldFromLegacySave() {
    const structures = [...this.simulation.structures.values()];
    const costs = new Map<string, number>();
    structures.forEach((structure) => {
      const buildingId = structure.buildingId ?? defaultBuildingForLegacyType(structure.type);
      START_REGISTRY.buildings.get(buildingId)?.buildCost.forEach(({ itemId, amount }) => {
        costs.set(itemId, (costs.get(itemId) ?? 0) + amount);
      });
    });
    this.world.grantItems([...costs].map(([itemId, amount]) => ({ itemId, amount })));
    structures.forEach((structure) => {
      const buildingId = structure.buildingId ?? defaultBuildingForLegacyType(structure.type);
      const placed = this.world.place({
        buildingId,
        position: { x: structure.x, z: structure.z },
        rotation: structure.rotation as 0 | 1 | 2 | 3,
      });
      if (!placed.ok) return;
      structure.buildingId = buildingId;
      structure.worldInstanceId = placed.instance.id;
    });
  }

  private publishConstructionState() {
    const snapshot = this.world.snapshot();
    this.callbacks.onConstructionState({
      unlockedIds: snapshot.unlockedIds,
      inventoryByItemId: Object.fromEntries(snapshot.constructionInventory.map(({ itemId, amount }) => [itemId, amount])),
    });
  }

  private save(paused: boolean) {
    const state = this.snapshot();
    return paused ? this.saveStorage.saveForPageHide(state) : this.saveStorage.save(state);
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "hidden") this.save(true);
    this.lastTime = performance.now();
  };

  private onPageHide = () => {
    this.save(true);
  };

  private resize = () => {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    const aspect = width / Math.max(height, 1);
    const viewHeight = 20;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.firstPersonCamera.aspect = aspect;
    this.firstPersonCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private updateCamera() {
    const distance = 23;
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(this.cameraAngle) * distance,
      18,
      this.cameraTarget.z + Math.cos(this.cameraAngle) * distance,
    );
    this.camera.lookAt(this.cameraTarget.x, 0, this.cameraTarget.z);
    this.camera.zoom = this.cameraZoom;
    this.camera.updateProjectionMatrix();
  }

  private get activeCamera(): THREE.Camera {
    return this.cameraMode === "firstPerson" ? this.firstPersonCamera : this.camera;
  }

  private canPlayerStand(position: THREE.Vector3) {
    const radius = 0.24;
    const samples = [
      [position.x - radius, position.z - radius],
      [position.x + radius, position.z - radius],
      [position.x - radius, position.z + radius],
      [position.x + radius, position.z + radius],
    ];
    return samples.every(([x, z]) => {
      if (Math.abs(x) > 12.45 || Math.abs(z) > 12.45) return false;
      const structure = this.simulation.getStructureAt(Math.round(x), Math.round(z));
      return !structure || structure.type === "belt";
    });
  }

  private updateFirstPerson(delta: number) {
    const forward = new THREE.Vector3(-Math.sin(this.firstPersonYaw), 0, -Math.cos(this.firstPersonYaw));
    const right = new THREE.Vector3(Math.cos(this.firstPersonYaw), 0, -Math.sin(this.firstPersonYaw));
    const movement = new THREE.Vector3();
    if (this.pressed.has("w")) movement.add(forward);
    if (this.pressed.has("s")) movement.sub(forward);
    if (this.pressed.has("d")) movement.add(right);
    if (this.pressed.has("a")) movement.sub(right);
    if (movement.lengthSq() > 0) movement.normalize();
    const speed = this.pressed.has("shift") ? 5.2 : 3.1;
    movement.multiplyScalar(speed);
    const damping = 1 - Math.exp(-delta * 12);
    this.playerVelocity.x += (movement.x - this.playerVelocity.x) * damping;
    this.playerVelocity.z += (movement.z - this.playerVelocity.z) * damping;

    const nextX = this.playerPosition.clone();
    nextX.x += this.playerVelocity.x * delta;
    if (this.canPlayerStand(nextX)) this.playerPosition.x = nextX.x;
    else this.playerVelocity.x = 0;
    const nextZ = this.playerPosition.clone();
    nextZ.z += this.playerVelocity.z * delta;
    if (this.canPlayerStand(nextZ)) this.playerPosition.z = nextZ.z;
    else this.playerVelocity.z = 0;

    const moving = movement.lengthSq() > 0.01;
    const headBob = moving ? Math.sin(this.elapsed * (this.pressed.has("shift") ? 13 : 9)) * 0.025 : 0;
    this.firstPersonCamera.position.set(this.playerPosition.x, this.playerPosition.y + headBob, this.playerPosition.z);
    this.firstPersonCamera.rotation.order = "YXZ";
    this.firstPersonCamera.rotation.set(this.firstPersonPitch, this.firstPersonYaw, 0);
  }

  private pointerToCell(event: PointerEvent | WheelEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) return null;
    return {
      x: THREE.MathUtils.clamp(Math.round(this.hitPoint.x), -12, 12),
      z: THREE.MathUtils.clamp(Math.round(this.hitPoint.z), -12, 12),
    };
  }

  private clearGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    this.ghostType = null;
    this.ghostBuildingId = null;
  }

  private recolorGhost(group: THREE.Group, valid: boolean) {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const role = child.userData.animationRole as string | undefined;
      if (role === "beltBuildArrow") child.visible = true;
      child.material = role === "beltBuildArrow" || role === "beltStatusLight"
        ? valid ? this.ghostDirectionValid : this.ghostDirectionInvalid
        : valid ? this.ghostMaterialValid : this.ghostMaterialInvalid;
    });
  }

  private updateGhost() {
    if (this.activeTool === "inspect" || this.activeTool === "demolish" || this.activeTool === "belt") {
      this.clearGhost();
      return;
    }
    const type = this.activeTool as BuildType;
    if (!this.ghost || this.ghostType !== type || this.ghostBuildingId !== this.selectedBuildingId) {
      this.clearGhost();
      this.ghost = this.selectedBuildingId
        ? createBuildingModel(this.selectedBuildingId, this.materials)
        : createStructureModel(type, this.materials);
      this.ghostType = type;
      this.ghostBuildingId = this.selectedBuildingId;
      this.scene.add(this.ghost);
    }
    this.ghostValid = this.selectedBuildingId
      ? this.world.previewPlace({
        buildingId: this.selectedBuildingId,
        position: { x: this.currentCell.x, z: this.currentCell.z },
        rotation: this.rotation as 0 | 1 | 2 | 3,
      }).ok
      : this.simulation.canPlace(type, this.currentCell.x, this.currentCell.z);
    const definition = this.selectedBuildingId ? START_REGISTRY.buildings.get(this.selectedBuildingId) : null;
    this.ghost.position.copy(definition
      ? new THREE.Vector3(this.currentCell.x + definition.footprint.x / 2, 0, this.currentCell.z + definition.footprint.z / 2)
      : modelPosition(type, this.currentCell.x, this.currentCell.z));
    this.ghost.rotation.y = this.rotation * (Math.PI / 2);
    this.recolorGhost(this.ghost, this.ghostValid);
  }

  private getBeltPath(start: Cell, end: Cell, zFirst: boolean) {
    const path: Cell[] = [];
    let x = start.x;
    let z = start.z;
    const push = (nextX: number, nextZ: number) => {
      if (!path.some((cell) => cell.x === nextX && cell.z === nextZ)) path.push({ x: nextX, z: nextZ });
    };
    push(x, z);
    const walkX = () => {
      while (x !== end.x) {
        const step = Math.sign(end.x - x);
        x += step;
        push(x, z);
      }
    };
    const walkZ = () => {
      while (z !== end.z) {
        const step = Math.sign(end.z - z);
        z += step;
        push(x, z);
      }
    };
    if (zFirst) {
      walkZ();
      walkX();
    } else {
      walkX();
      walkZ();
    }
    return path.map((cell, index) => {
      const next = path[index + 1];
      const previous = path[index - 1];
      const destination = next ?? previous;
      if (!destination) return { ...cell, rotation: this.rotation };
      const direction = next
        ? { x: destination.x - cell.x, z: destination.z - cell.z }
        : { x: cell.x - destination.x, z: cell.z - destination.z };
      const rotation = direction.x > 0 ? 1 : direction.x < 0 ? 3 : direction.z > 0 ? 0 : 2;
      return { ...cell, rotation };
    });
  }

  private updateBeltBuildInfo(dragging: boolean) {
    const first = this.beltPreviewCells[0];
    const connectedStart = Boolean(first && Array.from(this.simulation.structures.values()).some((machine) => {
      if (isTransportType(machine.type) || machine.type === "storage") return false;
      const ports = machinePorts(machine);
      return ports.output.x === first.x
        && ports.output.z === first.z
        && sameDirection(directionForRotation(first.rotation), ports.flow);
    }));
    const info = {
      dragging,
      length: dragging ? this.beltPreviewCells.length : 0,
      cost: dragging ? this.beltPreviewCells.length * COST.belt : 0,
      valid: dragging ? this.ghostValid : true,
      connectedStart,
    };
    const signature = `${info.dragging}:${info.length}:${info.cost}:${info.valid}:${info.connectedStart}`;
    if (signature === this.beltBuildSignature) return;
    this.beltBuildSignature = signature;
    this.callbacks.onBeltBuildInfo(info);
  }

  private updateBeltPreview(end: Cell, zFirst: boolean) {
    if (!this.beltStart) return;
    if (this.beltPreview) this.scene.remove(this.beltPreview);
    this.beltPreview = new THREE.Group();
    this.beltPreviewCells = this.getBeltPath(this.beltStart, end, zFirst);
    const reserved = new Set<string>();
    let allValid = true;
    this.beltPreviewCells.forEach((cell) => {
      const valid = this.simulation.canPlace("belt", cell.x, cell.z, reserved);
      if (!valid) allValid = false;
      reserved.add(cellKey(cell.x, cell.z));
      const model = createStructureModel("belt", this.materials);
      model.position.set(cell.x, 0, cell.z);
      model.rotation.y = cell.rotation * (Math.PI / 2);
      this.recolorGhost(model, valid);
      this.beltPreview?.add(model);
    });
    this.ghostValid = allValid;
    this.scene.add(this.beltPreview);
    this.updateBeltBuildInfo(true);
  }

  private pickStructure() {
    const hits = this.raycaster.intersectObjects(Array.from(this.groups.values()), true);
    const id = hits[0]?.object.userData.structureId;
    return typeof id === "number" ? id : null;
  }

  private selectStructure(id: number | null) {
    this.selectedId = id;
    this.callbacks.onSelected(id === null ? null : this.simulation.getSelectedInfo(id));
  }

  private changeCredits(value: number) {
    this.credits = Math.max(0, value);
    this.callbacks.onCredits(this.credits);
  }

  private commitMachine(type: BuildType) {
    if (!this.ghostValid) {
      this.callbacks.onToast(type === "miner" ? "채굴기는 광맥 위에 설치해야 합니다" : "이 위치에는 설치할 수 없습니다");
      return;
    }
    const selectedDefinition = this.selectedBuildingId
      ? START_REGISTRY.buildings.get(this.selectedBuildingId)
      : null;
    const worldPlacement = this.selectedBuildingId
      ? this.world.place({
        buildingId: this.selectedBuildingId,
        position: { x: this.currentCell.x, z: this.currentCell.z },
        rotation: this.rotation as 0 | 1 | 2 | 3,
      })
      : null;
    if (worldPlacement && !worldPlacement.ok) {
      const messages = {
        locked: "아직 해금되지 않은 설비입니다",
        insufficient_materials: "건설 재료가 부족합니다",
        occupied: "실제 설비 점유 영역이 겹칩니다",
        out_of_bounds: "공장 경계를 벗어났습니다",
        invalid_rotation: "지원하지 않는 회전입니다",
        unknown_building: "알 수 없는 설비입니다",
        preplaced_unique: "고정 설비는 건설할 수 없습니다",
      } as const;
      this.callbacks.onToast(messages[worldPlacement.reason]);
      return;
    }
    const cost = selectedDefinition ? 0 : COST[type];
    if (!selectedDefinition && this.credits < cost) {
      this.callbacks.onToast("크레딧이 부족합니다");
      return;
    }
    const data = this.addStructure({
      id: this.nextId++,
      type,
      ...(this.selectedBuildingId ? { buildingId: this.selectedBuildingId } : {}),
      ...(worldPlacement?.ok ? { worldInstanceId: worldPlacement.instance.id } : {}),
      x: this.currentCell.x,
      z: this.currentCell.z,
      rotation: this.rotation,
    });
    if (!selectedDefinition) {
      this.history.push({ added: [{ ...data }], removed: [], creditDelta: -cost });
      this.changeCredits(this.credits - cost);
    } else this.publishConstructionState();
    const buildingName = this.selectedBuildingId
      ? START_REGISTRY.buildings.get(this.selectedBuildingId)?.name
      : TYPE_NAME[type];
    this.callbacks.onToast(`${buildingName ?? TYPE_NAME[type]} 설치 완료`);
    this.updateGhost();
  }

  private commitBelts() {
    if (!this.ghostValid || !this.beltPreviewCells.length) {
      this.callbacks.onToast("경로가 막혀 있습니다");
      return;
    }
    const selectedDefinition = this.selectedBuildingId
      ? START_REGISTRY.buildings.get(this.selectedBuildingId)
      : null;
    const worldPlacement = this.selectedBuildingId
      ? this.world.placeBatch(this.beltPreviewCells.map((cell) => ({
        buildingId: this.selectedBuildingId!,
        position: { x: cell.x, z: cell.z },
        rotation: cell.rotation as 0 | 1 | 2 | 3,
      })))
      : null;
    if (worldPlacement && !worldPlacement.ok) {
      this.callbacks.onToast(worldPlacement.reason === "insufficient_materials"
        ? "컨베이어 건설 재료가 부족합니다"
        : "컨베이어 경로가 실제 설비 점유 영역과 겹칩니다");
      return;
    }
    const cost = selectedDefinition ? 0 : COST.belt * this.beltPreviewCells.length;
    if (!selectedDefinition && this.credits < cost) {
      this.callbacks.onToast("크레딧이 부족합니다");
      return;
    }
    const added = this.beltPreviewCells.map((cell, index) => this.addStructure({
      id: this.nextId++,
      type: "belt",
      ...(this.selectedBuildingId ? { buildingId: this.selectedBuildingId } : {}),
      ...(worldPlacement?.ok ? { worldInstanceId: worldPlacement.instances[index]?.id } : {}),
      x: cell.x,
      z: cell.z,
      rotation: cell.rotation,
    }));
    if (!selectedDefinition) {
      this.history.push({ added: added.map((data) => ({ ...data })), removed: [], creditDelta: -cost });
      this.changeCredits(this.credits - cost);
    } else this.publishConstructionState();
    const connected = added.some((belt) =>
      Array.from(this.simulation.structures.values()).some(
        (machine) => !isTransportType(machine.type)
          && machine.type !== "storage"
          && machinePorts(machine).output.x === belt.x
          && machinePorts(machine).output.z === belt.z,
      ),
    );
    this.callbacks.onToast(connected ? `출력 포트 연결 · 벨트 ${added.length}칸` : `컨베이어 ${added.length}칸 설치 완료`);
  }

  private undo() {
    const entry = this.history.pop();
    if (!entry) {
      this.callbacks.onToast("되돌릴 작업이 없습니다");
      return;
    }
    entry.added.forEach((data) => this.removeStructure(data.id));
    entry.removed.forEach((data) => this.addStructure(data));
    this.changeCredits(this.credits - entry.creditDelta);
    this.callbacks.onToast("마지막 작업을 되돌렸습니다");
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.inputLocked) return;
    if (this.cameraMode === "firstPerson") return;
    if (this.panning) {
      const dx = event.clientX - this.panOrigin.x;
      const dy = event.clientY - this.panOrigin.y;
      const speed = 0.014 / this.cameraZoom;
      const right = new THREE.Vector3(Math.cos(this.cameraAngle), 0, -Math.sin(this.cameraAngle));
      const forward = new THREE.Vector3(Math.sin(this.cameraAngle), 0, Math.cos(this.cameraAngle));
      this.desiredTarget.addScaledVector(right, -dx * speed);
      this.desiredTarget.addScaledVector(forward, -dy * speed);
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -8, 8);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -8, 8);
      this.panOrigin = { x: event.clientX, y: event.clientY };
      return;
    }
    const cell = this.pointerToCell(event);
    if (!cell) return;
    this.currentCell = cell;
    this.hoverTile.position.set(cell.x, 0.035, cell.z);
    if (this.beltStart) this.updateBeltPreview(cell, event.shiftKey);
    else this.updateGhost();
  };

  private onPointerDown = (event: PointerEvent) => {
    if (this.inputLocked) return;
    this.renderer.domElement.focus();
    if (this.cameraMode === "firstPerson") {
      if (event.button === 0 && document.pointerLockElement !== this.renderer.domElement) {
        void this.renderer.domElement.requestPointerLock();
      }
      return;
    }
    this.pointerDown = { x: event.clientX, y: event.clientY };
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.panning = true;
      this.capturedPointerId = event.pointerId;
      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const cell = this.pointerToCell(event);
    if (cell) this.currentCell = cell;
    if (this.activeTool === "belt") {
      this.beltStart = { ...this.currentCell };
      this.capturedPointerId = event.pointerId;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.updateBeltPreview(this.currentCell, event.shiftKey);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.inputLocked) return;
    if (this.cameraMode === "firstPerson") return;
    if (this.panning) {
      this.panning = false;
      this.renderer.domElement.releasePointerCapture(event.pointerId);
      this.capturedPointerId = null;
      this.setTool(this.activeTool);
      return;
    }
    if (event.button !== 0) return;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    this.capturedPointerId = null;
    const cell = this.pointerToCell(event);
    if (cell) this.currentCell = cell;
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (this.activeTool === "belt" && this.beltStart) {
      this.commitBelts();
      this.beltStart = null;
      if (this.beltPreview) this.scene.remove(this.beltPreview);
      this.beltPreview = null;
      this.beltPreviewCells = [];
      this.updateBeltBuildInfo(false);
      return;
    }
    if (moved > 6) return;
    if (this.activeTool === "inspect") {
      this.selectStructure(this.pickStructure());
      return;
    }
    if (this.activeTool === "demolish") {
      const id = this.pickStructure();
      if (id === null) {
        this.callbacks.onToast("철거할 설비를 선택하세요");
        return;
      }
      const structure = this.simulation.structures.get(id);
      if (structure?.worldInstanceId) {
        const demolition = this.world.demolish(structure.worldInstanceId);
        if (!demolition.ok) {
          this.callbacks.onToast("이 설비는 철거할 수 없습니다");
          return;
        }
      }
      const removed = this.removeStructure(id);
      if (removed) {
        if (removed.worldInstanceId) {
          this.publishConstructionState();
          this.callbacks.onToast(`${removed.buildingId ? START_REGISTRY.buildings.get(removed.buildingId)?.name : TYPE_NAME[removed.type]} 철거 · 재료 회수`);
        } else {
          const refund = Math.floor(COST[removed.type] * 0.5);
          this.history.push({ added: [], removed: [removed], creditDelta: refund });
          this.changeCredits(this.credits + refund);
          this.callbacks.onToast(`${TYPE_NAME[removed.type]} 철거 · ${refund} 환급`);
        }
      }
      return;
    }
    this.commitMachine(this.activeTool as BuildType);
  };

  private onWheel = (event: WheelEvent) => {
    if (this.inputLocked) return;
    event.preventDefault();
    if (this.cameraMode === "firstPerson") return;
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * Math.exp(-event.deltaY * 0.001), 0.72, 2.2);
  };

  private onContextMenu = (event: MouseEvent) => {
    if (this.inputLocked) return;
    event.preventDefault();
    if (this.cameraMode === "firstPerson") return;
    this.setTool("inspect");
    this.callbacks.onToast("건설 작업을 취소했습니다");
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.inputLocked) return;
    const key = event.key.toLowerCase();
    if (event.repeat && !["w", "a", "s", "d"].includes(key)) return;
    this.pressed.add(key);
    if (key === "v") {
      this.toggleCameraMode();
      return;
    }
    if (this.cameraMode === "firstPerson") return;
    const tools: Record<string, Tool> = {
      "1": "inspect",
      "2": "belt",
      "3": "miner",
      "4": "smelter",
      "5": "assembler",
      "6": "storage",
      "7": "splitter",
      "8": "merger",
      "9": "crusher",
      x: "demolish",
    };
    if (tools[key]) this.setTool(tools[key]);
    if (key === "f" && this.activeTool === "inspect" && this.selectedId !== null) {
      const recipe = this.simulation.cycleAssemblerRecipe(this.selectedId);
      if (recipe) {
        this.callbacks.onSelected(this.simulation.getSelectedInfo(this.selectedId));
        this.callbacks.onToast(`레시피 변경: ${recipe.name}`);
      } else {
        this.callbacks.onToast("성형기가 비어 있고 정지한 상태에서만 레시피를 바꿀 수 있습니다");
      }
      return;
    }
    if (key === "r") {
      this.rotation = (this.rotation + 1) % 4;
      if (this.activeTool === "belt" && this.beltStart) this.updateBeltPreview(this.currentCell, false);
      else this.updateGhost();
      this.callbacks.onToast(this.activeTool === "belt" ? "벨트 시작 방향을 회전했습니다" : "설비 방향을 회전했습니다");
    }
    if (key === "q" || key === "e") {
      this.desiredCameraAngle += key === "q" ? -Math.PI / 2 : Math.PI / 2;
      this.callbacks.onToast(key === "q" ? "카메라를 왼쪽으로 회전" : "카메라를 오른쪽으로 회전");
    }
    if (key === "escape") this.setTool("inspect");
    if (key === "z" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.undo();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.key.toLowerCase());
  };

  private onFirstPersonLook = (event: MouseEvent) => {
    if (this.inputLocked) return;
    if (this.cameraMode !== "firstPerson" || document.pointerLockElement !== this.renderer.domElement) return;
    this.firstPersonYaw -= event.movementX * 0.0022;
    this.firstPersonPitch -= event.movementY * 0.002;
    this.firstPersonPitch = THREE.MathUtils.clamp(this.firstPersonPitch, -1.35, 1.35);
  };

  private onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    this.callbacks.onPointerLock(locked);
    if (this.cameraMode === "firstPerson") this.renderer.domElement.style.cursor = locked ? "none" : "crosshair";
  };

  private syncItems(delta: number) {
    const activeItemIds = new Set<number>();
    this.simulation.beltItems.forEach((item, beltId) => {
      activeItemIds.add(item.id);
      let mesh = this.itemMeshes.get(item.id);
      if (!mesh) {
        mesh = createItemModel(item.type, this.materials);
        this.itemMeshes.set(item.id, mesh);
        this.scene.add(mesh);
      }
      const belt = this.simulation.structures.get(beltId);
      if (!belt) return;
      const outgoing = directionForRotation(belt.rotation);
      const incoming = item.incoming ?? outgoing;
      const progress = THREE.MathUtils.clamp(item.progress, 0, 1);
      const inverse = 1 - progress;
      const startX = belt.x - incoming.x * 0.5;
      const startZ = belt.z - incoming.z * 0.5;
      const endX = belt.x + outgoing.x * 0.5;
      const endZ = belt.z + outgoing.z * 0.5;
      const x = inverse * inverse * startX
        + 2 * inverse * progress * belt.x
        + progress * progress * endX;
      const z = inverse * inverse * startZ
        + 2 * inverse * progress * belt.z
        + progress * progress * endZ;
      mesh.position.set(x, 0.48, z);
      mesh.rotation.y += delta * (item.type.endsWith("_ore") ? 1.2 : item.type === "iron_plate" ? 2.2 : 0.35);
    });
    this.itemMeshes.forEach((mesh, id) => {
      if (activeItemIds.has(id)) return;
      this.scene.remove(mesh);
      this.itemMeshes.delete(id);
    });
  }

  private animateMachines(delta: number) {
    const power = this.simulation.getPowerGrid();
    this.simulation.structures.forEach((data, id) => {
      const group = this.groups.get(id);
      if (!group) return;
      const state = this.simulation.machines.get(id);
      const machineTime = (state?.animationTime ?? this.elapsed) + id * 0.17;
      const activity = state?.activity ?? 1;
      const outputQueued = (state?.output.length ?? 0) > 0;
      const inputConnections = isTransportType(data.type) ? [] : this.simulation.getInputConnections(data);
      const hasInputConnection = inputConnections.some(Boolean);
      const hasOutputConnection = !isTransportType(data.type) && this.simulation.hasOutputConnection(data);
      const beltItem = isTransportType(data.type) ? this.simulation.beltItems.get(id) : undefined;
      const genericModel = group.userData.modelSource === "generic";
      if (genericModel) {
        animateGenericBuildingModel(group, {
          time: machineTime,
          progress: state?.progress ?? (beltItem ? beltItem.progress : 0),
          activity: state?.activity ?? (beltItem ? 1 : 0),
          runtimeState: state?.working || beltItem
            ? "working"
            : outputQueued ? "blocked" : hasInputConnection ? "idle" : "disconnected",
        });
      }
      if (!genericModel && data.type === "miner") {
        animateMinerModel(group, {
          time: machineTime,
          delta,
          progress: state?.progress ?? 0,
          activity,
          working: state?.working ?? false,
          outputQueued,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "smelter") {
        animateSmelterModel(group, {
          time: machineTime,
          delta,
          progress: state?.progress ?? 0,
          activity,
          working: state?.working ?? false,
          inputCount: state?.input.length ?? 0,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "crusher") {
        animateCrusherModel(group, {
          time: machineTime,
          delta,
          progress: state?.progress ?? 0,
          activity,
          working: state?.working ?? false,
          inputCount: state?.input.length ?? 0,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "assembler") {
        animateAssemblerModel(group, {
          time: machineTime,
          delta,
          progress: state?.progress ?? 0,
          activity,
          working: state?.working ?? false,
          inputCount: state?.input.length ?? 0,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "storage") {
        animateStorageModel(group, {
          time: machineTime,
          delta,
          stored: state?.stored ?? 0,
          capacity: STORAGE_CAPACITY,
          intakePulse: state?.intakePulse ?? 0,
          inputConnected: hasInputConnection,
        });
      }
      const beltJammed = Boolean(beltItem && beltItem.progress >= 0.979);
      const beltSpeed = beltJammed ? 0 : 1;
      const beltTravel = ((group.userData.beltTravel as number | undefined) ?? 0) + delta * beltSpeed;
      group.userData.beltTravel = beltTravel;
      group.traverse((part) => {
        const role = part.userData.animationRole as string | undefined;
        if (role === "beltTread") {
          const offset = part.userData.offset as number;
          part.position.z = ((offset + beltTravel * 0.62 + 0.5) % 1) - 0.5;
        }
        if (role === "beltStatusLight" && part instanceof THREE.Mesh) {
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.setHex(beltJammed ? 0xffa94d : 0x5de4d1);
            material.emissive.setHex(beltJammed ? 0x9b480c : 0x1a8f82);
            material.emissiveIntensity = beltJammed ? 1.8 + Math.sin(this.elapsed * 5) * 0.5 : 1.5;
          }
        }
        if ((role === "inputPort" || role === "outputPort") && part instanceof THREE.Mesh && !isTransportType(data.type)) {
          const inputIndex = (part.userData.inputIndex as number | undefined) ?? 0;
          const connected = role === "inputPort"
            ? (inputConnections[inputIndex] ?? false)
            : hasOutputConnection;
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = connected ? 1.6 : 0.15;
        }
      });
      if (data.type === "splitter" || data.type === "merger") {
        animateLogisticsModel(group, {
          time: this.elapsed,
          activity: beltItem ? 1 : 0,
          working: Boolean(beltItem && !beltJammed),
          blocked: beltJammed,
          disconnected: false,
        });
      }
      if (!isTransportType(data.type)) {
        const powered = power.poweredByStructureId.get(id) ?? true;
        applyGridVisualState(group, {
          time: this.elapsed,
          powered,
          overloaded: power.overloaded && !powered,
          supplyRatio: power.supplyMW > 0 ? power.servedMW / power.supplyMW : 0,
        });
      }
    });
    const powerState = {
      time: this.elapsed,
      delta,
      generating: true,
      connected: true,
      supplyRatio: power.supplyMW > 0 ? power.servedMW / power.supplyMW : 0,
      loadRatio: power.supplyMW > 0 ? power.demandMW / power.supplyMW : 0,
      overloaded: power.overloaded,
    };
    animateFieldPowerCoreModel(this.powerCoreGroup, powerState);
    animateDistributionPoleModel(this.powerPoleGroup, powerState);
    const project = this.simulation.getProjectProgress();
    const delivered = Object.fromEntries(project.deliveries.map((delivery) => [delivery.itemId, delivery.delivered]));
    animateProjectDockModel(this.projectDockGroup, {
      time: this.elapsed,
      progress: project.totalProgress,
      deliveryCounts: {
        ironPlate: delivered.iron_plate ?? 0,
        constructionBlock: delivered.construction_block ?? 0,
        fastenerPack: delivered.fastener_pack ?? 0,
      },
      completed: project.completed,
    });
  }

  private publishPower() {
    const campaignPower = this.campaignWorld.powerResult();
    const power = campaignPower ? {
      supplyMW: campaignPower.capacityMW,
      demandMW: campaignPower.requestedMW,
      servedMW: campaignPower.servedMW,
      overloaded: campaignPower.satisfaction < 0.999 || campaignPower.mainBreakerTripped,
    } : this.simulation.getPowerGrid();
    const signature = `${power.supplyMW}:${power.demandMW}:${power.servedMW}:${power.overloaded}`;
    if (signature === this.lastPowerSignature) return;
    this.lastPowerSignature = signature;
    this.callbacks.onPower(power);
  }

  private stepCampaignPower(delta: number) {
    const overrides: Record<string, PowerInstanceOverride> = {};
    this.simulation.structures.forEach((structure, id) => {
      if (!structure.worldInstanceId) return;
      const state = this.simulation.machines.get(id);
      const definition = structure.buildingId ? START_REGISTRY.buildings.get(structure.buildingId) : null;
      const fuelItemId = definition?.generatorPolicy?.fuelItemId;
      overrides[structure.worldInstanceId] = {
        connected: true,
        active: state?.working ?? isTransportType(structure.type),
        ...(fuelItemId ? {
          fuelAvailable: Boolean(state && [...state.input, ...state.output, ...state.storedItems].includes(fuelItemId)),
        } : {}),
      };
    });
    const result = this.campaignWorld.stepPower(delta, overrides);
    const poweredByWorldId = new Map(result.consumers.map((consumer) => [consumer.id, consumer.satisfaction >= 0.999]));
    this.simulation.setExternalPowerAvailability(new Map(
      [...this.simulation.structures.values()].map((structure) => [
        structure.id,
        structure.worldInstanceId ? poweredByWorldId.get(structure.worldInstanceId) ?? true : true,
      ]),
    ));
  }

  private syncPhaseOneCampaign() {
    const stageId = "phase_1_settlement_package";
    const campaignProgress = this.campaignWorld.campaign.progress(stageId);
    if (!campaignProgress || campaignProgress.completed) return;
    const visualProgress = this.simulation.getProjectProgress();
    let changed = false;
    visualProgress.deliveries.forEach((delivery) => {
      const current = campaignProgress.deliveries.find(({ portId }) => portId === delivery.portId)?.delivered ?? 0;
      const amount = delivery.delivered - current;
      if (amount <= 0) return;
      const result = this.campaignWorld.deliverProject(stageId, {
        portId: delivery.portId,
        itemId: delivery.itemId,
        amount,
      });
      if (result.accepted) changed = true;
    });
    if (changed) this.publishConstructionState();
  }

  private publishProject() {
    const progress = this.simulation.getProjectProgress();
    const signature = progress.deliveries.map(({ delivered }) => delivered).join(":");
    if (signature === this.lastProjectSignature) return;
    this.lastProjectSignature = signature;
    this.callbacks.onProject({
      stageName: "기초 정착 패키지",
      delivered: progress.deliveredTotal,
      total: progress.requiredTotal,
      completed: progress.completed,
      requirements: progress.deliveries.map((delivery) => ({
        itemId: delivery.itemId,
        name: START_REGISTRY.items.get(delivery.itemId)?.name ?? delivery.itemId,
        delivered: delivery.delivered,
        total: delivery.required,
      })),
    });
  }

  private animate = (time: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.elapsed += delta;
    if (time - this.lastAutoSaveTime >= 5_000) {
      this.lastAutoSaveTime = time;
      this.save(false);
    }

    if (this.cameraMode === "overview") {
      const angularDistance = this.desiredCameraAngle - this.cameraAngle;
      this.cameraAngularVelocity += angularDistance * 90 * delta;
      this.cameraAngularVelocity *= Math.exp(-18 * delta);
      this.cameraAngle += this.cameraAngularVelocity * delta;
      const moveSpeed = (7.5 * delta) / this.cameraZoom;
      const right = new THREE.Vector3(Math.cos(this.cameraAngle), 0, -Math.sin(this.cameraAngle));
      const forward = new THREE.Vector3(Math.sin(this.cameraAngle), 0, Math.cos(this.cameraAngle));
      if (this.pressed.has("w")) this.desiredTarget.addScaledVector(forward, -moveSpeed);
      if (this.pressed.has("s")) this.desiredTarget.addScaledVector(forward, moveSpeed);
      if (this.pressed.has("a")) this.desiredTarget.addScaledVector(right, -moveSpeed);
      if (this.pressed.has("d")) this.desiredTarget.addScaledVector(right, moveSpeed);
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -8, 8);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -8, 8);
      this.cameraTarget.lerp(this.desiredTarget, 1 - Math.exp(-delta * 11));
      this.updateCamera();
    } else {
      this.updateFirstPerson(delta);
    }

    this.stepCampaignPower(delta);
    this.simulation.update(delta);
    this.syncPhaseOneCampaign();
    this.publishPower();
    this.publishProject();
    this.syncItems(delta);
    this.animateMachines(delta);
    this.selectedUiClock += delta;
    if (this.selectedId !== null && this.selectedUiClock >= 0.2) {
      this.selectedUiClock = 0;
      this.callbacks.onSelected(this.simulation.getSelectedInfo(this.selectedId));
    }
    const motors = this.simulation.getStoredComponents();
    if (motors !== this.lastMotorCount) {
      this.lastMotorCount = motors;
      this.callbacks.onMotors(motors);
    }
    this.renderer.render(this.scene, this.activeCamera);
  };
}
