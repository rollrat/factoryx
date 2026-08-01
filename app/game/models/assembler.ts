import * as THREE from "three";
import {
  addBeam,
  addBox,
  addCylinder,
  createIndicatorMaterial,
  setIndicator,
  type MachineMaterials,
  type ProcessingVisualState,
} from "./shared.ts";

const addFoundation = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [1.78, 0.18, 1.76], [0, 0.09, 0], materials.dark);
  addBox(group, [1.58, 0.08, 1.52], [0, 0.22, 0], materials.steel);
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.66, 0.66]) addBox(group, [0.22, 0.14, 0.22], [x, 0.07, z], materials.dark);
  }
};

const addGantry = (group: THREE.Group, materials: MachineMaterials) => {
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.58, 0.58]) {
      addBox(group, [0.14, 1.34, 0.14], [x, 0.95, z], materials.dark);
      addBox(group, [0.21, 0.1, 0.21], [x, 0.31, z], materials.orange);
    }
  }
  for (const z of [-0.58, 0.58]) {
    addBox(group, [1.5, 0.16, 0.18], [0, 1.65, z], materials.pale);
    addBox(group, [1.26, 0.06, 0.21], [0, 1.78, z], materials.dark);
  }
  addBox(group, [0.16, 0.16, 1.28], [-0.68, 1.65, 0], materials.dark);
  addBox(group, [0.16, 0.16, 1.28], [0.68, 1.65, 0], materials.dark);
  addBeam(group, [-0.63, 0.4, 0.57], [-0.63, 1.57, -0.57], 0.055, materials.steel);
  addBeam(group, [0.63, 0.4, -0.57], [0.63, 1.57, 0.57], 0.055, materials.steel);
};

const addInputBuffer = (group: THREE.Group, materials: MachineMaterials) => {
  [-0.5, 0.5].forEach((laneZ, laneIndex) => {
    addBox(group, [0.72, 0.14, 0.46], [-0.66, 0.38, laneZ], materials.dark);
    addBox(group, [0.64, 0.035, 0.34], [-0.68, 0.47, laneZ], materials.belt, false);
    for (const railZ of [laneZ - 0.22, laneZ + 0.22]) {
      addBox(group, [0.66, 0.14, 0.055], [-0.67, 0.55, railZ], materials.pale);
      addBox(group, [0.56, 0.025, 0.03], [-0.68, 0.64, railZ], materials.orange, false);
    }
    const port = addBox(
      group,
      [0.04, 0.055, 0.3],
      [-1.01, 0.74, laneZ],
      createIndicatorMaterial(0x5de4d1, 0x1a8f82),
      false,
    );
    port.userData.animationRole = "inputPort";
    port.userData.inputIndex = laneIndex;

    for (let slot = 0; slot < 2; slot += 1) {
      const ingot = addCylinder(
        group,
        0.075,
        0.11,
        0.24,
        [-0.72 + slot * 0.2, 0.54, laneZ],
        materials.pale,
        4,
      );
      ingot.rotation.z = Math.PI / 2;
      ingot.userData.animationRole = "assemblerInputIngot";
      ingot.userData.inputIndex = laneIndex * 2 + slot;
    }
    addBeam(group, [-0.32, 0.5, laneZ], [-0.08, 0.5, -0.12], 0.045, materials.steel);
  });
};

