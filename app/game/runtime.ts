import * as THREE from "three";
import { COST, STORAGE_CAPACITY, TYPE_NAME, cellKey, directionForRotation, machinePorts, sameDirection } from "./config";
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
import { FactorySimulation } from "./simulation";
import { buildLiveTelemetry } from "./telemetry/live.ts";
import { buildRuntimeTopology } from "./telemetry/topology.ts";
import type {
  BuildType,
  CameraMode,
  Cell,
  GameCallbacks,
  HistoryEntry,
  StructureData,
  Tool,
} from "./types";

const modelPosition = (type: BuildType, x: number, z: number) =>
  type === "belt" ? new THREE.Vector3(x, 0, z) : new THREE.Vector3(x + 0.5, 0, z + 0.5);

export class FactoryRuntime {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 120);
  private readonly firstPersonCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  private readonly materials = createFactoryMaterials();
  private readonly simulation = new FactorySimulation();
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
  private ghostValid = false;
  private beltStart: Cell | null = null;
  private beltPreview: THREE.Group | null = null;
  private beltPreviewCells: Array<Cell & { rotation: number }> = [];
  private beltBuildSignature = "";
  private panning = false;
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
  private lastMotorCount = -1;
  private selectedUiClock = 0;

  constructor(
    private readonly mount: HTMLDivElement,
    private readonly callbacks: GameCallbacks,
  ) {
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

    this.setupWorld();
    this.seedFactory();
    this.bindEvents();
    this.resize();
    this.updateCamera();
    this.callbacks.onCredits(this.credits);
    this.callbacks.onMotors(0);
    this.callbacks.onCameraMode(this.cameraMode);
    this.callbacks.onPointerLock(false);
    this.updateBeltBuildInfo(false);
    this.animate(performance.now());
  }

  setTool(tool: Tool) {
    this.activeTool = tool;
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

  getLiveTelemetry() {
    return buildLiveTelemetry(this.simulation);
  }

  getProductionTopology() {
    return buildRuntimeTopology(this.simulation);
  }

  toggleCameraMode() {
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
    this.scene.add(this.hoverTile);
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
    const group = createStructureModel(data.type, this.materials);
    group.position.copy(modelPosition(data.type, data.x, data.z));
    group.rotation.y = data.rotation * (Math.PI / 2);
    group.userData.structureId = data.id;
    group.traverse((child) => {
      child.userData.structureId = data.id;
    });
    this.groups.set(data.id, group);
    this.scene.add(group);
    this.nextId = Math.max(this.nextId, data.id + 1);
    return data;
  }

  private removeStructure(id: number) {
    const data = this.simulation.removeStructure(id);
    const group = this.groups.get(id);
    if (group) this.scene.remove(group);
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
  }

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
    if (!this.ghost || this.ghostType !== type) {
      this.clearGhost();
      this.ghost = createStructureModel(type, this.materials);
      this.ghostType = type;
      this.scene.add(this.ghost);
    }
    this.ghostValid = this.simulation.canPlace(type, this.currentCell.x, this.currentCell.z);
    this.ghost.position.copy(modelPosition(type, this.currentCell.x, this.currentCell.z));
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
      if (machine.type === "belt" || machine.type === "storage") return false;
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
    const cost = COST[type];
    if (this.credits < cost) {
      this.callbacks.onToast("크레딧이 부족합니다");
      return;
    }
    const data = this.addStructure({
      id: this.nextId++,
      type,
      x: this.currentCell.x,
      z: this.currentCell.z,
      rotation: this.rotation,
    });
    this.history.push({ added: [{ ...data }], removed: [], creditDelta: -cost });
    this.changeCredits(this.credits - cost);
    this.callbacks.onToast(`${TYPE_NAME[type]} 설치 완료`);
    this.updateGhost();
  }

  private commitBelts() {
    if (!this.ghostValid || !this.beltPreviewCells.length) {
      this.callbacks.onToast("경로가 막혀 있습니다");
      return;
    }
    const cost = COST.belt * this.beltPreviewCells.length;
    if (this.credits < cost) {
      this.callbacks.onToast("크레딧이 부족합니다");
      return;
    }
    const added = this.beltPreviewCells.map((cell) =>
      this.addStructure({ id: this.nextId++, type: "belt", x: cell.x, z: cell.z, rotation: cell.rotation }),
    );
    this.history.push({ added: added.map((data) => ({ ...data })), removed: [], creditDelta: -cost });
    this.changeCredits(this.credits - cost);
    const connected = added.some((belt) =>
      Array.from(this.simulation.structures.values()).some(
        (machine) => machine.type !== "belt"
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
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.updateBeltPreview(this.currentCell, event.shiftKey);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.cameraMode === "firstPerson") return;
    if (this.panning) {
      this.panning = false;
      this.renderer.domElement.releasePointerCapture(event.pointerId);
      this.setTool(this.activeTool);
      return;
    }
    if (event.button !== 0) return;
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
      const removed = this.removeStructure(id);
      if (removed) {
        const refund = Math.floor(COST[removed.type] * 0.5);
        this.history.push({ added: [], removed: [removed], creditDelta: refund });
        this.changeCredits(this.credits + refund);
        this.callbacks.onToast(`${TYPE_NAME[removed.type]} 철거 · ${refund} 환급`);
      }
      return;
    }
    this.commitMachine(this.activeTool as BuildType);
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.cameraMode === "firstPerson") return;
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * Math.exp(-event.deltaY * 0.001), 0.72, 2.2);
  };

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (this.cameraMode === "firstPerson") return;
    this.setTool("inspect");
    this.callbacks.onToast("건설 작업을 취소했습니다");
  };

  private onKeyDown = (event: KeyboardEvent) => {
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
      x: "demolish",
    };
    if (tools[key]) this.setTool(tools[key]);
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
      mesh.rotation.y += delta * (item.type === "ore" ? 1.2 : item.type === "component" ? 2.2 : 0.35);
    });
    this.itemMeshes.forEach((mesh, id) => {
      if (activeItemIds.has(id)) return;
      this.scene.remove(mesh);
      this.itemMeshes.delete(id);
    });
  }

  private animateMachines(delta: number) {
    this.simulation.structures.forEach((data, id) => {
      const group = this.groups.get(id);
      if (!group) return;
      const state = this.simulation.machines.get(id);
      const machineTime = (state?.animationTime ?? this.elapsed) + id * 0.17;
      const activity = state?.activity ?? 1;
      const outputQueued = (state?.output.length ?? 0) > 0;
      const inputConnections = data.type === "belt" ? [] : this.simulation.getInputConnections(data);
      const hasInputConnection = inputConnections.some(Boolean);
      const hasOutputConnection = data.type !== "belt" && this.simulation.hasOutputConnection(data);
      if (data.type === "miner") {
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
      if (data.type === "smelter") {
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
      if (data.type === "assembler") {
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
      if (data.type === "storage") {
        animateStorageModel(group, {
          time: machineTime,
          delta,
          stored: state?.stored ?? 0,
          capacity: STORAGE_CAPACITY,
          intakePulse: state?.intakePulse ?? 0,
          inputConnected: hasInputConnection,
        });
      }
      const beltItem = data.type === "belt" ? this.simulation.beltItems.get(id) : undefined;
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
        if ((role === "inputPort" || role === "outputPort") && part instanceof THREE.Mesh && data.type !== "belt") {
          const inputIndex = (part.userData.inputIndex as number | undefined) ?? 0;
          const connected = role === "inputPort"
            ? (inputConnections[inputIndex] ?? false)
            : hasOutputConnection;
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = connected ? 1.6 : 0.15;
        }
      });
    });
  }

  private animate = (time: number) => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.elapsed += delta;

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

    this.simulation.update(delta);
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
