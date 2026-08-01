import type {
  DefinitionRegistry,
  ItemId,
  ItemStack,
  ProjectStageId,
  UnlockId,
} from "../domain/types.ts";
import {
  CampaignProjectTracker,
  type CampaignDeliveryResult,
  type CampaignSnapshot,
} from "./campaign.ts";
import type { ProjectDeliveryRequest } from "./project.ts";
import {
  AdvancedPowerGrid,
  type AdvancedPowerGridSnapshot,
  type LoadPriority,
  type PowerGridResult,
} from "./powerGrid.ts";
import {
  DataDrivenWorld,
  type WorldBounds,
  type WorldSnapshot,
} from "./world.ts";

export type PowerInstanceOverride = Readonly<{
  connected?: boolean;
  active?: boolean;
  requestedMW?: number;
  priority?: LoadPriority;
  enabled?: boolean;
  fuelAvailable?: boolean;
  storedMWh?: number;
}>;

export type CampaignWorldSnapshot = Readonly<{
  version: 1;
  gridId: string;
  world: WorldSnapshot;
  campaign: CampaignSnapshot;
  power: AdvancedPowerGridSnapshot;
  appliedRewardStageIds: readonly ProjectStageId[];
  unlockedItemIds: readonly ItemId[];
  constructionCredits: readonly Readonly<{ id: string; amount: number }>[];
  dockSuppliedPowerMW: number;
}>;

export type CampaignWorldOptions = Readonly<{
  registry: DefinitionRegistry;
  bounds: WorldBounds;
  gridId?: string;
  unlockedIds?: readonly UnlockId[];
  constructionInventory?: readonly ItemStack[];
  snapshot?: CampaignWorldSnapshot;
}>;

/** Joins campaign rewards, the definition-driven world, and one independent power grid. */
export class CampaignWorldRuntime {
  readonly registry: DefinitionRegistry;
  readonly world: DataDrivenWorld;
  readonly campaign: CampaignProjectTracker;
  readonly powerGrid: AdvancedPowerGrid;

  private readonly appliedRewardStageIds = new Set<ProjectStageId>();
  private readonly unlockedItemIds = new Set<ItemId>();
  private readonly constructionCredits = new Map<string, number>();
  private dockSuppliedPowerMW = 0;
  private lastPowerResult: PowerGridResult | null = null;

  constructor(options: CampaignWorldOptions) {
    this.registry = options.registry;
    const gridId = options.snapshot?.gridId ?? options.gridId ?? "campaign-grid";
    if (options.snapshot && options.gridId !== undefined && options.gridId !== options.snapshot.gridId) {
      throw new Error("campaign world snapshot gridId does not match");
    }
    this.world = new DataDrivenWorld({
      registry: options.registry,
      bounds: options.bounds,
      unlockedIds: options.unlockedIds,
      constructionInventory: options.constructionInventory,
      ...(options.snapshot ? { snapshot: options.snapshot.world } : {}),
    });
    this.campaign = new CampaignProjectTracker(options.registry, options.snapshot?.campaign);
    this.powerGrid = new AdvancedPowerGrid(gridId, options.snapshot?.power);

    if (options.snapshot) {
      if (options.snapshot.version !== 1) {
        throw new Error(`unsupported campaign world snapshot version: ${options.snapshot.version}`);
      }
      options.snapshot.appliedRewardStageIds.forEach((id) => {
        if (!options.registry.projectStages.has(id)) throw new Error(`unknown rewarded project stage: ${id}`);
        this.appliedRewardStageIds.add(id);
      });
      options.snapshot.unlockedItemIds.forEach((id) => {
        if (!options.registry.items.has(id)) throw new Error(`unknown unlocked item: ${id}`);
        this.unlockedItemIds.add(id);
      });
      options.snapshot.constructionCredits.forEach(({ id, amount }) => {
        if (!id || !Number.isFinite(amount) || amount < 0) throw new RangeError("invalid construction credit snapshot");
        if (this.constructionCredits.has(id)) throw new Error(`duplicate construction credit snapshot: ${id}`);
        this.constructionCredits.set(id, amount);
      });
      if (!Number.isFinite(options.snapshot.dockSuppliedPowerMW) || options.snapshot.dockSuppliedPowerMW < 0) {
        throw new RangeError("invalid dock supplied power snapshot");
      }
      this.dockSuppliedPowerMW = options.snapshot.dockSuppliedPowerMW;
    } else {
      options.registry.items.forEach((item) => {
        if (item.unlockId === "start") this.unlockedItemIds.add(item.id);
      });
    }
  }

  deliverProject(stageId: ProjectStageId, request: ProjectDeliveryRequest): CampaignDeliveryResult {
    const wasComplete = this.campaign.progress(stageId)?.completed === true;
    const result = this.campaign.deliver(stageId, request, this.dockSuppliedPowerMW);
    const isComplete = this.campaign.progress(stageId)?.completed === true;
    if (!wasComplete && isComplete) this.applyStageRewards(stageId);
    return result;
  }

