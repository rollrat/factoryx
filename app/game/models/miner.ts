import * as THREE from "three";

type MinerMaterials = {
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt: THREE.Material;
  ore: THREE.Material;
};

type Point = [number, number, number];

const addBox = (
  group: THREE.Group,
  size: Point,
  position: Point,
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

const addCylinder = (
  group: THREE.Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Point,
  material: THREE.Material,
  segments = 12,
) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

const addBeam = (
  group: THREE.Group,
  start: Point,
  end: Point,
  thickness: number,
  material: THREE.Material,
) => {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = to.clone().sub(from);
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, direction.length(), thickness),
    material,
  );
  beam.position.copy(from).add(to).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);
  return beam;
};

const addSupportFeet = (group: THREE.Group, material: THREE.Material) => {
  const geometry = new THREE.BoxGeometry(0.34, 0.12, 0.34);
  const feet = new THREE.InstancedMesh(geometry, material, 4);
  const matrix = new THREE.Matrix4();
  const positions: Point[] = [
    [-0.65, 0.06, -0.65],
    [-0.65, 0.06, 0.65],
    [0.65, 0.06, -0.65],
    [0.65, 0.06, 0.65],
  ];
  positions.forEach(([x, y, z], index) => {
    matrix.makeTranslation(x, y, z);
    feet.setMatrixAt(index, matrix);
  });
  feet.castShadow = true;
  feet.receiveShadow = true;
  group.add(feet);
};

const createDrillAssembly = (materials: MinerMaterials) => {
  const drill = new THREE.Group();
  drill.position.set(-0.08, 0.24, 0.02);
  drill.userData.animationRole = "minerDrill";
  drill.userData.baseY = drill.position.y;

  addCylinder(drill, 0.095, 0.12, 1.18, [0, 0.66, 0], materials.steel, 12);

  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 10), materials.dark);
  bit.position.y = 0.04;
  bit.rotation.x = Math.PI;
  bit.castShadow = true;
  drill.add(bit);

  const cuttingCollar = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.045, 6, 14), materials.orange);
  cuttingCollar.position.y = 0.23;
  cuttingCollar.rotation.x = Math.PI / 2;
  cuttingCollar.castShadow = true;
  drill.add(cuttingCollar);

  [0.34, 0.5, 0.66].forEach((y, index) => {
    const flight = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.025, 4, 12, Math.PI * 1.3),
      materials.dark,
    );
    flight.position.y = y;
    flight.rotation.x = Math.PI / 2;
    flight.rotation.y = index * 2.05;
    flight.castShadow = true;
    drill.add(flight);
  });

  const toothGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.12);
  const teeth = new THREE.InstancedMesh(toothGeometry, materials.steel, 4);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < 4; index += 1) {
    const angle = index * (Math.PI / 2);
    quaternion.setFromEuler(new THREE.Euler(0, angle, 0));
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * 0.17, 0.16, Math.sin(angle) * 0.17),
      quaternion,
      scale,
    );
    teeth.setMatrixAt(index, matrix);
  }
  teeth.castShadow = true;
  drill.add(teeth);
  return drill;
};

