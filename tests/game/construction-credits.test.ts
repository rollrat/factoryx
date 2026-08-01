import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { CampaignWorldRuntime } from "../../app/game/sim/campaignWorld.ts";
import { WorldCommandHistory } from "../../app/game/sim/worldCommandHistory.ts";

const createRuntime = () => {
  const initial = new CampaignWorldRuntime({
    registry: START_REGISTRY,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
  });
  const snapshot = initial.snapshot();
  return new CampaignWorldRuntime({
    registry: START_REGISTRY,
    bounds: snapshot.world.bounds,
    snapshot: {
      ...snapshot,
      world: {
        ...snapshot.world,
        unlockedIds: [...new Set([...snapshot.world.unlockedIds, "phase_3_complete"])],
        constructionInventory: [],
      },
      constructionCredits: [
        { id: "pipe_mk1_length_m", amount: 3 },
        { id: "fluid_tank", amount: 1 },
      ],
    },
  });
};

const ledger = (runtime: CampaignWorldRuntime) => ({
  balances: () => runtime.constructionCreditBalances(),
  applyDeltas: (deltas: readonly Readonly<{ id: string; amount: number }>[]) => runtime.applyConstructionCreditDeltas(deltas),
});

test("starter credits sponsor exact pipe lengths before construction inventory", () => {
  const runtime = createRuntime();
  const result = runtime.placeConstructionBatch([0, 1, 2].map((offset) => ({
    buildingId: "pipe_mk1",
    position: { x: -10 + offset, z: -5 },
    rotation: 0 as const,
  })));
  assert.equal(result.ok, true);
  assert.equal(runtime.constructionCreditAmount("pipe_mk1_length_m"), 0);
  assert.deepEqual(result.ok ? result.consumedItems : [], []);
  assert.equal(runtime.placeConstruction({
    buildingId: "pipe_mk1",
    position: { x: -7, z: -5 },
    rotation: 0,
  }).ok, false, "the fourth segment needs ordinary construction materials");
});

test("sponsored structures refund their credit rather than minting build materials", () => {
  const runtime = createRuntime();
  const placed = runtime.placeConstruction({ buildingId: "fluid_tank", position: { x: -10, z: 0 }, rotation: 0 });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(runtime.constructionCreditAmount("fluid_tank"), 0);
  const removed = runtime.world.demolish(placed.instance.id);
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(removed.recoveredItems, []);
  runtime.refundConstructionCreditFor(removed.instance);
  assert.equal(runtime.constructionCreditAmount("fluid_tank"), 1);
});

test("construction history restores and re-spends credits while preserving later grants", () => {
  const runtime = createRuntime();
  const history = new WorldCommandHistory();
  const funding = ledger(runtime);
  const placed = history.execute(
    runtime.world,
    "place",
    "starter tank",
    () => runtime.placeConstruction({ buildingId: "fluid_tank", position: { x: -10, z: 0 }, rotation: 0 }),
    funding,
  );
  assert.equal(placed.ok, true);
  assert.equal(runtime.constructionCreditAmount("fluid_tank"), 0);
  assert.equal(runtime.applyConstructionCreditDeltas([{ id: "fluid_tank", amount: 2 }]), true);
  assert.equal(history.undo(runtime.world).ok, true);
  assert.equal(runtime.constructionCreditAmount("fluid_tank"), 3, "undo adds only the command's spent credit");
  assert.equal(history.redo(runtime.world).ok, true);
  assert.equal(runtime.constructionCreditAmount("fluid_tank"), 2, "redo spends only one credit again");
});