const addWorkCell = (group: THREE.Group, materials: MachineMaterials) => {
  const table = addCylinder(group, 0.44, 0.5, 0.13, [0, 0.55, -0.12], materials.dark, 14);
  table.userData.animationRole = "assemblerTurntable";
  table.userData.baseRotation = table.rotation.y;
  const tableTop = addCylinder(group, 0.37, 0.4, 0.045, [0, 0.65, -0.12], materials.steel, 14);
  tableTop.userData.animationRole = "assemblerTurntableTop";

  [-1, 1].forEach((side, index) => {
    const half = addBox(
      group,
      [0.3, 0.18, 0.18],
      [-0.05, 0.76, -0.12 + side * 0.18],
      index === 0 ? materials.pale : materials.copper,
    );
    half.userData.animationRole = "assemblerWorkpieceHalf";
    half.userData.side = side;
    half.userData.baseZ = half.position.z;
  });

  const clamp = new THREE.Group();
  clamp.position.set(-0.3, 1.35, -0.1);
  clamp.userData.animationRole = "assemblerClamp";
  clamp.userData.baseY = clamp.position.y;
  addCylinder(clamp, 0.09, 0.09, 0.58, [0, 0.13, 0], materials.steel, 10);
  addBox(clamp, [0.42, 0.14, 0.28], [0.16, -0.2, 0], materials.dark);
  addBox(clamp, [0.3, 0.045, 0.18], [0.16, -0.3, 0], materials.orange, false);
  group.add(clamp);

  const tool = new THREE.Group();
  tool.position.set(0.34, 1.43, -0.08);
  tool.userData.animationRole = "assemblerToolArm";
  tool.userData.baseY = tool.position.y;
  addBox(tool, [0.22, 0.5, 0.22], [0, 0.06, 0], materials.dark);
  const spindle = addCylinder(tool, 0.065, 0.095, 0.4, [0, -0.28, 0], materials.steel, 10);
  spindle.userData.animationRole = "assemblerSpindle";
  const toolTip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.18, 8), materials.orange);
  toolTip.position.y = -0.54;
  toolTip.rotation.x = Math.PI;
  toolTip.castShadow = true;
  tool.add(toolTip);
  group.add(tool);

  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.62, 1.55, 0.35),
    new THREE.Vector3(0.48, 1.35, 0.25),
    new THREE.Vector3(0.35, 1.25, -0.06),
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 14, 0.045, 6, false), materials.rubber);
  cable.castShadow = true;
  group.add(cable);

  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc46b,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  [0, 0.25, 0.5, 0.75].forEach((phase, index) => {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), sparkMaterial);
    spark.position.set(0.18, 0.82, -0.1);
    spark.userData.animationRole = "assemblerSpark";
    spark.userData.phase = phase;
    spark.userData.angle = index * (Math.PI / 2) + 0.4;
    spark.visible = false;
    group.add(spark);
  });
};

const addOutput = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.72, 0.14, 0.68], [0.68, 0.38, -0.5], materials.dark);
  addBox(group, [0.64, 0.035, 0.54], [0.69, 0.47, -0.5], materials.belt, false);
  for (const z of [-0.79, -0.21]) {
    addBox(group, [0.64, 0.14, 0.06], [0.69, 0.55, z], materials.pale);
  }
  const ejector = new THREE.Group();
  ejector.position.set(0.28, 0.59, -0.5);
  ejector.userData.animationRole = "assemblerEjector";
  ejector.userData.baseX = ejector.position.x;
  addBox(ejector, [0.18, 0.2, 0.38], [0, 0, 0], materials.dark);
  addBox(ejector, [0.045, 0.14, 0.28], [0.11, 0, 0], materials.orange, false);
  group.add(ejector);

  const port = addBox(
    group,
    [0.04, 0.055, 0.36],
    [1.01, 0.74, -0.5],
    createIndicatorMaterial(0xffa94d, 0x9b480c),
    false,
  );
  port.userData.animationRole = "outputPort";

  const component = new THREE.Group();
  component.position.set(0.38, 0.57, -0.5);
  component.userData.animationRole = "assemblerComponent";
  component.userData.startX = component.position.x;
  addCylinder(component, 0.1, 0.1, 0.2, [0, 0, 0], materials.cyan, 10).rotation.z = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 10), materials.steel);
  ring.rotation.y = Math.PI / 2;
  component.add(ring);
  component.visible = false;
  group.add(component);
};

