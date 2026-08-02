import assert from "node:assert/strict";
import test from "node:test";

import { buildConveyorRoute } from "../../app/game/domain/conveyorRoute.ts";

test("straight routes derive direction in both travel directions", () => {
  assert.deepEqual(buildConveyorRoute({ x: 2, z: 4 }, { x: 5, z: 4 }, false, 3), [
    { x: 2, z: 4, rotation: 0, kind: "straight" },
    { x: 3, z: 4, rotation: 0, kind: "straight" },
    { x: 4, z: 4, rotation: 0, kind: "straight" },
    { x: 5, z: 4, rotation: 0, kind: "straight" },
  ]);
  assert.deepEqual(buildConveyorRoute({ x: 5, z: 4 }, { x: 2, z: 4 }, true, 1), [
    { x: 5, z: 4, rotation: 2, kind: "straight" },
    { x: 4, z: 4, rotation: 2, kind: "straight" },
    { x: 3, z: 4, rotation: 2, kind: "straight" },
    { x: 2, z: 4, rotation: 2, kind: "straight" },
  ]);
});

test("x-first L routes mark the clockwise corner and keep outgoing rotation", () => {
  assert.deepEqual(buildConveyorRoute({ x: 0, z: 0 }, { x: 2, z: 2 }, false, 0), [
    { x: 0, z: 0, rotation: 0, kind: "straight" },
    { x: 1, z: 0, rotation: 0, kind: "straight" },
    { x: 2, z: 0, rotation: 1, kind: "corner_cw" },
    { x: 2, z: 1, rotation: 1, kind: "straight" },
    { x: 2, z: 2, rotation: 1, kind: "straight" },
  ]);
});

test("z-first L routes mark the counter-clockwise corner and keep outgoing rotation", () => {
  assert.deepEqual(buildConveyorRoute({ x: 0, z: 0 }, { x: 2, z: 2 }, true, 0), [
    { x: 0, z: 0, rotation: 1, kind: "straight" },
    { x: 0, z: 1, rotation: 1, kind: "straight" },
    { x: 0, z: 2, rotation: 0, kind: "corner_ccw" },
    { x: 1, z: 2, rotation: 0, kind: "straight" },
    { x: 2, z: 2, rotation: 0, kind: "straight" },
  ]);
});

test("reverse L routes preserve turn handedness", () => {
  assert.deepEqual(buildConveyorRoute({ x: 2, z: 2 }, { x: 0, z: 0 }, false, 0), [
    { x: 2, z: 2, rotation: 2, kind: "straight" },
    { x: 1, z: 2, rotation: 2, kind: "straight" },
    { x: 0, z: 2, rotation: 3, kind: "corner_cw" },
    { x: 0, z: 1, rotation: 3, kind: "straight" },
    { x: 0, z: 0, rotation: 3, kind: "straight" },
  ]);
  assert.deepEqual(buildConveyorRoute({ x: 2, z: 2 }, { x: 0, z: 0 }, true, 0), [
    { x: 2, z: 2, rotation: 3, kind: "straight" },
    { x: 2, z: 1, rotation: 3, kind: "straight" },
    { x: 2, z: 0, rotation: 2, kind: "corner_ccw" },
    { x: 1, z: 0, rotation: 2, kind: "straight" },
    { x: 0, z: 0, rotation: 2, kind: "straight" },
  ]);
});

test("a single-cell route uses the normalized default rotation", () => {
  assert.deepEqual(buildConveyorRoute({ x: 7, z: -3 }, { x: 7, z: -3 }, false, -1), [
    { x: 7, z: -3, rotation: 3, kind: "straight" },
  ]);
});

test("route endpoints must use safe integer grid coordinates", () => {
  assert.throws(
    () => buildConveyorRoute({ x: 0.5, z: 0 }, { x: 1, z: 0 }, false, 0),
    /safe integer grid coordinates/,
  );
});
