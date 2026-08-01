import * as THREE from "three";
import { addBox, createIndicatorMaterial, setIndicator } from "./shared.ts";

export type LogisticsMaterials = {
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt: THREE.Material;
};

export type LogisticsVisualState = Readonly<{
  time: number;
  activity: number;
  working: boolean;
  blocked: boolean;
  disconnected: boolean;
}>;

type Point2 = readonly [number, number];
type LogisticsKind = "splitter" | "merger";

const addBeltSegment = (
  group: THREE.Group,
  start: Point2,
  end: Point2,
  materials: LogisticsMaterials,
) => {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const centerX = (start[0] + end[0]) / 2;
  const centerZ = (start[1] + end[1]) / 2;

  const belt = addBox(group, [length, 0.035, 0.2], [centerX, 0.365, centerZ], materials.belt, false);
  belt.rotation.y = -angle;
  const normalX = -Math.sin(angle) * 0.14;
  const normalZ = Math.cos(angle) * 0.14;
  for (const side of [-1, 1]) {
    const rail = addBox(
      group,
      [length, 0.11, 0.045],
      [centerX + normalX * side, 0.405, centerZ + normalZ * side],
      materials.steel,
    );
    rail.rotation.y = -angle;
  }
  return belt;
};

const addPort = (
  group: THREE.Group,
  position: [number, number, number],
  role: "inputPort" | "outputPort",
  index: number,
) => {
  const marker = addBox(
    group,
    [0.035, 0.08, 0.2],
    position,
    createIndicatorMaterial(role === "inputPort" ? 0x5de4d1 : 0xffa94d, role === "inputPort" ? 0x1a8f82 : 0x9b480c, 1.15),
    false,
  );
  marker.userData.animationRole = role;
  marker.userData.portIndex = index;
};

const addDirectionMark = (
  group: THREE.Group,
  x: number,
  z: number,
  angle: number,
  material: THREE.Material,
  index: number,
) => {
  const mark = new THREE.Group();
  mark.position.set(x, 0.405, z);
  mark.rotation.y = -angle;
  mark.userData.animationRole = "logisticsDirection";
  mark.userData.markIndex = index;
  mark.userData.baseY = mark.position.y;
  addBox(mark, [0.1, 0.018, 0.035], [-0.02, 0, 0], material, false);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.1, 3), material);
  tip.position.x = 0.075;
  tip.rotation.z = -Math.PI / 2;
  mark.add(tip);
  group.add(mark);
};

const addGate = (
  group: THREE.Group,
  x: number,
  z: number,
  channel: number,
  materials: LogisticsMaterials,
) => {
  const gate = new THREE.Group();
  gate.position.set(x, 0.47, z);
  gate.userData.animationRole = "logisticsGate";
  gate.userData.channel = channel;
  gate.userData.baseRotation = 0;
  addBox(gate, [0.05, 0.2, 0.24], [0, 0, 0], materials.orange, false);
  addBox(gate, [0.075, 0.08, 0.06], [0, 0.12, 0], materials.dark);
  group.add(gate);
};

const addFoundation = (group: THREE.Group, materials: LogisticsMaterials) => {
  addBox(group, [0.94, 0.13, 0.94], [0, 0.075, 0], materials.dark);
  addBox(group, [0.82, 0.07, 0.82], [0, 0.175, 0], materials.steel);
  for (const x of [-0.4, 0.4]) {
    for (const z of [-0.4, 0.4]) addBox(group, [0.13, 0.11, 0.13], [x, 0.055, z], materials.dark);
  }
};

