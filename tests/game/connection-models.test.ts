import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { START_BUILDINGS } from "../../app/game/data/buildings.ts";
import {
  animateConnectionModel,
  connectionProfileKind,
  createPortConnectionModel,
  resolveWorldPort,
  type ConnectionMaterials,
} from "../../app/game/models/connection.ts";

const material = (color: number) => new THREE.MeshStandardMaterial({ color });
const materials: ConnectionMaterials = {
  dark: material(0x16242a),
  steel: material(0x657b80),
  pale: material(0xa8bcc0),
  cyan: material(0x5de4d1),
  amber: material(0xffa94d),
  orange: material(0xd96f32),
  rubber: material(0x0b1215),
  belt: material(0x27393d),
  beltRib: material(0x405255),
  copper: material(0xb76e43),
};

const building = (id: string) => {
  const definition = START_BUILDINGS.find((candidate) => candidate.id === id);
  assert.ok(definition, id);
  return definition;
};

const port = (
  buildingId: string,
  portId: string,
  origin: { x: number; y?: number; z: number },
  rotation: 0 | 1 | 2 | 3 = 0,
) => resolveWorldPort({ building: building(buildingId), portId, origin, rotation });

const parts = (model: THREE.Object3D) => {
  const found: THREE.Object3D[] = [];
  model.traverse((part) => found.push(part));
  return found;
};

const withRole = (model: THREE.Object3D, role: string) => parts(model).filter((part) => part.userData.animationRole === role);

test("world ports rotate local position, connection cell, and facing together", () => {
  const definition = building("circuit_printer");
  const source = definition.ports.find(({ id }) => id === "product_out")!;
  const resolved = port("circuit_printer", "product_out", { x: 10, y: 2, z: -4 }, 1);

  assert.deepEqual(resolved.position.toArray(), [10.5, 2 + source.localPosition.y, -2.5]);
  assert.deepEqual(resolved.facing, { x: 0, z: 1 });
  assert.deepEqual(resolved.connectionAnchor.toArray(), [10.5, 2 + source.localPosition.y, -2]);
});

test("solid connections keep the conveyor frame and use instanced moving treads", () => {
  const source = port("arc_smelter", "solid_out", { x: 0, z: 0 });
  const target = port("hydraulic_former", "solid_in", { x: 4, z: 0 });
  const model = createPortConnectionModel(source, target, materials);

  assert.equal(model.userData.medium, "solid");
  assert.ok(withRole(model, "connectionBeltFrame").length > 0);
  assert.ok(withRole(model, "connectionBeltSurface").length > 0);
  const treads = withRole(model, "connectionBeltTreads")[0];
  assert.ok(treads instanceof THREE.InstancedMesh);
  assert.ok(treads.count <= 48);
  assert.equal(model.userData.length, source.position.distanceTo(target.position));
  const firstTread = new THREE.Matrix4();
  const treadPosition = new THREE.Vector3();
  treads.getMatrixAt(0, firstTread);
  treadPosition.setFromMatrixPosition(firstTread);
  assert.ok(Math.abs(treadPosition.y - source.position.y) < 1e-6);
});

test("fluid connections render straight, corner, tee, and directional pump variants", () => {
  const source = port("fluid_extractor", "fluid_out", { x: 0, z: 0 });
  const straightTarget = port("fluid_tank", "fluid_in", { x: 4, z: 0 });
  const cornerTarget = port("fluid_tank", "fluid_in", { x: 4, z: 3 });
  const branch = port("fluid_tank", "fluid_in", { x: 2, z: 4 });

  const straight = createPortConnectionModel(source, straightTarget, materials);
  const corner = createPortConnectionModel(source, cornerTarget, materials, { fluidTopology: "corner" });
  const tee = createPortConnectionModel(source, cornerTarget, materials, { fluidTopology: "tee", branch });
  const pump = createPortConnectionModel(source, straightTarget, materials, { fluidTopology: "pump", flowDirection: -1 });

  assert.equal(straight.userData.topology, "straight");
  assert.equal(corner.userData.topology, "corner");
  assert.ok(withRole(corner, "connectionPipeElbow").length > 0);
  assert.equal(tee.userData.topology, "tee");
  assert.ok(withRole(tee, "connectionPipeTee").length > 0);
  assert.ok(withRole(tee, "connectionFluidBranchPulses")[0] instanceof THREE.InstancedMesh);
  assert.ok(withRole(pump, "connectionPumpRotor").length === 1);
  assert.ok(withRole(pump, "connectionFlowDirection").length === 1);
  assert.ok(modelMeshCount(tee) < 20);
});

