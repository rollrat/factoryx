import * as THREE from "three";
import { COST, STORAGE_CAPACITY, TYPE_NAME, cellKey, directionForRotation, machinePorts, sameDirection } from "./config";
import {
  createBuildingModel,
  createFactoryMaterials,
  createItemModel,
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
  animateConnectionModel,
  createPowerCableConnectionModel,
  createPortConnectionModel,
  type ResolvedWorldPort,
} from "./models/connection.ts";
import {
  animateDistributionPoleModel,
  animateFieldPowerCoreModel,
  createFieldPowerCoreModel,
} from "./models/power";
import { animateProjectDockModel, createProjectDockModel } from "./models/projectDock";
import { applyGridVisualState, removeGridVisualState } from "./models/gridState";
import { CAMPAIGN_START_INVENTORY, START_REGISTRY } from "./data/index.ts";
import { FactorySimulation } from "./simulation";
import { migrateWorldSnapshotBounds, type DataDrivenWorld } from "./sim/world.ts";
import { CampaignWorldRuntime } from "./sim/campaignWorld.ts";
import { ProjectDockDeliveryCommitter } from "./sim/projectDockCommitter.ts";
import {
  buildPhysicalPowerTopology,
  inferAdjacentPowerEdges,
  type PhysicalPowerTopology,
  type PowerEdge,
  type PowerInstanceRuntime,
} from "./sim/physicalPowerNetwork.ts";
import { PhysicalPowerRuntime } from "./sim/physicalPowerRuntime.ts";
import type { LoadPriority } from "./sim/powerGrid.ts";
import { WorldProductionSimulation } from "./sim/worldProduction.ts";
import { migrateLegacyStructuresIntoWorld } from "./sim/legacyWorldMigration.ts";
import { WorldCommandHistory } from "./sim/worldCommandHistory.ts";
import { WorldCollisionIndex, recoverPlayerStart, resolvePlayerMovement } from "./sim/firstPersonCollision.ts";
import { projectPlacement, worldPointToAnchorCell } from "./domain/placement.ts";
import {
  FIRST_PERSON_LOCOMOTION,
  initialVerticalLocomotionState,
  updatePlanarVelocity,
  updateVerticalLocomotion,
  type VerticalLocomotionState,
} from "./sim/firstPersonLocomotion.ts";
import {
  classifyBuildingLods,
  createWorldBuildingLodSubjects,
  frustumPlanesFromMatrix,
} from "./models/buildingLod.ts";
import { ProductionMetricCollector } from "./telemetry/productionMetrics.ts";
import {
  createFactoryRuntimeSaveStorage,
  type FactoryRuntimeSnapshot,
} from "./visualPersistence.ts";
import { createEnvironmentSnapshot } from "./environment/persistence/environmentSnapshot.ts";
import { buildLiveTelemetry } from "./telemetry/live.ts";
import { buildWorldRuntimeTopology } from "./telemetry/worldTopology.ts";
import {
  A17_ENVIRONMENT,
  CAVE_ZONES,
  EnvironmentRenderer,
  EnvironmentAudioSystem,
  browserEnvironmentQuality,
  TerrainSampler,
  createTerrainPlacementValidator,
  resolveTerrainMovement,
  infrastructureHeightAt,
  type TerrainInfrastructureSurface,
  WORLD_STUDIO_STORAGE_KEY,
  parseWorldStudioDocument,
  EnvironmentObstacleIndex,
  ExplorationTracker,
} from "./environment/index.ts";
import type {
  BuildingId,
  BuildType,
  CameraMode,
  Cell,
  GameCallbacks,
  HistoryEntry,
  SelectedInfo,
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
  if (["conveyor_lift", "solid_wall_socket", "pipe_riser", "pipe_wall_socket", "shaft_logistics_socket"].includes(buildingId)) return "belt";
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

const PROJECT_STAGE_NAMES: Readonly<Record<string, string>> = {
  phase_1_settlement_package: "기초 정착 패키지",
  phase_2_industrial_power_node: "산업 전력 노드",
  phase_3_automation_core: "자동화 코어",
  phase_4_chemistry_stabilization: "화학 안정화",
  phase_4_thermal_management_verification: "열관리 검증",
  phase_4_colony_seed: "AX-17 개척 시드",
};

export type RuntimePowerControlSnapshot = Readonly<{
  capacityMW: number;
  dispatchableMW: number;
  requestedMW: number;
  servedMW: number;
  storedMWh: number;
  maxConsumptionMW: number;
  nameplateReserveMW: number;
  operatingReserveMW: number;
  mainBreakerTripped: boolean;
  zones: readonly Readonly<{
    id: string;
    connected: boolean;
    generators: number;
    consumers: number;
    batteries: number;
  }>[];
  breakers: readonly Readonly<{ instanceId: string; name: string; state: "closed" | "open" | "tripped" }>[];
  switchboards: readonly Readonly<{
    instanceId: string;
    name: string;
    outputs: Readonly<Record<LoadPriority, boolean>>;
  }>[];
}>;

type MutablePowerControls = {
  breakers: Record<string, "closed" | "open" | "tripped">;
  switchboardOutputs: Record<string, Partial<Record<LoadPriority, boolean>>>;
};

export class FactoryRuntime {
  private readonly scene = new THREE.Scene();
  private readonly powerCoreGroup: THREE.Group;
  private readonly powerPoleGroup: THREE.Group;
  private readonly projectDockGroup: THREE.Group;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly environmentQuality = browserEnvironmentQuality();
  private readonly environment: EnvironmentRenderer;
  private readonly environmentAudio = new EnvironmentAudioSystem();
  private readonly exploration: ExplorationTracker;
  private readonly terrainSampler: TerrainSampler;
  private environmentObstacles: EnvironmentObstacleIndex;
  private readonly buildGrid: THREE.GridHelper;
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 400);
  private readonly firstPersonCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 320);
  private readonly materials = createFactoryMaterials();
  private readonly simulation: FactorySimulation;
  private readonly world: DataDrivenWorld;
  private readonly campaignWorld: CampaignWorldRuntime;
  private readonly worldProduction: WorldProductionSimulation;
  private readonly dockCommitter: ProjectDockDeliveryCommitter;
  private readonly physicalPower: PhysicalPowerRuntime;
  private powerTopology: PhysicalPowerTopology;
  private collisionIndex: WorldCollisionIndex;
  private readonly powerControls: MutablePowerControls;
  private readonly manualPowerEdges: PowerEdge[];
  private readonly saveStorage: ReturnType<typeof createFactoryRuntimeSaveStorage>;
  private readonly groups = new Map<number, THREE.Group>();
  private readonly itemMeshes = new Map<number, THREE.Group>();
  private readonly worldItemMeshes = new Map<string, THREE.Group>();
  private readonly connectionGroups = new Map<string, THREE.Group>();
  private readonly resourceGroups = new Map<string, THREE.Group>();
  private readonly history: HistoryEntry[] = [];
  private readonly worldHistory = new WorldCommandHistory(120);
  private readonly productionMetrics = new ProductionMetricCollector(60, 15);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
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
  private powerCableStartId: string | null = null;
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
  private verticalLocomotion: VerticalLocomotionState = initialVerticalLocomotionState();
  private jumpRequested = false;
  private headBobPhase = 0;
  private firstPersonYaw = 0;
  private firstPersonPitch = -0.08;
  private activeStratumId = "surface";
  private animationId = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private lastPowerSignature = "";
  private lastProjectSignature = "";
  private lastMotorCount = -1;
  private selectedUiClock = 0;
  private lastAutoSaveTime = 0;
  private lastConnectionSyncTime = -1;
  private lastLodSyncTime = -1;
  private lastEnvironmentUiTime = -1;

  constructor(
    private readonly mount: HTMLDivElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.saveStorage = createFactoryRuntimeSaveStorage(window.localStorage);
    let worldStudioDocument = null;
    try {
      const raw = window.localStorage.getItem(WORLD_STUDIO_STORAGE_KEY);
      worldStudioDocument = raw ? parseWorldStudioDocument(JSON.parse(raw), A17_ENVIRONMENT) : null;
    } catch { /* Invalid authoring drafts never prevent the game from starting. */ }
    this.terrainSampler = new TerrainSampler(A17_ENVIRONMENT, worldStudioDocument?.strokes ?? []);
    const loaded = this.saveStorage.load();
    const restored = loaded.ok ? loaded.value?.snapshot ?? null : null;
    this.exploration = new ExplorationTracker(restored?.exploration);
    const gameplayBounds = A17_ENVIRONMENT.constructionBounds;
    const migratedCampaign = restored?.campaignWorld
      ? { ...restored.campaignWorld, world: migrateWorldSnapshotBounds(restored.campaignWorld.world, gameplayBounds) }
      : undefined;
    const migratedWorld = restored?.world ? migrateWorldSnapshotBounds(restored.world, gameplayBounds) : undefined;
    this.campaignWorld = new CampaignWorldRuntime({
      registry: START_REGISTRY,
      bounds: gameplayBounds,
      constructionInventory: CAMPAIGN_START_INVENTORY,
      terrainPlacement: createTerrainPlacementValidator(this.terrainSampler),
      ...(migratedCampaign
        ? { snapshot: migratedCampaign }
        : migratedWorld ? { worldSnapshot: migratedWorld } : {}),
    });
    this.world = this.campaignWorld.world;
    this.simulation = new FactorySimulation(24, restored?.simulation, (request) => this.deliverToActiveProject(request));
    if (restored) {
      migrateLegacyStructuresIntoWorld(
        this.world,
        [...this.simulation.structures.values()],
        defaultBuildingForLegacyType,
      );
    }
    this.worldProduction = new WorldProductionSimulation(this.world, restored?.worldProduction);
    this.dockCommitter = new ProjectDockDeliveryCommitter(
      this.campaignWorld,
      this.worldProduction,
      60,
      restored?.dockCommitter ?? {
        version: 1,
        fluidTransferCredits: [],
        unassignedFluidCredit: restored?.dockFluidTransferCredit ?? 0,
      },
    );
    this.powerControls = {
      breakers: { ...(restored?.powerControls?.breakers ?? {}) },
      switchboardOutputs: Object.fromEntries(Object.entries(restored?.powerControls?.switchboardOutputs ?? {})
        .map(([id, outputs]) => [id, { ...outputs }])),
    };
    this.manualPowerEdges = (restored?.physicalPower?.edges ?? [])
      .filter(({ id }) => id.startsWith("manual-power:"))
      .map((edge) => ({ ...edge, from: { ...edge.from }, to: { ...edge.to } }));
    this.physicalPower = new PhysicalPowerRuntime({
      world: this.world,
      edges: [...inferAdjacentPowerEdges(this.world), ...this.manualPowerEdges],
      controls: this.powerControls,
      ...(restored?.physicalPower ? { snapshot: restored.physicalPower } : {}),
    });
    this.powerTopology = this.physicalPower.topology();
    this.world.setHazardServiceResolver(({ stabilizerInstanceIds }) => stabilizerInstanceIds.some((instanceId) => (
      this.physicalPower.powerResults().flatMap(({ consumers }) => consumers)
        .some(({ id, satisfaction }) => id === instanceId && satisfaction >= 0.999)
    )));
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
      this.activeStratumId = restored.activeStratumId ?? "surface";
    }
    this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
    const recoveredPlayer = recoverPlayerStart(this.collisionIndex, this.playerPosition);
    this.playerPosition.x = recoveredPlayer.position.x;
    this.playerPosition.z = recoveredPlayer.position.z;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.environmentQuality === "high" ? 1.5 : 1));
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

    this.environment = new EnvironmentRenderer(this.scene, A17_ENVIRONMENT, this.environmentQuality, this.terrainSampler);
    this.environment.props.applyClearedPropIds(restored?.environment?.removedPropIds ?? []);
    restored?.environment?.stabilizedHazardIds.forEach((id) => this.environment.props.setHazardState(id, true));
    if (worldStudioDocument) {
      this.environment.seedCycle(worldStudioDocument.timeOfDay, worldStudioDocument.weather, worldStudioDocument.weatherStrength);
      this.environment.setSunAzimuth(worldStudioDocument.sunAzimuth);
      this.environment.setFogDensity(worldStudioDocument.fogDensity);
      this.environment.setScatterDensity(worldStudioDocument.scatterDensity);
      this.environment.setLandmarkOffsets(worldStudioDocument.landmarkOffsets);
      this.environment.setLandmarksVisible(worldStudioDocument.landmarksVisible);
    }
    this.exploration.snapshot().discoveredSiteIds.forEach((id) => this.environment.exploration.setDiscovered(id));
    this.environmentObstacles = new EnvironmentObstacleIndex(this.environment.props.obstacles());
    if (restored?.environment?.cycle) this.environment.restoreCycle(restored.environment.cycle);
    this.environment.setAutomaticCycle(true);
    this.environment.setStratum(this.activeStratumId);
    this.environmentAudio.setStratum(this.activeStratumId);
    const powerModels = this.setupWorld();
    this.powerCoreGroup = powerModels.core;
    this.powerPoleGroup = powerModels.pole;
    this.projectDockGroup = powerModels.projectDock;
    if (this.activeStratumId !== "surface") {
      this.powerCoreGroup.visible = false;
      this.projectDockGroup.visible = false;
    }
    this.buildGrid = powerModels.grid;
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
    this.publishEnvironment();
    this.updateBeltBuildInfo(false);
    this.buildGrid.visible = false;
    this.animate(performance.now());
  }

  setTool(tool: Tool) {
    if (this.inputLocked) return;
    this.activeTool = tool;
    this.selectedBuildingId = tool === "inspect" || tool === "demolish"
      ? null
      : defaultBuildingForLegacyType(tool as BuildType);
    this.callbacks.onToolChange(tool);
    this.beltStart = null;
    if (this.beltPreview) this.scene.remove(this.beltPreview);
    this.beltPreview = null;
    this.beltPreviewCells = [];
    this.updateBeltBuildInfo(false);
    this.renderer.domElement.style.cursor =
      tool === "demolish" ? "not-allowed" : tool === "inspect" ? "default" : "crosshair";
    this.buildGrid.visible = tool !== "inspect";
    this.updateGhost();
  }

  toggleEnvironmentAudio() {
    const muted = !this.environmentAudio.isMuted();
    this.environmentAudio.setMuted(muted);
    if (!muted) void this.environmentAudio.resume();
    this.callbacks.onToast(muted ? "환경음을 음소거했습니다" : "환경음을 켰습니다");
    this.publishEnvironment();
  }

  getExplorationSnapshot() { return this.exploration.snapshot(); }

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
    this.jumpRequested = false;

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
    return buildWorldRuntimeTopology(this.campaignWorld, this.worldProduction, {
      topology: this.powerTopology,
      results: this.physicalPower.powerResults(),
    }, this.productionMetrics.sample(this.worldProduction));
  }

  getCampaignSnapshot() {
    return this.campaignWorld.campaign.snapshot();
  }

  restartRepeatableProject(stageId: string) {
    if (!this.campaignWorld.restartRepeatableProject(stageId)) {
      this.callbacks.onToast("완료된 반복 프로젝트만 다시 시작할 수 있습니다");
      return false;
    }
    this.publishProject();
    this.callbacks.onToast("AX-17 반복 프로젝트를 다시 시작했습니다");
    return true;
  }

  getDockSuppliedPowerMW() {
    return this.campaignWorld.snapshot().dockSuppliedPowerMW;
  }

  getPowerControlSnapshot(): RuntimePowerControlSnapshot {
    const grids = this.physicalPower.powerResults();
    const breakers = this.world.allInstances()
      .filter(({ definitionId }) => definitionId === "power_breaker")
      .map((instance) => ({
        instanceId: instance.id,
        name: START_REGISTRY.buildings.get(instance.definitionId)?.name ?? instance.definitionId,
        state: this.powerControls.breakers[instance.id] ?? "closed" as const,
      }));
    const switchboards = this.world.allInstances()
      .filter(({ definitionId }) => definitionId === "priority_switchboard")
      .map((instance) => ({
        instanceId: instance.id,
        name: START_REGISTRY.buildings.get(instance.definitionId)?.name ?? instance.definitionId,
        outputs: Object.fromEntries(([1, 2, 3, 4] as const).map((priority) => [
          priority,
          this.powerControls.switchboardOutputs[instance.id]?.[priority] ?? true,
        ])) as Record<LoadPriority, boolean>,
      }));
    return {
      capacityMW: grids.reduce((sum, grid) => sum + grid.capacityMW, 0),
      dispatchableMW: grids.reduce((sum, grid) => sum + grid.dispatchableMW, 0),
      requestedMW: grids.reduce((sum, grid) => sum + grid.requestedMW, 0),
      servedMW: grids.reduce((sum, grid) => sum + grid.servedMW, 0),
      storedMWh: grids.reduce((sum, grid) => sum + grid.storedMWh, 0),
      maxConsumptionMW: grids.reduce((sum, grid) => sum + grid.maxConsumptionMW, 0),
      nameplateReserveMW: grids.reduce((sum, grid) => sum + grid.nameplateReserveMW, 0),
      operatingReserveMW: grids.reduce((sum, grid) => sum + grid.operatingReserveMW, 0),
      mainBreakerTripped: grids.some((grid) => grid.mainBreakerTripped),
      zones: this.powerTopology.zones.map((zone) => ({
        id: zone.id,
        connected: zone.generatorIds.length > 0 && zone.consumerIds.length > 0,
        generators: zone.generatorIds.length,
        consumers: zone.consumerIds.length,
        batteries: zone.batteryIds.length,
      })),
      breakers,
      switchboards,
    };
  }

  togglePowerBreaker(instanceId: string) {
    const instance = this.world.instance(instanceId);
    if (instance?.definitionId !== "power_breaker") return false;
    const next = (this.powerControls.breakers[instanceId] ?? "closed") === "closed" ? "open" : "closed";
    this.powerControls.breakers[instanceId] = next;
    this.physicalPower.setBreakerState(instanceId, next);
    this.powerTopology = this.physicalPower.topology();
    this.syncConnectionModels();
    this.callbacks.onToast(`${START_REGISTRY.buildings.get(instance.definitionId)?.name ?? "차단기"} · ${next === "closed" ? "투입" : "차단"}`);
    return true;
  }

  togglePowerPriority(instanceId: string, priority: LoadPriority) {
    const instance = this.world.instance(instanceId);
    if (instance?.definitionId !== "priority_switchboard") return false;
    const outputs = this.powerControls.switchboardOutputs[instanceId] ?? {};
    outputs[priority] = !(outputs[priority] ?? true);
    this.powerControls.switchboardOutputs[instanceId] = outputs;
    this.physicalPower.setSwitchboardOutput(instanceId, priority, outputs[priority]!);
    this.powerTopology = this.physicalPower.topology();
    this.syncConnectionModels();
    this.callbacks.onToast(`P${priority} 구역 · ${outputs[priority] ? "연결" : "차단"}`);
    return true;
  }

  sequentialPowerRestart() {
    Object.keys(this.powerControls.breakers).forEach((id) => { this.powerControls.breakers[id] = "closed"; });
    Object.keys(this.powerControls.breakers).forEach((id) => this.physicalPower.setBreakerState(id, "closed"));
    this.physicalPower.powerResults().filter(({ mainBreakerTripped }) => mainBreakerTripped)
      .forEach(({ gridId }) => this.physicalPower.requestSequentialRestart(gridId));
    this.callbacks.onToast("전력망 순차 재기동을 시작했습니다");
  }

  private connectSelectedPowerCable() {
    const selected = this.selectedId === null ? null : this.simulation.structures.get(this.selectedId);
    const targetId = selected?.worldInstanceId ?? null;
    const targetPorts = targetId ? this.world.portsFor(targetId).filter(({ definition }) => definition.medium === "power") : [];
    if (!targetId || targetPorts.length === 0) {
      this.callbacks.onToast("전력 포트가 있는 설비를 먼저 선택하세요");
      return;
    }
    if (!this.powerCableStartId) {
      this.powerCableStartId = targetId;
      this.callbacks.onToast("케이블 시작점 지정 · 다른 전력 설비를 선택하고 L");
      return;
    }
    const sourceId = this.powerCableStartId;
    this.powerCableStartId = null;
    if (sourceId === targetId) {
      this.callbacks.onToast("케이블 연결을 취소했습니다");
      return;
    }
    const existingIndex = this.manualPowerEdges.findIndex(({ from, to }) => (
      (from.ownerId === sourceId && to.ownerId === targetId)
      || (from.ownerId === targetId && to.ownerId === sourceId)
    ));
    if (existingIndex >= 0) {
      this.manualPowerEdges.splice(existingIndex, 1);
      this.syncConnectionModels();
      this.callbacks.onToast("수동 전력 케이블을 해제했습니다");
      return;
    }
    const sourcePorts = this.world.portsFor(sourceId).filter(({ definition }) => definition.medium === "power");
    const pair = sourcePorts.flatMap((source) => targetPorts.flatMap((target) => {
      if (source.definition.connectorProfile !== target.definition.connectorProfile) return [];
      if (source.stratumId !== target.stratumId && !(source.connectsStrata && target.connectsStrata)) return [];
      const direct = source.definition.direction !== "input" && target.definition.direction !== "output";
      const reverse = target.definition.direction !== "input" && source.definition.direction !== "output";
      if (!direct && !reverse) return [];
      const distance = Math.hypot(
        source.localPosition.x - target.localPosition.x,
        source.localPosition.y - target.localPosition.y,
        source.localPosition.z - target.localPosition.z,
      );
      const maxDistance = source.definition.connectorProfile === "power_high_voltage" ? 24 : 8;
      if (distance > maxDistance) return [];
      return [{ source, target, reverse, distance }];
    })).sort((a, b) => a.distance - b.distance)[0];
    if (!pair) {
      this.callbacks.onToast("호환되는 전력 포트가 없거나 케이블 거리가 너무 멉니다");
      return;
    }
    const from = pair.reverse
      ? { ownerId: targetId, portId: pair.target.definition.id }
      : { ownerId: sourceId, portId: pair.source.definition.id };
    const to = pair.reverse
      ? { ownerId: sourceId, portId: pair.source.definition.id }
      : { ownerId: targetId, portId: pair.target.definition.id };
    const edge: PowerEdge = {
      id: `manual-power:${[`${from.ownerId}:${from.portId}`, `${to.ownerId}:${to.portId}`].sort().join("|")}`,
      from,
      to,
      cableType: pair.source.definition.connectorProfile,
      enabled: true,
    };
    const proposed = [...inferAdjacentPowerEdges(this.world), ...this.manualPowerEdges, edge];
    try {
      const beforeZones = this.powerTopology.zones.length;
      const preview = buildPhysicalPowerTopology(this.world, proposed, this.powerControls);
      this.manualPowerEdges.push(edge);
      this.physicalPower.setEdges(proposed);
      this.powerTopology = this.physicalPower.topology();
      this.syncConnectionModels();
      this.callbacks.onToast(`전력 케이블 연결 · 전력 구역 ${beforeZones} → ${preview.zones.length}`);
    } catch {
      this.callbacks.onToast("해당 포트에는 케이블을 연결할 수 없습니다");
    }
  }

  cycleSelectedRecipe() {
    if (this.selectedId === null) return false;
    const selected = this.simulation.structures.get(this.selectedId);
    const worldRecipeId = selected?.worldInstanceId
      ? this.worldProduction.cycleRecipe(selected.worldInstanceId)
      : null;
    const recipe = worldRecipeId
      ? START_REGISTRY.recipes.get(worldRecipeId) ?? null
      : selected?.worldInstanceId ? null : this.simulation.cycleAssemblerRecipe(this.selectedId);
    if (!recipe) {
      this.callbacks.onToast("설비 버퍼와 진행 중 작업이 비어 있을 때만 레시피를 바꿀 수 있습니다");
      return false;
    }
    this.callbacks.onSelected(this.selectedInfo(this.selectedId));
    this.callbacks.onToast(`레시피 변경: ${recipe.name}`);
    return true;
  }

  cycleWorldRecipe(instanceId: string) {
    const visual = [...this.simulation.structures.values()].find((structure) => structure.worldInstanceId === instanceId);
    const recipeId = this.worldProduction.cycleRecipe(instanceId);
    const recipe = recipeId ? START_REGISTRY.recipes.get(recipeId) : null;
    if (!recipe) {
      this.callbacks.onToast("설비 버퍼와 진행 중 작업이 비어 있을 때만 레시피를 바꿀 수 있습니다");
      return false;
    }
    if (visual) this.selectStructure(visual.id);
    this.callbacks.onToast(`레시피 변경: ${recipe.name}`);
    return true;
  }

  focusWorldInstance(instanceId: string) {
    const visual = [...this.simulation.structures.values()].find((structure) => structure.worldInstanceId === instanceId);
    if (!visual) {
      this.callbacks.onToast("월드에서 해당 설비를 찾을 수 없습니다");
      return false;
    }
    if (this.cameraMode === "firstPerson") {
      this.cameraMode = "overview";
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      this.callbacks.onCameraMode(this.cameraMode);
    }
    this.setTool("inspect");
    this.selectStructure(visual.id);
    const worldInstance = visual.worldInstanceId ? this.world.instance(visual.worldInstanceId) : null;
    const focusStratum = worldInstance?.stratumId ?? "surface";
    if (focusStratum !== this.activeStratumId) {
      this.activeStratumId = focusStratum;
      this.environment.setStratum(focusStratum);
      this.environmentAudio.setStratum(focusStratum);
      this.collisionIndex = new WorldCollisionIndex(this.world, 8, focusStratum);
      this.groups.forEach((group) => { group.visible = (group.userData.stratumId ?? "surface") === focusStratum; });
      this.resourceGroups.forEach((group) => { group.visible = group.userData.stratumId === focusStratum; });
      this.powerCoreGroup.visible = focusStratum === "surface";
      this.projectDockGroup.visible = focusStratum === "surface";
      this.publishEnvironment();
    }
    this.desiredTarget.set(
      THREE.MathUtils.clamp(visual.x + 0.5, this.world.bounds.minX + 2, this.world.bounds.maxX - 2),
      worldInstance?.elevation ?? this.elevationAt(visual.x + 0.5, visual.z + 0.5, focusStratum),
      THREE.MathUtils.clamp(visual.z + 0.5, this.world.bounds.minZ + 2, this.world.bounds.maxZ - 2),
    );
    this.cameraZoom = Math.max(this.cameraZoom, 1.25);
    this.callbacks.onToast(`${START_REGISTRY.buildings.get(visual.buildingId ?? "")?.name ?? "설비"} 위치로 이동`);
    return true;
  }

  toggleCameraMode() {
    if (this.inputLocked) return;
    if (this.cameraMode === "overview") {
      const recovered = recoverPlayerStart(this.collisionIndex, this.playerPosition);
      this.playerPosition.x = recovered.position.x;
      this.playerPosition.z = recovered.position.z;
      this.playerPosition.y = this.elevationAt(this.playerPosition.x, this.playerPosition.z) + 1.62;
      this.verticalLocomotion = initialVerticalLocomotionState();
      this.headBobPhase = 0;
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
    this.environment.dispose();
    this.environmentAudio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) this.mount.removeChild(this.renderer.domElement);
  }

  private setupWorld() {
    const grid = new THREE.GridHelper(256, 256, 0x4c7a7e, 0x29474d);
    grid.position.y = 0.012;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.38;
    });
    this.scene.add(grid);

    this.world.resourceAnchors().forEach((anchor) => {
      const patch = new THREE.Group();
      const offsets = anchor.medium === "fluid"
        ? [[0, 0, 0]]
        : [[-0.28, 0, -0.2], [0.25, 0.04, -0.12], [-0.04, 0.08, 0.28]];
      offsets.forEach(([x, y, z], index) => {
        const model = createItemModel(anchor.itemId, this.materials);
        model.position.set(x, y, z);
        model.rotation.y = index * 1.9;
        model.scale.setScalar(anchor.medium === "fluid" ? 1.7 : 1.35);
        patch.add(model);
      });
      patch.position.set(
        anchor.position.x + 0.5,
        (anchor.elevation ?? this.elevationAt(anchor.position.x + 0.5, anchor.position.z + 0.5, anchor.stratumId)) + 0.04,
        anchor.position.z + 0.5,
      );
      patch.visible = anchor.stratumId === this.activeStratumId;
      patch.scale.setScalar(anchor.active ? 1 : 0.62);
      patch.userData.resourceAnchorId = anchor.id;
      patch.userData.resourceActive = anchor.active;
      patch.userData.stratumId = anchor.stratumId;
      this.resourceGroups.set(anchor.id, patch);
      this.scene.add(patch);
    });
    const core = createFieldPowerCoreModel(this.materials);
    core.position.set(1, 0, 1);
    this.scene.add(core);
    // Distribution poles are player-built world instances. Keep no decorative
    // duplicate that could imply a power connection which does not exist.
    const pole = new THREE.Group();
    const projectDock = createProjectDockModel(this.materials);
    projectDock.position.set(8.5, 0, 8.5);
    this.scene.add(projectDock);
    this.scene.add(this.hoverTile);
    return { core, pole, projectDock, grid };
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
    const worldInstance = data.worldInstanceId ? this.world.instance(data.worldInstanceId) : null;
    const stratumId = worldInstance?.stratumId ?? "surface";
    const baseProjection = definition
      ? projectPlacement(definition, { x: data.x, z: data.z }, data.rotation)
      : null;
    const position = baseProjection
      ? new THREE.Vector3(
        baseProjection.modelTransform.position.x,
        0,
        baseProjection.modelTransform.position.z,
      )
      : modelPosition(data.type, data.x, data.z);
    position.y = worldInstance?.elevation ?? this.elevationAt(position.x, position.z, stratumId);
    group.position.copy(position);
    group.userData.stratumId = stratumId;
    group.visible = stratumId === this.activeStratumId;
    group.rotation.y = baseProjection
      ? baseProjection.modelTransform.rotationY
      : data.rotation * (Math.PI / 2);
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
    const worldProduction = this.worldProduction.snapshot();
    return {
      version: 1,
      simulation: this.simulation.snapshot(),
      world: this.world.snapshot(),
      campaignWorld: this.campaignWorld.snapshot(),
      worldProduction,
      dockFluidTransferCredit: this.dockCommitter.legacyFluidCredit(),
      dockCommitter: this.dockCommitter.snapshot(),
      physicalPower: this.physicalPower.snapshot(),
      powerControls: {
        breakers: { ...this.powerControls.breakers },
        switchboardOutputs: Object.fromEntries(Object.entries(this.powerControls.switchboardOutputs)
          .map(([id, outputs]) => [id, { ...outputs }])),
      },
      credits: this.credits,
      nextId: this.nextId,
      cameraMode: this.cameraMode,
      cameraAngle: this.cameraAngle,
      cameraZoom: this.cameraZoom,
      cameraTarget: this.cameraTarget.toArray(),
      playerPosition: this.playerPosition.toArray(),
      firstPersonYaw: this.firstPersonYaw,
      firstPersonPitch: this.firstPersonPitch,
      environment: createEnvironmentSnapshot(A17_ENVIRONMENT, {
        removedPropIds: this.environment.props.clearedPropIds(),
        stabilizedHazardIds: this.stabilizedEnvironmentHazardIds(),
      }, this.environment.cycleSnapshot()),
      activeStratumId: this.activeStratumId,
      exploration: this.exploration.snapshot(),
    };
  }

  private publishConstructionState() {
    const snapshot = this.world.snapshot();
    const foundationAreas = this.world.allInstances().flatMap((instance) => {
      const definition = START_REGISTRY.buildings.get(instance.definitionId);
      if (definition?.terrainPolicy?.role !== "foundation" || (instance.stratumId ?? "surface") !== "surface") return [];
      const width = instance.rotation % 2 === 0 ? definition.footprint.x : definition.footprint.z;
      const depth = instance.rotation % 2 === 0 ? definition.footprint.z : definition.footprint.x;
      return [{ minX: instance.position.x - 0.5, maxX: instance.position.x + width + 0.5, minZ: instance.position.z - 0.5, maxZ: instance.position.z + depth + 0.5 }];
    });
    const industrialFootprints = this.world.allInstances().flatMap((instance) => {
      const definition = START_REGISTRY.buildings.get(instance.definitionId);
      const role = definition?.terrainPolicy?.role;
      if (!definition || (instance.stratumId ?? "surface") !== "surface"
        || definition.footprint.x * definition.footprint.z < 4
        || role === "ramp" || role === "bridge") return [];
      const width = instance.rotation % 2 === 0 ? definition.footprint.x : definition.footprint.z;
      const depth = instance.rotation % 2 === 0 ? definition.footprint.z : definition.footprint.x;
      return [{ minX: instance.position.x - 0.5, maxX: instance.position.x + width + 0.5, minZ: instance.position.z - 0.5, maxZ: instance.position.z + depth + 0.5 }];
    });
    this.environment.props.applyFoundationClearing(foundationAreas);
    this.environment.setIndustrialFootprints(industrialFootprints);
    this.environmentObstacles = new EnvironmentObstacleIndex(this.environment.props.obstaclesOutside(foundationAreas));
    this.world.resourceAnchors().forEach((anchor) => {
      const group = this.resourceGroups.get(anchor.id);
      if (!group) return;
      group.userData.resourceActive = anchor.active;
      group.visible = anchor.stratumId === this.activeStratumId;
      group.scale.setScalar(anchor.active ? 1 : 0.62);
    });
    this.callbacks.onConstructionState({
      unlockedIds: snapshot.unlockedIds,
      inventoryByItemId: Object.fromEntries(snapshot.constructionInventory.map(({ itemId, amount }) => [itemId, amount])),
      constructionCredits: this.campaignWorld.constructionCreditBalances(),
    });
  }

  private resolvedProductionPort(instanceId: string, portId: string): ResolvedWorldPort | null {
    const instance = this.world.instance(instanceId);
    if (!instance) return null;
    const building = START_REGISTRY.buildings.get(instance.definitionId);
    const worldPort = this.world.portsFor(instanceId).find(({ definition }) => definition.id === portId);
    if (!building || !worldPort) return null;
    return {
      buildingId: building.id,
      port: worldPort.definition,
      position: new THREE.Vector3(worldPort.localPosition.x, worldPort.localPosition.y, worldPort.localPosition.z),
      connectionAnchor: new THREE.Vector3(worldPort.connectionCell.x + 0.5, worldPort.localPosition.y, worldPort.connectionCell.z + 0.5),
      facing: worldPort.localFacing,
      rotation: instance.rotation,
    };
  }

  private syncConnectionModels() {
    const active = new Set<string>();
    this.worldProduction.connections().forEach((connection) => {
      const key = `${connection.fromInstanceId}:${connection.fromPortId}->${connection.toInstanceId}:${connection.toPortId}`;
      active.add(key);
      if (this.connectionGroups.has(key)) return;
      const source = this.resolvedProductionPort(connection.fromInstanceId, connection.fromPortId);
      const target = this.resolvedProductionPort(connection.toInstanceId, connection.toPortId);
      if (!source || !target) return;
      const group = createPortConnectionModel(source, target, this.materials);
      group.userData.connectionKey = key;
      group.userData.strata = [
        this.world.instance(connection.fromInstanceId)?.stratumId ?? "surface",
        this.world.instance(connection.toInstanceId)?.stratumId ?? "surface",
      ];
      group.visible = (group.userData.strata as string[]).includes(this.activeStratumId);
      this.connectionGroups.set(key, group);
      this.scene.add(group);
    });
    const liveIds = new Set(this.world.allInstances().map(({ id }) => id));
    for (let index = this.manualPowerEdges.length - 1; index >= 0; index -= 1) {
      const edge = this.manualPowerEdges[index];
      if (!liveIds.has(edge.from.ownerId) || !liveIds.has(edge.to.ownerId)) this.manualPowerEdges.splice(index, 1);
    }
    this.physicalPower.setEdges([...inferAdjacentPowerEdges(this.world), ...this.manualPowerEdges]);
    this.powerTopology = this.physicalPower.topology();
    this.powerTopology.cables.forEach((cable) => {
      const key = `power:${cable.id}`;
      active.add(key);
      if (this.connectionGroups.has(key)) return;
      const group = createPowerCableConnectionModel(cable, START_REGISTRY, this.materials);
      group.userData.connectionKey = key;
      group.userData.strata = [
        this.world.instance(cable.from.ownerId)?.stratumId ?? "surface",
        this.world.instance(cable.to.ownerId)?.stratumId ?? "surface",
      ];
      group.visible = (group.userData.strata as string[]).includes(this.activeStratumId);
      this.connectionGroups.set(key, group);
      this.scene.add(group);
    });
    this.connectionGroups.forEach((group, key) => {
      if (active.has(key)) return;
      this.scene.remove(group);
      this.connectionGroups.delete(key);
    });
  }

  private animateConnections() {
    const states = new Map(this.worldProduction.connectionStates().map((connection) => [
      `${connection.fromInstanceId}:${connection.fromPortId}->${connection.toInstanceId}:${connection.toPortId}`,
      connection,
    ]));
    this.connectionGroups.forEach((group, key) => {
      if (key.startsWith("power:")) {
        const cable = this.powerTopology.cables.find(({ id }) => `power:${id}` === key);
        const zone = cable?.gridId ? this.powerTopology.zones.find(({ id }) => id === cable.gridId) : null;
        const energized = Boolean(cable?.enabled && zone && zone.generatorIds.length > 0);
        animateConnectionModel(group, {
          time: this.elapsed,
          activity: energized ? 1 : 0,
          flowing: energized,
          blocked: !cable?.enabled,
        });
        return;
      }
      const state = states.get(key);
      animateConnectionModel(group, {
        time: this.elapsed,
        activity: state?.flowing ? 1 : 0,
        flowing: state?.flowing ?? false,
        blocked: state?.blocked ?? false,
      });
    });
  }

  private save(paused: boolean) {
    const state = this.snapshot();
    return paused ? this.saveStorage.saveForPageHide(state) : this.saveStorage.save(state);
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.save(true);
      void this.environmentAudio.suspend();
    } else if (!this.environmentAudio.isMuted()) {
      void this.environmentAudio.resume();
    }
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

  private elevationAt(x: number, z: number, stratumId = this.activeStratumId) {
    const supported = infrastructureHeightAt(x, z, this.terrainInfrastructure(stratumId));
    if (supported !== null) return supported;
    return stratumId === "surface"
      ? this.terrainSampler.constructionHeightAt(x, z)
      : this.terrainSampler.caveHeightAt(x, z, stratumId);
  }

  private terrainInfrastructure(stratumId = this.activeStratumId): readonly TerrainInfrastructureSurface[] {
    return this.world.allInstances().flatMap((instance) => {
      if ((instance.stratumId ?? "surface") !== stratumId) return [];
      const definition = START_REGISTRY.buildings.get(instance.definitionId);
      const role = definition?.terrainPolicy?.role;
      if (!definition || (role !== "foundation" && role !== "ramp" && role !== "bridge")) return [];
      const width = instance.rotation % 2 === 0 ? definition.footprint.x : definition.footprint.z;
      const depth = instance.rotation % 2 === 0 ? definition.footprint.z : definition.footprint.x;
      const baseElevation = instance.elevation ?? (stratumId === "surface"
        ? this.terrainSampler.constructionHeightAt(instance.position.x, instance.position.z)
        : this.terrainSampler.caveHeightAt(instance.position.x, instance.position.z, stratumId));
      return [{
        minX: instance.position.x,
        maxX: instance.position.x + width,
        minZ: instance.position.z,
        maxZ: instance.position.z + depth,
        baseElevation,
        rise: definition.terrainPolicy?.elevationStep ?? 0,
        rotation: instance.rotation,
        kind: role,
      } satisfies TerrainInfrastructureSurface];
    });
  }

  private updateCamera() {
    const distance = 23;
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(this.cameraAngle) * distance,
      18,
      this.cameraTarget.z + Math.cos(this.cameraAngle) * distance,
    );
    this.cameraTarget.y = this.elevationAt(this.cameraTarget.x, this.cameraTarget.z);
    this.camera.lookAt(this.cameraTarget);
    this.camera.zoom = this.cameraZoom;
    this.camera.updateProjectionMatrix();
  }

  private get activeCamera(): THREE.Camera {
    return this.cameraMode === "firstPerson" ? this.firstPersonCamera : this.camera;
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
    const sprinting = this.pressed.has("shift") && movement.lengthSq() > 0;
    const speed = sprinting ? FIRST_PERSON_LOCOMOTION.sprintSpeed : FIRST_PERSON_LOCOMOTION.walkSpeed;
    movement.multiplyScalar(speed);
    const planarVelocity = updatePlanarVelocity(
      { x: this.playerVelocity.x, z: this.playerVelocity.z },
      { x: movement.x, z: movement.z },
      delta,
      this.verticalLocomotion.grounded,
    );
    this.playerVelocity.x = planarVelocity.x;
    this.playerVelocity.z = planarVelocity.z;

    const previousX = this.playerPosition.x;
    const previousZ = this.playerPosition.z;
    const resolved = resolvePlayerMovement(
      this.collisionIndex,
      this.playerPosition,
      { x: this.playerVelocity.x * delta, z: this.playerVelocity.z * delta },
    );
    const obstacleResolved = this.environmentObstacles.resolve(this.playerPosition, resolved.position, 0.32, this.activeStratumId);
    const terrainResolved = resolveTerrainMovement(
      this.terrainSampler,
      this.playerPosition,
      obstacleResolved.position,
      this.activeStratumId,
      this.terrainInfrastructure(),
      (position, stratumId) => this.world.isHazardStabilizedAt(position, stratumId),
    );
    this.playerPosition.x = terrainResolved.position.x;
    this.playerPosition.z = terrainResolved.position.z;
    const vertical = updateVerticalLocomotion(this.verticalLocomotion, {
      delta,
      eyeHeight: this.playerPosition.y,
      groundEyeHeight: terrainResolved.elevation + 1.62,
      jumpPressed: this.jumpRequested,
    });
    this.jumpRequested = false;
    this.verticalLocomotion = vertical.state;
    this.playerVelocity.y = vertical.state.velocity;
    this.playerPosition.y = vertical.eyeHeight;
    if (resolved.contacts.some(({ normal }) => normal.x !== 0)) this.playerVelocity.x = 0;
    if (resolved.contacts.some(({ normal }) => normal.z !== 0)) this.playerVelocity.z = 0;
    if (terrainResolved.blocked || obstacleResolved.blocked) this.playerVelocity.multiplyScalar(0.2);

    const actualSpeed = Math.hypot(this.playerPosition.x - previousX, this.playerPosition.z - previousZ) / Math.max(delta, 0.001);
    if (actualSpeed > 0.05 && this.verticalLocomotion.grounded) this.headBobPhase += actualSpeed * delta * 2.8;
    const bobStrength = THREE.MathUtils.clamp(actualSpeed / FIRST_PERSON_LOCOMOTION.sprintSpeed, 0, 1);
    const headBob = this.verticalLocomotion.grounded ? Math.sin(this.headBobPhase) * 0.032 * bobStrength : 0;
    this.firstPersonCamera.position.set(
      this.playerPosition.x,
      this.playerPosition.y + headBob + this.verticalLocomotion.landingCompression,
      this.playerPosition.z,
    );
    const targetFov = sprinting && actualSpeed > FIRST_PERSON_LOCOMOTION.walkSpeed ? 74 : 70;
    this.firstPersonCamera.fov += (targetFov - this.firstPersonCamera.fov) * (1 - Math.exp(-delta * 8));
    this.firstPersonCamera.updateProjectionMatrix();
    this.firstPersonCamera.rotation.order = "YXZ";
    this.firstPersonCamera.rotation.set(this.firstPersonPitch, this.firstPersonYaw, 0);
  }

  private pointerToCell(event: PointerEvent | WheelEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const activeCamera = this.cameraMode === "firstPerson" ? this.firstPersonCamera : this.camera;
    this.raycaster.setFromCamera(this.pointer, activeCamera);
    const interactionRoot = this.activeStratumId === "surface" ? this.environment.terrain.root : this.environment.caves.interactionRoot;
    const point = this.raycaster.intersectObject(interactionRoot, true)[0]?.point;
    if (!point) return null;
    this.hitPoint.copy(point);
    const bounds = this.world.bounds;
    const anchor = worldPointToAnchorCell(this.hitPoint);
    return {
      x: THREE.MathUtils.clamp(anchor.x, bounds.minX, bounds.maxX),
      z: THREE.MathUtils.clamp(anchor.z, bounds.minZ, bounds.maxZ),
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
    const definition = this.selectedBuildingId ? START_REGISTRY.buildings.get(this.selectedBuildingId) : null;
    const projection = definition
      ? projectPlacement(definition, this.currentCell, this.rotation)
      : null;
    const elevation = projection
      ? this.elevationAt(projection.modelTransform.position.x, projection.modelTransform.position.z)
      : this.elevationAt(this.currentCell.x, this.currentCell.z);
    this.ghostValid = this.selectedBuildingId
      ? this.campaignWorld.previewConstruction({
        buildingId: this.selectedBuildingId,
        position: { x: this.currentCell.x, z: this.currentCell.z },
        rotation: this.rotation as 0 | 1 | 2 | 3,
        elevation,
        stratumId: this.activeStratumId,
      }).ok
      : this.simulation.canPlace(type, this.currentCell.x, this.currentCell.z);
    this.ghost.position.copy(projection
      ? new THREE.Vector3(
        projection.modelTransform.position.x,
        elevation,
        projection.modelTransform.position.z,
      )
      : modelPosition(type, this.currentCell.x, this.currentCell.z));
    if (!projection) this.ghost.position.y = this.elevationAt(this.ghost.position.x, this.ghost.position.z);
    this.ghost.rotation.y = projection
      ? projection.modelTransform.rotationY
      : this.rotation * (Math.PI / 2);
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
      const rotation = direction.x > 0 ? 0 : direction.x < 0 ? 2 : direction.z > 0 ? 1 : 3;
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
    const definition = this.selectedBuildingId ? START_REGISTRY.buildings.get(this.selectedBuildingId) : null;
    this.beltPreviewCells.forEach((cell) => {
      const projection = definition ? projectPlacement(definition, cell, cell.rotation) : null;
      const elevation = projection
        ? this.elevationAt(projection.modelTransform.position.x, projection.modelTransform.position.z)
        : this.elevationAt(cell.x, cell.z);
      const valid = this.simulation.canPlace("belt", cell.x, cell.z, reserved)
        && Boolean(this.selectedBuildingId && this.campaignWorld.previewConstruction({
          buildingId: this.selectedBuildingId,
          position: { x: cell.x, z: cell.z },
          rotation: cell.rotation as 0 | 1 | 2 | 3,
          elevation,
          stratumId: this.activeStratumId,
        }).ok);
      if (!valid) allValid = false;
      reserved.add(cellKey(cell.x, cell.z));
      const model = definition
        ? createBuildingModel(definition.id, this.materials)
        : createStructureModel("belt", this.materials);
      model.position.set(
        projection?.modelTransform.position.x ?? cell.x,
        elevation,
        projection?.modelTransform.position.z ?? cell.z,
      );
      model.rotation.y = projection?.modelTransform.rotationY ?? cell.rotation * (Math.PI / 2);
      this.recolorGhost(model, valid);
      this.beltPreview?.add(model);
    });
    if (definition) {
      const required = new Map<string, number>();
      definition.buildCost.forEach(({ itemId, amount }) => {
        required.set(itemId, (required.get(itemId) ?? 0) + amount * this.beltPreviewCells.length);
      });
      if ([...required].some(([itemId, amount]) => this.world.inventoryAmount(itemId) < amount)) {
        allValid = false;
        this.beltPreview.children.forEach((model) => this.recolorGhost(model as THREE.Group, false));
      }
    }
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
    this.callbacks.onSelected(id === null ? null : this.selectedInfo(id));
  }

  private selectedInfo(id: number): SelectedInfo {
    const data = this.simulation.structures.get(id);
    if (!data?.worldInstanceId) return this.simulation.getSelectedInfo(id);
    const state = this.worldProduction.nodeState(data.worldInstanceId);
    const definition = data.buildingId ? START_REGISTRY.buildings.get(data.buildingId) : null;
    if (!state || !definition) return this.simulation.getSelectedInfo(id);
    const recipe = state.selectedRecipeId ? START_REGISTRY.recipes.get(state.selectedRecipeId) : null;
    const items = (inventories: typeof state.inputs) => inventories
      .filter(({ itemId, amount }) => itemId && amount > 0)
      .map(({ itemId, amount }) => ({
        itemId: itemId!,
        name: START_REGISTRY.items.get(itemId!)?.name ?? itemId!,
        amount,
      }));
    const total = (inventories: typeof state.inputs, key: "amount" | "capacity") => (
      inventories.reduce((sum, inventory) => sum + inventory[key], 0)
    );
    const status = {
      working: "가동 중",
      starved: "원료 부족",
      blocked: "출력 막힘",
      disconnected: "연결 끊김",
      paused: state.powerSatisfaction < 0.999 ? "전력 부족" : "일시 정지",
      idle: recipe ? "가동 대기" : "물류 대기",
    }[state.runtimeState];
    return {
      id,
      type: data.type,
      buildingId: definition.id,
      status,
      runtimeState: state.runtimeState,
      recipeName: recipe?.name ?? (definition.recipeIds.length > 0 ? "레시피 선택 필요" : "물류 처리"),
      progress: state.progress,
      inputCount: total(state.inputs, "amount"),
      inputItems: items(state.inputs),
      inputCapacity: total(state.inputs, "capacity"),
      outputCount: total(state.outputs, "amount"),
      outputItems: items(state.outputs),
      outputCapacity: total(state.outputs, "capacity"),
    };
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
      ? this.worldHistory.execute(
        this.world,
        "place",
        `건설 · ${this.selectedBuildingId}`,
        () => this.campaignWorld.placeConstruction({
          buildingId: this.selectedBuildingId!,
          position: { x: this.currentCell.x, z: this.currentCell.z },
          rotation: this.rotation as 0 | 1 | 2 | 3,
          elevation: this.elevationAt(this.currentCell.x, this.currentCell.z),
          stratumId: this.activeStratumId,
        }),
        this.constructionCreditLedger(),
      )
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
        invalid_resource_anchor: "이 채취 설비와 맞는 천연자원 지점이 아닙니다",
        resource_locked: "아직 해금되지 않은 천연자원입니다",
        foundation_required: "연약하거나 고르지 않은 지반입니다. 기초가 필요합니다",
        terrain_steep: "경사가 너무 가파릅니다",
        terrain_submerged: "침수 지면에는 이 설비를 설치할 수 없습니다",
        terrain_hazard: "위험 지대를 먼저 안정화해야 합니다",
        terrain_clearance: "설비 바닥의 높이차가 너무 큽니다",
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
    } else {
      this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
      this.publishConstructionState();
    }
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
      ? this.worldHistory.execute(
        this.world,
        "place_batch",
        `경로 건설 · ${this.beltPreviewCells.length}칸`,
        () => this.campaignWorld.placeConstructionBatch(this.beltPreviewCells.map((cell) => ({
          buildingId: this.selectedBuildingId!,
          position: { x: cell.x, z: cell.z },
          rotation: cell.rotation as 0 | 1 | 2 | 3,
          elevation: this.elevationAt(cell.x, cell.z),
          stratumId: this.activeStratumId,
        }))),
        this.constructionCreditLedger(),
      )
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
    } else {
      this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
      this.publishConstructionState();
    }
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
    if (this.worldHistory.canUndo) {
      const result = this.worldHistory.undo(this.world);
      if (result.ok) {
        this.reconcileStructuresFromWorld();
        this.callbacks.onToast(`되돌리기 · ${result.command.label}`);
      } else {
        this.callbacks.onToast(result.reason === "insufficient_inventory" ? "되돌릴 재료가 부족합니다" : "설비 상태가 바뀌어 안전하게 되돌릴 수 없습니다");
      }
      return;
    }
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

  private redo() {
    const result = this.worldHistory.redo(this.world);
    if (!result.ok) {
      this.callbacks.onToast(result.reason === "empty" ? "다시 실행할 작업이 없습니다" : "현재 공장 상태에서는 다시 실행할 수 없습니다");
      return;
    }
    this.reconcileStructuresFromWorld();
    this.callbacks.onToast(`다시 실행 · ${result.command.label}`);
  }

  private constructionCreditLedger() {
    return {
      balances: () => this.campaignWorld.constructionCreditBalances(),
      applyDeltas: (deltas: readonly Readonly<{ id: string; amount: number }>[]) => (
        this.campaignWorld.applyConstructionCreditDeltas(deltas)
      ),
    };
  }

  private reconcileStructuresFromWorld() {
    const worldInstances = new Map(this.world.allInstances().map((instance) => [instance.id, instance]));
    [...this.simulation.structures.values()]
      .filter(({ worldInstanceId }) => worldInstanceId && !worldInstances.has(worldInstanceId))
      .forEach(({ id }) => this.removeStructure(id));
    const mirroredIds = new Set([...this.simulation.structures.values()].map(({ worldInstanceId }) => worldInstanceId).filter(Boolean));
    worldInstances.forEach((instance) => {
      const definition = START_REGISTRY.buildings.get(instance.definitionId);
      if (!definition || definition.placementMode === "preplaced_unique" || mirroredIds.has(instance.id)) return;
      this.addStructure({
        id: this.nextId++,
        type: legacyTypeForBuilding(instance.definitionId),
        buildingId: instance.definitionId,
        worldInstanceId: instance.id,
        x: instance.position.x,
        z: instance.position.z,
        rotation: instance.rotation,
      });
    });
    this.worldProduction.syncWorld();
    this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
    this.publishConstructionState();
    this.syncConnectionModels();
    this.updateGhost();
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
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, this.world.bounds.minX + 4, this.world.bounds.maxX - 3);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, this.world.bounds.minZ + 4, this.world.bounds.maxZ - 3);
      this.panOrigin = { x: event.clientX, y: event.clientY };
      return;
    }
    const cell = this.pointerToCell(event);
    if (!cell) return;
    this.currentCell = cell;
    this.hoverTile.position.set(cell.x + 0.5, this.elevationAt(cell.x + 0.5, cell.z + 0.5) + 0.035, cell.z + 0.5);
    if (this.beltStart) this.updateBeltPreview(cell, event.shiftKey);
    else this.updateGhost();
  };

  private onPointerDown = (event: PointerEvent) => {
    void this.environmentAudio.resume();
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
      if (cell) this.updateBeltPreview(cell, event.shiftKey);
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
        const constructionInstance = this.world.instance(structure.worldInstanceId);
        // Synchronize live buffers/WIP before the command captures its undo boundary.
        this.worldProduction.snapshot();
        const demolition = this.worldHistory.execute(
          this.world,
          "demolish",
          `철거 · ${structure.buildingId ? START_REGISTRY.buildings.get(structure.buildingId)?.name : structure.worldInstanceId}`,
          () => {
            const result = this.worldProduction.demolish(structure.worldInstanceId!);
            if (result.ok && constructionInstance) this.campaignWorld.refundConstructionCreditFor(constructionInstance);
            return result;
          },
          this.constructionCreditLedger(),
        );
        if (!demolition.ok) {
          this.callbacks.onToast("이 설비는 철거할 수 없습니다");
          return;
        }
      }
      const removed = this.removeStructure(id);
      if (removed) {
        if (removed.worldInstanceId) {
          this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
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

  private toggleStratum() {
    const zone = CAVE_ZONES[0];
    const entering = this.activeStratumId === "surface";
    const reference = this.cameraMode === "firstPerson" ? this.playerPosition : this.cameraTarget;
    const portalCandidates = zone.portals.map((portal, index) => ({
      portal,
      index,
      distance: Math.hypot(reference.x - portal.x, reference.z - portal.z),
    })).sort((a, b) => a.distance - b.distance);
    const nearest = portalCandidates[0];
    if (nearest.distance > 8) {
      this.callbacks.onToast(entering ? "열극 천공 입구 가까이에서 C를 눌러야 합니다" : "동굴 출구 가까이에서 C를 눌러야 합니다");
      return;
    }
    this.activeStratumId = entering ? zone.stratumId : "surface";
    this.environment.setStratum(this.activeStratumId);
    this.environmentAudio.setStratum(this.activeStratumId);
    if (entering) {
      const room = nearest.index === 0 ? zone.rooms[0] : zone.rooms.at(-1)!;
      this.playerPosition.set(room.center.x, room.center.y + 1.62, room.center.z);
      this.desiredTarget.set(room.center.x, room.center.y, room.center.z);
      this.cameraTarget.copy(this.desiredTarget);
    } else {
      const portal = nearest.portal;
      const elevation = this.elevationAt(portal.x, portal.z, "surface");
      this.playerPosition.set(portal.x, elevation + 1.62, portal.z);
      this.desiredTarget.set(portal.x, elevation, portal.z);
      this.cameraTarget.copy(this.desiredTarget);
    }
    this.playerVelocity.set(0, 0, 0);
    this.verticalLocomotion = initialVerticalLocomotionState();
    this.jumpRequested = false;
    this.headBobPhase = 0;
    this.collisionIndex = new WorldCollisionIndex(this.world, 8, this.activeStratumId);
    this.groups.forEach((group) => { group.visible = (group.userData.stratumId ?? "surface") === this.activeStratumId; });
    this.connectionGroups.forEach((group) => {
      group.visible = (group.userData.strata as string[] | undefined)?.includes(this.activeStratumId) ?? this.activeStratumId === "surface";
    });
    this.worldItemMeshes.forEach((mesh, key) => {
      const connection = this.connectionGroups.get(key);
      mesh.visible = (connection?.userData.strata as string[] | undefined)?.includes(this.activeStratumId) ?? this.activeStratumId === "surface";
    });
    this.resourceGroups.forEach((group) => {
      group.visible = group.userData.stratumId === this.activeStratumId;
    });
    this.powerCoreGroup.visible = !entering;
    this.projectDockGroup.visible = !entering;
    this.buildGrid.position.y = entering ? zone.rooms[1].center.y + 0.02 : 0.012;
    this.updateCamera();
    this.updateGhost();
    this.publishEnvironment();
    this.callbacks.onToast(entering ? "열극 심층부로 진입했습니다 · C 지상 복귀" : "지상 열극 입구로 복귀했습니다");
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.inputLocked) return;
    const key = event.key.toLowerCase();
    if (event.repeat && !["w", "a", "s", "d"].includes(key)) return;
    this.pressed.add(key);
    if (this.cameraMode === "firstPerson" && (key === " " || key === "spacebar")) {
      event.preventDefault();
      this.jumpRequested = true;
      return;
    }
    if (key === "v") {
      this.toggleCameraMode();
      return;
    }
    if (key === "c") {
      this.toggleStratum();
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
      this.cycleSelectedRecipe();
      return;
    }
    if (key === "l" && this.activeTool === "inspect") {
      this.connectSelectedPowerCable();
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
      if (event.shiftKey) this.redo();
      else this.undo();
    }
    if (key === "y" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.redo();
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
      mesh.visible = this.activeStratumId === "surface";
      mesh.rotation.y += delta * (item.type.endsWith("_ore") ? 1.2 : item.type === "iron_plate" ? 2.2 : 0.35);
    });
    this.itemMeshes.forEach((mesh, id) => {
      if (activeItemIds.has(id)) return;
      this.scene.remove(mesh);
      this.itemMeshes.delete(id);
    });
  }

  private syncWorldConnectionItems(delta: number) {
    const active = new Set<string>();
    this.worldProduction.connectionStates().forEach((connection) => {
      if (connection.medium !== "solid" || !connection.itemId) return;
      const key = `${connection.fromInstanceId}:${connection.fromPortId}->${connection.toInstanceId}:${connection.toPortId}`;
      const connectionGroup = this.connectionGroups.get(key);
      const path = connectionGroup?.userData.pathPoints as Array<[number, number, number]> | undefined;
      if (!connectionGroup || !path || path.length < 2) return;
      active.add(key);
      let mesh = this.worldItemMeshes.get(key);
      if (!mesh || mesh.userData.itemId !== connection.itemId) {
        if (mesh) this.scene.remove(mesh);
        mesh = createItemModel(connection.itemId, this.materials);
        mesh.scale.setScalar(0.78);
        mesh.userData.itemId = connection.itemId;
        this.worldItemMeshes.set(key, mesh);
        this.scene.add(mesh);
      }
      const previous = (mesh.userData.travel as number | undefined) ?? 0;
      const travel = connection.flowing && !connection.blocked ? (previous + delta * 0.72) % 1 : Math.min(previous, 0.92);
      mesh.userData.travel = travel;
      const points = path.map(([x, y, z]) => new THREE.Vector3(x, y + 0.18, z));
      const lengths = points.slice(1).map((point, index) => point.distanceTo(points[index]));
      const totalLength = lengths.reduce((sum, length) => sum + length, 0);
      let remaining = travel * totalLength;
      let position = points[0];
      for (let index = 1; index < points.length; index += 1) {
        const segmentLength = lengths[index - 1];
        if (remaining <= segmentLength || index === points.length - 1) {
          position = points[index - 1].clone().lerp(points[index], segmentLength > 0 ? remaining / segmentLength : 0);
          break;
        }
        remaining -= segmentLength;
      }
      mesh.position.copy(position);
      mesh.visible = (connectionGroup.userData.strata as string[] | undefined)?.includes(this.activeStratumId) ?? true;
      mesh.rotation.y += delta * 1.8;
    });
    this.worldItemMeshes.forEach((mesh, key) => {
      if (active.has(key)) return;
      this.scene.remove(mesh);
      this.worldItemMeshes.delete(key);
    });
    this.itemMeshes.forEach((mesh) => { mesh.visible = this.activeStratumId === "surface"; });
  }

  private updateBuildingLods() {
    const camera = this.activeCamera;
    camera.updateMatrixWorld();
    const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const decisions = new Map(classifyBuildingLods(
      createWorldBuildingLodSubjects(this.world),
      { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      {
        nearDistance: this.cameraMode === "firstPerson" ? 12 : 18,
        farDistance: this.cameraMode === "firstPerson" ? 32 : 45,
        maxDistance: this.cameraMode === "firstPerson" ? 72 : 95,
        frustumPlanes: frustumPlanesFromMatrix(projectionView.elements),
      },
    ).map((decision) => [decision.instanceId, decision]));
    this.simulation.structures.forEach((structure, id) => {
      if (!structure.worldInstanceId) return;
      const group = this.groups.get(id);
      const decision = decisions.get(structure.worldInstanceId);
      if (!group || !decision) return;
      group.visible = decision.visible && (group.userData.stratumId ?? "surface") === this.activeStratumId;
      group.userData.lodTier = decision.detailTier;
    });
  }

  private animateMachines(delta: number) {
    const campaignPower = this.campaignWorld.powerResult();
    const legacyPower = this.simulation.getPowerGrid();
    const supplyMW = campaignPower?.capacityMW ?? legacyPower.supplyMW;
    const servedMW = campaignPower?.servedMW ?? legacyPower.servedMW;
    const demandMW = campaignPower?.requestedMW ?? legacyPower.demandMW;
    const overloaded = campaignPower
      ? campaignPower.satisfaction < 0.999 || campaignPower.mainBreakerTripped
      : legacyPower.overloaded;
    this.simulation.structures.forEach((data, id) => {
      const group = this.groups.get(id);
      if (!group || !group.visible) return;
      if (group.userData.lodTier === 2 && (Math.floor(this.elapsed * 4) + id) % 4 !== 0) return;
      const state = this.simulation.machines.get(id);
      const worldState = data.worldInstanceId ? this.worldProduction.nodeState(data.worldInstanceId) : null;
      const definition = data.buildingId ? START_REGISTRY.buildings.get(data.buildingId) : null;
      const runtimeState = worldState?.runtimeState ?? (state?.working ? "working" : "idle");
      const progress = worldState?.progress ?? state?.progress ?? 0;
      const activity = worldState ? (runtimeState === "working" ? 1 : 0) : state?.activity ?? 1;
      const inputCount = worldState
        ? worldState.inputs.reduce((total, inventory) => total + inventory.amount, 0)
        : state?.input.length ?? 0;
      const outputQueued = worldState
        ? worldState.outputs.some(({ amount }) => amount > 0)
        : (state?.output.length ?? 0) > 0;
      const connectedPortIds = new Set(worldState?.connectedPortIds ?? []);
      const inputConnections = worldState && definition
        ? definition.ports.filter(({ direction }) => direction !== "output").map(({ id: portId }) => connectedPortIds.has(portId))
        : isTransportType(data.type) ? [] : this.simulation.getInputConnections(data);
      const hasInputConnection = inputConnections.some(Boolean);
      const hasOutputConnection = worldState && definition
        ? definition.ports.filter(({ direction }) => direction !== "input").some(({ id: portId }) => connectedPortIds.has(portId))
        : !isTransportType(data.type) && this.simulation.hasOutputConnection(data);
      const beltItem = isTransportType(data.type) ? this.simulation.beltItems.get(id) : undefined;
      const machineTime = (worldState ? this.elapsed * Math.max(activity, 0.08) : state?.animationTime ?? this.elapsed) + id * 0.17;
      const genericModel = group.userData.modelSource === "generic";
      if (genericModel) {
        animateGenericBuildingModel(group, {
          time: machineTime,
          progress: beltItem ? beltItem.progress : progress,
          activity: worldState ? activity : state?.activity ?? (beltItem ? 1 : 0),
          runtimeState: worldState?.runtimeState ?? (state?.working || beltItem
            ? "working"
            : outputQueued ? "blocked" : hasInputConnection ? "idle" : "disconnected"),
        });
      }
      if (!genericModel && data.type === "miner") {
        animateMinerModel(group, {
          time: machineTime,
          delta,
          progress,
          activity,
          working: runtimeState === "working",
          outputQueued,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "smelter") {
        animateSmelterModel(group, {
          time: machineTime,
          delta,
          progress,
          activity,
          working: runtimeState === "working",
          inputCount,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "crusher") {
        animateCrusherModel(group, {
          time: machineTime,
          delta,
          progress,
          activity,
          working: runtimeState === "working",
          inputCount,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "assembler") {
        animateAssemblerModel(group, {
          time: machineTime,
          delta,
          progress,
          activity,
          working: runtimeState === "working",
          inputCount,
          outputQueued,
          inputConnected: hasInputConnection,
          outputConnected: hasOutputConnection,
        });
      }
      if (!genericModel && data.type === "storage") {
        animateStorageModel(group, {
          time: machineTime,
          delta,
          stored: worldState ? inputCount + worldState.outputs.reduce((total, inventory) => total + inventory.amount, 0) : state?.stored ?? 0,
          capacity: worldState ? [...worldState.inputs, ...worldState.outputs].reduce((total, inventory) => total + inventory.capacity, 0) : STORAGE_CAPACITY,
          intakePulse: worldState && runtimeState === "working" ? 1 : state?.intakePulse ?? 0,
          inputConnected: hasInputConnection,
        });
      }
      const beltJammed = worldState?.runtimeState === "blocked" || Boolean(beltItem && beltItem.progress >= 0.979);
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
          activity: worldState ? activity : beltItem ? 1 : 0,
          working: worldState ? runtimeState === "working" : Boolean(beltItem && !beltJammed),
          blocked: beltJammed,
          disconnected: runtimeState === "disconnected",
        });
      }
      if (!isTransportType(data.type)) {
        const powered = worldState
          ? worldState.powerSatisfaction >= 0.999
          : legacyPower.poweredByStructureId.get(id) ?? true;
        applyGridVisualState(group, {
          time: this.elapsed,
          powered,
          overloaded: overloaded && !powered,
          supplyRatio: demandMW > 0 ? servedMW / demandMW : 1,
        });
      }
    });
    const powerState = {
      time: this.elapsed,
      delta,
      generating: true,
      connected: true,
      supplyRatio: demandMW > 0 ? servedMW / demandMW : 1,
      loadRatio: supplyMW > 0 ? demandMW / supplyMW : 0,
      overloaded,
    };
    animateFieldPowerCoreModel(this.powerCoreGroup, powerState);
    animateDistributionPoleModel(this.powerPoleGroup, powerState);
    const project = this.activeProjectProgress();
    const delivered = Object.fromEntries((project?.deliveries ?? []).map((delivery) => [delivery.itemId, delivery.delivered]));
    animateProjectDockModel(this.projectDockGroup, {
      time: this.elapsed,
      progress: project?.totalProgress ?? 0,
      deliveryCounts: {
        ironPlate: delivered.iron_plate ?? 0,
        constructionBlock: delivered.construction_block ?? 0,
        fastenerPack: delivered.fastener_pack ?? 0,
      },
      completed: project?.completed ?? false,
    });
  }

  private publishPower() {
    const grids = this.physicalPower.powerResults();
    const power = grids.length > 0 ? {
      supplyMW: grids.reduce((sum, grid) => sum + grid.capacityMW, 0),
      demandMW: grids.reduce((sum, grid) => sum + grid.requestedMW, 0),
      servedMW: grids.reduce((sum, grid) => sum + grid.servedMW, 0),
      overloaded: grids.some((grid) => grid.satisfaction < 0.999 || grid.mainBreakerTripped),
    } : this.simulation.getPowerGrid();
    const signature = `${power.supplyMW}:${power.demandMW}:${power.servedMW}:${power.overloaded}`;
    if (signature === this.lastPowerSignature) return;
    this.lastPowerSignature = signature;
    this.callbacks.onPower(power);
  }

  private stepCampaignPower(delta: number) {
    const overrides: Record<string, PowerInstanceRuntime> = {};
    const activePoweredStage = [...START_REGISTRY.projectStages.values()].find((stage) => (
      stage.dockPowerMode === "powered"
      && this.campaignWorld.campaign.isUnlocked(stage.id)
      && this.campaignWorld.campaign.progress(stage.id)?.completed === false
    ));
    this.simulation.structures.forEach((structure) => {
      if (!structure.worldInstanceId) return;
      const state = this.worldProduction.nodeState(structure.worldInstanceId);
      const definition = structure.buildingId ? START_REGISTRY.buildings.get(structure.buildingId) : null;
      const powerNode = this.powerTopology.nodes.find(({ instanceId }) => instanceId === structure.worldInstanceId);
      overrides[structure.worldInstanceId] = {
        active: definition?.id === "project_dock"
          ? activePoweredStage !== undefined
          : state?.runtimeState === "working" || (isTransportType(structure.type) && state?.runtimeState !== "disconnected"),
        ...(powerNode?.priority ? { priority: powerNode.priority } : {}),
      };
    });
    const projectDock = this.world.allInstances().find(({ definitionId }) => definitionId === "project_dock");
    if (projectDock) overrides[projectDock.id] = {
      ...overrides[projectDock.id],
      active: activePoweredStage !== undefined,
      requestedMW: activePoweredStage !== undefined ? activePoweredStage.requiredPowerMW ?? 32 : 0,
    };
    this.powerTopology.nodes.filter(({ roles }) => roles.includes("generator")).forEach(({ instanceId }) => {
      const fuel = this.physicalPower.generatorFuelState(instanceId);
      if (!fuel || fuel.buffered >= fuel.capacity) return;
      const state = this.worldProduction.nodeState(instanceId);
      const input = state?.inputs.find(({ itemId, amount }) => itemId === fuel.fuelItemId && amount > 0);
      if (!input) return;
      const amount = Math.min(input.amount, fuel.capacity - fuel.buffered);
      if (amount > 0 && this.worldProduction.withdraw(instanceId, input.portId, "input", fuel.fuelItemId, amount)) {
        this.physicalPower.supplyGeneratorFuel(instanceId, fuel.fuelItemId, amount);
      }
    });
    const result = this.physicalPower.step(delta, overrides);
    this.powerTopology = result.topology;
    result.visualStates.forEach(({ instanceId, satisfaction }) => {
      if (this.worldProduction.nodeState(instanceId)) this.worldProduction.setPowerSatisfaction(instanceId, satisfaction);
    });
    const dockSupplied = projectDock
      ? result.grids.flatMap(({ consumers }) => consumers).find(({ id }) => id === projectDock.id)?.servedMW ?? 0
      : 0;
    this.campaignWorld.setDockSuppliedPowerMW(dockSupplied);
    const poweredByWorldId = new Map(result.grids.flatMap(({ consumers }) => consumers)
      .map((consumer) => [consumer.id, consumer.satisfaction >= 0.999] as const));
    this.simulation.setExternalPowerAvailability(new Map(
      [...this.simulation.structures.values()].map((structure) => [
        structure.id,
        structure.worldInstanceId ? poweredByWorldId.get(structure.worldInstanceId) ?? true : true,
      ]),
    ));
    this.syncEnvironmentHazards();
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
    const progress = this.activeProjectProgress();
    if (!progress) return;
    const signature = `${progress.stageId}:${progress.deliveries.map(({ delivered }) => delivered).join(":")}`;
    if (signature === this.lastProjectSignature) return;
    this.lastProjectSignature = signature;
    this.callbacks.onProject({
      stageName: PROJECT_STAGE_NAMES[progress.stageId] ?? progress.stageId,
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

  private activeProjectProgress() {
    const progress = this.campaignWorld.campaign.allProgress();
    return progress.find((stage) => !stage.completed && this.campaignWorld.campaign.isUnlocked(stage.stageId))
      ?? progress.at(-1)
      ?? null;
  }

  private deliverToActiveProject(request: Readonly<{ portId: string; itemId: string; amount: number }>) {
    const active = this.activeProjectProgress();
    if (!active || active.completed) return false;
    const result = this.campaignWorld.deliverProject(active.stageId, request);
    if (result.accepted) {
      this.publishConstructionState();
      this.publishProject();
    }
    return result.accepted;
  }

  private animate = (time: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const elapsedSeconds = (time - this.lastTime) / 1000;
    this.lastTime = time;
    // requestAnimationFrame can reuse a timestamp on the first frame or after
    // hot replacement. Simulation clocks require positive time, so render the
    // current state without advancing instead of forwarding a zero/negative dt.
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      this.renderer.render(this.scene, this.activeCamera);
      return;
    }
    const delta = Math.min(elapsedSeconds, 0.05);
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
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, this.world.bounds.minX + 4, this.world.bounds.maxX - 3);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, this.world.bounds.minZ + 4, this.world.bounds.maxZ - 3);
      this.cameraTarget.lerp(this.desiredTarget, 1 - Math.exp(-delta * 11));
      this.updateCamera();
    } else {
      this.updateFirstPerson(delta);
    }

    this.stepCampaignPower(delta);
    this.simulation.update(delta);
    this.worldProduction.advance(delta, {
      afterTick: (_tick, fixedDelta) => {
        const accepted = this.dockCommitter.advanceFixedTick(fixedDelta);
        if (accepted.acceptedAmount > 0) {
          this.publishConstructionState();
          this.publishProject();
        }
      },
    });
    if (this.elapsed - this.lastConnectionSyncTime >= 0.25) {
      this.lastConnectionSyncTime = this.elapsed;
      this.syncConnectionModels();
    }
    if (this.elapsed - this.lastLodSyncTime >= 0.25) {
      this.lastLodSyncTime = this.elapsed;
      this.updateBuildingLods();
    }
    this.syncPhaseOneCampaign();
    this.publishPower();
    this.publishProject();
    this.syncItems(delta);
    this.syncWorldConnectionItems(delta);
    this.animateMachines(delta);
    this.animateConnections();
    this.environment.update(delta, this.activeCamera);
    if (this.elapsed - this.lastEnvironmentUiTime >= 0.5) {
      this.lastEnvironmentUiTime = this.elapsed;
      this.publishEnvironment();
    }
    this.selectedUiClock += delta;
    if (this.selectedId !== null && this.selectedUiClock >= 0.2) {
      this.selectedUiClock = 0;
      this.callbacks.onSelected(this.selectedInfo(this.selectedId));
    }
    const motors = this.simulation.getStoredComponents();
    if (motors !== this.lastMotorCount) {
      this.lastMotorCount = motors;
      this.callbacks.onMotors(motors);
    }
    this.renderer.render(this.scene, this.activeCamera);
  };

  private publishEnvironment() {
    const reference = this.cameraMode === "firstPerson" ? this.playerPosition : this.cameraTarget;
    this.exploration.discoverNear(reference.x, reference.z, this.activeStratumId).forEach((site) => {
      this.environment.exploration.setDiscovered(site.id);
      this.campaignWorld.applyConstructionCreditDeltas([{ id: site.reward.creditId, amount: site.reward.amount }]);
      if (site.reward.unlockId) this.world.unlock(site.reward.unlockId);
      this.publishConstructionState();
      this.callbacks.onToast(`탐사 완료 · ${site.name} · ${site.reward.label}`);
    });
    const info = {
      ...this.environment.runtimeInfo(reference.x, reference.z, this.activeStratumId),
      explorationDiscovered: this.exploration.snapshot().discoveredSiteIds.length,
      explorationTotal: this.exploration.total(),
      audioMuted: this.environmentAudio.isMuted(),
    };
    this.syncEnvironmentHazards();
    this.environmentAudio.setWeather(info.weather, info.weatherStrength);
    this.callbacks.onEnvironment(info);
  }

  private stabilizedEnvironmentHazardIds() {
    return A17_ENVIRONMENT.landmarks
      .filter(({ kind, position }) => kind === "vent"
        && this.world.isHazardStabilizedAt({ x: position.x, z: position.z }, "surface"))
      .map(({ id }) => id)
      .sort();
  }

  private syncEnvironmentHazards() {
    const stabilized = new Set(this.stabilizedEnvironmentHazardIds());
    A17_ENVIRONMENT.landmarks.filter(({ kind }) => kind === "vent")
      .forEach(({ id }) => this.environment.props.setHazardState(id, stabilized.has(id)));
  }
}
