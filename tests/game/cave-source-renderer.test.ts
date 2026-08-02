import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { CaveSourceRenderer } from "../../app/game/environment/index.ts";
import { IRONWIND_WORLD_SOURCE_V3, type WorldSourceV3 } from "../../app/game/environment/worldSourceV3/index.ts";

test("source cave renderer is empty without a world source and supports visibility toggles", () => {
  const renderer = new CaveSourceRenderer();
  assert.equal(renderer.root.children.length, 0);
  assert.deepEqual(renderer.renderCounts(), { rooms: 0, corridors: 0, entrances: 0 });
  renderer.setVisible(false);
  assert.equal(renderer.root.visible, false);
  renderer.setVisible(true);
  assert.equal(renderer.root.visible, true);
  renderer.dispose();
});

test("source cave renderer deterministically visualizes validated room volumes, paths, and entrances", () => {
  const source = IRONWIND_WORLD_SOURCE_V3;
  const cave = source.caves[0];
  const reordered = {
    ...source,
    caves: [{ ...cave, rooms: [...cave.rooms].reverse(), corridors: [...cave.corridors].reverse(), portals: [...cave.portals].reverse() }],
  } satisfies WorldSourceV3;
  const first = new CaveSourceRenderer(source);
  const second = new CaveSourceRenderer(reordered);
  const namesFor = (renderer: CaveSourceRenderer) => {
    const names: string[] = [];
    renderer.root.traverse((object) => { if (object.name) names.push(object.name); });
    return names;
  };

  assert.deepEqual(first.renderCounts(), { rooms: 2, corridors: 1, entrances: 1 });
  assert.deepEqual(namesFor(first), namesFor(second));
  const room = first.root.getObjectByName("world-source-cave-room:thermal-rift-cave:rift-factory-room") as THREE.Mesh;
  const corridor = first.root.getObjectByName("world-source-cave-corridor:thermal-rift-cave:rift-entry-corridor") as THREE.Line;
  const entrance = first.root.getObjectByName("world-source-cave-entrance:thermal-rift-cave:rift-surface-portal") as THREE.Mesh;
  assert.ok(room instanceof THREE.Mesh);
  assert.ok(corridor instanceof THREE.Line);
  assert.ok(entrance instanceof THREE.Mesh);
  room.geometry.computeBoundingBox();
  const bounds = room.geometry.boundingBox!.clone().applyMatrix4(room.matrixWorld);
  assert.ok(Math.abs(bounds.min.y - (-22)) < 1e-9);
  assert.ok(Math.abs(bounds.max.y - (-9)) < 1e-9);
  assert.equal((corridor.geometry.getAttribute("position") as THREE.BufferAttribute).count, 3);
  assert.equal(entrance.userData.floorHeight, -18, "entrance markers read the existing cave sampler");

  let disposed = false;
  room.geometry.addEventListener("dispose", () => { disposed = true; });
  first.dispose();
  assert.equal(disposed, true);
  assert.equal(first.root.children.length, 0);
  assert.deepEqual(first.renderCounts(), { rooms: 0, corridors: 0, entrances: 0 });
  second.dispose();
});
