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
import {
  ProjectDockDeliveryCommitter,
  type ProjectDockDeliveryCommitterSnapshot,
} from "./projectDockCommitter.ts";

export type CampaignProductionSnapshot = Readonly<{
  version: 1;
  campaignWorld: CampaignWorldSnapshot;
  production: WorldProductionSnapshot;
  dockFluidTransferCredit: number;
  dockCommitter?: ProjectDockDeliveryCommitterSnapshot;
}>;

export type CampaignProductionOptions = Omit<CampaignWorldOptions, "snapshot"> & Readonly<{
  dockFluidThroughputM3PerMinute?: number;
  snapshot?: CampaignProductionSnapshot;
}>;

/** @deprecated Compatibility adapter for the original single-fluid runtime save. */
export class ProjectDockFluidCommitter {
  readonly throughputM3PerMinute: number;
  private readonly committer: ProjectDockDeliveryCommitter;

  constructor(
    campaignWorld: CampaignWorldRuntime,
    production: WorldProductionSimulation,
    throughputM3PerMinute = 60,
    transferCredit = 0,
  ) {
    if (!Number.isFinite(throughputM3PerMinute) || throughputM3PerMinute <= 0) {
      throw new RangeError("dock fluid throughput must be finite and greater than zero");
    }
    if (!Number.isFinite(transferCredit) || transferCredit < 0 || transferCredit > 1 + Number.EPSILON) {
      throw new RangeError("invalid dock fluid transfer credit snapshot");
    }
    this.throughputM3PerMinute = throughputM3PerMinute;
    this.committer = new ProjectDockDeliveryCommitter(campaignWorld, production, throughputM3PerMinute, {
      version: 1,
      fluidTransferCredits: [],
      unassignedFluidCredit: transferCredit,
    });
  }

  snapshot(): number { return this.committer.legacyFluidCredit(); }

  advanceFixedTick(deltaSeconds: number) {
    return this.committer.advanceFixedTick(deltaSeconds).acceptedAmount;
  }
}

/** Complete headless adapter for world production, power, and dock fluid commits. */
export class CampaignProductionRuntime {
  readonly campaignWorld: CampaignWorldRuntime;
  readonly production: WorldProductionSimulation;
  readonly dockFluidThroughputM3PerMinute: number;
  private dockFluidTransferCredit = 0;
  private readonly dockCommitter: ProjectDockDeliveryCommitter;

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
    this.dockCommitter = new ProjectDockDeliveryCommitter(
      this.campaignWorld,
      this.production,
      throughput,
      options.snapshot?.dockCommitter ?? {
        version: 1,
        fluidTransferCredits: [],
        unassignedFluidCredit: this.dockFluidTransferCredit,
      },
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
        this.dockCommitter.advanceFixedTick(fixedDelta);
        this.dockFluidTransferCredit = this.dockCommitter.legacyFluidCredit();
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
      dockCommitter: this.dockCommitter.snapshot(),
    };
  }

}
