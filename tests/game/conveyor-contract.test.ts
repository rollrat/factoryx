import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { buildConveyorRoute } from "../../app/game/domain/conveyorRoute.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

test("adjacent registry conveyors connect a machine output to the next machine input", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: 0, maxX: 64, minZ: 0, maxZ: 64 },
  });

  const place = (buildingId: string, x: number) => {
    const result = world.place({
      buildingId,
      position: { x, z: 30 },
      rotation: 0,
      waiveBuildCost: true,
    });
    assert.equal(result.ok, true, result.ok ? undefined : `${buildingId}: ${result.reason}`);
    if (!result.ok) throw new Error(`failed to place ${buildingId}`);
    return result.instance.id;
  };

  const source = place("arc_smelter", 30);
  const beltA = place("conveyor_mk1", 32);
  const beltB = place("conveyor_mk1", 33);
  const target = place("arc_smelter", 34);

  const links = new WorldProductionSimulation(world).connections().map((link) => [
    link.fromInstanceId,
    link.toInstanceId,
  ]);

  assert.deepEqual(links, [
    [source, beltA],
    [beltA, beltB],
    [beltB, target],
  ]);
});

test("an L-shaped registry route uses a real corner and stays connected through the turn", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: 0, maxX: 64, minZ: 0, maxZ: 64 },
  });
  const route = buildConveyorRoute({ x: 20, z: 20 }, { x: 21, z: 21 }, false, 0);
  const ids = route.map((cell) => {
    const buildingId = cell.kind === "straight" ? "conveyor_mk1" : `conveyor_${cell.kind}_mk1`;
    const placed = world.place({
      buildingId,
      position: { x: cell.x, z: cell.z },
      rotation: cell.rotation,
      waiveBuildCost: true,
    });
    assert.equal(placed.ok, true, placed.ok ? undefined : `${buildingId}: ${placed.reason}`);
    if (!placed.ok) throw new Error(`failed to place ${buildingId}`);
    return placed.instance.id;
  });

  assert.deepEqual(new WorldProductionSimulation(world).connections().map((link) => [
    link.fromInstanceId,
    link.toInstanceId,
  ]), [
    [ids[0], ids[1]],
    [ids[1], ids[2]],
  ]);
});