const modelMeshCount = (model: THREE.Object3D) => parts(model).filter((part) => part instanceof THREE.Mesh).length;

const powerEndpoint = (
  buildingId: string,
  portId: string,
  origin: { x: number; z: number },
) => port(buildingId, portId, origin);

test("local and high-voltage power cables use distinct profiles and geometry", () => {
  const local = createPortConnectionModel(
    powerEndpoint("field_power_core", "power_out", { x: 0, z: 0 }),
    powerEndpoint("distribution_pole_mk1", "grid_a", { x: 4, z: 0 }),
    materials,
  );
  const high = createPortConnectionModel(
    powerEndpoint("combined_fuel_turbine", "power_out", { x: 0, z: 4 }),
    powerEndpoint("high_voltage_tower", "high_voltage_a", { x: 6, z: 4 }),
    materials,
  );
  const localCable = withRole(local, "connectionPowerCable")[0];
  const highCable = withRole(high, "connectionPowerCable")[0];

  assert.equal(localCable.userData.connectorProfile, "power_local");
  assert.equal(highCable.userData.connectorProfile, "power_high_voltage");
  assert.ok(highCable.userData.cableRadius > localCable.userData.cableRadius);
  assert.equal(withRole(local, "connectionHighVoltageInsulator").length, 0);
  assert.equal(withRole(high, "connectionHighVoltageInsulator").length, 2);
  assert.equal(connectionProfileKind("power_local"), "power_local");
  assert.equal(connectionProfileKind("power_high_voltage"), "power_high_voltage");
});

test("flow pulses and pump direction animate along distance and stop safely", () => {
  const source = port("fluid_extractor", "fluid_out", { x: 0, z: 0 });
  const target = port("fluid_tank", "fluid_in", { x: 5, z: 0 });
  const model = createPortConnectionModel(source, target, materials, { fluidTopology: "pump" });
  const pulses = withRole(model, "connectionFluidPulses")[0] as THREE.InstancedMesh;
  const rotor = withRole(model, "connectionPumpRotor")[0];
  const before = new THREE.Matrix4();
  const after = new THREE.Matrix4();
  pulses.getMatrixAt(0, before);
  const safeRotation = rotor.rotation.z;

  animateConnectionModel(model, { time: 2, activity: 1, flowing: true });
  pulses.getMatrixAt(0, after);
  assert.notDeepEqual(after.elements, before.elements);
  assert.notEqual(rotor.rotation.z, safeRotation);
  animateConnectionModel(model, { time: 8, activity: 1, flowing: true, blocked: true });
  assert.equal(pulses.visible, false);
  assert.equal(rotor.rotation.z, safeRotation);
  assert.equal(withRole(model, "connectionFlowDirection")[0].visible, false);
});

test("incompatible medium, direction, and profile pairs are rejected", () => {
  const solidOutput = port("arc_smelter", "solid_out", { x: 0, z: 0 });
  const solidInput = port("hydraulic_former", "solid_in", { x: 4, z: 0 });
  const fluidInput = port("fluid_tank", "fluid_in", { x: 4, z: 0 });
  const highVoltage = port("high_voltage_tower", "high_voltage_a", { x: 4, z: 0 });
  const localPower = port("distribution_pole_mk1", "grid_a", { x: 0, z: 0 });

  assert.throws(() => createPortConnectionModel(solidOutput, fluidInput, materials), /medium mismatch/);
  assert.throws(() => createPortConnectionModel(solidInput, solidOutput, materials), /direction mismatch/);
  assert.throws(() => createPortConnectionModel(localPower, highVoltage, materials), /profile mismatch/);
});
