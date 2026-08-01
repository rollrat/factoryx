import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { START_BUILDINGS } from "../../app/game/data/buildings.ts";
import type { BuildingDefinition } from "../../app/game/domain/types.ts";
import { rotateLocalPosition } from "../../app/game/domain/placement.ts";
import {
  buildingModelRotationY,
  createBuildingModel,
  createBuildingModelFromDefinition,
  createFactoryMaterials,
} from "../../app/game/models.ts";
import {
  animateGenericBuildingModel,
  auditBuildingModel,
  createGenericBuildingModel,
  genericBuildingCategory,
  type GenericBuildingMaterials,
} from "../../app/game/models/genericBuilding.ts";
import { animateDistributionPoleModel, animateFieldPowerCoreModel } from "../../app/game/models/power.ts";

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

const powerBuildingIds = [
  "field_power_core", "solid_fuel_generator", "combined_fuel_turbine", "high_density_thermal_plant",
  "distribution_pole_mk1", "distribution_pole_mk2", "high_voltage_tower", "substation",
  "power_breaker", "priority_switchboard", "industrial_accumulator",
] as const;

test("actual routed power models use exact definition ports and LOD metadata", () => {
  const factoryMaterials = createFactoryMaterials();
  for (const id of powerBuildingIds) {
    const definition = building(id);
    const model = createBuildingModel(id, factoryMaterials);
    const markers = meshes(model).filter((part) => typeof part.userData.portId === "string");
    assert.equal(markers.length, definition.ports.length, `${id} marker count`);
    definition.ports.forEach((port, index) => {
      const marker = markers.find((part) => part.userData.portId === port.id);
      assert.ok(marker, `${id}.${port.id}`);
      assert.deepEqual(marker.position.toArray(), [port.localPosition.x, port.localPosition.y, port.localPosition.z]);
      assert.equal(marker.userData.portIndex, index);
      assert.deepEqual(marker.userData.localFacing, port.localFacing);
    });
    assert.deepEqual(model.userData.localCollisionAabb, {
      minX: -definition.footprint.x / 2,
      maxX: definition.footprint.x / 2,
      minZ: -definition.footprint.z / 2,
      maxZ: definition.footprint.z / 2,
    });
    assert.ok(meshes(model).every((part) => [0, 1, 2].includes(part.userData.lodMaxTier)), `${id} LOD metadata`);
  }
});

