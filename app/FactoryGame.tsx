"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Tool =
  | "inspect"
  | "belt"
  | "miner"
  | "smelter"
  | "assembler"
  | "storage"
  | "demolish";

type BuildType = Exclude<Tool, "inspect" | "demolish">;

type StructureData = {
  id: number;
  type: BuildType;
  x: number;
  z: number;
  rotation: number;
};

type HistoryEntry = {
  added: StructureData[];
  removed: StructureData[];
  creditDelta: number;
};

type SelectedInfo = {
  id: number;
  type: BuildType;
} | null;

const TOOL_INFO: Array<{
  id: Tool;
  name: string;
  glyph: string;
  key: string;
  cost?: number;
}> = [
  { id: "inspect", name: "선택", glyph: "◎", key: "1" },
  { id: "belt", name: "벨트", glyph: "≫", key: "2", cost: 8 },
  { id: "miner", name: "채굴기", glyph: "M", key: "3", cost: 120 },
  { id: "smelter", name: "제련기", glyph: "S", key: "4", cost: 180 },
  { id: "assembler", name: "조립기", glyph: "A", key: "5", cost: 260 },
  { id: "storage", name: "창고", glyph: "▣", key: "6", cost: 90 },
  { id: "demolish", name: "철거", glyph: "×", key: "X" },
];

const COST: Record<BuildType, number> = {
  belt: 8,
  miner: 120,
  smelter: 180,
  assembler: 260,
  storage: 90,
};

const TYPE_NAME: Record<BuildType, string> = {
  belt: "컨베이어 Mk.1",
  miner: "철 채굴기",
  smelter: "아크 제련기",
  assembler: "정밀 조립기",
  storage: "소형 저장고",
};

const TYPE_RATE: Record<BuildType, string> = {
  belt: "60 /분",
  miner: "30 /분",
  smelter: "20 /분",
  assembler: "12 /분",
  storage: "400 슬롯",
};

const isMachine = (type: BuildType) => type !== "belt";

