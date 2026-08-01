import * as THREE from "three";
import { COST, TYPE_NAME, cellKey, directionForRotation, machinePorts } from "./config";
import {
  createFactoryMaterials,
  createItemModel,
  createOrePatch,
  createStructureModel,
} from "./models";
import { FactorySimulation } from "./simulation";
import type {
  BuildType,
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
  private panning = false;
  private panOrigin = { x: 0, y: 0 };
  private pointerDown = { x: 0, y: 0 };
  private cameraAngle = Math.PI * 0.25;
  private desiredCameraAngle = this.cameraAngle;
  private cameraAngularVelocity = 0;
  private cameraZoom = 1;
  private readonly cameraTarget = new THREE.Vector3(0, 0, 0);
  private readonly desiredTarget = new THREE.Vector3(0, 0, 0);
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
    this.animate(performance.now());
  }

  setTool(tool: Tool) {
    this.activeTool = tool;
    this.callbacks.onToolChange(tool);
    this.beltStart = null;
    if (this.beltPreview) this.scene.remove(this.beltPreview);
    this.beltPreview = null;
    this.beltPreviewCells = [];
    this.renderer.domElement.style.cursor =
      tool === "demolish" ? "not-allowed" : tool === "inspect" ? "default" : "crosshair";
    this.updateGhost();
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
      if (child instanceof THREE.Mesh) child.material = valid ? this.ghostMaterialValid : this.ghostMaterialInvalid;
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
    const cells: Array<Cell & { rotation: number }> = [];
    let x = start.x;
    let z = start.z;
    const push = (nextX: number, nextZ: number, rotation: number) => {
      if (!cells.some((cell) => cell.x === nextX && cell.z === nextZ)) cells.push({ x: nextX, z: nextZ, rotation });
    };
    push(x, z, this.rotation);
    const walkX = () => {
      while (x !== end.x) {
        const step = Math.sign(end.x - x);
        x += step;
        push(x, z, step > 0 ? 1 : 3);
      }
    };
    const walkZ = () => {
      while (z !== end.z) {
        const step = Math.sign(end.z - z);
        z += step;
        push(x, z, step > 0 ? 0 : 2);
      }
    };
    if (zFirst) {
      walkZ();
      walkX();
    } else {
      walkX();
      walkZ();
    }
    if (cells.length > 1) cells[0].rotation = cells[1].rotation;
    return cells;
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
        (machine) => machine.type !== "belt" && machinePorts(machine).output.x === belt.x && machinePorts(machine).output.z === belt.z,
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
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * Math.exp(-event.deltaY * 0.001), 0.72, 2.2);
  };

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    this.setTool("inspect");
    this.callbacks.onToast("건설 작업을 취소했습니다");
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (event.repeat && !["w", "a", "s", "d"].includes(key)) return;
    this.pressed.add(key);
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
      this.updateGhost();
      this.callbacks.onToast("설비 방향을 회전했습니다");
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
      const direction = directionForRotation(belt.rotation);
      const travel = (item.progress - 0.5) * 0.86;
      mesh.position.set(belt.x + direction.x * travel, 0.48, belt.z + direction.z * travel);
      mesh.rotation.y += delta * (item.type === "ore" ? 1.2 : item.type === "component" ? 2.2 : 0.35);
    });
    this.itemMeshes.forEach((mesh, id) => {
      if (activeItemIds.has(id)) return;
      this.scene.remove(mesh);
      this.itemMeshes.delete(id);
    });
  }

  private animateMachines() {
    this.simulation.structures.forEach((data, id) => {
      const group = this.groups.get(id);
      if (!group) return;
      const state = this.simulation.machines.get(id);
      const machineTime = (state?.animationTime ?? this.elapsed) + id * 0.17;
      const activity = state?.activity ?? 1;
      group.traverse((part) => {
        const role = part.userData.animationRole as string | undefined;
        if (role === "beltRoller") part.rotation.x = -this.elapsed * 9;
        if (role === "beltSlat") {
          const offset = part.userData.offset as number;
          part.position.z = ((offset + this.elapsed * 0.62 + 0.45) % 0.9) - 0.45;
        }
        if (role === "minerDrill") {
          const baseY = part.userData.baseY as number;
          const stroke = Math.pow((Math.sin(machineTime * 4.1) + 1) * 0.5, 2) * activity;
          part.position.y = baseY - stroke * 0.22;
          part.rotation.y = machineTime * 7.5;
        }
        if (role === "minerGear") part.rotation.z = -machineTime * 4.8;
        if (role === "smelterGlow" && part instanceof THREE.Mesh) {
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) {
            material.emissiveIntensity = 0.3 + activity * (1.9 + Math.sin(machineTime * 5.4) * 0.7);
          }
        }
        if (role === "smelterHeatRing" && part instanceof THREE.Mesh) {
          const heat = 1 + Math.sin(machineTime * 5.4) * 0.035 * activity;
          part.scale.setScalar(heat);
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) material.opacity = 0.12 + activity * 0.55;
        }
        if (role === "smelterFan") part.rotation.z = -machineTime * 5.6;
        if (role === "smelterSmoke" && part instanceof THREE.Mesh) {
          const smokePhase = (machineTime * 0.34 + (part.userData.offset as number)) % 1;
          part.position.y = (part.userData.baseY as number) + smokePhase * 0.92;
          part.position.x = 0.34 + Math.sin(smokePhase * Math.PI * 2) * 0.08;
          part.scale.setScalar(0.55 + smokePhase * 1.25);
          const material = part.material;
          if (material instanceof THREE.MeshStandardMaterial) material.opacity = (1 - smokePhase) * 0.24 * activity;
        }
        if (role === "assemblerTurntable") part.rotation.y = machineTime * 1.55;
        if (role === "assemblerWorkpiece") {
          part.rotation.y = -machineTime * 1.55;
          part.position.y = 1.02 + Math.sin(machineTime * 6.2) * 0.025 * activity;
        }
        if (role === "assemblerArm") {
          const baseY = part.userData.baseY as number;
          const phase = machineTime * 0.72 + (part.userData.phase as number);
          const press = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 5) * activity;
          part.position.y = baseY - press * 0.39;
        }
        if ((role === "inputPort" || role === "outputPort") && part instanceof THREE.Mesh && data.type !== "belt") {
          const connected = role === "inputPort" ? this.simulation.hasInputConnection(data) : this.simulation.hasOutputConnection(data);
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

    this.simulation.update(delta);
    this.syncItems(delta);
    this.animateMachines();
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
    this.renderer.render(this.scene, this.camera);
  };
}
