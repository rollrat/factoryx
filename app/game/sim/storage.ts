import type { ItemId, StorageState } from "../domain/types.ts";

export type StorageRoutingPolicy = StorageState["routingPolicy"];

export type StorageOperationResult =
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    reason:
      | "disabled"
      | "invalid_amount"
      | "item_mismatch"
      | "insufficient_capacity"
      | "insufficient_available"
      | "waiting_until_full"
      | "filter_mismatch";
  }>;

export type StorageRuntimeOptions = Readonly<{
  structureId: string;
  slotCount: number;
  stackSize: number;
  snapshot?: StorageState;
}>;

const isNonNegativeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validAmount = (amount: number) => Number.isSafeInteger(amount) && amount > 0;

/**
 * Transactional state for a solid, single-item storage building.
 * Capacity is static definition data and therefore is not duplicated in snapshots.
 */
export class StorageRuntime {
  readonly structureId: string;
  readonly slotCount: number;
  readonly stackSize: number;
  readonly capacity: number;

  private lockedItemId?: ItemId;
  private inventory = 0;
  private reservedIncoming = 0;
  private reservedOutgoing = 0;
  private inputTransferItemId?: ItemId;
  private inputEnabled = true;
  private outputEnabled = true;
  private outputFilterItemId?: ItemId;
  private minimumReserve = 0;
  private routingPolicy: StorageRoutingPolicy = "pass_through";