const addControls = (group: THREE.Group, materials: MachineMaterials) => {
  addBox(group, [0.3, 0.4, 0.15], [-0.46, 1.08, 0.67], materials.dark);
  const screen = addBox(
    group,
    [0.2, 0.14, 0.025],
    [-0.46, 1.13, 0.76],
    createIndicatorMaterial(0x5de4d1, 0x1a8f82, 0.8),
    false,
  );
  screen.userData.animationRole = "assemblerStatus";
  addBox(group, [0.16, 0.035, 0.025], [-0.46, 1.0, 0.76], materials.orange, false);
};

export const createAssemblerModel = (materials: MachineMaterials) => {
  const group = new THREE.Group();
  addFoundation(group, materials);
  addGantry(group, materials);
  addInputBuffer(group, materials);
  addWorkCell(group, materials);
  addOutput(group, materials);
  addControls(group, materials);
  return group;
};

export const animateAssemblerModel = (group: THREE.Group, state: ProcessingVisualState) => {
  const progress = THREE.MathUtils.clamp(state.progress, 0, 1);
  const load = THREE.MathUtils.smoothstep(progress, 0.04, 0.2);
  const align = THREE.MathUtils.smoothstep(progress, 0.16, 0.31)
    - THREE.MathUtils.smoothstep(progress, 0.83, 0.97);
  const clamp = THREE.MathUtils.smoothstep(progress, 0.3, 0.42)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.62, 0.72));
  const tool = THREE.MathUtils.smoothstep(progress, 0.46, 0.57)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.73, 0.82));
  const inspect = THREE.MathUtils.smoothstep(progress, 0.72, 0.79)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.86, 0.92));
  const release = THREE.MathUtils.smoothstep(progress, 0.83, 0.93)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.98, 1));

  group.traverse((part) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "assemblerTurntable" || role === "assemblerTurntableTop") {
      part.rotation.y = align * Math.PI * 0.5;
    }
    if (role === "assemblerWorkpieceHalf") {
      const side = part.userData.side as number;
      part.visible = state.working && progress < 0.86;
      part.position.z = -0.12 + side * 0.18 * (1 - load);
      part.rotation.y = align * Math.PI * 0.5;
    }
    if (role === "assemblerClamp") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY - clamp * 0.34;
    }
    if (role === "assemblerToolArm") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY - tool * 0.3;
    }
    if (role === "assemblerSpindle") part.rotation.y = state.time * 11 * tool;
    if (role === "assemblerSpark" && part instanceof THREE.Mesh) {
      const phase = (state.time * 3.2 + (part.userData.phase as number)) % 1;
      const angle = part.userData.angle as number;
      part.visible = tool > 0.35;
      part.position.set(
        0.16 + Math.cos(angle) * phase * 0.28,
        0.77 + phase * 0.18,
        -0.1 + Math.sin(angle) * phase * 0.28,
      );
      part.scale.setScalar((1 - phase) * tool);
    }
    if (role === "assemblerInputIngot") {
      const inputIndex = part.userData.inputIndex as number;
      part.visible = !state.working && inputIndex < state.inputCount;
    }
    if (role === "assemblerEjector") {
      const baseX = part.userData.baseX as number;
      part.position.x = baseX + release * 0.36;
    }
    if (role === "assemblerComponent") {
      const queued = state.outputQueued;
      part.visible = queued || release > 0.02;
      const travel = queued ? 0.9 : release;
      part.position.x = (part.userData.startX as number) + travel * 0.57;
      part.rotation.x = travel * 2.2;
    }
    if (role === "assemblerStatus") {
      if (state.outputQueued) setIndicator(part, 0xff5268, 0xa8172b, 2.2);
      else if (!state.inputConnected || (!state.working && state.inputCount < 2)) {
        setIndicator(part, 0xffa94d, 0x9b480c, 1.25 + Math.sin(state.time * 4) * 0.25);
      } else if (inspect > 0.2) setIndicator(part, 0xe7fbff, 0x5de4d1, 2.3);
      else setIndicator(part, 0x5de4d1, 0x1a8f82, 0.65 + state.activity * 1.05);
    }
  });
};
