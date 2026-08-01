import * as THREE from "three";
import type {
  BuildingDefinition,
  ConnectorProfile,
  GridCell,
  PortDefinition,
  PortId,
  TransportMedium,
} from "../domain/types.ts";

export type ConnectionMaterials = Readonly<{
  dark: THREE.Material;
  steel: THREE.Material;
  pale: THREE.Material;
  cyan: THREE.Material;
  amber: THREE.Material;
  orange: THREE.Material;
  rubber: THREE.Material;
  belt?: THREE.Material;
  beltRib?: THREE.Material;
  copper?: THREE.Material;
}>;

export type WorldPortOrigin = Readonly<{ x: number; y?: number; z: number }>;

export type WorldPortReference = Readonly<{
  building: BuildingDefinition;
  portId: PortId;
  origin: WorldPortOrigin;
  rotation: 0 | 1 | 2 | 3;
}>;

export type ResolvedWorldPort = Readonly<{
  buildingId: string;
  port: PortDefinition;
  position: THREE.Vector3;
  connectionAnchor: THREE.Vector3;
  facing: GridCell;
  rotation: 0 | 1 | 2 | 3;
}>;

export type FluidConnectionTopology = "auto" | "straight" | "corner" | "tee" | "pump";

export type ConnectionModelOptions = Readonly<{
  fluidTopology?: FluidConnectionTopology;
  branch?: ResolvedWorldPort;
  flowDirection?: 1 | -1;
}>;

export type ConnectionVisualState = Readonly<{
  time: number;
  activity: number;
  flowing: boolean;
  blocked?: boolean;
  direction?: 1 | -1;
}>;

const rotateXZ = (x: number, z: number, rotation: 0 | 1 | 2 | 3) => {
  let rotated = { x, z };
  if (rotation === 1) rotated = { x: -z, z: x };
  else if (rotation === 2) rotated = { x: -x, z: -z };
  else if (rotation === 3) rotated = { x: z, z: -x };
  return {
    x: Object.is(rotated.x, -0) ? 0 : rotated.x,
    z: Object.is(rotated.z, -0) ? 0 : rotated.z,
  };
};

export const resolveWorldPort = (reference: WorldPortReference): ResolvedWorldPort => {
  const port = reference.building.ports.find(({ id }) => id === reference.portId);
  if (!port) throw new Error(`Unknown port ${reference.building.id}.${reference.portId}`);
  const originY = reference.origin.y ?? 0;
  const localPosition = rotateXZ(port.localPosition.x, port.localPosition.z, reference.rotation);
  const localFacing = rotateXZ(port.localFacing.x, port.localFacing.z, reference.rotation);
  const localCellCenter = {
    x: port.connectionCell.x + 0.5 - reference.building.footprint.x / 2,
    z: port.connectionCell.z + 0.5 - reference.building.footprint.z / 2,
  };
  const rotatedCell = rotateXZ(localCellCenter.x, localCellCenter.z, reference.rotation);
  return {
    buildingId: reference.building.id,
    port,
    position: new THREE.Vector3(
      reference.origin.x + localPosition.x,
      originY + port.localPosition.y,
      reference.origin.z + localPosition.z,
    ),
    connectionAnchor: new THREE.Vector3(
      reference.origin.x + rotatedCell.x,
      originY + port.localPosition.y,
      reference.origin.z + rotatedCell.z,
    ),
    facing: { x: localFacing.x, z: localFacing.z },
    rotation: reference.rotation,
  };
};

const compatibleDirection = (source: PortDefinition, target: PortDefinition) => {
  const sourceCanOutput = source.direction === "output" || source.direction === "bidirectional";
  const targetCanInput = target.direction === "input" || target.direction === "bidirectional";
  return sourceCanOutput && targetCanInput;
};

const validateConnection = (source: ResolvedWorldPort, target: ResolvedWorldPort) => {
  if (source.port.medium !== target.port.medium) {
    throw new Error(`Connection medium mismatch: ${source.port.medium} to ${target.port.medium}`);
  }
  if (!compatibleDirection(source.port, target.port)) {
    throw new Error(`Connection direction mismatch: ${source.port.direction} to ${target.port.direction}`);
  }
  if (source.port.connectorProfile !== target.port.connectorProfile) {
    throw new Error(`Connection profile mismatch: ${source.port.connectorProfile} to ${target.port.connectorProfile}`);
  }
};

const sameAxis = (a: THREE.Vector3, b: THREE.Vector3) => (
  Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6
);

const dedupePoints = (points: readonly THREE.Vector3[]) => points.filter((point, index) => (
  index === 0 || point.distanceToSquared(points[index - 1]) > 1e-8
));

