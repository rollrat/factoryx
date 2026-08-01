import assert from "node:assert/strict";
import test from "node:test";

import { StorageRuntime } from "../../app/game/sim/storage.ts";

const createStorage = () => new StorageRuntime({
  structureId: "storage-1",
  slotCount: 4,
  stackSize: 100,
});

const deposit = (storage: StorageRuntime, itemId: string, amount: number) => {
  assert.deepEqual(storage.reserveIncomingItem(itemId, amount), { ok: true });
  assert.deepEqual(storage.commitIncoming(itemId, amount), { ok: true });
};

test("capacity is slotCount times item stackSize and includes incoming reservations", () => {
  const storage = createStorage();
  assert.equal(storage.capacity, 400);
  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 400), { ok: true });
  assert.equal(storage.availableCapacity, 0);
  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 1), {
    ok: false,
    reason: "insufficient_capacity",
  });
  assert.equal(storage.incomingReservation, 400);
});

test("the first successful incoming reservation atomically locks the item type", () => {
  const storage = createStorage();
  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 401), {
    ok: false,
    reason: "insufficient_capacity",
  });
  assert.equal(storage.itemId, undefined, "a failed first reservation must not leave a lock");

  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 20), { ok: true });
  assert.equal(storage.itemId, "iron_plate");
  assert.deepEqual(storage.reserveIncomingItem("copper_wire", 1), {
    ok: false,
    reason: "item_mismatch",
  });
  assert.equal(storage.incomingReservation, 20);

  assert.deepEqual(storage.cancelIncoming(20), { ok: true });
  assert.equal(storage.itemId, undefined);

  assert.equal(storage.beginInputTransfer("iron_plate"), true);
  assert.deepEqual(storage.reserveIncomingItem("copper_wire", 1), {
    ok: false,
    reason: "item_mismatch",
  });
  assert.equal(storage.itemId, undefined);
  assert.equal(storage.endInputTransfer("iron_plate"), true);
});

test("incoming and outgoing reservations preserve inventory and minimum reserve", () => {
  const storage = createStorage();
  deposit(storage, "iron_plate", 100);
  assert.equal(storage.setMinimumReserve(25), true);
  assert.equal(storage.availableToOutput, 75);

  assert.deepEqual(storage.reserveOutgoingItem(60), { ok: true });
  assert.equal(storage.storedAmount, 100, "reservation alone must not remove inventory");
  assert.equal(storage.availableToOutput, 15);
  assert.deepEqual(storage.reserveOutgoingItem(16), {
    ok: false,
    reason: "insufficient_available",
  });
  assert.equal(storage.setMinimumReserve(50), false, "reserve changes cannot invalidate existing output reservations");

  assert.deepEqual(storage.commitOutgoing(60), { ok: true });
  assert.equal(storage.storedAmount, 40);
  assert.equal(storage.availableToOutput, 15);
});

test("filters change only when inventory, reservations, and input transfer are empty", () => {
  const storage = createStorage();
  assert.equal(storage.setOutputFilter("iron_plate"), true);
  assert.equal(storage.beginInputTransfer("iron_plate"), true);
  assert.equal(storage.setOutputFilter("copper_wire"), false);
  assert.equal(storage.endInputTransfer("iron_plate"), true);

  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 1), { ok: true });
  assert.equal(storage.setOutputFilter("copper_wire"), false);
  assert.deepEqual(storage.commitIncoming("iron_plate", 1), { ok: true });
  assert.equal(storage.setOutputFilter(undefined), false);

  assert.deepEqual(storage.reserveOutgoingItem(1), { ok: true });
  assert.equal(storage.setOutputFilter(undefined), false);
  assert.deepEqual(storage.commitOutgoing(1), { ok: true });
  assert.equal(storage.itemId, undefined);
  assert.equal(storage.setOutputFilter(undefined), true);
});

test("routing policies implement pass-through, fill-then-output, and disabled output", () => {
  const storage = createStorage();
  deposit(storage, "iron_plate", 10);
  assert.deepEqual(storage.reserveOutgoingItem(1), { ok: true });
  assert.deepEqual(storage.cancelOutgoing(1), { ok: true });

  storage.setRoutingPolicy("fill_then_output");
  assert.deepEqual(storage.reserveOutgoingItem(1), {
    ok: false,
    reason: "waiting_until_full",
  });
  assert.deepEqual(storage.reserveIncomingItem("iron_plate", 390), { ok: true });
  assert.deepEqual(storage.commitIncoming("iron_plate", 390), { ok: true });
  assert.deepEqual(storage.reserveOutgoingItem(1), { ok: true });
  assert.deepEqual(storage.cancelOutgoing(1), { ok: true });

  storage.setRoutingPolicy("output_disabled");
  assert.deepEqual(storage.reserveOutgoingItem(1), { ok: false, reason: "disabled" });
  storage.setRoutingPolicy("pass_through");
  storage.setOutputEnabled(false);
  assert.deepEqual(storage.reserveOutgoingItem(1), { ok: false, reason: "disabled" });
});

test("output filters block a different locked item without deleting it", () => {
  const storage = createStorage();
  assert.equal(storage.setOutputFilter("copper_wire"), true);
  deposit(storage, "iron_plate", 10);
  assert.deepEqual(storage.reserveOutgoingItem(1), {
    ok: false,
    reason: "filter_mismatch",
  });
  assert.equal(storage.storedAmount, 10);
});

test("snapshot restore preserves policy and transaction state", () => {
  const original = createStorage();
  deposit(original, "iron_plate", 100);
  assert.equal(original.setMinimumReserve(20), true);
  assert.deepEqual(original.reserveIncomingItem("iron_plate", 30), { ok: true });
  assert.deepEqual(original.reserveOutgoingItem(15), { ok: true });
  original.setRoutingPolicy("pass_through");
  original.setInputEnabled(false);

  const snapshot = structuredClone(original.snapshot());
  const restored = new StorageRuntime({
    structureId: "storage-1",
    slotCount: 4,
    stackSize: 100,
    snapshot,
  });

  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.availableCapacity, 270);
  assert.equal(restored.availableToOutput, 65);
  assert.deepEqual(restored.reserveIncomingItem("iron_plate", 1), { ok: false, reason: "disabled" });
});

test("restore rejects snapshots that violate storage invariants", () => {
  const valid = createStorage().snapshot();
  assert.throws(() => new StorageRuntime({
    structureId: "storage-2",
    slotCount: 4,
    stackSize: 100,
    snapshot: valid,
  }), /structureId does not match/);
  assert.throws(() => new StorageRuntime({
    structureId: "storage-1",
    slotCount: 4,
    stackSize: 100,
    snapshot: { ...valid, lockedItemId: "iron_plate", inventory: 401 },
  }), /exceeds capacity/);
  assert.throws(() => new StorageRuntime({
    structureId: "storage-1",
    slotCount: 4,
    stackSize: 100,
    snapshot: { ...valid, inventory: 1 },
  }), /requires lockedItemId/);
});
