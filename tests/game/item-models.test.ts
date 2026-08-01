import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { START_ITEMS } from "../../app/game/data/items.ts";
import {
  createItemModelFromDefinition,
  createRegisteredItemModel,
  type ItemModelMaterials,
} from "../../app/game/models/item.ts";

const material = (color: number) => new THREE.MeshStandardMaterial({ color });
const materials: ItemModelMaterials = {
  dark: material(0x16242a),
  steel: material(0x657b80),
  pale: material(0xa8bcc0),
  orange: material(0xd96f32),
  rubber: material(0x0b1215),
};

const meshCount = (object: THREE.Object3D) => {
  let count = 0;
  object.traverse((part: THREE.Object3D) => {
    if (part instanceof THREE.Mesh) count += 1;
  });
  return count;
};

const signature = (itemId: string) => {
  const definition = START_ITEMS.find((item) => item.id === itemId);
  assert.ok(definition);
  const model = createItemModelFromDefinition(definition, materials);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const geometries: string[] = [];
  model.traverse((part: THREE.Object3D) => {
    if (part instanceof THREE.Mesh) geometries.push(part.geometry.type);
  });
  return {
    geometryType: model.userData.geometryType,
    meshes: meshCount(model),
    dimensions: [size.x, size.y, size.z].map((value) => Number(value.toFixed(3))),
    geometries: geometries.sort(),
  };
};

test("all campaign items produce a visible texture-free model", () => {
  assert.equal(START_ITEMS.length, 42);
  for (const definition of START_ITEMS) {
    const model = createRegisteredItemModel(definition.id, materials);
    assert.ok(meshCount(model) > 0, `${definition.id} should contain at least one mesh`);
    assert.equal(model.userData.itemId, definition.id);
    assert.equal(model.userData.modelKey, definition.modelKey);
    assert.equal(model.userData.geometryType, definition.geometryType);
  }
});

test("fluid, ore, plate, and project items have distinct silhouettes", () => {
  const samples = [
    signature("crude_oil"),
    signature("iron_ore"),
    signature("iron_plate"),
    signature("colony_seed_ax17"),
  ];
  assert.equal(new Set(samples.map((sample) => JSON.stringify(sample))).size, samples.length);
  assert.deepEqual(samples.map((sample) => sample.geometryType), ["fluid", "ore_chunk", "plate", "seed"]);
});

test("wire, electronic, mechanical, container, and project families remain readable", () => {
  const samples = [
    signature("copper_wire"),
    signature("basic_control_circuit"),
    signature("industrial_motor"),
    signature("alumina"),
    signature("automation_core"),
  ];
  assert.equal(new Set(samples.map((sample) => JSON.stringify(sample))).size, samples.length);
});