const routedPath = (
  source: ResolvedWorldPort,
  target: ResolvedWorldPort,
  forceCorner = false,
) => {
  const start = source.position.clone();
  const end = target.position.clone();
  const aligned = sameAxis(source.connectionAnchor, target.connectionAnchor);
  if (aligned && !forceCorner) return [start, end];
  const sourceAlongX = source.facing.x !== 0;
  const corner = sourceAlongX
    ? new THREE.Vector3(end.x, start.y, start.z)
    : new THREE.Vector3(start.x, start.y, end.z);
  if (corner.distanceToSquared(start) < 1e-8 || corner.distanceToSquared(end) < 1e-8) {
    const alternate = sourceAlongX
      ? new THREE.Vector3(start.x, start.y, end.z)
      : new THREE.Vector3(end.x, start.y, start.z);
    return dedupePoints([start, alternate, end]);
  }
  return dedupePoints([start, corner, end]);
};

const pathLength = (points: readonly THREE.Vector3[]) => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += points[index - 1].distanceTo(points[index]);
  return length;
};

const pointOnPath = (points: readonly THREE.Vector3[], normalized: number) => {
  const total = pathLength(points);
  if (total <= 1e-8) return { position: points[0].clone(), tangent: new THREE.Vector3(0, 0, 1) };
  let remaining = THREE.MathUtils.clamp(normalized, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = start.distanceTo(end);
    if (remaining <= segmentLength || index === points.length - 1) {
      const fraction = segmentLength <= 1e-8 ? 0 : Math.min(1, remaining / segmentLength);
      return {
        position: start.clone().lerp(end, fraction),
        tangent: end.clone().sub(start).normalize(),
      };
    }
    remaining -= segmentLength;
  }
  return { position: points.at(-1)!.clone(), tangent: new THREE.Vector3(0, 0, 1) };
};

const addSegmentBox = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
  height: number,
  material: THREE.Material,
  role: string,
) => {
  const delta = end.clone().sub(start);
  const length = delta.length();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.rotation.y = Math.atan2(delta.x, delta.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.animationRole = role;
  mesh.userData.segmentLength = length;
  group.add(mesh);
  return mesh;
};

const addCylinderBetween = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  role: string,
) => {
  const delta = end.clone().sub(start);
  const length = delta.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.animationRole = role;
  mesh.userData.segmentLength = length;
  group.add(mesh);
  return mesh;
};

const pathData = (points: readonly THREE.Vector3[]) => points.map((point) => point.toArray());
const fromPathData = (value: unknown) => (value as Array<[number, number, number]>).map((point) => new THREE.Vector3(...point));

const updateInstancesOnPath = (
  mesh: THREE.InstancedMesh,
  points: readonly THREE.Vector3[],
  offset: number,
  direction: 1 | -1,
) => {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < mesh.count; index += 1) {
    const phase = ((index / mesh.count + offset * direction) % 1 + 1) % 1;
    const sample = pointOnPath(points, phase);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sample.tangent.x, sample.tangent.z));
    matrix.compose(sample.position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
};

const addFlowPulses = (
  group: THREE.Group,
  points: readonly THREE.Vector3[],
  count: number,
  radius: number,
  material: THREE.Material,
  role: string,
) => {
  const pulses = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 6, 4), material, count);
  pulses.castShadow = false;
  pulses.userData.animationRole = role;
  pulses.userData.pathPoints = pathData(points);
  updateInstancesOnPath(pulses, points, 0, 1);
  group.add(pulses);
  return pulses;
};

const addSolidConnection = (
  group: THREE.Group,
  points: readonly THREE.Vector3[],
  materials: ConnectionMaterials,
) => {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const frameStart = start.clone().add(new THREE.Vector3(0, -0.14, 0));
    const frameEnd = end.clone().add(new THREE.Vector3(0, -0.14, 0));
    addSegmentBox(group, frameStart, frameEnd, 0.78, 0.15, materials.dark, "connectionBeltFrame");
    const surfaceStart = start.clone().add(new THREE.Vector3(0, -0.035, 0));
    const surfaceEnd = end.clone().add(new THREE.Vector3(0, -0.035, 0));
    addSegmentBox(group, surfaceStart, surfaceEnd, 0.68, 0.045, materials.belt ?? materials.rubber, "connectionBeltSurface");
  }
  if (points.length > 2) {
    for (const corner of points.slice(1, -1)) {
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.15, 10), materials.dark);
      cover.position.copy(corner).add(new THREE.Vector3(0, -0.14, 0));
      cover.userData.animationRole = "connectionBeltCorner";
      group.add(cover);
    }
  }
  const treadCount = Math.max(2, Math.min(48, Math.ceil(pathLength(points) / 0.18)));
  const treads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.018, 0.035),
    materials.beltRib ?? materials.steel,
    treadCount,
  );
  treads.userData.animationRole = "connectionBeltTreads";
  treads.userData.pathPoints = pathData(points);
  updateInstancesOnPath(treads, fromPathData(treads.userData.pathPoints), 0, 1);
  group.add(treads);
};

