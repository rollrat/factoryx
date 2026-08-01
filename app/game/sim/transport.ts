import type { ItemId, PortDefinition } from "../domain/types.ts";
import { SIMULATION_TICK_SECONDS } from "./contracts.ts";
import { PortInventory } from "./inventory.ts";

export type TransportLinkSnapshot = Readonly<{
  id: string;
  connected: boolean;
  transferCredit: number;
  transferredAmount: number;
}>;

export type TransportStepResult = Readonly<{
  movedAmount: number;
  reason: "moved" | "accumulating" | "disconnected" | "empty" | "item_mismatch" | "blocked";
}>;

export type TransportLinkOptions = Readonly<{
  id: string;
  upstreamPort: PortDefinition;
  upstreamInventory: PortInventory;
  downstreamPort: PortDefinition;
  downstreamInventory: PortInventory;
  ratePerMinute: number;
  connected?: boolean;
  snapshot?: TransportLinkSnapshot;
}>;

const accepts = (port: PortDefinition, itemId: ItemId) => (
  port.acceptedItemIds.length === 0 || port.acceptedItemIds.includes(itemId)
);

const canOutput = (port: PortDefinition) => port.direction === "output" || port.direction === "bidirectional";
const canInput = (port: PortDefinition) => port.direction === "input" || port.direction === "bidirectional";

const assertFiniteNonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite, non-negative number`);
};

/**
 * A deterministic, directional solid-item link. Throughput is accumulated as
 * fractional transfer credit, while inventories only exchange whole items.
 */
export class TransportLink {
  readonly id: string;
  readonly upstreamPort: PortDefinition;
  readonly upstreamInventory: PortInventory;
  readonly downstreamPort: PortDefinition;
  readonly downstreamInventory: PortInventory;
  readonly ratePerMinute: number;

  private isConnected: boolean;
  private transferCredit = 0;
  private totalTransferred = 0;

  constructor(options: TransportLinkOptions) {
    if (!options.id) throw new Error("transport link id is required");
    if (!Number.isFinite(options.ratePerMinute) || options.ratePerMinute <= 0) {
      throw new RangeError("ratePerMinute must be a finite number greater than zero");
    }
    if (!canOutput(options.upstreamPort)) throw new Error("upstream port must allow output");
    if (!canInput(options.downstreamPort)) throw new Error("downstream port must allow input");
    if (options.upstreamPort.medium !== "solid" || options.downstreamPort.medium !== "solid") {
      throw new Error("transport links only connect solid ports");
    }
    if (options.upstreamPort.connectorProfile !== "belt_standard"
      || options.downstreamPort.connectorProfile !== "belt_standard") {
      throw new Error("transport links require belt_standard connectors");
    }
    if (options.upstreamPort.connectorProfile !== options.downstreamPort.connectorProfile) {
      throw new Error("transport link connector profiles must match");
    }
    if (options.upstreamInventory.portId !== options.upstreamPort.id) {
      throw new Error("upstream inventory does not belong to the upstream port");
    }
    if (options.downstreamInventory.portId !== options.downstreamPort.id) {
      throw new Error("downstream inventory does not belong to the downstream port");
    }
    if (options.upstreamInventory === options.downstreamInventory) {
      throw new Error("transport link cannot connect an inventory to itself");
    }

    this.id = options.id;
    this.upstreamPort = options.upstreamPort;
    this.upstreamInventory = options.upstreamInventory;
    this.downstreamPort = options.downstreamPort;
    this.downstreamInventory = options.downstreamInventory;
    this.ratePerMinute = options.ratePerMinute;
    this.isConnected = options.connected ?? true;
    if (options.snapshot) this.restore(options.snapshot);
  }

  get connected() { return this.isConnected; }
  get transferredAmount() { return this.totalTransferred; }

  setConnected(connected: boolean) {
    this.isConnected = connected;
  }

  step(deltaSeconds = SIMULATION_TICK_SECONDS): TransportStepResult {
    assertFiniteNonNegative(deltaSeconds, "deltaSeconds");
    if (!this.isConnected) return { movedAmount: 0, reason: "disconnected" };

    // A blocked or empty zero-length link may retain at most one ready batch;
    // it never banks downtime into an above-rate burst after reconnection.
    const generatedCredit = this.ratePerMinute * deltaSeconds / 60;
    this.transferCredit = Math.min(this.transferCredit + generatedCredit, Math.max(1, generatedCredit));
    const allowedAmount = Math.floor(this.transferCredit + Number.EPSILON);
    if (allowedAmount === 0) return { movedAmount: 0, reason: "accumulating" };

    const itemId = this.upstreamInventory.itemId;
    if (itemId === null || this.upstreamInventory.availableAmount < 1) {
      return { movedAmount: 0, reason: "empty" };
    }
    if (!accepts(this.upstreamPort, itemId) || !accepts(this.downstreamPort, itemId)) {
      return { movedAmount: 0, reason: "item_mismatch" };
    }
    if (this.downstreamInventory.itemId !== null && this.downstreamInventory.itemId !== itemId) {
      return { movedAmount: 0, reason: "item_mismatch" };
    }

    const amount = Math.min(
      allowedAmount,
      Math.floor(this.upstreamInventory.availableAmount),
      Math.floor(this.downstreamInventory.availableCapacity),
    );
    if (amount < 1) return { movedAmount: 0, reason: "blocked" };

    // Reserve first and commit only after the destination accepts the complete
    // batch, so a failed handoff cannot delete or duplicate an item.
    if (!this.upstreamInventory.reserve(itemId, amount)) {
      return { movedAmount: 0, reason: "empty" };
    }
    if (!this.downstreamInventory.deposit(itemId, amount)) {
      this.upstreamInventory.release(amount);
      return { movedAmount: 0, reason: "blocked" };
    }
    this.upstreamInventory.commitReserved(amount);
    this.transferCredit = Math.max(0, this.transferCredit - amount);
    this.totalTransferred += amount;
    return { movedAmount: amount, reason: "moved" };
  }

  snapshot(): TransportLinkSnapshot {
    return {
      id: this.id,
      connected: this.isConnected,
      transferCredit: this.transferCredit,
      transferredAmount: this.totalTransferred,
    };
  }

  restore(snapshot: TransportLinkSnapshot) {
    if (snapshot.id !== this.id) throw new Error("transport snapshot id does not match");
    assertFiniteNonNegative(snapshot.transferCredit, "snapshot.transferCredit");
    assertFiniteNonNegative(snapshot.transferredAmount, "snapshot.transferredAmount");
    this.isConnected = snapshot.connected;
    this.transferCredit = snapshot.transferCredit;
    this.totalTransferred = snapshot.transferredAmount;
  }
}

