import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { START_BUILDINGS } from "../../app/game/data/buildings.ts";
import type { BuildingDefinition } from "../../app/game/domain/types.ts";
import {
  createBuildingModel,
  createBuildingModelFromDefinition,
  createFactoryMaterials,
} from "../../app/game/models.ts";
import {
  animateGenericBuildingModel,
  createGenericBuildingModel,
  genericBuildingCategory,
  type GenericBuildingMaterials,
} from "../../app/game/models/genericBuilding.ts";

const material = (color: number) => new THREE.MeshStandardMaterial({ color });
const materials: GenericBuildingMaterials = {
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

const meshes = (model: THREE.Object3D) => {
  const result: THREE.Mesh[] = [];
  model.traverse((part: THREE.Object3D) => {
    if (part instanceof THREE.Mesh) result.push(part);
  });
  return result;
};

const hasAnimationRole = (model: THREE.Object3D, role: string) => {
  let found = false;
  model.traverse((part: THREE.Object3D) => {
    if (part.userData.animationRole === role) found = true;
  });
  return found;
};

const building = (id: string) => {
  const definition = START_BUILDINGS.find((candidate) => candidate.id === id);
  assert.ok(definition, `missing building definition ${id}`);
  return definition;
};

const silhouette = (id: string) => {
  const definition = building(id);
  const model = createGenericBuildingModel(definition, materials);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  return {
    category: model.userData.modelCategory,
    meshes: meshes(model).length,
    dimensions: [size.x, size.y, size.z].map((value) => Number(value.toFixed(2))),
    roles: [...new Set(meshes(model).map((mesh) => mesh.userData.animationRole).filter(Boolean))].sort(),
  };
};

test("all building definitions produce a visible model with animation roles", () => {
  assert.ok(START_BUILDINGS.length >= 34);
  for (const definition of START_BUILDINGS) {
    const model = createGenericBuildingModel(definition, materials);
    const parts = meshes(model);
    assert.ok(parts.length > 0, `${definition.id} should contain meshes`);
    assert.ok(parts.some((part) => part.userData.animationRole), `${definition.id} should expose animation roles`);
    assert.equal(model.userData.buildingId, definition.id);
    assert.deepEqual(model.userData.footprint, definition.footprint);
  }
});

test("every definition port has a marker at its exact local position", () => {
  for (const definition of START_BUILDINGS) {
    const model = createGenericBuildingModel(definition, materials);
    const portMarkers = new Map(
      meshes(model)
        .filter((part) => typeof part.userData.portId === "string")
        .map((part) => [part.userData.portId as string, part]),
    );
    for (const port of definition.ports) {
      const marker = portMarkers.get(port.id);
      assert.ok(marker, `${definition.id}.${port.id} should have a marker`);
      assert.deepEqual(marker.position.toArray(), [port.localPosition.x, port.localPosition.y, port.localPosition.z]);
      assert.equal(marker.userData.medium, port.medium);
      assert.equal(marker.userData.connectorProfile, port.connectorProfile);
    }
  }
});

test("production, logistics, fluid, generator, distribution, storage, and infrastructure silhouettes differ", () => {
  const ids = [
    "hydraulic_former",
    "conveyor_mk2",
    "pipe_pump",
    "combined_fuel_turbine",
    "distribution_pole_mk2",
    "industrial_storage",
    "project_dock",
  ];
  const samples = ids.map(silhouette);
  assert.deepEqual(samples.map(({ category }) => category), [
    "production",
    "logistics",
    "fluid",
    "generator",
    "distribution",
    "storage",
    "infrastructure",
  ]);
  assert.equal(new Set(samples.map((sample) => JSON.stringify(sample))).size, samples.length);
});

test("policy classification takes precedence over incidental port media", () => {
  assert.equal(genericBuildingCategory(building("fractionation_refinery")), "production");
  assert.equal(genericBuildingCategory(building("fluid_tank")), "storage");
  assert.equal(genericBuildingCategory(building("solid_fuel_generator")), "generator");
  assert.equal(genericBuildingCategory(building("substation")), "distribution");
});

test("registry building ids keep dedicated models and route missing models to generic blockouts", () => {
  const factoryMaterials = createFactoryMaterials();
  for (const definition of START_BUILDINGS) {
    assert.ok(meshes(createBuildingModel(definition.id, factoryMaterials)).length > 0, definition.id);
  }

  const miner = createBuildingModel("vein_miner", factoryMaterials);
  assert.equal(miner.userData.modelSource, "dedicated");
  assert.ok(hasAnimationRole(miner, "minerDrill"));

  const winder = createBuildingModel("industrial_winder", factoryMaterials);
  assert.equal(winder.userData.modelSource, "generic");
  assert.equal(winder.userData.modelCategory, "production");
  assert.ok(meshes(winder).some((part) => part.userData.animationRole === "processCore"));
  assert.throws(() => createBuildingModel("missing_building", factoryMaterials), /Unknown building definition/);
});

test("modelKey selects a dedicated model independently from the registry id", () => {
  const alias = {
    ...building("industrial_winder"),
    id: "model_key_alias",
    modelKey: "vein_miner",
  } satisfies BuildingDefinition;
  const model = createBuildingModelFromDefinition(alias, createFactoryMaterials());

  assert.equal(model.userData.buildingId, "model_key_alias");
  assert.equal(model.userData.modelKey, "vein_miner");
  assert.equal(model.userData.modelSource, "dedicated");
  assert.ok(hasAnimationRole(model, "minerDrill"));
});

const rolePart = (model: THREE.Object3D, role: string) => {
  let found: THREE.Object3D | null = null;
  model.traverse((part: THREE.Object3D) => {
    if (!found && part.userData.animationRole === role) found = part;
  });
  assert.ok(found, `missing animation role ${role}`);
  return found;
};

test("working progress drives actuators and gates while stopped states restore safe positions", () => {
  const model = createGenericBuildingModel(building("hydraulic_former"), materials);
  const actuator = rolePart(model, "processActuator");
  const inputGate = rolePart(model, "inputGate");
  const outputGate = rolePart(model, "outputGate");
  const safeActuatorY = actuator.position.y;
  const safeInputY = inputGate.position.y;
  const safeOutputY = outputGate.position.y;

  animateGenericBuildingModel(model, { runtimeState: "working", progress: 0.5, activity: 1, time: 2 });
  assert.notEqual(actuator.position.y, safeActuatorY);
  animateGenericBuildingModel(model, { runtimeState: "working", progress: 0.05, activity: 1, time: 2 });
  assert.ok(inputGate.position.y > safeInputY);
  animateGenericBuildingModel(model, { runtimeState: "working", progress: 0.9, activity: 1, time: 2 });
  assert.ok(outputGate.position.y > safeOutputY);

  for (const runtimeState of ["idle", "starved", "blocked", "disconnected", "paused"] as const) {
    animateGenericBuildingModel(model, { runtimeState, progress: 0.9, activity: 1, time: 5 });
    assert.equal(actuator.position.y, safeActuatorY, runtimeState);
    assert.equal(inputGate.position.y, safeInputY, runtimeState);
    assert.equal(outputGate.position.y, safeOutputY, runtimeState);
  }
});

test("pump, fluid, routing, and generator motion follows working activity", () => {
  const pump = createGenericBuildingModel(building("pipe_pump"), materials);
  const rotor = rolePart(pump, "pumpRotor");
  const fluidPath = rolePart(pump, "fluidPath");
  const safeRotor = rotor.rotation.z;
  animateGenericBuildingModel(pump, { runtimeState: "working", progress: 0.5, activity: 0.75, time: 3 });
  assert.notEqual(rotor.rotation.z, safeRotor);
  assert.notEqual(fluidPath.scale.y, 1);
  animateGenericBuildingModel(pump, { runtimeState: "disconnected", progress: 0.5, activity: 1, time: 8 });
  assert.equal(rotor.rotation.z, safeRotor);
  assert.equal(fluidPath.scale.y, 1);

  const junction = createGenericBuildingModel(building("splitter"), materials);
  const gate = rolePart(junction, "routingGate");
  const safeGate = gate.rotation.y;
  animateGenericBuildingModel(junction, { runtimeState: "working", progress: 0.5, activity: 1, time: 0.7 });
  assert.notEqual(gate.rotation.y, safeGate);
  animateGenericBuildingModel(junction, { runtimeState: "paused", progress: 0.5, activity: 1, time: 4 });
  assert.equal(gate.rotation.y, safeGate);

  const generator = createGenericBuildingModel(building("combined_fuel_turbine"), materials);
  const generatorRotor = rolePart(generator, "generatorRotor");
  const safeGenerator = generatorRotor.rotation.x;
  animateGenericBuildingModel(generator, { runtimeState: "working", progress: 0.4, activity: 1, time: 2 });
  assert.notEqual(generatorRotor.rotation.x, safeGenerator);
  animateGenericBuildingModel(generator, { runtimeState: "blocked", progress: 0.4, activity: 1, time: 7 });
  assert.equal(generatorRotor.rotation.x, safeGenerator);
});

test("status light encodes every generic runtime state without sharing material mutation", () => {
  const first = createGenericBuildingModel(building("industrial_winder"), materials);
  const second = createGenericBuildingModel(building("industrial_winder"), materials);
  const firstStatus = rolePart(first, "status") as THREE.Mesh;
  const secondStatus = rolePart(second, "status") as THREE.Mesh;
  assert.notEqual(firstStatus.material, secondStatus.material);

  const expected = {
    idle: 0x5d7b80,
    working: 0x5de4d1,
    starved: 0xffa94d,
    blocked: 0xffa94d,
    disconnected: 0xd96f32,
    paused: 0xa8bcc0,
  } as const;
  for (const [runtimeState, color] of Object.entries(expected)) {
    animateGenericBuildingModel(first, {
      runtimeState: runtimeState as keyof typeof expected,
      progress: 0.5,
      activity: 1,
      time: 1,
    });
    assert.equal((firstStatus.material as THREE.MeshStandardMaterial).color.getHex(), color);
  }
  assert.equal((secondStatus.material as THREE.MeshStandardMaterial).color.getHex(), 0x5de4d1);
});