const addOutputAssembly = (group: THREE.Group, materials: MinerMaterials) => {
  const transition = addBox(group, [0.5, 0.24, 0.4], [0.12, 0.48, -0.23], materials.dark);
  transition.rotation.y = Math.PI * 0.23;
  addBox(group, [0.78, 0.09, 0.52], [0.59, 0.36, -0.5], materials.dark);
  addBox(group, [0.7, 0.2, 0.075], [0.6, 0.47, -0.72], materials.pale);
  addBox(group, [0.7, 0.2, 0.075], [0.6, 0.47, -0.28], materials.pale);
  addBox(group, [0.62, 0.035, 0.045], [0.61, 0.585, -0.72], materials.orange, false);
  addBox(group, [0.62, 0.035, 0.045], [0.61, 0.585, -0.28], materials.orange, false);

  const rollerGroup = new THREE.Group();
  rollerGroup.position.set(0.72, 0.43, -0.5);
  rollerGroup.userData.animationRole = "minerOutputRoller";
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.45, 10), materials.steel);
  roller.rotation.x = Math.PI / 2;
  roller.castShadow = true;
  rollerGroup.add(roller);
  group.add(rollerGroup);

  addBox(group, [0.14, 0.09, 0.6], [0.93, 0.68, -0.5], materials.dark);
  addBox(group, [0.14, 0.09, 0.6], [0.93, 0.31, -0.5], materials.dark);
  addBox(group, [0.14, 0.29, 0.075], [0.93, 0.495, -0.755], materials.orange);
  addBox(group, [0.14, 0.29, 0.075], [0.93, 0.495, -0.245], materials.orange);

  const gate = new THREE.Group();
  gate.position.set(0.9, 0.645, -0.5);
  gate.userData.animationRole = "minerOutputGate";
  gate.userData.baseRotation = 0;
  addBox(gate, [0.055, 0.27, 0.42], [0, -0.135, 0], materials.rubber, false);
  addBox(gate, [0.065, 0.035, 0.34], [0.002, -0.13, 0], materials.orange, false);
  group.add(gate);

  const portMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa94d,
    emissive: 0x9b480c,
    emissiveIntensity: 0.18,
    metalness: 0.25,
    roughness: 0.32,
  });
  const portSignal = addBox(group, [0.04, 0.045, 0.32], [1.01, 0.74, -0.5], portMaterial, false);
  portSignal.userData.animationRole = "outputPort";

  [0, 0.09, 0.18].forEach((phase, index) => {
    const ore = new THREE.Mesh(new THREE.OctahedronGeometry(0.075 + index * 0.008, 0), materials.ore);
    ore.position.set(0.28, 0.48, -0.5);
    ore.userData.animationRole = "minerOrePulse";
    ore.userData.phase = phase;
    ore.userData.startX = 0.28;
    ore.userData.baseY = 0.48;
    ore.visible = false;
    group.add(ore);
  });
};