const addFluidConnection = (
  group: THREE.Group,
  mainPath: readonly THREE.Vector3[],
  branchPath: readonly THREE.Vector3[] | null,
  topology: Exclude<FluidConnectionTopology, "auto">,
  materials: ConnectionMaterials,
) => {
  const radius = 0.12;
  const paths = branchPath ? [mainPath, branchPath] : [mainPath];
  for (const points of paths) {
    for (let index = 1; index < points.length; index += 1) {
      addCylinderBetween(group, points[index - 1], points[index], radius, materials.steel, "connectionPipeSegment");
    }
  }
  const joints = [...mainPath.slice(1, -1), ...(branchPath?.slice(0, -1) ?? [])];
  for (const joint of joints) {
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.08, 8, 6), materials.steel);
    elbow.position.copy(joint);
    elbow.userData.animationRole = topology === "tee" ? "connectionPipeTee" : "connectionPipeElbow";
    group.add(elbow);
  }

  const flangePoints = [mainPath[0], mainPath.at(-1)!, ...(branchPath ? [branchPath.at(-1)!] : [])];
  const flange = new THREE.InstancedMesh(new THREE.TorusGeometry(0.16, 0.025, 6, 12), materials.orange, flangePoints.length);
  const matrix = new THREE.Matrix4();
  flangePoints.forEach((point, index) => {
    matrix.makeRotationX(Math.PI / 2);
    matrix.setPosition(point);
    flange.setMatrixAt(index, matrix);
  });
  flange.instanceMatrix.needsUpdate = true;
  flange.userData.animationRole = "connectionPipeFlanges";
  group.add(flange);

  addFlowPulses(group, mainPath, Math.max(2, Math.min(12, Math.ceil(pathLength(mainPath) / 0.75))), 0.05, materials.cyan, "connectionFluidPulses");
  if (branchPath) addFlowPulses(group, branchPath, 3, 0.045, materials.cyan, "connectionFluidBranchPulses");

  if (topology === "pump") {
    const sample = pointOnPath(mainPath, 0.5);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.38, 12), materials.dark);
    housing.position.copy(sample.position);
    housing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sample.tangent);
    housing.userData.animationRole = "connectionPumpHousing";
    group.add(housing);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), materials.orange);
    rotor.position.copy(sample.position);
    rotor.userData.animationRole = "connectionPumpRotor";
    group.add(rotor);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 7), materials.cyan);
    arrow.position.copy(sample.position).add(sample.tangent.clone().multiplyScalar(0.3));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sample.tangent);
    arrow.userData.animationRole = "connectionFlowDirection";
    group.add(arrow);
  }
};

const addPowerConnection = (
  group: THREE.Group,
  source: ResolvedWorldPort,
  target: ResolvedWorldPort,
  materials: ConnectionMaterials,
) => {
  const highVoltage = source.port.connectorProfile === "power_high_voltage";
  const distance = source.position.distanceTo(target.position);
  const midpoint = source.position.clone().lerp(target.position, 0.5);
  midpoint.y -= Math.min(highVoltage ? 0.7 : 0.32, distance * (highVoltage ? 0.07 : 0.045));
  const curve = new THREE.CatmullRomCurve3([source.position, midpoint, target.position], false, "catmullrom", 0.5);
  const radius = highVoltage ? 0.045 : 0.024;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(4, Math.min(32, Math.ceil(distance * 2))), radius, highVoltage ? 7 : 5, false),
    materials.copper ?? materials.orange,
  );
  cable.userData.animationRole = "connectionPowerCable";
  cable.userData.connectorProfile = source.port.connectorProfile;
  cable.userData.cableRadius = radius;
  cable.userData.pathPoints = pathData(Array.from({ length: 9 }, (_, index) => curve.getPoint(index / 8)));
  group.add(cable);
  if (highVoltage) {
    for (const endpoint of [source.position, target.position]) {
      const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 8), materials.rubber);
      insulator.position.copy(endpoint);
      insulator.userData.animationRole = "connectionHighVoltageInsulator";
      group.add(insulator);
    }
  }
  addFlowPulses(
    group,
    fromPathData(cable.userData.pathPoints),
    highVoltage ? 7 : 4,
    highVoltage ? 0.055 : 0.04,
    materials.cyan,
    "connectionPowerPulses",
  );
};

