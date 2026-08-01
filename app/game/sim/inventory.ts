import type { ItemId, PortId, RecipeAmount } from "../domain/types.ts";
import type { PortInventorySnapshot } from "./contracts.ts";

export type PortInventoryState = PortInventorySnapshot & Readonly<{
  reservedAmount: number;
}>;

export type InventoryTransactionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "missing_port" | "item_mismatch" | "insufficient_amount" | "insufficient_capacity"; portId: PortId }>;

type AggregatedAmount = { portId: PortId; itemId: ItemId; amount: number };

const assertAmount = (amount: number, name = "amount") => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
};

const aggregateAmounts = (amounts: readonly RecipeAmount[]): AggregatedAmount[] => {
  const byPort = new Map<PortId, AggregatedAmount>();
  for (const amount of amounts) {
    assertAmount(amount.amount);
    const current = byPort.get(amount.portId);
    if (current && current.itemId !== amount.itemId) {
      throw new Error(`port ${amount.portId} cannot hold multiple item types in one transaction`);
    }
    if (current) current.amount += amount.amount;
    else byPort.set(amount.portId, { ...amount });
  }
  return [...byPort.values()];
};

/** A single-item buffer owned by one logical port. */
export class PortInventory {
  readonly portId: PortId;
  readonly capacity: number;
  private currentItemId: ItemId | null;
  private currentAmount: number;
  private currentReservedAmount: number;

  constructor(
    portId: PortId,
    capacity: number,
    initial?: Readonly<{ itemId: ItemId | null; amount: number; reservedAmount?: number }>,
  ) {
    assertAmount(capacity, "capacity");
    this.portId = portId;
    this.capacity = capacity;
    this.currentItemId = initial?.itemId ?? null;
    this.currentAmount = initial?.amount ?? 0;
    this.currentReservedAmount = initial?.reservedAmount ?? 0;
    this.assertInvariant();
  }

  get itemId() { return this.currentItemId; }
  get amount() { return this.currentAmount; }
  get reservedAmount() { return this.currentReservedAmount; }
  get availableAmount() { return this.currentAmount - this.currentReservedAmount; }
  get availableCapacity() { return this.capacity - this.currentAmount; }

  canDeposit(itemId: ItemId, amount: number) {
    assertAmount(amount);
    return (this.currentItemId === null || this.currentItemId === itemId)
      && amount <= this.availableCapacity;
  }

  deposit(itemId: ItemId, amount: number) {
    if (!this.canDeposit(itemId, amount)) return false;
    if (amount === 0) return true;
    this.currentItemId = itemId;
    this.currentAmount += amount;
    return true;
  }

  canReserve(itemId: ItemId, amount: number) {
    assertAmount(amount);
    return this.currentItemId === itemId && amount <= this.availableAmount;
  }

  reserve(itemId: ItemId, amount: number) {
    if (!this.canReserve(itemId, amount)) return false;
    this.currentReservedAmount += amount;
    return true;
  }

  release(amount: number) {
    assertAmount(amount);
    if (amount > this.currentReservedAmount) throw new RangeError("cannot release more than reserved");
    this.currentReservedAmount -= amount;
  }

  commitReserved(amount: number) {
    assertAmount(amount);
    if (amount > this.currentReservedAmount) throw new RangeError("cannot commit more than reserved");
    this.currentReservedAmount -= amount;
    this.currentAmount -= amount;
    this.clearItemWhenEmpty();
  }

  withdraw(itemId: ItemId, amount: number) {
    if (!this.canReserve(itemId, amount)) return false;
    this.currentAmount -= amount;
    this.clearItemWhenEmpty();
    return true;
  }

  snapshot(): PortInventorySnapshot {
    return { portId: this.portId, itemId: this.currentItemId, amount: this.currentAmount, capacity: this.capacity };
  }

  state(): PortInventoryState {
    return { ...this.snapshot(), reservedAmount: this.currentReservedAmount };
  }

  private clearItemWhenEmpty() {
    if (this.currentAmount === 0) this.currentItemId = null;
    this.assertInvariant();
  }

  private assertInvariant() {
    assertAmount(this.currentAmount);
    assertAmount(this.currentReservedAmount, "reservedAmount");
    if (this.currentAmount > this.capacity) throw new RangeError("inventory amount exceeds capacity");
    if (this.currentReservedAmount > this.currentAmount) throw new RangeError("reserved amount exceeds inventory amount");
    if ((this.currentAmount === 0) !== (this.currentItemId === null)) {
      throw new Error("an empty inventory must have a null itemId and a non-empty inventory must have an itemId");
    }
  }
}

export type PortInventoryMap = ReadonlyMap<PortId, PortInventory>;

/** Atomically reserves and consumes every recipe input into WIP. */
export const consumeInputsAtomically = (
  inventories: PortInventoryMap,
  requirements: readonly RecipeAmount[],
): InventoryTransactionResult => {
  const aggregated = aggregateAmounts(requirements);
  for (const requirement of aggregated) {
    const inventory = inventories.get(requirement.portId);
    if (!inventory) return { ok: false, reason: "missing_port", portId: requirement.portId };
    if (inventory.itemId !== requirement.itemId) {
      return { ok: false, reason: "item_mismatch", portId: requirement.portId };
    }
    if (!inventory.canReserve(requirement.itemId, requirement.amount)) {
      return { ok: false, reason: "insufficient_amount", portId: requirement.portId };
    }
  }
  for (const requirement of aggregated) {
    inventories.get(requirement.portId)!.reserve(requirement.itemId, requirement.amount);
  }
  for (const requirement of aggregated) {
    inventories.get(requirement.portId)!.commitReserved(requirement.amount);
  }
  return { ok: true };
};

/** Checks all outputs first, then commits all of them without partial writes. */
export const produceOutputsAtomically = (
  inventories: PortInventoryMap,
  outputs: readonly RecipeAmount[],
): InventoryTransactionResult => {
  const aggregated = aggregateAmounts(outputs);
  const preflight = canProduceOutputsAtomically(inventories, outputs);
  if (!preflight.ok) return preflight;
  for (const output of aggregated) {
    inventories.get(output.portId)!.deposit(output.itemId, output.amount);
  }
  return { ok: true };
};

/** Checks every output without mutating any buffer. */
export const canProduceOutputsAtomically = (
  inventories: PortInventoryMap,
  outputs: readonly RecipeAmount[],
): InventoryTransactionResult => {
  const aggregated = aggregateAmounts(outputs);
  for (const output of aggregated) {
    const inventory = inventories.get(output.portId);
    if (!inventory) return { ok: false, reason: "missing_port", portId: output.portId };
    if (inventory.itemId !== null && inventory.itemId !== output.itemId) {
      return { ok: false, reason: "item_mismatch", portId: output.portId };
    }
    if (!inventory.canDeposit(output.itemId, output.amount)) {
      return { ok: false, reason: "insufficient_capacity", portId: output.portId };
    }
  }
  return { ok: true };
};
