import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorldInteractionIdentityResolver,
  type LegacyWorldInteractionLink,
} from "../../app/game/domain/worldInteractionIdentity.ts";
import type {
  BuildingDefinition,
  DefinitionRegistry,
} from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const preplaced = (
  id: string,
  position: { x: number; z: number },
): BuildingDefinition => ({
  id,
  name: id,
  unlockId: "start",
  placementMode: "preplaced_unique",
  footprint: { x: 1, z: 1 },
  allowedRotations: [0],
  ports: [],
  recipeIds: [],
  buildCost: [],
  preplacedPolicy: {
    worldAnchor: position,
    fixedRotation: 0,
    canBuild: false,
    canClone: false,
    canDemolish: false,
  },
});

const buildings = [
  preplaced("field_power_core", { x: 0, z: 0 }),
  preplaced("project_dock", { x: 2, z: 0 }),
  {
    id: "assembler",
    name: "Assembler",
    unlockId: "start",
    placementMode: "buildable",
    footprint: { x: 1, z: 1 },
    allowedRotations: [0, 1, 2, 3],
    ports: [],
    recipeIds: [],
    buildCost: [],
  },
] as const satisfies readonly BuildingDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(),
  recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(),
};

const createWorld = () => new DataDrivenWorld({
  registry,
  bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
});

const placeAssembler = (world: DataDrivenWorld) => {
  const placed = world.place({
    buildingId: "assembler",
    position: { x: 4, z: 0 },
    rotation: 1,
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) assert.fail("assembler placement failed");
  return placed.instance;
};

test("legacy and canonical references resolve to one installed-building identity", () => {
  const world = createWorld();
  const assembler = placeAssembler(world);
  const resolver = createWorldInteractionIdentityResolver({
    instances: world.allInstances(),
    definitions: registry.buildings,
    legacyStructures: [{ id: 41, worldInstanceId: assembler.id }],
  });

  const canonical = resolver.resolve({ kind: "owner", ownerId: assembler.id });
  const legacy = resolver.resolve({ kind: "legacy_structure", structureId: 41 });
  assert.equal(canonical.ok, true);
  assert.equal(legacy.ok, true);
  if (!canonical.ok || !legacy.ok) return;

  assert.equal(canonical.target, legacy.target);
  assert.deepEqual(canonical.target, {
    kind: "building",
    ownerId: assembler.id,
    worldInstanceId: assembler.id,
    definitionId: "assembler",
    legacyStructureId: 41,
    placementMode: "buildable",
    stratumId: "surface",
    selectable: true,
    inspectable: true,
    demolishable: true,
  });
});

test("preplaced core and dock resolve to real owner IDs without synthetic numeric structures", () => {
  const world = createWorld();
  placeAssembler(world);
  const resolver = createWorldInteractionIdentityResolver({
    instances: world.allInstances(),
    definitions: registry.buildings,
  });

  for (const definitionId of ["field_power_core", "project_dock"] as const) {
    const instance = world.allInstances().find((candidate) => candidate.definitionId === definitionId);
    assert.ok(instance);
    const byDefinition = resolver.resolve({ kind: "preplaced_definition", definitionId });
    const byOwner = resolver.resolve({ kind: "owner", ownerId: instance.id });
    assert.equal(byDefinition.ok, true);
    assert.equal(byOwner.ok, true);
    if (!byDefinition.ok || !byOwner.ok) continue;

    assert.equal(byDefinition.target, byOwner.target);
    assert.equal(byDefinition.target.ownerId, instance.id);
    assert.equal(byDefinition.target.worldInstanceId, instance.id);
    assert.equal(byDefinition.target.legacyStructureId, null);
    assert.equal(byDefinition.target.placementMode, "preplaced_unique");
    assert.equal(byDefinition.target.selectable, true);
    assert.equal(byDefinition.target.inspectable, true);
    assert.equal(byDefinition.target.demolishable, false);
  }
});

test("preplaced lookup trusts the world instance instead of manufacturing an ID from its definition", () => {
  const world = createWorld();
  const instances = world.allInstances().map((instance) => (
    instance.definitionId === "field_power_core"
      ? { ...instance, id: "restored-owner:core-primary" }
      : instance
  ));
  const resolver = createWorldInteractionIdentityResolver({
    instances,
    definitions: registry.buildings,
  });

  const resolution = resolver.resolve({
    kind: "preplaced_definition",
    definitionId: "field_power_core",
  });
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.target.ownerId, "restored-owner:core-primary");
});

test("identity remains stable across a world snapshot restore", () => {
  const original = createWorld();
  const assembler = placeAssembler(original);
  const restored = new DataDrivenWorld({
    registry,
    bounds: original.bounds,
    snapshot: structuredClone(original.snapshot()),
  });
  const resolver = createWorldInteractionIdentityResolver({
    instances: restored.allInstances(),
    definitions: registry.buildings,
    legacyStructures: [{ id: 7, worldInstanceId: assembler.id }],
  });

  assert.equal(
    resolver.find({ kind: "legacy_structure", structureId: 7 })?.ownerId,
    assembler.id,
  );
  assert.equal(
    resolver.find({ kind: "preplaced_definition", definitionId: "project_dock" })?.ownerId,
    "preplaced:project_dock",
  );
});

test("unlinked and stale legacy records fail explicitly instead of inventing owners", () => {
  const world = createWorld();
  const legacyStructures: readonly LegacyWorldInteractionLink[] = [
    { id: 1 },
    { id: 2, worldInstanceId: "building-that-no-longer-exists" },
  ];
  const resolver = createWorldInteractionIdentityResolver({
    instances: world.allInstances(),
    definitions: registry.buildings,
    legacyStructures,
  });

  assert.deepEqual(
    resolver.resolve({ kind: "legacy_structure", structureId: 1 }),
    { ok: false, reason: "legacy_structure_unlinked" },
  );
  assert.deepEqual(
    resolver.resolve({ kind: "legacy_structure", structureId: 2 }),
    { ok: false, reason: "stale_legacy_link" },
  );
  assert.deepEqual(
    resolver.resolve({ kind: "legacy_structure", structureId: 3 }),
    { ok: false, reason: "unknown_legacy_structure" },
  );
});

test("preplaced-definition lookup rejects buildable, unknown, and missing targets", () => {
  const world = createWorld();
  const resolver = createWorldInteractionIdentityResolver({
    instances: world.allInstances(),
    definitions: registry.buildings,
  });
  assert.deepEqual(
    resolver.resolve({ kind: "preplaced_definition", definitionId: "assembler" }),
    { ok: false, reason: "not_preplaced_unique" },
  );
  assert.deepEqual(
    resolver.resolve({ kind: "preplaced_definition", definitionId: "not-real" }),
    { ok: false, reason: "unknown_definition" },
  );

  const missingCore = createWorldInteractionIdentityResolver({
    instances: world.allInstances().filter(({ definitionId }) => definitionId !== "field_power_core"),
    definitions: registry.buildings,
  });
  assert.deepEqual(
    missingCore.resolve({ kind: "preplaced_definition", definitionId: "field_power_core" }),
    { ok: false, reason: "preplaced_instance_missing" },
  );
});

test("resolver rejects aliases that would give one owner two numeric identities", () => {
  const world = createWorld();
  const assembler = placeAssembler(world);
  assert.throws(() => createWorldInteractionIdentityResolver({
    instances: world.allInstances(),
    definitions: registry.buildings,
    legacyStructures: [
      { id: 4, worldInstanceId: assembler.id },
      { id: 5, worldInstanceId: assembler.id },
    ],
  }), /multiple legacy structures reference world owner/);
});
