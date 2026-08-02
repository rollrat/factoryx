import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
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
