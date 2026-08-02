import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import {
  occupiedWorldCells,
  placementModelCenter,
  projectPlacement,
  rotateConnectionCell,
  rotateFacing,
  rotatedFootprintSize,
  worldPointToAnchorCell,
  worldPorts,
} from "../../app/game/domain/placement.ts";

test("world points resolve to the minimum containing anchor cell", () => {
  assert.deepEqual(worldPointToAnchorCell({ x: 0, z: 0 }), { x: 0, z: 0 });
  assert.deepEqual(worldPointToAnchorCell({ x: 0.999, z: 1.999 }), { x: 0, z: 1 });
  assert.deepEqual(worldPointToAnchorCell({ x: 1, z: 2 }), { x: 1, z: 2 });
  assert.deepEqual(worldPointToAnchorCell({ x: -0.001, z: -1.001 }), { x: -1, z: -2 });
});

test("a one-tile conveyor model is centered in its anchor cell", () => {
  const conveyor = START_REGISTRY.buildings.get("conveyor_mk1")!;
  const projection = projectPlacement(conveyor, { x: 4, z: 7 }, 0);

  assert.deepEqual(projection.anchorCell, { x: 4, z: 7 });
  assert.deepEqual(projection.modelTransform.position, { x: 4.5, y: 0, z: 7.5 });
});

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

test("a non-square building projects one center and port transform for all four rotations", () => {
  const printer = START_REGISTRY.buildings.get("circuit_printer")!;
  const anchor = { x: 10, z: 20 };
  const expected = [
    {
      rotation: 0,
      footprint: { x: 3, z: 2 },
      center: { x: 11.5, y: 2, z: 21 },
      connectionCell: { x: 9, z: 20 },
      position: { x: 10, y: 2.36, z: 20.5 },
      facing: { x: -1, z: 0 },
      rotationY: 0,
    },
    {
      rotation: 1,
      footprint: { x: 2, z: 3 },
      center: { x: 11, y: 2, z: 21.5 },
      connectionCell: { x: 11, z: 19 },
      position: { x: 11.5, y: 2.36, z: 20 },
      facing: { x: 0, z: -1 },
      rotationY: -Math.PI / 2,
    },
    {
      rotation: 2,
      footprint: { x: 3, z: 2 },
      center: { x: 11.5, y: 2, z: 21 },
      connectionCell: { x: 13, z: 21 },
      position: { x: 13, y: 2.36, z: 21.5 },
      facing: { x: 1, z: 0 },
      rotationY: -Math.PI,
    },
    {
      rotation: 3,
      footprint: { x: 2, z: 3 },
      center: { x: 11, y: 2, z: 21.5 },
      connectionCell: { x: 10, z: 23 },
      position: { x: 10.5, y: 2.36, z: 23 },
      facing: { x: 0, z: 1 },
      rotationY: -3 * Math.PI / 2,
    },
  ] as const;

  expected.forEach((row) => {
    const projection = projectPlacement(printer, anchor, row.rotation, 2);
    const inputPort = projection.worldPorts.find(({ definition }) => definition.id === "primary_in")!;

    assert.deepEqual(projection.rotatedFootprint, row.footprint);
    assert.equal(projection.occupiedCells.length, 6);
    assert.deepEqual(projection.modelTransform.position, row.center);
    assert.equal(projection.modelTransform.rotationY, row.rotationY);
    assert.deepEqual(placementModelCenter(printer, anchor, row.rotation, 2), row.center);
    assert.deepEqual(inputPort.connectionCell, row.connectionCell);
    assert.deepEqual(inputPort.position, row.position);
    assert.deepEqual(inputPort.facing, row.facing);
  });
});

test("preview and commit inputs produce the same normalized placement projection", () => {
  const printer = START_REGISTRY.buildings.get("circuit_printer")!;
  const preview = projectPlacement(printer, { x: 10, z: 20 }, 5, 2);
  const commit = projectPlacement(printer, { x: 10, z: 20 }, 1, 2);

  assert.equal(preview.rotation, 1);
  assert.deepEqual(preview, commit);
});
