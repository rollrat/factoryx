import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import {
  occupiedWorldCells,
  rotateConnectionCell,
  rotateFacing,
  rotatedFootprintSize,
  worldPorts,
} from "../../app/game/domain/placement.ts";

test("every registered port stays outside its rotated occupied footprint", () => {
  START_REGISTRY.buildings.forEach((building) => {
    building.allowedRotations.forEach((rotation) => {
      const occupied = new Set(occupiedWorldCells(building, { x: 10, z: 20 }, rotation).map(({ x, z }) => `${x},${z}`));
      worldPorts(building, { x: 10, z: 20 }, rotation).forEach((port) => {
        assert.equal(occupied.has(`${port.connectionCell.x},${port.connectionCell.z}`), false, `${building.id}.${port.definition.id}@${rotation}`);
      });
    });
  });
});

test("four quarter turns restore cells and facings exactly", () => {
  const footprint = { x: 3, z: 2 };
  const initialCell = { x: -1, z: 1 };
  const initialFacing = { x: -1, z: 0 };
  let cell = initialCell;
  let facing = initialFacing;
  let size = footprint;
  for (let turn = 0; turn < 4; turn += 1) {
    cell = rotateConnectionCell(cell, size, 1);
    facing = rotateFacing(facing, 1);
    size = { x: size.z, z: size.x };
  }
  assert.deepEqual(cell, initialCell);
  assert.deepEqual(facing, initialFacing);
});

test("project dock ports follow the documented 0 and 90 degree anchors", () => {
  const dock = START_REGISTRY.buildings.get("project_dock")!;
  const atZero = worldPorts(dock, { x: 6, z: 6 }, 0).find(({ definition }) => definition.id === "phase1_plate_in")!;
  const atNinety = worldPorts(dock, { x: 6, z: 6 }, 1).find(({ definition }) => definition.id === "phase1_plate_in")!;

  assert.deepEqual(atZero.connectionCell, { x: 5, z: 7 });
  assert.deepEqual(atZero.facing, { x: -1, z: 0 });
  assert.deepEqual(atNinety.connectionCell, { x: 9, z: 5 });
  assert.deepEqual(atNinety.facing, { x: 0, z: -1 });
  assert.deepEqual(rotatedFootprintSize(dock, 1), { x: 5, z: 5 });
});
