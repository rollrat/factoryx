import {
  CampaignWorldRuntime,
  type CampaignWorldOptions,
  type CampaignWorldSnapshot,
  type PowerInstanceOverride,
} from "./campaignWorld.ts";
import {
  WorldProductionSimulation,
  type WorldProductionSnapshot,
} from "./worldProduction.ts";

export type CampaignProductionSnapshot = Readonly<{
  version: 1;
  campaignWorld: CampaignWorldSnapshot;
  production: WorldProductionSnapshot;
  dockFluidTransferCredit: number;
}>;

export type CampaignProductionOptions = Omit<CampaignWorldOptions, "snapshot"> & Readonly<{
  dockFluidThroughputM3PerMinute?: number;
  snapshot?: CampaignProductionSnapshot;
}>;

/** Commits fluid already transported into the preplaced project dock. */
export class ProjectDockFluidCommitter {
  readonly throughputM3PerMinute: number;
  private readonly campaignWorld: CampaignWorldRuntime;
  private readonly production: WorldProductionSimulation;
  private transferCredit: number;

  constructor(
    campaignWorld: CampaignWorldRuntime,
    production: WorldProductionSimulation,
    throughputM3PerMinute = 60,
    transferCredit = 0,
  ) {
    if (!Number.isFinite(throughputM3PerMinute) || throughputM3PerMinute <= 0) {
      throw new RangeError("dock fluid throughput must be finite and greater than zero");
    }
    this.campaignWorld = campaignWorld;
    this.production = production;
    if (!Number.isFinite(transferCredit) || transferCredit < 0 || transferCredit > 1 + Number.EPSILON) {
      throw new RangeError("invalid dock fluid transfer credit snapshot");
    }
    this.throughputM3PerMinute = throughputM3PerMinute;
    this.transferCredit = transferCredit;
  }

  snapshot(): number { return this.transferCredit; }

  advanceFixedTick(deltaSeconds: number) {
    const generatedCredit = this.throughputM3PerMinute * deltaSeconds / 60;
    this.transferCredit = Math.min(this.transferCredit + generatedCredit, Math.max(1, generatedCredit));
    const acceptedLimit = Math.floor(this.transferCredit + Number.EPSILON);
    if (acceptedLimit < 1) return 0;
    const stage = [...this.campaignWorld.registry.projectStages.values()].find((candidate) => (
      this.campaignWorld.campaign.isUnlocked(candidate.id)
      && this.campaignWorld.campaign.progress(candidate.id)?.completed === false
    ));
    const delivery = stage?.deliveries.find(({ medium, commitPolicy }) => (
      medium === "fluid" && commitPolicy === "fluid_accepted_per_tick"
    ));
    if (!stage || !delivery) return 0;
    const dock = this.campaignWorld.world.allInstances().find(({ definitionId }) => definitionId === "project_dock");
    if (!dock) return 0;
    const inventory = this.production.inventory(dock.id, delivery.portId, "input");
    if (inventory.itemId !== delivery.itemId || inventory.amount <= 0) return 0;
    const progress = this.campaignWorld.campaign.progress(stage.id)?.deliveries.find(({ portId, itemId }) => (
      portId === delivery.portId && itemId === delivery.itemId
    ));
    if (!progress || progress.remaining <= 0) return 0;
    const amount = Math.min(acceptedLimit, inventory.amount, progress.remaining);
    if (amount <= 0) return 0;
    if (!this.production.withdraw(dock.id, delivery.portId, "input", delivery.itemId, amount)) return 0;
    const result = this.campaignWorld.deliverProject(stage.id, {
      portId: delivery.portId,
      itemId: delivery.itemId,
      amount,
    });
    if (!result.accepted) {
      if (!this.production.deposit(dock.id, delivery.portId, "input", delivery.itemId, amount)) {
        throw new Error("failed to roll back rejected dock fluid delivery");
      }
      return 0;
    }
    this.transferCredit = Math.max(0, this.transferCredit - amount);
    return amount;
  }
}

/** Complete headless adapter for world production, power, and dock fluid commits. */
export class CampaignProductionRuntime {
  readonly campaignWorld: CampaignWorldRuntime;
  readonly production: WorldProductionSimulation;
  readonly dockFluidThroughputM3PerMinute: number;
  private dockFluidTransferCredit = 0;
  private readonly dockFluidCommitter: ProjectDockFluidCommitter;

  constructor(options: CampaignProductionOptions) {
    const throughput = options.dockFluidThroughputM3PerMinute ?? 60;
    if (!Number.isFinite(throughput) || throughput <= 0) {
      throw new RangeError("dock fluid throughput must be finite and greater than zero");
    }
    if (options.snapshot?.version !== undefined && options.snapshot.version !== 1) {
      throw new Error(`unsupported campaign production snapshot version: ${options.snapshot.version}`);
    }
    this.dockFluidThroughputM3PerMinute = throughput;
    this.campaignWorld = new CampaignWorldRuntime({
      registry: options.registry,
      bounds: options.bounds,
      gridId: options.gridId,
      unlockedIds: options.unlockedIds,
      constructionInventory: options.constructionInventory,
      snapshot: options.snapshot?.campaignWorld,
    });
    this.production = new WorldProductionSimulation(
      this.campaignWorld.world,
      options.snapshot?.production,
    );
    if (options.snapshot) {
      if (!Number.isFinite(options.snapshot.dockFluidTransferCredit)
        || options.snapshot.dockFluidTransferCredit < 0
        || options.snapshot.dockFluidTransferCredit > 1 + Number.EPSILON) {
        throw new RangeError("invalid dock fluid transfer credit snapshot");
      }
      this.dockFluidTransferCredit = options.snapshot.dockFluidTransferCredit;
    }
    this.dockFluidCommitter = new ProjectDockFluidCommitter(
      this.campaignWorld,
      this.production,
      throughput,
      this.dockFluidTransferCredit,
    );
  }

  advance(
    deltaSeconds: number,
    powerOverrides: Readonly<Record<string, PowerInstanceOverride>> = {},
  ) {
    return this.production.advance(deltaSeconds, {
      beforeTick: (_tick, fixedDelta) => {
        const power = this.campaignWorld.stepPower(fixedDelta, powerOverrides);
        this.production.applyPowerResult(power);
      },
      afterTick: (_tick, fixedDelta) => {
        this.dockFluidCommitter.advanceFixedTick(fixedDelta);
        this.dockFluidTransferCredit = this.dockFluidCommitter.snapshot();
      },
    });
  }

  snapshot(): CampaignProductionSnapshot {
    const production = this.production.snapshot();
    return {
      version: 1,
      campaignWorld: this.campaignWorld.snapshot(),
      production,
      dockFluidTransferCredit: this.dockFluidTransferCredit,
    };
  }

}