export const createMinerModel = (materials: MinerMaterials) => {
  const group = new THREE.Group();

  addSupportFeet(group, materials.dark);
  addBox(group, [1.46, 0.15, 0.14], [-0.02, 0.14, -0.69], materials.dark);
  addBox(group, [1.46, 0.15, 0.14], [-0.02, 0.14, 0.69], materials.dark);
  addBox(group, [0.14, 0.15, 1.24], [-0.69, 0.14, 0], materials.dark);
  addBox(group, [0.14, 0.15, 1.24], [0.65, 0.14, 0], materials.dark);
  addBeam(group, [-0.58, 0.18, -0.58], [-0.32, 0.34, -0.28], 0.08, materials.steel);
  addBeam(group, [-0.58, 0.18, 0.58], [-0.32, 0.34, 0.3], 0.08, materials.steel);
  addBeam(group, [0.56, 0.18, -0.5], [0.2, 0.34, -0.27], 0.08, materials.steel);
  addBeam(group, [0.56, 0.18, 0.5], [0.22, 0.34, 0.28], 0.08, materials.steel);

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16), materials.steel);
  baseRing.position.set(-0.08, 0.36, 0.02);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.castShadow = true;
  group.add(baseRing);
  addBox(group, [0.28, 0.055, 0.06], [-0.08, 0.38, -0.49], materials.orange, false);
  addBox(group, [0.28, 0.055, 0.06], [-0.08, 0.38, 0.53], materials.orange, false);
  const collector = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.55, 0.34, 10, 1, true),
    materials.dark,
  );
  collector.position.set(-0.08, 0.52, 0.02);
  collector.castShadow = true;
  collector.receiveShadow = true;
  collector.userData.animationRole = "minerCollector";
  collector.userData.baseX = collector.position.x;
  collector.userData.baseZ = collector.position.z;
  group.add(collector);
  const collectorRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 6, 14), materials.steel);
  collectorRim.position.set(-0.08, 0.69, 0.02);
  collectorRim.rotation.x = Math.PI / 2;
  collectorRim.castShadow = true;
  group.add(collectorRim);

  for (const z of [-0.42, 0.46]) {
    const footZ = z < 0 ? -0.62 : 0.62;
    addBeam(group, [-0.62, 0.2, footZ], [-0.2, 1.9, z], 0.16, materials.dark);
    addBeam(group, [0.42, 0.2, footZ], [-0.2, 1.9, z], 0.1, materials.steel);
    addBox(group, [0.085, 1.08, 0.085], [-0.08, 1.3, z * 0.7], materials.steel);
  }
  addBox(group, [0.31, 0.16, 0.94], [-0.2, 1.9, 0.02], materials.dark);
  addBox(group, [0.39, 0.08, 0.78], [-0.2, 1.99, 0.02], materials.orange);
  addBox(group, [0.3, 0.42, 0.42], [-0.51, 1.52, 0.02], materials.pale);
  addBox(group, [0.32, 0.07, 0.44], [-0.51, 1.75, 0.02], materials.orange);

  const motor = addCylinder(group, 0.19, 0.19, 0.62, [-0.2, 2.09, 0.02], materials.dark, 12);
  motor.rotation.x = Math.PI / 2;
  const motorCap = addCylinder(group, 0.195, 0.195, 0.07, [-0.2, 2.09, 0.35], materials.orange, 12);
  motorCap.rotation.x = Math.PI / 2;

  const motorRotor = new THREE.Group();
  motorRotor.position.set(-0.2, 2.09, 0.395);
  motorRotor.userData.animationRole = "minerMotor";
  for (let index = 0; index < 3; index += 1) {
    const spoke = addBox(motorRotor, [0.045, 0.21, 0.035], [0, 0.09, 0], materials.steel, false);
    spoke.rotation.z = index * ((Math.PI * 2) / 3);
  }
  addBox(motorRotor, [0.085, 0.085, 0.06], [0.09, 0, 0], materials.orange, false);
  group.add(motorRotor);

  const crankPlate = addCylinder(group, 0.2, 0.2, 0.075, [-0.22, 1.61, 0.48], materials.dark, 12);
  crankPlate.rotation.x = Math.PI / 2;
  const crank = new THREE.Group();
  crank.position.set(-0.22, 1.61, 0.525);
  crank.userData.animationRole = "minerCrank";
  const driveWheel = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.035, 6, 14), materials.steel);
  driveWheel.castShadow = true;
  crank.add(driveWheel);
  for (let index = 0; index < 3; index += 1) {
    const spoke = addBox(crank, [0.035, 0.22, 0.035], [0, 0.085, 0], materials.orange, false);
    spoke.rotation.z = index * ((Math.PI * 2) / 3);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 10), materials.orange);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  crank.add(hub);
  group.add(crank);

  const linkage = new THREE.Group();
  linkage.position.set(-0.22, 1.58, 0.53);
  linkage.userData.animationRole = "minerLinkage";
  linkage.userData.baseRotation = 0;
  addBox(linkage, [0.06, 0.42, 0.05], [0, -0.19, 0], materials.orange);
  group.add(linkage);

  const carriage = new THREE.Group();
  carriage.position.set(-0.08, 1.28, 0.02);
  carriage.userData.animationRole = "minerCarriage";
  carriage.userData.baseY = carriage.position.y;
  addCylinder(carriage, 0.3, 0.34, 0.28, [0, 0, 0], materials.pale, 10);
  addBox(carriage, [0.22, 0.31, 0.14], [-0.12, 0, -0.34], materials.dark);
  addBox(carriage, [0.22, 0.31, 0.14], [-0.12, 0, 0.34], materials.dark);
  const carriageBand = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.04, 6, 14), materials.orange);
  carriageBand.position.y = -0.1;
  carriageBand.rotation.x = Math.PI / 2;
  carriageBand.castShadow = true;
  carriage.add(carriageBand);
  const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.045, 6, 14), materials.steel);
  bearing.position.y = -0.17;
  bearing.rotation.x = Math.PI / 2;
  bearing.castShadow = true;
  carriage.add(bearing);
  group.add(carriage);
  group.add(createDrillAssembly(materials));

  addOutputAssembly(group, materials);

  addBox(group, [0.34, 0.38, 0.12], [-0.48, 1.17, 0.5], materials.dark);
  const controlMaterial = new THREE.MeshStandardMaterial({
    color: 0x5de4d1,
    emissive: 0x1a8f82,
    emissiveIntensity: 0.7,
    metalness: 0.2,
    roughness: 0.28,
  });
  addBox(group, [0.23, 0.18, 0.025], [-0.48, 1.2, 0.566], controlMaterial, false)
    .userData.animationRole = "minerControlScreen";
  addBox(group, [0.24, 0.045, 0.03], [-0.48, 1.04, 0.57], materials.orange, false);

  addBeam(group, [-0.51, 1.75, 0.22], [-0.5, 1.37, 0.42], 0.05, materials.rubber);
  addBeam(group, [-0.5, 1.37, 0.42], [-0.48, 1.29, 0.48], 0.05, materials.rubber);
  addBeam(group, [-0.34, 1.12, 0.43], [-0.48, 1.12, 0.45], 0.065, materials.steel);

  const statusMaterial = new THREE.MeshStandardMaterial({
    color: 0x5de4d1,
    emissive: 0x1a8f82,
    emissiveIntensity: 1.4,
    metalness: 0.15,
    roughness: 0.25,
  });
  addCylinder(group, 0.045, 0.045, 0.12, [0.76, 0.76, -0.72], materials.dark, 8);
  const status = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), statusMaterial);
  status.position.set(0.76, 0.84, -0.72);
  status.userData.animationRole = "minerStatusLight";
  group.add(status);

  const dustMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c887d,
    transparent: true,
    opacity: 0.18,
    roughness: 1,
    depthWrite: false,
  });
  [0, 0.34, 0.67].forEach((phase, index) => {
    const dust = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), dustMaterial);
    const angle = index * ((Math.PI * 2) / 3) + 0.35;
    dust.position.set(-0.08 + Math.cos(angle) * 0.42, 0.18, 0.02 + Math.sin(angle) * 0.42);
    dust.userData.animationRole = "minerDust";
    dust.userData.phase = phase;
    dust.userData.baseX = dust.position.x;
    dust.userData.baseZ = dust.position.z;
    dust.userData.directionX = Math.cos(angle);
    dust.userData.directionZ = Math.sin(angle);
    dust.scale.setScalar(0);
    group.add(dust);
  });

  return group;
};

