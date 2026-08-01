import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { migrateLegacyStructuresIntoWorld } from "../../app/game/sim/legacyWorldMigration.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import type { BuildType, StructureData } from "../../app/game/types.ts";

const resolveBuildingId = (type: BuildType) => ({
  belt: "conveyor_mk1",
  splitter: "splitter",
  merger: "merger",
  miner: "vein_miner",
  smelter: "arc_smelter",
  crusher: "crusher",
  assembler: "hydraulic_former",
  storage: "small_storage",
} as const)[type];

const makeWorld = () => new DataDrivenWorld({
  registry: START_REGISTRY,
  bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
});

test("legacy visual structures become real world instances without charging build materials", () => {
  const world = makeWorld();
  const ironBefore = world.inventoryAmount("iron_plate");
  const structures: StructureData[] = [
    { id: 1, type: "miner", x: -8, z: -3, rotation: 0 },
    { id: 2, type: "belt", x: -6, z: -3, rotation: 1 },
  ];

  const result = migrateLegacyStructuresIntoWorld(world, structures, resolveBuildingId);

  assert.equal(result.skipped.length, 0);
  assert.equal(result.placedInstanceIds.length, 2);
  assert.equal(world.inventoryAmount("iron_plate"), ironBefore);
  assert.equal(world.allInstances().length, 4);
  assert.equal(structures[0].buildingId, "vein_miner");
  assert.equal(world.instance(structures[0].worldInstanceId!)?.definitionId, "vein_miner");
  assert.equal(world.instance(structures[1].worldInstanceId!)?.definitionId, "conveyor_mk1");
});

test("migration links an existing matching world instance instead of duplicating it", () => {
  const world = makeWorld();
  const placed = world.place({
    buildingId: "conveyor_mk1",
    position: { x: -6, z: -3 },
    rotation: 1,
    waiveBuildCost: true,
  });
  assert.equal(placed.ok, true);
  const structures: StructureData[] = [
    { id: 7, type: "belt", x: -6, z: -3, rotation: 1 },
  ];

  const result = migrateLegacyStructuresIntoWorld(world, structures, resolveBuildingId);

  assert.deepEqual(result.placedInstanceIds, []);
  assert.deepEqual(result.linkedInstanceIds, [placed.ok ? placed.instance.id : ""]);
  assert.equal(world.allInstances().length, 3);
  assert.equal(structures[0].worldInstanceId, placed.ok ? placed.instance.id : undefined);
});

test("migration leaves an unplaceable structure visible but reports why it was not mirrored", () => {
  const world = makeWorld();
  const structures: StructureData[] = [
    { id: 9, type: "miner", x: 3, z: 3, rotation: 0 },
  ];

  const result = migrateLegacyStructuresIntoWorld(world, structures, resolveBuildingId);

  assert.deepEqual(result.skipped, [{ structureId: 9, reason: "invalid_resource_anchor" }]);
  assert.equal(structures[0].worldInstanceId, undefined);
});