test("model quarter-turn convention matches rotated ports and footprint collision", () => {
  for (const id of powerBuildingIds) {
    const definition = building(id);
    for (const rotation of definition.allowedRotations) {
      for (const port of definition.ports) {
        const visual = new THREE.Vector3(port.localPosition.x, port.localPosition.y, port.localPosition.z)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), buildingModelRotationY(rotation));
        const logical = rotateLocalPosition(port.localPosition, rotation);
        assert.ok(Math.abs(visual.x - logical.x) < 1e-9, `${id}.${port.id} rotation ${rotation} x`);
        assert.ok(Math.abs(visual.z - logical.z) < 1e-9, `${id}.${port.id} rotation ${rotation} z`);
      }
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

test("transmission equipment exposes mechanical state poses instead of color-only changes", () => {
  const substation = createGenericBuildingModel(building("substation"), materials);
  const fan = rolePart(substation, "coolingFan");
  const safeFan = fan.rotation.z;
  animateGenericBuildingModel(substation, { runtimeState: "working", progress: 0.5, activity: 0.8, time: 2 });
  assert.notEqual(fan.rotation.z, safeFan);
  animateGenericBuildingModel(substation, { runtimeState: "disconnected", progress: 0.5, activity: 1, time: 5 });
  assert.equal(fan.rotation.z, safeFan);

  const breaker = createGenericBuildingModel(building("power_breaker"), materials);
  const lever = rolePart(breaker, "breakerLever");
  const contact = rolePart(breaker, "breakerContact");
  const closedRotation = lever.rotation.z;
  animateGenericBuildingModel(breaker, { runtimeState: "tripped", progress: 0, activity: 0, time: 1 });
  assert.notEqual(lever.rotation.z, closedRotation);
  assert.equal(contact.visible, false);
  animateGenericBuildingModel(breaker, { runtimeState: "idle", progress: 0, activity: 0, time: 2 });
  assert.equal(lever.rotation.z, closedRotation);
  assert.equal(contact.visible, true);

  const switchboard = createGenericBuildingModel(building("priority_switchboard"), materials);
  assert.equal(meshes(switchboard).filter((part) => part.userData.animationRole === "priorityLever").length, 4);
  const accumulator = createGenericBuildingModel(building("industrial_accumulator"), materials);
  const gauge = rolePart(accumulator, "batteryGauge");
  animateGenericBuildingModel(accumulator, { runtimeState: "idle", progress: 0, storedRatio: 0.5, activity: 0, time: 0 });
  assert.equal(gauge.scale.y, 0.5);
});

test("generic geometry and non-indicator materials are shared across repeated models", () => {
  const first = createGenericBuildingModel(building("solid_fuel_generator"), materials);
  const second = createGenericBuildingModel(building("solid_fuel_generator"), materials);
  const firstFoundation = rolePart(first, "foundation") as THREE.Mesh;
  const secondFoundation = rolePart(second, "foundation") as THREE.Mesh;
  assert.equal(firstFoundation.geometry, secondFoundation.geometry);
  const sharedMaterials = new Set(Object.values(materials));
  for (const part of meshes(first).filter((part) => part.userData.animationRole !== "status")) {
    assert.ok(sharedMaterials.has(part.material as THREE.Material), `${part.userData.animationRole} should reuse the material palette`);
  }
});

test("power blockouts expose auditable port, LOD, motion, material, triangle, and shadow budgets", () => {
  const factoryMaterials = createFactoryMaterials();
  for (const id of powerBuildingIds) {
    const definition = building(id);
    const model = createBuildingModel(id, factoryMaterials);
    const audit = auditBuildingModel(model);
    assert.deepEqual(audit.portIds, definition.ports.map(({ id: portId }) => portId).sort(), `${id} ports`);
    assert.equal(audit.meshes, audit.lodMeshes[0] + audit.lodMeshes[1] + audit.lodMeshes[2], `${id} LOD coverage`);
    assert.ok(audit.triangles <= 14_000, `${id} triangle budget: ${audit.triangles}`);
    assert.ok(audit.materials <= Object.keys(factoryMaterials).length + 8, `${id} material budget: ${audit.materials}`);
    assert.ok(audit.shadowMeshes < audit.meshes, `${id} should disable shadows on indicators or service detail`);
    assert.ok(audit.movingRoles.length > 0, `${id} motion/state roles`);
  }

  for (const id of ["field_power_core", "distribution_pole_mk1"] as const) {
    const model = createBuildingModel(id, factoryMaterials);
    const pulseMaterials = meshes(model)
      .filter((part) => String(part.userData.animationRole).toLowerCase().includes("pulse"))
      .map((part) => part.material);
    assert.ok(pulseMaterials.length > 1);
    assert.equal(new Set(pulseMaterials).size, 1, `${id} pulse indicators share one material`);
  }
});

test("runtime lodTier is enforced after generic and dedicated power animation", () => {
  const generator = createGenericBuildingModel(building("solid_fuel_generator"), materials);
  generator.userData.lodTier = 2;
  animateGenericBuildingModel(generator, { runtimeState: "working", progress: 0.5, activity: 1, time: 1 });
  assert.equal(rolePart(generator, "generatorRotor").visible, false);
  assert.equal(rolePart(generator, "generatorHousing").visible, true);

  const factoryMaterials = createFactoryMaterials();
  const core = createBuildingModel("field_power_core", factoryMaterials);
  core.userData.lodTier = 2;
  animateFieldPowerCoreModel(core, { time: 1, delta: 1 / 60, generating: true, connected: true, supplyRatio: 1, loadRatio: 0.5, overloaded: false });
  assert.ok(meshes(core).some((part) => part.userData.lodMaxTier === 0 && !part.visible));
  assert.ok(meshes(core).some((part) => part.userData.lodMaxTier === 2 && part.visible));

  const pole = createBuildingModel("distribution_pole_mk1", factoryMaterials);
  pole.userData.lodTier = 1;
  animateDistributionPoleModel(pole, { time: 1, delta: 1 / 60, generating: true, connected: true, supplyRatio: 1, loadRatio: 0.5, overloaded: false });
  assert.ok(meshes(pole).some((part) => part.userData.lodMaxTier === 0 && !part.visible));
  assert.ok(meshes(pole).some((part) => part.userData.lodMaxTier === 1 && part.visible));
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
    manual_off: 0xa8bcc0,
    tripped: 0xff5268,
    restoring: 0xffa94d,
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