export type MinerVisualState = {
  time: number;
  delta: number;
  progress: number;
  activity: number;
  working: boolean;
  outputQueued: boolean;
  outputConnected: boolean;
};

export const animateMinerModel = (group: THREE.Group, state: MinerVisualState) => {
  const progress = THREE.MathUtils.clamp(state.progress, 0, 1);
  const descent = THREE.MathUtils.smoothstep(progress, 0.14, 0.4);
  const returning = THREE.MathUtils.smoothstep(progress, 0.76, 0.98);
  const stroke = Math.max(0, descent - returning) * state.activity;
  const contact = THREE.MathUtils.smoothstep(progress, 0.38, 0.48)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.72, 0.82))
    * state.activity;
  const impact = Math.pow(Math.max(0, Math.sin(state.time * 13)), 10) * contact;
  const release = THREE.MathUtils.smoothstep(progress, 0.78, 0.89)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.96, 1))
    * state.activity;

  group.traverse((part) => {
    const role = part.userData.animationRole as string | undefined;
    if (role === "minerMotor") part.rotation.z = -state.time * 8.4;
    if (role === "minerDrill") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY - stroke * 0.2 - impact * 0.025;
      part.rotation.y = state.time * 7.2;
    }
    if (role === "minerCarriage") {
      const baseY = part.userData.baseY as number;
      part.position.y = baseY - stroke * 0.14 - impact * 0.012;
    }
    if (role === "minerCrank") part.rotation.z = -state.time * 4.6;
    if (role === "minerLinkage") {
      const baseRotation = part.userData.baseRotation as number;
      part.rotation.z = baseRotation + stroke * 0.24 + Math.sin(state.time * 4.6) * 0.045 * state.activity;
    }
    if (role === "minerCollector") {
      const baseX = part.userData.baseX as number;
      const baseZ = part.userData.baseZ as number;
      part.position.x = baseX + Math.sin(state.time * 31) * 0.008 * contact;
      part.position.z = baseZ + Math.cos(state.time * 27) * 0.006 * contact;
    }
    if (role === "minerOutputRoller") {
      const travel = ((part.userData.travel as number | undefined) ?? 0) + state.delta * release * 8;
      part.userData.travel = travel;
      part.rotation.z = -travel;
    }
    if (role === "minerOutputGate") {
      const baseRotation = part.userData.baseRotation as number;
      const gateOpen = Math.max(release, state.outputQueued ? 0.28 : 0);
      part.rotation.z = baseRotation - gateOpen * 1.02;
    }
    if (role === "minerOrePulse" && part instanceof THREE.Mesh) {
      const phase = part.userData.phase as number;
      const rawTravel = (progress - (0.72 + phase * 0.25)) / 0.245;
      const travel = THREE.MathUtils.clamp(rawTravel, 0, 1);
      const queuedOre = state.outputQueued && phase === 0;
      const visible = queuedOre || (state.working && rawTravel > 0 && rawTravel < 1);
      const displayTravel = queuedOre ? 0.82 : travel;
      part.visible = visible;
      part.position.x = (part.userData.startX as number) + displayTravel * 0.66;
      part.position.y = (part.userData.baseY as number) + Math.sin(displayTravel * Math.PI) * 0.075;
      part.position.z = -0.5 + Math.sin((displayTravel + phase) * Math.PI * 2) * 0.025;
      part.rotation.x = displayTravel * 3.2;
      part.rotation.z = displayTravel * 4.1;
      part.scale.setScalar(visible ? 0.78 + Math.sin(displayTravel * Math.PI) * 0.24 : 0);
    }
    if (role === "minerDust" && part instanceof THREE.Mesh) {
      const dustPhase = (state.time * 0.72 + (part.userData.phase as number)) % 1;
      const dustStrength = state.activity * (0.35 + impact * 0.65);
      part.visible = dustStrength > 0.015;
      part.position.x = (part.userData.baseX as number)
        + (part.userData.directionX as number) * dustPhase * 0.2;
      part.position.z = (part.userData.baseZ as number)
        + (part.userData.directionZ as number) * dustPhase * 0.2;
      part.position.y = 0.17 + dustPhase * 0.24;
      part.scale.setScalar((0.18 + dustPhase * 0.72) * dustStrength);
    }
    if ((role === "minerStatusLight" || role === "minerControlScreen") && part instanceof THREE.Mesh) {
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        const color = state.outputQueued ? 0xff5268 : state.outputConnected ? 0x5de4d1 : 0xffa94d;
        const emissive = state.outputQueued ? 0xa8172b : state.outputConnected ? 0x1a8f82 : 0x9b480c;
        material.color.setHex(color);
        material.emissive.setHex(emissive);
        material.emissiveIntensity = state.outputQueued
          ? 2.3
          : 0.55 + state.activity * (1.05 + Math.sin(state.time * 4.2) * 0.25);
      }
    }
    if (role === "outputPort" && part instanceof THREE.Mesh) {
      const material = part.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = state.outputConnected ? 1.6 : 0.15;
      }
    }
  });
};
