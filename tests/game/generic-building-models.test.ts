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
