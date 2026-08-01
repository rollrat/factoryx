import type { ProjectDeliveryDefinition, ProjectStageDefinition } from "../domain/types.ts";
import type { CampaignWorldRuntime } from "./campaignWorld.ts";
import { SIMULATION_TICK_SECONDS } from "./contracts.ts";
import type { WorldProductionSimulation } from "./worldProduction.ts";

export type ProjectDockDeliveryCommitterSnapshot = Readonly<{
  version: 1;
  fluidTransferCredits: readonly Readonly<{ stageId: string; portId: string; credit: number }>[];
  unassignedFluidCredit: number;
}>;

export type ProjectDockCommitStatus =
  | "committed"
  | "waiting_for_full_load"
  | "empty"
  | "item_mismatch"
  | "power_insufficient"
  | "rollback";

export type ProjectDockCommitEntry = Readonly<{
  stageId: string;
  portId: string;
  itemId: string;
  policy: ProjectDeliveryDefinition["commitPolicy"];
  status: ProjectDockCommitStatus;
  acceptedAmount: number;
  bufferedAmount: number;
}>;

export type ProjectDockCommitReport = Readonly<{
  stageId: string | null;
  acceptedAmount: number;
  stageCompleted: boolean;
  entries: readonly ProjectDockCommitEntry[];
}>;

const creditKey = (stageId: string, portId: string) => `${stageId}:${portId}`;

/**
 * Atomically commits the live project dock buffers into CampaignProjectTracker.
 * The campaign definition is the only source of item, port, policy, and power rules.
 */
export class ProjectDockDeliveryCommitter {
  readonly throughputM3PerMinute: number;
  private readonly credits = new Map<string, number>();
  private unassignedFluidCredit = 0;
  private readonly campaignWorld: CampaignWorldRuntime;
  private readonly production: WorldProductionSimulation;

  constructor(
    campaignWorld: CampaignWorldRuntime,
    production: WorldProductionSimulation,
    throughputM3PerMinute = 60,
    snapshot?: ProjectDockDeliveryCommitterSnapshot,
  ) {
    if (!Number.isFinite(throughputM3PerMinute) || throughputM3PerMinute <= 0) {
      throw new RangeError("dock fluid throughput must be finite and greater than zero");
    }
    this.campaignWorld = campaignWorld;
    this.production = production;
    this.throughputM3PerMinute = throughputM3PerMinute;
    if (snapshot) this.restore(snapshot);
  }

  advanceFixedTick(deltaSeconds: number): ProjectDockCommitReport {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("dock commit delta must be finite and non-negative");
    const stage = this.activeStage();
    if (!stage) return { stageId: null, acceptedAmount: 0, stageCompleted: false, entries: [] };
    const dock = this.campaignWorld.world.allInstances().find(({ definitionId }) => definitionId === "project_dock");
    if (!dock) return { stageId: stage.id, acceptedAmount: 0, stageCompleted: false, entries: [] };

    const suppliedPowerMW = this.campaignWorld.snapshot().dockSuppliedPowerMW;
    const requiredPowerMW = stage.dockPowerMode === "powered" ? stage.requiredPowerMW ?? 32 : 0;
    const powerReady = suppliedPowerMW >= requiredPowerMW;
    const entries: ProjectDockCommitEntry[] = [];
    let acceptedAmount = 0;

    // Resolve one stage for the whole tick. Completing it never consumes a newly
    // unlocked stage's buffers until the following deterministic tick.
    stage.deliveries.forEach((delivery) => {
      const progress = this.campaignWorld.campaign.progress(stage.id)?.deliveries.find(({ portId }) => portId === delivery.portId);
      if (!progress || progress.remaining <= 0) return;
      let inventory;
      try {
        inventory = this.production.inventory(dock.id, delivery.portId, "input");
      } catch {
        entries.push(this.entry(stage, delivery, "empty", 0, 0));
        return;
      }

      if (inventory.itemId === null || inventory.amount <= 0) {
        entries.push(this.entry(stage, delivery, "empty", 0, inventory.amount));
        return;
      }
      if (inventory.itemId !== delivery.itemId) {
        entries.push(this.entry(stage, delivery, "item_mismatch", 0, inventory.amount));
        return;
      }
      if (!powerReady) {
        entries.push(this.entry(stage, delivery, "power_insufficient", 0, inventory.amount));
        return;
      }

      const amount = delivery.commitPolicy === "solid_lock_complete"
        ? inventory.amount >= progress.remaining ? progress.remaining : 0
        : this.fluidAmount(stage, delivery, deltaSeconds, inventory.amount, progress.remaining);
      if (amount <= 0) {
        entries.push(this.entry(
          stage,
          delivery,
          delivery.commitPolicy === "solid_lock_complete" ? "waiting_for_full_load" : "empty",
          0,
          inventory.amount,
        ));
        return;
      }

      if (!this.production.withdraw(dock.id, delivery.portId, "input", delivery.itemId, amount)) {
        entries.push(this.entry(stage, delivery, "rollback", 0, inventory.amount));
        return;
      }
      const result = this.campaignWorld.deliverProject(stage.id, {
        portId: delivery.portId,
        itemId: delivery.itemId,
        amount,
      });
      if (!result.accepted) {
        if (!this.production.deposit(dock.id, delivery.portId, "input", delivery.itemId, amount)) {
          throw new Error(`failed to roll back rejected dock delivery: ${stage.id}.${delivery.portId}`);
        }
        entries.push(this.entry(stage, delivery, "rollback", 0, inventory.amount));
        return;
      }
      if (delivery.commitPolicy === "fluid_accepted_per_tick") {
        const key = creditKey(stage.id, delivery.portId);
        this.credits.set(key, Math.max(0, (this.credits.get(key) ?? 0) - amount));
      }
      acceptedAmount += amount;
      entries.push(this.entry(stage, delivery, "committed", amount, inventory.amount - amount));
    });

    return {
      stageId: stage.id,
      acceptedAmount,
      stageCompleted: this.campaignWorld.campaign.progress(stage.id)?.completed ?? false,
      entries,
    };
  }