const resolvedTopology = (
  medium: TransportMedium,
  source: ResolvedWorldPort,
  target: ResolvedWorldPort,
  options: ConnectionModelOptions,
) => {
  if (medium !== "fluid") return medium;
  if (options.fluidTopology && options.fluidTopology !== "auto") return options.fluidTopology;
  if (source.buildingId === "pipe_pump" || target.buildingId === "pipe_pump") return "pump";
  return sameAxis(source.connectionAnchor, target.connectionAnchor) ? "straight" : "corner";
};

export const createPortConnectionModel = (
  source: ResolvedWorldPort,
  target: ResolvedWorldPort,
  materials: ConnectionMaterials,
  options: ConnectionModelOptions = {},
) => {
  validateConnection(source, target);
  const medium = source.port.medium;
  const topology = resolvedTopology(medium, source, target, options);
  if (topology === "tee" && !options.branch) throw new Error("Fluid tee connections require a branch port");
  if (options.branch) {
    validateConnection(source, options.branch);
    if (options.branch.port.medium !== "fluid") throw new Error("Only fluid connections support a branch port");
  }

  const forceCorner = topology === "corner";
  const mainPath = routedPath(source, target, forceCorner);
  let branchPath: THREE.Vector3[] | null = null;
  if (topology === "tee" && options.branch) {
    const teePoint = mainPath.length > 2 ? mainPath[1].clone() : pointOnPath(mainPath, 0.5).position;
    branchPath = dedupePoints([teePoint, options.branch.position.clone()]);
  }

  const group = new THREE.Group();
  group.name = `connection:${source.buildingId}.${source.port.id}->${target.buildingId}.${target.port.id}`;
  group.userData.medium = medium;
  group.userData.connectorProfile = source.port.connectorProfile;
  group.userData.topology = topology;
  group.userData.flowDirection = options.flowDirection ?? 1;
  group.userData.source = {
    buildingId: source.buildingId,
    portId: source.port.id,
    position: source.position.toArray(),
    connectionCell: source.connectionAnchor.toArray(),
    facing: source.facing,
    rotation: source.rotation,
  };
  group.userData.target = {
    buildingId: target.buildingId,
    portId: target.port.id,
    position: target.position.toArray(),
    connectionCell: target.connectionAnchor.toArray(),
    facing: target.facing,
    rotation: target.rotation,
  };
  group.userData.pathPoints = pathData(mainPath);
  group.userData.length = pathLength(mainPath) + (branchPath ? pathLength(branchPath) : 0);

  if (medium === "solid") addSolidConnection(group, mainPath, materials);
  else if (medium === "fluid") addFluidConnection(group, mainPath, branchPath, topology as Exclude<FluidConnectionTopology, "auto">, materials);
  else addPowerConnection(group, source, target, materials);
  return group;
};

export const animateConnectionModel = (
  group: THREE.Group,
  state: ConnectionVisualState,
) => {
  const activity = THREE.MathUtils.clamp(state.activity, 0, 1);
  const moving = state.flowing && !state.blocked && activity > 0;
  const direction = state.direction ?? (group.userData.flowDirection as 1 | -1 | undefined) ?? 1;
  group.traverse((part: THREE.Object3D) => {
    const role = part.userData.animationRole as string | undefined;
    if (part instanceof THREE.InstancedMesh && (
      role === "connectionBeltTreads"
      || role === "connectionFluidPulses"
      || role === "connectionFluidBranchPulses"
      || role === "connectionPowerPulses"
    )) {
      const points = fromPathData(part.userData.pathPoints);
      part.visible = role === "connectionBeltTreads" || moving;
      updateInstancesOnPath(part, points, moving ? state.time * activity * 0.22 : 0, direction);
    }
    if (role === "connectionPumpRotor") {
      const base = (part.userData.baseRotationZ as number | undefined) ?? part.rotation.z;
      part.userData.baseRotationZ = base;
      part.rotation.z = base + (moving ? state.time * activity * 7 * direction : 0);
    }
    if (role === "connectionFlowDirection") part.visible = moving;
  });
};

export const connectionProfileKind = (profile: ConnectorProfile) => {
  if (profile === "belt_standard") return "solid";
  if (profile === "pipe_mk1") return "fluid";
  return profile === "power_high_voltage" ? "power_high_voltage" : "power_local";
};
