import assert from "node:assert/strict";
import test from "node:test";

import type { PortDefinition } from "../../app/game/domain/types.ts";
import { PortInventory } from "../../app/game/sim/inventory.ts";
import { TransportLink } from "../../app/game/sim/transport.ts";

const port = (
  id: string,
  direction: "input" | "output" | "bidirectional",
  acceptedItemIds: readonly string[] = ["iron_ore"],
): PortDefinition => ({
  id,
  direction,
  medium: "solid",
  connectorProfile: "belt_standard",
  connectionCell: { x: direction === "output" ? 1 : -1, z: 0 },
  localPosition: { x: direction === "output" ? 0.5 : -0.5, y: 0.36, z: 0 },
  localFacing: { x: direction === "output" ? 1 : -1, z: 0 },
  bufferSlots: 10,
  acceptedItemIds,
});

const makeLink = (options: Readonly<{
  sourceAmount?: number;
  destinationAmount?: number;
  destinationCapacity?: number;
  destinationItemId?: string;
  destinationAccepted?: readonly string[];
  ratePerMinute?: number;
}> = {}) => {
  const upstreamPort = port("source_out", "output");
  const downstreamPort = port("destination_in", "input", options.destinationAccepted);
  const upstreamInventory = new PortInventory(upstreamPort.id, 100, {
    itemId: (options.sourceAmount ?? 10) > 0 ? "iron_ore" : null,
    amount: options.sourceAmount ?? 10,
  });
  const destinationAmount = options.destinationAmount ?? 0;
  const downstreamInventory = new PortInventory(downstreamPort.id, options.destinationCapacity ?? 100, {
    itemId: destinationAmount > 0 ? (options.destinationItemId ?? "iron_ore") : null,
    amount: destinationAmount,
  });
  const link = new TransportLink({
    id: "belt_a",
    upstreamPort,
    upstreamInventory,
    downstreamPort,
    downstreamInventory,
    ratePerMinute: options.ratePerMinute ?? 60,
  });
  return { link, upstreamInventory, downstreamInventory };
};

test("rejects invalid directional and connector links", () => {
  const inventoryA = new PortInventory("a", 1);
  const inventoryB = new PortInventory("b", 1);
  assert.throws(() => new TransportLink({
    id: "wrong_direction",
    upstreamPort: port("a", "input"),
    upstreamInventory: inventoryA,
    downstreamPort: port("b", "input"),
    downstreamInventory: inventoryB,
    ratePerMinute: 60,
  }), /upstream port must allow output/);

  const pipeInput: PortDefinition = {
    ...port("b", "input"),
    medium: "fluid",
    connectorProfile: "pipe_mk1",
    acceptedItemIds: [],
  };
  assert.throws(() => new TransportLink({
    id: "wrong_medium",
    upstreamPort: port("a", "output"),
    upstreamInventory: inventoryA,
    downstreamPort: pipeInput,
    downstreamInventory: inventoryB,
    ratePerMinute: 60,
  }), /only connect solid ports/);
});

test("accumulates fixed-tick throughput without deleting or duplicating items", () => {
  const { link, upstreamInventory, downstreamInventory } = makeLink();
  const initialTotal = upstreamInventory.amount + downstreamInventory.amount;
  let moved = 0;
  for (let tick = 0; tick < 200; tick += 1) moved += link.step(1 / 20).movedAmount;

  assert.equal(moved, 10);
  assert.equal(link.transferredAmount, 10);
  assert.equal(upstreamInventory.amount, 0);
  assert.equal(downstreamInventory.amount, 10);
  assert.equal(upstreamInventory.amount + downstreamInventory.amount, initialTotal);
});

test("preserves the source item when destination capacity is exhausted", () => {
  const { link, upstreamInventory, downstreamInventory } = makeLink({
    sourceAmount: 2,
    destinationAmount: 1,
    destinationCapacity: 1,
  });
  for (let tick = 0; tick < 20; tick += 1) link.step(1 / 20);
  const blocked = link.step(1 / 20);

  assert.equal(blocked.reason, "blocked");
  assert.equal(upstreamInventory.amount, 2);
  assert.equal(downstreamInventory.amount, 1);
});

test("preserves both inventories when the destination rejects the item", () => {
  const { link, upstreamInventory, downstreamInventory } = makeLink({
    sourceAmount: 2,
    destinationAccepted: ["copper_ore"],
  });
  for (let tick = 0; tick < 20; tick += 1) link.step(1 / 20);
  const mismatched = link.step(1 / 20);

  assert.equal(mismatched.reason, "item_mismatch");
  assert.equal(upstreamInventory.amount, 2);
  assert.equal(downstreamInventory.amount, 0);
});

test("disconnecting stops transfer and preserves accumulated inventories", () => {
  const { link, upstreamInventory, downstreamInventory } = makeLink({ sourceAmount: 2 });
  for (let tick = 0; tick < 10; tick += 1) link.step(1 / 20);
  link.setConnected(false);
  const before = { source: upstreamInventory.amount, destination: downstreamInventory.amount };
  for (let tick = 0; tick < 100; tick += 1) {
    assert.equal(link.step(1 / 20).reason, "disconnected");
  }
  assert.deepEqual(
    { source: upstreamInventory.amount, destination: downstreamInventory.amount },
    before,
  );

  link.setConnected(true);
  for (let tick = 0; tick < 10; tick += 1) link.step(1 / 20);
  assert.equal(upstreamInventory.amount, 1);
  assert.equal(downstreamInventory.amount, 1);
});