  snapshot(): ProjectDockDeliveryCommitterSnapshot {
    return {
      version: 1,
      fluidTransferCredits: [...this.credits]
        .map(([key, credit]) => {
          const separator = key.lastIndexOf(":");
          return { stageId: key.slice(0, separator), portId: key.slice(separator + 1), credit };
        })
        .sort((a, b) => a.stageId.localeCompare(b.stageId) || a.portId.localeCompare(b.portId)),
      unassignedFluidCredit: this.unassignedFluidCredit,
    };
  }

  /** Compatibility value for v1 visual-runtime saves. */
  legacyFluidCredit(): number {
    return Math.max(this.unassignedFluidCredit, 0, ...this.credits.values());
  }

  private activeStage(): ProjectStageDefinition | null {
    return [...this.campaignWorld.registry.projectStages.values()].find((stage) => (
      this.campaignWorld.campaign.isUnlocked(stage.id)
      && this.campaignWorld.campaign.progress(stage.id)?.completed === false
    )) ?? null;
  }

  private fluidAmount(
    stage: ProjectStageDefinition,
    delivery: ProjectDeliveryDefinition,
    deltaSeconds: number,
    buffered: number,
    remaining: number,
  ) {
    const key = creditKey(stage.id, delivery.portId);
    const generated = this.throughputM3PerMinute * deltaSeconds / 60;
    const inherited = this.credits.has(key) ? 0 : this.unassignedFluidCredit;
    if (inherited > 0) this.unassignedFluidCredit = 0;
    const credit = Math.min((this.credits.get(key) ?? inherited) + generated, Math.max(1, generated));
    this.credits.set(key, credit);
    const acceptedLimit = Math.floor(credit + Number.EPSILON);
    return Math.min(acceptedLimit, buffered, remaining);
  }

  private entry(
    stage: ProjectStageDefinition,
    delivery: ProjectDeliveryDefinition,
    status: ProjectDockCommitStatus,
    acceptedAmount: number,
    bufferedAmount: number,
  ): ProjectDockCommitEntry {
    return {
      stageId: stage.id,
      portId: delivery.portId,
      itemId: delivery.itemId,
      policy: delivery.commitPolicy,
      status,
      acceptedAmount,
      bufferedAmount,
    };
  }

  private restore(snapshot: ProjectDockDeliveryCommitterSnapshot) {
    if (snapshot.version !== 1) throw new Error(`unsupported project dock committer snapshot version: ${snapshot.version}`);
    const maximumCredit = Math.max(1, this.throughputM3PerMinute * SIMULATION_TICK_SECONDS / 60);
    if (!Number.isFinite(snapshot.unassignedFluidCredit) || snapshot.unassignedFluidCredit < 0
      || snapshot.unassignedFluidCredit > maximumCredit + Number.EPSILON) {
      throw new RangeError("invalid unassigned dock fluid credit snapshot");
    }
    this.unassignedFluidCredit = snapshot.unassignedFluidCredit;
    snapshot.fluidTransferCredits.forEach(({ stageId, portId, credit }) => {
      const stage = this.campaignWorld.registry.projectStages.get(stageId);
      const delivery = stage?.deliveries.find((candidate) => candidate.portId === portId);
      if (!delivery || delivery.commitPolicy !== "fluid_accepted_per_tick") {
        throw new Error(`unknown dock fluid credit: ${stageId}.${portId}`);
      }
      const key = creditKey(stageId, portId);
      if (this.credits.has(key)) throw new Error(`duplicate dock fluid credit: ${stageId}.${portId}`);
      if (!Number.isFinite(credit) || credit < 0 || credit > maximumCredit + Number.EPSILON) {
        throw new RangeError(`invalid dock fluid credit: ${stageId}.${portId}`);
      }
      this.credits.set(key, credit);
    });
  }
}