  stepPower(
    deltaSeconds: number,
    overrides: Readonly<Record<string, PowerInstanceOverride>> = {},
  ): PowerGridResult {
    const activePoweredStage = [...this.registry.projectStages.values()].find((stage) => (
      stage.dockPowerMode === "powered"
      && this.campaign.isUnlocked(stage.id)
      && this.campaign.progress(stage.id)?.completed === false
    ));
    const generators = [];
    const consumers = [];
    const batteries = [];

    this.world.allInstances().forEach((instance) => {
      const definition = this.registry.buildings.get(instance.definitionId);
      if (!definition) return;
      const override = overrides[instance.id] ?? {};
      if (definition.generatorPolicy) {
        const policy = definition.generatorPolicy;
        generators.push({
          id: instance.id,
          nameplateMW: policy.capacityMW,
          minimumLoadMW: policy.capacityMW * policy.minimumLoadRatio,
          dispatchPriority: policy.dispatchPriority,
          connected: override.connected,
          enabled: override.enabled,
          requiresFuel: policy.fuelItemId !== undefined,
          fuelAvailable: override.fuelAvailable ?? (
            policy.fuelItemId === undefined || this.instanceContainsItem(instance.id, policy.fuelItemId)
          ),
        });
      }
      if (definition.activeMW !== undefined || definition.idleMW !== undefined) {
        const dockActive = definition.id === "project_dock" && activePoweredStage !== undefined;
        consumers.push({
          id: instance.id,
          active: override.active ?? (dockActive || instance.runtimeState === "working"),
          activeMW: definition.activeMW ?? 0,
          idleMW: definition.idleMW ?? 0,
          requestedMW: override.requestedMW,
          priority: override.priority,
          connected: override.connected,
        });
      }
      if (definition.powerStoragePolicy) {
        const policy = definition.powerStoragePolicy;
        batteries.push({
          id: instance.id,
          capacityMWh: policy.capacityMWh,
          storedMWh: override.storedMWh ?? 0,
          maxChargeMW: policy.maxChargeMW,
          maxDischargeMW: policy.maxDischargeMW,
          connected: override.connected,
        });
      }
    });

    this.lastPowerResult = this.powerGrid.step({
      gridId: this.powerGrid.gridId,
      deltaSeconds,
      generators,
      consumers,
      batteries,
    });
    const dock = this.world.allInstances().find(({ definitionId }) => definitionId === "project_dock");
    this.dockSuppliedPowerMW = dock
      ? this.lastPowerResult.consumers.find(({ id }) => id === dock.id)?.servedMW ?? 0
      : 0;
    return this.lastPowerResult;
  }

  powerResult(): PowerGridResult | null {
    return this.lastPowerResult;
  }

  isItemUnlocked(itemId: ItemId): boolean {
    return this.unlockedItemIds.has(itemId);
  }

  constructionCreditAmount(id: string): number {
    return this.constructionCredits.get(id) ?? 0;
  }

  spendConstructionCredit(id: string, amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const available = this.constructionCreditAmount(id);
    if (amount > available) return false;
    this.constructionCredits.set(id, available - amount);
    return true;
  }

  snapshot(): CampaignWorldSnapshot {
    return {
      version: 1,
      gridId: this.powerGrid.gridId,
      world: this.world.snapshot(),
      campaign: this.campaign.snapshot(),
      power: this.powerGrid.snapshot(),
      appliedRewardStageIds: [...this.appliedRewardStageIds].sort(),
      unlockedItemIds: [...this.unlockedItemIds].sort(),
      constructionCredits: [...this.constructionCredits]
        .map(([id, amount]) => ({ id, amount }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      dockSuppliedPowerMW: this.dockSuppliedPowerMW,
    };
  }

  private applyStageRewards(stageId: ProjectStageId) {
    if (this.appliedRewardStageIds.has(stageId)) return;
    const stage = this.registry.projectStages.get(stageId);
    if (!stage) throw new Error(`unknown completed project stage: ${stageId}`);
    if (stage.completionUnlockId) this.world.unlock(stage.completionUnlockId);
    (stage.rewards.itemIds ?? []).forEach((id) => this.unlockedItemIds.add(id));
    (stage.rewards.resourceIds ?? []).forEach((id) => this.unlockedItemIds.add(id));
    Object.entries(stage.rewards.constructionCredits ?? {}).forEach(([id, amount]) => {
      this.constructionCredits.set(id, this.constructionCreditAmount(id) + amount);
    });
    this.appliedRewardStageIds.add(stageId);
  }

  private instanceContainsItem(instanceId: string, itemId: ItemId): boolean {
    const instance = this.world.instance(instanceId);
    if (!instance) return false;
    return [
      ...Object.values(instance.inputBuffersByPortId).flat(),
      ...Object.values(instance.outputBuffersByPortId).flat(),
      ...instance.workInProgress,
    ].some((stack) => stack.itemId === itemId && stack.amount > 0);
  }
}