  constructor(options: StorageRuntimeOptions) {
    if (!options.structureId) throw new Error("storage structureId is required");
    if (!Number.isSafeInteger(options.slotCount) || options.slotCount <= 0) {
      throw new RangeError("slotCount must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.stackSize) || options.stackSize <= 0) {
      throw new RangeError("stackSize must be a positive safe integer");
    }
    const capacity = options.slotCount * options.stackSize;
    if (!Number.isSafeInteger(capacity)) throw new RangeError("storage capacity exceeds safe integer range");

    this.structureId = options.structureId;
    this.slotCount = options.slotCount;
    this.stackSize = options.stackSize;
    this.capacity = capacity;
    if (options.snapshot) this.restore(options.snapshot);
  }

  get itemId() { return this.lockedItemId; }
  get storedAmount() { return this.inventory; }
  get incomingReservation() { return this.reservedIncoming; }
  get outgoingReservation() { return this.reservedOutgoing; }
  get availableCapacity() { return this.capacity - this.inventory - this.reservedIncoming; }
  get availableToOutput() {
    return Math.max(0, this.inventory - this.reservedOutgoing - this.minimumReserve);
  }

  reserveIncomingItem(itemId: ItemId, amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (!this.inputEnabled) return { ok: false, reason: "disabled" };
    if (this.inputTransferItemId !== undefined && this.inputTransferItemId !== itemId) {
      return { ok: false, reason: "item_mismatch" };
    }
    if (this.lockedItemId !== undefined && this.lockedItemId !== itemId) {
      return { ok: false, reason: "item_mismatch" };
    }
    if (amount > this.availableCapacity) return { ok: false, reason: "insufficient_capacity" };

    // Lock and reservation are committed together only after every check passes.
    this.lockedItemId = itemId;
    this.reservedIncoming += amount;
    return { ok: true };
  }

  commitIncoming(itemId: ItemId, amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (this.lockedItemId !== itemId) return { ok: false, reason: "item_mismatch" };
    if (amount > this.reservedIncoming) return { ok: false, reason: "insufficient_available" };
    this.reservedIncoming -= amount;
    this.inventory += amount;
    this.assertInvariant();
    return { ok: true };
  }

  cancelIncoming(amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (amount > this.reservedIncoming) return { ok: false, reason: "insufficient_available" };
    this.reservedIncoming -= amount;
    this.unlockWhenCompletelyEmpty();
    return { ok: true };
  }

  reserveOutgoingItem(amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (!this.outputEnabled || this.routingPolicy === "output_disabled") {
      return { ok: false, reason: "disabled" };
    }
    if (this.routingPolicy === "fill_then_output" && this.inventory < this.capacity) {
      return { ok: false, reason: "waiting_until_full" };
    }
    if (this.outputFilterItemId !== undefined && this.outputFilterItemId !== this.lockedItemId) {
      return { ok: false, reason: "filter_mismatch" };
    }
    if (amount > this.availableToOutput) return { ok: false, reason: "insufficient_available" };
    this.reservedOutgoing += amount;
    return { ok: true };
  }

  commitOutgoing(amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (amount > this.reservedOutgoing) return { ok: false, reason: "insufficient_available" };
    this.reservedOutgoing -= amount;
    this.inventory -= amount;
    this.unlockWhenCompletelyEmpty();
    return { ok: true };
  }

  cancelOutgoing(amount: number): StorageOperationResult {
    if (!validAmount(amount)) return { ok: false, reason: "invalid_amount" };
    if (amount > this.reservedOutgoing) return { ok: false, reason: "insufficient_available" };
    this.reservedOutgoing -= amount;
    return { ok: true };
  }

  beginInputTransfer(itemId: ItemId): boolean {
    if (!this.inputEnabled || this.inputTransferItemId !== undefined) return false;
    if (this.lockedItemId !== undefined && this.lockedItemId !== itemId) return false;
    this.inputTransferItemId = itemId;
    return true;
  }

  endInputTransfer(itemId: ItemId): boolean {
    if (this.inputTransferItemId !== itemId) return false;
    this.inputTransferItemId = undefined;
    this.unlockWhenCompletelyEmpty();
    return true;
  }

  canChangeFilter(): boolean {
    return this.inventory === 0
      && this.reservedIncoming === 0
      && this.reservedOutgoing === 0
      && this.inputTransferItemId === undefined;
  }

  setOutputFilter(itemId?: ItemId): boolean {
    if (!this.canChangeFilter()) return false;
    this.outputFilterItemId = itemId;
    this.unlockWhenCompletelyEmpty();
    return true;
  }

  setMinimumReserve(amount: number): boolean {
    if (!isNonNegativeInteger(amount) || amount > this.capacity) return false;
    if (this.reservedOutgoing > Math.max(0, this.inventory - amount)) return false;
    this.minimumReserve = amount;
    return true;
  }

  setInputEnabled(enabled: boolean) { this.inputEnabled = enabled; }
  setOutputEnabled(enabled: boolean) { this.outputEnabled = enabled; }
  setRoutingPolicy(policy: StorageRoutingPolicy) { this.routingPolicy = policy; }

  snapshot(): StorageState {
    return {
      structureId: this.structureId,
      ...(this.lockedItemId !== undefined ? { lockedItemId: this.lockedItemId } : {}),
      inventory: this.inventory,
      reservedIncoming: this.reservedIncoming,
      reservedOutgoing: this.reservedOutgoing,
      ...(this.inputTransferItemId !== undefined ? { inputTransferItemId: this.inputTransferItemId } : {}),
      inputEnabled: this.inputEnabled,
      outputEnabled: this.outputEnabled,
      ...(this.outputFilterItemId !== undefined ? { outputFilterItemId: this.outputFilterItemId } : {}),
      minimumReserve: this.minimumReserve,
      routingPolicy: this.routingPolicy,
    };
  }

  restore(snapshot: StorageState): void {
    if (snapshot.structureId !== this.structureId) throw new Error("storage snapshot structureId does not match");
    for (const [name, value] of [
      ["inventory", snapshot.inventory],
      ["reservedIncoming", snapshot.reservedIncoming],
      ["reservedOutgoing", snapshot.reservedOutgoing],
      ["minimumReserve", snapshot.minimumReserve],
    ] as const) {
      if (!isNonNegativeInteger(value)) throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    if (snapshot.inventory + snapshot.reservedIncoming > this.capacity) {
      throw new RangeError("storage snapshot exceeds capacity");
    }
    if (snapshot.reservedOutgoing > snapshot.inventory) {
      throw new RangeError("storage snapshot outgoing reservation exceeds inventory");
    }
    if (snapshot.minimumReserve > this.capacity) {
      throw new RangeError("storage snapshot minimumReserve exceeds capacity");
    }
    if (snapshot.reservedOutgoing > Math.max(0, snapshot.inventory - snapshot.minimumReserve)) {
      throw new RangeError("storage snapshot outgoing reservation violates minimumReserve");
    }
    const hasContents = snapshot.inventory > 0
      || snapshot.reservedIncoming > 0
      || snapshot.reservedOutgoing > 0;
    if (hasContents && snapshot.lockedItemId === undefined) {
      throw new Error("non-empty storage snapshot requires lockedItemId");
    }
    if (snapshot.inputTransferItemId !== undefined
      && snapshot.lockedItemId !== undefined
      && snapshot.inputTransferItemId !== snapshot.lockedItemId) {
      throw new Error("storage snapshot input transfer item conflicts with locked item");
    }

    this.lockedItemId = snapshot.lockedItemId;
    this.inventory = snapshot.inventory;
    this.reservedIncoming = snapshot.reservedIncoming;
    this.reservedOutgoing = snapshot.reservedOutgoing;
    this.inputTransferItemId = snapshot.inputTransferItemId;
    this.inputEnabled = snapshot.inputEnabled;
    this.outputEnabled = snapshot.outputEnabled;
    this.outputFilterItemId = snapshot.outputFilterItemId;
    this.minimumReserve = snapshot.minimumReserve;
    this.routingPolicy = snapshot.routingPolicy;
    this.unlockWhenCompletelyEmpty();
    this.assertInvariant();
  }

  private unlockWhenCompletelyEmpty() {
    if (this.canChangeFilter()) this.lockedItemId = undefined;
  }

  private assertInvariant() {
    if (this.inventory + this.reservedIncoming > this.capacity) throw new Error("storage capacity invariant violated");
    if (this.reservedOutgoing > this.inventory) throw new Error("storage outgoing reservation invariant violated");
    if (this.minimumReserve < 0 || this.minimumReserve > this.capacity) throw new Error("storage minimum reserve invariant violated");
  }
}