export default function FactoryGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameApiRef = useRef<{ setTool: (tool: Tool) => void } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("inspect");
  const [credits, setCredits] = useState(1200);
  const [selected, setSelected] = useState<SelectedInfo>(null);
  const [toast, setToast] = useState("준비 완료 — 벨트를 드래그해 연결하세요");
  const [toastVisible, setToastVisible] = useState(true);
  const [motors, setMotors] = useState(7);

  const showToast = (message: string) => {
    setToast(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1800);
  };

  const chooseTool = (tool: Tool) => {
    setActiveTool(tool);
    gameApiRef.current?.setTool(tool);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071419);
    scene.fog = new THREE.FogExp2(0x071419, 0.027);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "Factory X 3D 건설 영역");
    renderer.domElement.tabIndex = 0;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 120);
    let cameraAngle = Math.PI * 0.25;
    let desiredCameraAngle = cameraAngle;
    let cameraAngularVelocity = 0;
    let cameraZoom = 1;
    const cameraTarget = new THREE.Vector3(0, 0, 0);
    const desiredTarget = cameraTarget.clone();

    const updateCamera = () => {
      const distance = 23;
      camera.position.set(
        cameraTarget.x + Math.sin(cameraAngle) * distance,
        18,
        cameraTarget.z + Math.cos(cameraAngle) * distance,
      );
      camera.lookAt(cameraTarget.x, 0, cameraTarget.z);
      camera.zoom = cameraZoom;
      camera.updateProjectionMatrix();
    };

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const aspect = width / Math.max(height, 1);
      const viewHeight = 20;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    resize();
    updateCamera();

    const hemi = new THREE.HemisphereLight(0xbdefff, 0x142328, 2.2);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d8, 4.3);
    sun.position.set(-12, 22, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(27, 0.45, 27),
      new THREE.MeshStandardMaterial({ color: 0x16272c, roughness: 0.88, metalness: 0.18 }),
    );
    platform.position.y = -0.27;
    platform.receiveShadow = true;
    scene.add(platform);

    const underGlow = new THREE.Mesh(
      new THREE.BoxGeometry(27.4, 0.18, 27.4),
      new THREE.MeshBasicMaterial({ color: 0x173d42 }),
    );
    underGlow.position.y = -0.51;
    scene.add(underGlow);

    const grid = new THREE.GridHelper(26, 26, 0x4c7a7e, 0x29474d);
    grid.position.y = 0.012;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.38;
    });
    scene.add(grid);

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x274249,
      emissive: 0x0a2528,
      emissiveIntensity: 0.8,
      metalness: 0.55,
      roughness: 0.35,
    });
    const edgeGeometryH = new THREE.BoxGeometry(27.7, 0.3, 0.28);
    const edgeGeometryV = new THREE.BoxGeometry(0.28, 0.3, 27.7);
    [
      new THREE.Mesh(edgeGeometryH, edgeMaterial),
      new THREE.Mesh(edgeGeometryH, edgeMaterial),
      new THREE.Mesh(edgeGeometryV, edgeMaterial),
      new THREE.Mesh(edgeGeometryV, edgeMaterial),
    ].forEach((edge, index) => {
      if (index < 2) edge.position.set(0, 0.08, index === 0 ? -13.65 : 13.65);
      else edge.position.set(index === 2 ? -13.65 : 13.65, 0.08, 0);
      edge.castShadow = true;
      scene.add(edge);
    });

    const createMaterial = (color: number, metalness = 0.28, roughness = 0.48) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });

    const materials = {
      dark: createMaterial(0x16242a, 0.65, 0.34),
      steel: createMaterial(0x657b80, 0.72, 0.28),
      pale: createMaterial(0xa8bcc0, 0.52, 0.32),
      cyan: new THREE.MeshStandardMaterial({
        color: 0x5de4d1,
        emissive: 0x1a8f82,
        emissiveIntensity: 1.25,
        metalness: 0.3,
        roughness: 0.25,
      }),
      amber: new THREE.MeshStandardMaterial({
        color: 0xffa94d,
        emissive: 0x9b480c,
        emissiveIntensity: 1.2,
        metalness: 0.25,
        roughness: 0.3,
      }),
      belt: createMaterial(0x27393d, 0.08, 0.82),
      copper: createMaterial(0xb76e43, 0.58, 0.3),
      ore: createMaterial(0x5d7b8b, 0.65, 0.38),
    };

    const addBox = (
      group: THREE.Group,
      size: [number, number, number],
      position: [number, number, number],
      material: THREE.Material,
      castShadow = true,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    const addPort = (group: THREE.Group, x: number, z: number, color: number, outward: number) => {
      const port = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.34, 4),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85 }),
      );
      port.position.set(x, 0.32, z);
      port.rotation.z = Math.PI / 2;
      port.rotation.y = outward;
      group.add(port);
    };

    const createModel = (type: BuildType) => {
      const group = new THREE.Group();

      if (type === "belt") {
        addBox(group, [0.92, 0.16, 0.94], [0, 0.1, 0], materials.dark);
        addBox(group, [0.74, 0.075, 0.9], [0, 0.21, 0], materials.belt, false);
        for (const z of [-0.32, 0, 0.32]) {
          const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.76, 10), materials.steel);
          roller.position.set(0, 0.25, z);
          roller.rotation.z = Math.PI / 2;
          roller.userData.animationRole = "beltRoller";
          roller.castShadow = true;
          group.add(roller);
        }
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 3), materials.cyan);
        arrow.position.set(0, 0.29, 0.08);
        arrow.rotation.x = Math.PI / 2;
        arrow.userData.animationRole = "beltIndicator";
        arrow.userData.baseZ = arrow.position.z;
        group.add(arrow);
        return group;
      }

      addBox(group, [1.78, 0.24, 1.78], [0, 0.12, 0], materials.dark);
      addBox(group, [1.5, 0.12, 1.5], [0, 0.3, 0], materials.steel);
      addPort(group, -0.96, 0, 0x5de4d1, Math.PI);
      addPort(group, 0.96, 0, 0xffa94d, 0);

      if (type === "miner") {
        addBox(group, [0.28, 0.98, 0.34], [-0.57, 0.82, 0], materials.pale);
        addBox(group, [0.28, 0.98, 0.34], [0.57, 0.82, 0], materials.pale);
        addBox(group, [1.38, 0.22, 0.42], [0, 1.32, 0], materials.dark);
        addBox(group, [0.46, 0.24, 0.46], [0, 1.18, 0], materials.steel);

        const drillAssembly = new THREE.Group();
        drillAssembly.position.set(0, 0.2, 0);
        drillAssembly.userData.animationRole = "minerDrill";
        drillAssembly.userData.baseY = drillAssembly.position.y;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8), materials.steel);
        shaft.position.y = 0.55;
        shaft.castShadow = true;
        drillAssembly.add(shaft);
        const bit = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.44, 8), materials.dark);
        bit.position.y = 0.02;
        bit.rotation.x = Math.PI;
        bit.castShadow = true;
        drillAssembly.add(bit);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.055, 6, 12), materials.amber);
        collar.position.y = 0.84;
        collar.rotation.x = Math.PI / 2;
        drillAssembly.add(collar);
        group.add(drillAssembly);

        const driveGear = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.085, 6, 12), materials.steel);
        driveGear.position.set(0, 1.18, 0.26);
        driveGear.userData.animationRole = "minerGear";
        group.add(driveGear);
        addBox(group, [0.48, 0.18, 0.08], [0, 0.84, 0.58], materials.cyan, false).userData.animationRole =
          "statusLight";
      }

      if (type === "smelter") {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.76, 1.16, 10), materials.steel);
        body.position.y = 0.88;
        body.castShadow = true;
        group.add(body);
        const furnace = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.36, 0.08),
          new THREE.MeshStandardMaterial({
            color: 0xffb25b,
            emissive: 0xff641a,
            emissiveIntensity: 2.5,
          }),
        );
        furnace.position.set(0, 0.72, 0.68);
        furnace.userData.animationRole = "smelterGlow";
        group.add(furnace);

        const heatRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.66, 0.045, 6, 18),
          new THREE.MeshStandardMaterial({
            color: 0xff9b42,
            emissive: 0xff5218,
            emissiveIntensity: 1.8,
            transparent: true,
            opacity: 0.7,
          }),
        );
        heatRing.position.y = 1.12;
        heatRing.rotation.x = Math.PI / 2;
        heatRing.userData.animationRole = "smelterHeatRing";
        group.add(heatRing);

        const fan = new THREE.Group();
        fan.position.set(-0.43, 0.92, 0.64);
        fan.userData.animationRole = "smelterFan";
        const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10), materials.dark);
        fanHub.rotation.x = Math.PI / 2;
        fan.add(fanHub);
        for (let index = 0; index < 3; index += 1) {
          const blade = addBox(fan, [0.08, 0.31, 0.055], [0, 0.16, 0], materials.steel, false);
          blade.rotation.z = index * ((Math.PI * 2) / 3);
        }
        group.add(fan);

        const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.85, 8), materials.dark);
        chimney.position.set(0.34, 1.65, -0.15);
        chimney.castShadow = true;
        group.add(chimney);
        for (let index = 0; index < 3; index += 1) {
          const smokeMaterial = new THREE.MeshStandardMaterial({
            color: 0x8fa2a5,
            transparent: true,
            opacity: 0.2,
            roughness: 1,
            depthWrite: false,
          });
          const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), smokeMaterial);
          smoke.position.set(0.34, 2.12, -0.15);
          smoke.userData.animationRole = "smelterSmoke";
          smoke.userData.offset = index / 3;
          smoke.userData.baseY = smoke.position.y;
          group.add(smoke);
        }
      }

      if (type === "assembler") {
        addBox(group, [1.42, 0.46, 1.3], [0, 0.56, 0], materials.pale);
        addBox(group, [0.22, 1.08, 0.22], [-0.65, 1.08, 0], materials.dark);
        addBox(group, [0.22, 1.08, 0.22], [0.65, 1.08, 0], materials.dark);
        addBox(group, [1.48, 0.18, 0.28], [0, 1.58, 0], materials.steel);

        const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.12, 12), materials.dark);
        turntable.position.y = 0.86;
        turntable.userData.animationRole = "assemblerTurntable";
        turntable.castShadow = true;
        group.add(turntable);
        const workpiece = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.36), materials.copper);
        workpiece.position.y = 1.02;
        workpiece.userData.animationRole = "assemblerWorkpiece";
        group.add(workpiece);

        [-0.36, 0.36].forEach((x, index) => {
          const arm = new THREE.Group();
          arm.position.set(x, 1.1, 0);
          arm.userData.animationRole = "assemblerArm";
          arm.userData.baseY = arm.position.y;
          arm.userData.phase = index * 0.5;
          const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.58, 8), materials.steel);
          piston.position.y = 0.24;
          piston.castShadow = true;
          arm.add(piston);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), index === 0 ? materials.cyan : materials.amber);
          head.position.y = -0.08;
          head.castShadow = true;
          arm.add(head);
          group.add(arm);
        });
      }

      if (type === "storage") {
        addBox(group, [1.45, 1.22, 1.38], [0, 0.92, 0], materials.steel);
        for (const y of [0.48, 0.86, 1.24]) {
          addBox(group, [1.5, 0.07, 1.43], [0, y, 0], materials.dark);
        }
        addBox(group, [0.58, 0.18, 0.07], [0, 1.12, 0.72], materials.amber, false).userData.animationRole =
          "statusLight";
      }

      return group;
    };

    const oreAnchors = new Set(["-8,-3", "7,4"]);
    const addOrePatch = (x: number, z: number, copper = false) => {
      const group = new THREE.Group();
      group.position.set(x + 0.5, 0, z + 0.5);
      const oreMaterial = copper ? materials.copper : materials.ore;
      const points = [
        [-0.5, 0.13, -0.38, 0.28],
        [0.34, 0.2, -0.22, 0.36],
        [-0.12, 0.26, 0.34, 0.42],
        [0.52, 0.13, 0.42, 0.24],
      ];
      points.forEach(([px, py, pz, scale], index) => {
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(scale, 0), oreMaterial);
        crystal.position.set(px, py, pz);
        crystal.rotation.y = index * 0.7;
        crystal.castShadow = true;
        group.add(crystal);
      });
      scene.add(group);
    };

    addOrePatch(-8, -3);
    addOrePatch(7, 4, true);

    const structures = new Map<number, { data: StructureData; group: THREE.Group; cells: string[] }>();
    const occupancy = new Map<string, number>();
    const history: HistoryEntry[] = [];
    let nextId = 1;
    let creditsValue = 1200;
    let selectedId: number | null = null;

    const footprint = (type: BuildType, x: number, z: number) => {
      if (type === "belt") return [`${x},${z}`];
      return [`${x},${z}`, `${x + 1},${z}`, `${x},${z + 1}`, `${x + 1},${z + 1}`];
    };

    const modelPosition = (type: BuildType, x: number, z: number) =>
      type === "belt" ? new THREE.Vector3(x, 0, z) : new THREE.Vector3(x + 0.5, 0, z + 0.5);

    const addStructure = (data: StructureData) => {
      const group = createModel(data.type);
      group.position.copy(modelPosition(data.type, data.x, data.z));
      group.rotation.y = data.rotation * (Math.PI / 2);
      group.userData.structureId = data.id;
      group.traverse((child) => {
        child.userData.structureId = data.id;
      });
      const cells = footprint(data.type, data.x, data.z);
      cells.forEach((cell) => occupancy.set(cell, data.id));
      structures.set(data.id, { data: { ...data }, group, cells });
      scene.add(group);
      nextId = Math.max(nextId, data.id + 1);
      return data;
    };

    const removeStructure = (id: number) => {
      const record = structures.get(id);
      if (!record) return null;
      record.cells.forEach((cell) => occupancy.delete(cell));
      scene.remove(record.group);
      structures.delete(id);
      if (selectedId === id) {
        selectedId = null;
        setSelected(null);
      }
      return { ...record.data };
    };

    const canPlace = (type: BuildType, x: number, z: number, pathCells?: Set<string>) => {
      const cells = footprint(type, x, z);
      const inside = cells.every((cell) => {
        const [cx, cz] = cell.split(",").map(Number);
        return Math.abs(cx) <= 12 && Math.abs(cz) <= 12;
      });
      if (!inside) return false;
      if (type === "miner" && !oreAnchors.has(`${x},${z}`)) return false;
      return cells.every((cell) => !occupancy.has(cell) && (!pathCells || !pathCells.has(cell)));
    };

    const seed: Array<Omit<StructureData, "id">> = [
      { type: "miner", x: -8, z: -3, rotation: 1 },
      { type: "belt", x: -6, z: -2, rotation: 1 },
      { type: "belt", x: -5, z: -2, rotation: 1 },
      { type: "belt", x: -4, z: -2, rotation: 1 },
      { type: "belt", x: -3, z: -2, rotation: 1 },
      { type: "smelter", x: -2, z: -3, rotation: 0 },
      { type: "belt", x: 0, z: -2, rotation: 1 },
      { type: "belt", x: 1, z: -2, rotation: 1 },
      { type: "assembler", x: 2, z: -3, rotation: 0 },
      { type: "storage", x: 5, z: -3, rotation: 0 },
    ];
    seed.forEach((data) => addStructure({ ...data, id: nextId++ }));

    const itemGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const itemMaterial = new THREE.MeshStandardMaterial({
      color: 0xaed5e3,
      emissive: 0x284f5d,
      emissiveIntensity: 0.9,
      metalness: 0.72,
      roughness: 0.25,
    });
    const movingItems = Array.from({ length: 6 }, (_, index) => {
      const item = new THREE.Mesh(itemGeometry, itemMaterial);
      item.castShadow = true;
      item.userData.offset = index / 6;
      scene.add(item);
      return item;
    });

    const hoverTile = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.035, 0.94),
      new THREE.MeshBasicMaterial({ color: 0x5de4d1, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    hoverTile.position.y = 0.035;
    scene.add(hoverTile);

    let ghost: THREE.Group | null = null;
    let ghostType: BuildType | null = null;
    let ghostValid = false;
    let currentCell = { x: 0, z: 0 };
    let rotation = 0;
    let activeToolValue: Tool = "inspect";
    let beltStart: { x: number; z: number } | null = null;
    let beltPreview: THREE.Group | null = null;
    let beltPreviewCells: Array<{ x: number; z: number; rotation: number }> = [];
    let panning = false;
    let panOrigin = { x: 0, y: 0 };
    let pointerDown = { x: 0, y: 0 };

    const ghostMaterialValid = new THREE.MeshStandardMaterial({
      color: 0x65f2dc,
      emissive: 0x1c7c72,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const ghostMaterialInvalid = new THREE.MeshStandardMaterial({
      color: 0xff6174,
      emissive: 0x8a1525,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });

    const clearGhost = () => {
      if (ghost) scene.remove(ghost);
      ghost = null;
      ghostType = null;
    };

    const recolorGhost = (group: THREE.Group, valid: boolean) => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = valid ? ghostMaterialValid : ghostMaterialInvalid;
      });
    };

    const updateGhost = () => {
      if (activeToolValue === "inspect" || activeToolValue === "demolish" || activeToolValue === "belt") {
        clearGhost();
        return;
      }
      const type = activeToolValue as BuildType;
      if (!ghost || ghostType !== type) {
        clearGhost();
        ghost = createModel(type);
        ghostType = type;
        scene.add(ghost);
      }
      ghostValid = canPlace(type, currentCell.x, currentCell.z);
      ghost.position.copy(modelPosition(type, currentCell.x, currentCell.z));
      ghost.rotation.y = rotation * (Math.PI / 2);
      recolorGhost(ghost, ghostValid);
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    const pointerToCell = (event: PointerEvent | WheelEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
      return {
        x: THREE.MathUtils.clamp(Math.round(hitPoint.x), -12, 12),
        z: THREE.MathUtils.clamp(Math.round(hitPoint.z), -12, 12),
      };
    };

    const getBeltPath = (start: { x: number; z: number }, end: { x: number; z: number }, zFirst: boolean) => {
      const cells: Array<{ x: number; z: number; rotation: number }> = [];
      let x = start.x;
      let z = start.z;
      const push = (nextX: number, nextZ: number, dir: number) => {
        if (!cells.some((cell) => cell.x === nextX && cell.z === nextZ)) {
          cells.push({ x: nextX, z: nextZ, rotation: dir });
        }
      };
      push(x, z, rotation);
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
      return cells;
    };

    const updateBeltPreview = (end: { x: number; z: number }, zFirst: boolean) => {
      if (!beltStart) return;
      if (beltPreview) scene.remove(beltPreview);
      beltPreview = new THREE.Group();
      beltPreviewCells = getBeltPath(beltStart, end, zFirst);
      const reserved = new Set<string>();
      let allValid = true;
      beltPreviewCells.forEach((cell) => {
        const valid = canPlace("belt", cell.x, cell.z, reserved);
        if (!valid) allValid = false;
        reserved.add(`${cell.x},${cell.z}`);
        const model = createModel("belt");
        model.position.set(cell.x, 0, cell.z);
        model.rotation.y = cell.rotation * (Math.PI / 2);
        recolorGhost(model, valid);
        beltPreview?.add(model);
      });
      ghostValid = allValid;
      scene.add(beltPreview);
    };

    const selectStructure = (id: number | null) => {
      selectedId = id;
      const record = id === null ? null : structures.get(id);
      setSelected(record ? { id: record.data.id, type: record.data.type } : null);
    };

    const pickStructure = () => {
      const groups = Array.from(structures.values(), (record) => record.group);
      const hits = raycaster.intersectObjects(groups, true);
      const id = hits[0]?.object.userData.structureId;
      return typeof id === "number" ? id : null;
    };

    const changeCredits = (next: number) => {
      creditsValue = Math.max(0, next);
      setCredits(creditsValue);
    };

    const undo = () => {
      const entry = history.pop();
      if (!entry) {
        showToast("되돌릴 작업이 없습니다");
        return;
      }
      entry.added.forEach((data) => removeStructure(data.id));
      entry.removed.forEach(addStructure);
      changeCredits(creditsValue - entry.creditDelta);
      showToast("마지막 작업을 되돌렸습니다");
    };

    const commitMachine = (type: BuildType) => {
      if (!ghostValid) {
        showToast(type === "miner" ? "채굴기는 광맥 위에 설치해야 합니다" : "이 위치에는 설치할 수 없습니다");
        return;
      }
      const cost = COST[type];
      if (creditsValue < cost) {
        showToast("크레딧이 부족합니다");
        return;
      }
      const data = addStructure({ id: nextId++, type, x: currentCell.x, z: currentCell.z, rotation });
      history.push({ added: [{ ...data }], removed: [], creditDelta: -cost });
      changeCredits(creditsValue - cost);
      showToast(`${TYPE_NAME[type]} 설치 완료`);
      updateGhost();
    };

    const commitBelts = () => {
      if (!ghostValid || beltPreviewCells.length === 0) {
        showToast("경로가 막혀 있습니다");
        return;
      }
      const cost = COST.belt * beltPreviewCells.length;
      if (creditsValue < cost) {
        showToast("크레딧이 부족합니다");
        return;
      }
      const added = beltPreviewCells.map((cell) =>
        addStructure({ id: nextId++, type: "belt", x: cell.x, z: cell.z, rotation: cell.rotation }),
      );
      history.push({ added: added.map((data) => ({ ...data })), removed: [], creditDelta: -cost });
      changeCredits(creditsValue - cost);
      showToast(`컨베이어 ${added.length}칸 설치 완료`);
    };

    const setToolInternal = (tool: Tool) => {
      activeToolValue = tool;
      beltStart = null;
      if (beltPreview) scene.remove(beltPreview);
      beltPreview = null;
      beltPreviewCells = [];
      renderer.domElement.style.cursor = tool === "demolish" ? "not-allowed" : tool === "inspect" ? "default" : "crosshair";
      updateGhost();
    };

    gameApiRef.current = { setTool: setToolInternal };

    const onPointerMove = (event: PointerEvent) => {
      if (panning) {
        const dx = event.clientX - panOrigin.x;
        const dy = event.clientY - panOrigin.y;
        const speed = 0.014 / cameraZoom;
        const right = new THREE.Vector3(Math.cos(cameraAngle), 0, -Math.sin(cameraAngle));
        const forward = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
        desiredTarget.addScaledVector(right, -dx * speed);
        desiredTarget.addScaledVector(forward, -dy * speed);
        desiredTarget.x = THREE.MathUtils.clamp(desiredTarget.x, -8, 8);
        desiredTarget.z = THREE.MathUtils.clamp(desiredTarget.z, -8, 8);
        panOrigin = { x: event.clientX, y: event.clientY };
        return;
      }
      const cell = pointerToCell(event);
      if (!cell) return;
      currentCell = cell;
      hoverTile.position.set(cell.x, 0.035, cell.z);
      if (beltStart) updateBeltPreview(cell, event.shiftKey);
      else updateGhost();
    };

    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.focus();
      pointerDown = { x: event.clientX, y: event.clientY };
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        panning = true;
        panOrigin = { x: event.clientX, y: event.clientY };
        renderer.domElement.setPointerCapture(event.pointerId);
        renderer.domElement.style.cursor = "grabbing";
        event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
      const cell = pointerToCell(event);
      if (cell) currentCell = cell;
      if (activeToolValue === "belt") {
        beltStart = { ...currentCell };
        renderer.domElement.setPointerCapture(event.pointerId);
        updateBeltPreview(currentCell, event.shiftKey);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (panning) {
        panning = false;
        renderer.domElement.releasePointerCapture(event.pointerId);
        setToolInternal(activeToolValue);
        return;
      }
      if (event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      if (activeToolValue === "belt" && beltStart) {
        commitBelts();
        beltStart = null;
        if (beltPreview) scene.remove(beltPreview);
        beltPreview = null;
        beltPreviewCells = [];
        return;
      }
      if (moved > 6) return;
      raycaster.setFromCamera(pointer, camera);
      if (activeToolValue === "inspect") {
        selectStructure(pickStructure());
        return;
      }
      if (activeToolValue === "demolish") {
        const id = pickStructure();
        if (id === null) {
          showToast("철거할 설비를 선택하세요");
          return;
        }
        const removed = removeStructure(id);
        if (removed) {
          const refund = Math.floor(COST[removed.type] * 0.5);
          history.push({ added: [], removed: [removed], creditDelta: refund });
          changeCredits(creditsValue + refund);
          showToast(`${TYPE_NAME[removed.type]} 철거 · ${refund} 환급`);
        }
        return;
      }
      commitMachine(activeToolValue as BuildType);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraZoom = THREE.MathUtils.clamp(cameraZoom * Math.exp(-event.deltaY * 0.001), 0.72, 2.2);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setToolInternal("inspect");
      setActiveTool("inspect");
      showToast("건설 작업을 취소했습니다");
    };

    const pressed = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat && !["w", "a", "s", "d"].includes(event.key.toLowerCase())) return;
      const key = event.key.toLowerCase();
      pressed.add(key);
      const keyTools: Record<string, Tool> = {
        "1": "inspect",
        "2": "belt",
        "3": "miner",
        "4": "smelter",
        "5": "assembler",
        "6": "storage",
        x: "demolish",
      };
      if (keyTools[key]) {
        setToolInternal(keyTools[key]);
        setActiveTool(keyTools[key]);
      }
      if (key === "r") {
        rotation = (rotation + 1) % 4;
        updateGhost();
        showToast("설비 방향을 회전했습니다");
      }
      if (key === "q" || key === "e") {
        desiredCameraAngle += key === "q" ? -Math.PI / 2 : Math.PI / 2;
        showToast(key === "q" ? "카메라를 왼쪽으로 회전" : "카메라를 오른쪽으로 회전");
      }
      if (key === "escape") {
        setToolInternal("inspect");
        setActiveTool("inspect");
      }
      if (key === "z" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        undo();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.key.toLowerCase());

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", resize);

    let animationId = 0;
    let lastTime = performance.now();
    let productionClock = 0;
    let elapsed = 0;
    const animate = (time: number) => {
      animationId = requestAnimationFrame(animate);
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      elapsed += delta;
      const angularDistance = desiredCameraAngle - cameraAngle;
      cameraAngularVelocity += angularDistance * 90 * delta;
      cameraAngularVelocity *= Math.exp(-18 * delta);
      cameraAngle += cameraAngularVelocity * delta;
      const moveSpeed = 7.5 * delta / cameraZoom;
      const right = new THREE.Vector3(Math.cos(cameraAngle), 0, -Math.sin(cameraAngle));
      const forward = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
      if (pressed.has("w")) desiredTarget.addScaledVector(forward, -moveSpeed);
      if (pressed.has("s")) desiredTarget.addScaledVector(forward, moveSpeed);
      if (pressed.has("a")) desiredTarget.addScaledVector(right, -moveSpeed);
      if (pressed.has("d")) desiredTarget.addScaledVector(right, moveSpeed);
      desiredTarget.x = THREE.MathUtils.clamp(desiredTarget.x, -8, 8);
      desiredTarget.z = THREE.MathUtils.clamp(desiredTarget.z, -8, 8);
      cameraTarget.lerp(desiredTarget, 1 - Math.exp(-delta * 11));
      updateCamera();

      movingItems.forEach((item) => {
        const phase = (elapsed * 0.12 + item.userData.offset) % 1;
        if (phase < 0.56) {
          const t = phase / 0.56;
          item.position.set(-6 + t * 4, 0.46, -2);
        } else {
          const t = (phase - 0.56) / 0.44;
          item.position.set(t * 5, 0.46, -2);
        }
        item.rotation.y = elapsed * 1.4;
      });

      structures.forEach((record) => {
        const machinePhase = elapsed + record.data.id * 0.17;
        record.group.traverse((part) => {
          const role = part.userData.animationRole as string | undefined;

          if (role === "beltRoller") {
            part.rotation.x = -elapsed * 9;
          }

          if (role === "beltIndicator") {
            const baseZ = part.userData.baseZ as number;
            part.position.z = baseZ + (((elapsed * 1.7) % 1) - 0.5) * 0.16;
          }

          if (role === "minerDrill") {
            const baseY = part.userData.baseY as number;
            const stroke = Math.pow((Math.sin(machinePhase * 4.1) + 1) * 0.5, 2);
            part.position.y = baseY - stroke * 0.22;
            part.rotation.y = elapsed * 7.5;
          }

          if (role === "minerGear") {
            part.rotation.z = -elapsed * 4.8;
          }

          if (role === "smelterGlow" && part instanceof THREE.Mesh) {
            const material = part.material;
            if (material instanceof THREE.MeshStandardMaterial) {
              material.emissiveIntensity = 2.2 + Math.sin(machinePhase * 5.4) * 0.75;
            }
          }

          if (role === "smelterHeatRing" && part instanceof THREE.Mesh) {
            const heat = 1 + Math.sin(machinePhase * 5.4) * 0.035;
            part.scale.setScalar(heat);
            const material = part.material;
            if (material instanceof THREE.MeshStandardMaterial) {
              material.opacity = 0.58 + Math.sin(machinePhase * 5.4) * 0.16;
            }
          }

          if (role === "smelterFan") {
            part.rotation.z = -elapsed * 5.6;
          }

          if (role === "smelterSmoke" && part instanceof THREE.Mesh) {
            const smokePhase = (elapsed * 0.34 + (part.userData.offset as number)) % 1;
            part.position.y = (part.userData.baseY as number) + smokePhase * 0.92;
            part.position.x = 0.34 + Math.sin(smokePhase * Math.PI * 2) * 0.08;
            const smokeScale = 0.55 + smokePhase * 1.25;
            part.scale.setScalar(smokeScale);
            const material = part.material;
            if (material instanceof THREE.MeshStandardMaterial) material.opacity = (1 - smokePhase) * 0.24;
          }

          if (role === "assemblerTurntable") {
            part.rotation.y = elapsed * 1.55;
          }

          if (role === "assemblerWorkpiece") {
            part.rotation.y = -elapsed * 1.55;
            part.position.y = 1.02 + Math.sin(machinePhase * 6.2) * 0.025;
          }

          if (role === "assemblerArm") {
            const baseY = part.userData.baseY as number;
            const phase = machinePhase * 0.72 + (part.userData.phase as number);
            const press = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 5);
            part.position.y = baseY - press * 0.39;
          }
        });
      });

      productionClock += delta;
      if (productionClock > 4.2) {
        productionClock = 0;
        setMotors((value) => (value >= 20 ? 7 : value + 1));
      }

      renderer.render(scene, camera);
    };
    animate(performance.now());

    return () => {
      cancelAnimationFrame(animationId);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      gameApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" />

      <div className="hud">
        <header className="topbar glass">
          <div className="brand">
            <div className="brand-mark">FX</div>
            <div>
              <div className="brand-name">FACTORY X</div>
              <div className="brand-sub">SECTOR A-17</div>
            </div>
          </div>
          <div className="divider" />
          <div className="metric-row">
            <div className="metric">
              <div className="metric-label">Credits</div>
              <div className="metric-value amber">₡ {credits.toLocaleString("ko-KR")}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Power grid</div>
              <div className="metric-value cyan">68 / 120 MW</div>
            </div>
          </div>
          <div className="objective">
            <div className="objective-head">
              <strong>첫 자동화 라인</strong>
              <span>{motors} / 20 모터</span>
            </div>
            <div className="progress" aria-label={`모터 생산 진행률 ${motors}/20`}>
              <div style={{ width: `${(motors / 20) * 100}%` }} />
            </div>
          </div>
        </header>

        <section className="left-panel glass">
          <div className="eyebrow">ACTIVE MISSION</div>
          <h1 className="mission-title">자동화의 첫 박자</h1>
          <p className="mission-copy">채굴기와 생산 설비를 벨트로 연결해 모터 20개를 납품하세요.</p>
          <div className="mission-step">
            <span className="step-check">✓</span>
            <span>철 채굴기 가동</span>
          </div>
          <div className="mission-step">
            <span className="step-check">2</span>
            <span>빈 타일을 드래그해 컨베이어 경로를 만들어보세요.</span>
          </div>
        </section>

        <aside className={`inspector glass ${selected ? "visible" : ""}`} aria-hidden={!selected}>
          <div className="eyebrow">EQUIPMENT</div>
          <div className="inspector-head">
            <div className="inspector-title">{selected ? TYPE_NAME[selected.type] : "설비"}</div>
            <span className="status-pill">RUNNING</span>
          </div>
          <div className="inspector-grid">
            <div className="inspector-cell">
              <span>처리량</span>
              <strong>{selected ? TYPE_RATE[selected.type] : "—"}</strong>
            </div>
            <div className="inspector-cell">
              <span>효율</span>
              <strong>96%</strong>
            </div>
            <div className="inspector-cell">
              <span>전력</span>
              <strong>{selected?.type === "belt" ? "0 MW" : "8 MW"}</strong>
            </div>
            <div className="inspector-cell">
              <span>상태</span>
              <strong>정상</strong>
            </div>
          </div>
        </aside>

        <div className={`toast ${toastVisible ? "visible" : ""}`} role="status">
          {toast}
        </div>

        <div className="hintbar glass">
          <kbd>WASD</kbd> 이동 <kbd>휠</kbd> 줌 <kbd>Q E</kbd> 회전 <kbd>CTRL Z</kbd> 실행 취소
        </div>

        <div className="toolbar-wrap glass">
          <nav className="toolbar" aria-label="건설 도구">
            {TOOL_INFO.map((tool) => (
              <button
                key={tool.id}
                className={`tool-button ${activeTool === tool.id ? "active" : ""}`}
                onClick={() => chooseTool(tool.id)}
                aria-pressed={activeTool === tool.id}
                aria-label={`${tool.name}${tool.cost ? `, 비용 ${tool.cost}` : ""}`}
              >
                <span className="tool-key">{tool.key}</span>
                <span className="tool-glyph">{tool.glyph}</span>
                <span className="tool-name">{tool.name}</span>
                {tool.cost ? <span className="tool-cost">₡ {tool.cost}</span> : null}
              </button>
            ))}
          </nav>
        </div>

        <div className="build-mode glass">{activeTool === "inspect" ? "INSPECT MODE" : "BUILD MODE"}</div>
      </div>
    </main>
  );
}