const createLogisticsModel = (kind: LogisticsKind, materials: LogisticsMaterials) => {
  const group = new THREE.Group();
  group.userData.logisticsKind = kind;
  addFoundation(group, materials);

  const splitAtX = 0;
  const branchZ = 0.23;
  if (kind === "splitter") {
    addBeltSegment(group, [-0.5, 0], [splitAtX, 0], materials);
    addBeltSegment(group, [splitAtX, 0], [0.5, -branchZ], materials);
    addBeltSegment(group, [splitAtX, 0], [0.5, branchZ], materials);
    addPort(group, [-0.485, 0.43, 0], "inputPort", 0);
    addPort(group, [0.485, 0.43, -branchZ], "outputPort", 0);
    addPort(group, [0.485, 0.43, branchZ], "outputPort", 1);
    addGate(group, 0.19, -0.09, -1, materials);
    addGate(group, 0.19, 0.09, 1, materials);
    addDirectionMark(group, 0.33, -0.15, Math.atan2(-branchZ, 0.5), materials.amber, 0);
    addDirectionMark(group, 0.33, 0.15, Math.atan2(branchZ, 0.5), materials.amber, 1);
  } else {
    addBeltSegment(group, [-0.5, -branchZ], [splitAtX, 0], materials);
    addBeltSegment(group, [-0.5, branchZ], [splitAtX, 0], materials);
    addBeltSegment(group, [splitAtX, 0], [0.5, 0], materials);
    addPort(group, [-0.485, 0.43, -branchZ], "inputPort", 0);
    addPort(group, [-0.485, 0.43, branchZ], "inputPort", 1);
    addPort(group, [0.485, 0.43, 0], "outputPort", 0);
    addGate(group, -0.19, -0.09, -1, materials);
    addGate(group, -0.19, 0.09, 1, materials);
    addDirectionMark(group, -0.32, -0.15, Math.atan2(branchZ, 0.5), materials.cyan, 0);
    addDirectionMark(group, -0.32, 0.15, Math.atan2(-branchZ, 0.5), materials.cyan, 1);
  }

  // The raised bridge and low hood give the 1x1 module enough mass without
  // hiding the Y-shaped material path from the overview camera.
  addBox(group, [0.34, 0.12, 0.56], [0, 0.53, 0], materials.pale);
  addBox(group, [0.26, 0.055, 0.48], [0, 0.625, 0], materials.dark);
  for (const z of [-0.24, 0.24]) addBox(group, [0.08, 0.3, 0.08], [0, 0.42, z], materials.dark);

  const shuttle = new THREE.Group();
  shuttle.position.set(0, 0.445, 0);
  shuttle.userData.animationRole = "logisticsShuttle";
  shuttle.userData.baseZ = 0;
  addBox(shuttle, [0.18, 0.055, 0.13], [0, 0, 0], materials.orange, false);
  addBox(shuttle, [0.1, 0.025, 0.17], [0, 0.035, 0], materials.steel, false);
  group.add(shuttle);

  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.047, 8, 6),
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 1.25),
  );
  status.position.set(0.12, 0.69, 0.17);
  status.userData.animationRole = "logisticsStatus";
  group.add(status);
  return group;
};

export const createSplitterModel = (materials: LogisticsMaterials) => createLogisticsModel("splitter", materials);
export const createMergerModel = (materials: LogisticsMaterials) => createLogisticsModel("merger", materials);

export const animateLogisticsModel = (group: THREE.Group, state: LogisticsVisualState) => {
  const activity = THREE.MathUtils.clamp(state.activity, 0, 1);
  const phase = state.time * 4.5;
  const shuttlePosition = state.working ? Math.sin(phase) * 0.12 * activity : 0;
  const gatePulse = state.working ? (Math.sin(phase) * 0.5 + 0.5) * activity : 0;

  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "logisticsShuttle") {
      part.position.z = (part.userData.baseZ as number) + shuttlePosition;
    }
    if (role === "logisticsGate") {
      const channel = part.userData.channel as number;
      const baseRotation = part.userData.baseRotation as number;
      part.rotation.y = baseRotation + channel * (gatePulse - 0.5) * 0.38;
    }
    if (role === "logisticsDirection") {
      const baseY = part.userData.baseY as number;
      const index = part.userData.markIndex as number;
      part.position.y = baseY + (state.working ? Math.sin(phase + index * Math.PI) * 0.008 : 0);
    }
    if (role === "logisticsStatus") {
      if (state.disconnected) setIndicator(part, 0xffa94d, 0x9b480c, 1.25);
      else if (state.blocked) setIndicator(part, 0xffa94d, 0x9b480c, 1.7 + Math.sin(state.time * 3) * 0.35);
      else if (state.working) setIndicator(part, 0x5de4d1, 0x1a8f82, 1.1 + activity * 0.75);
      else setIndicator(part, 0xa8bcc0, 0x1a8f82, 0.25);
    }
  });
};
