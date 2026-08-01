import type { DefinitionRegistry, ItemId, ProjectStageId } from "../domain/types.ts";
import {
  ProjectStageTracker,
  type ProjectDeliveryRequest,
  type ProjectDeliveryResult,
  type ProjectStageProgress,
  type ProjectStageSnapshot,
} from "./project.ts";

export type CampaignSnapshot = Readonly<{
  version: 1;
  stages: readonly ProjectStageSnapshot[];
}>;

export type CampaignDeliveryResult =
  | ProjectDeliveryResult
  | Readonly<{
    accepted: false;
    reason: "unknown_stage" | "stage_locked" | "power_insufficient";
    portId: string;
    requiredPowerMW?: number;
  }>;

/** Data-driven campaign progression over every registered project stage. */
export class CampaignProjectTracker {
  private readonly trackers = new Map<ProjectStageId, ProjectStageTracker>();
  private readonly registry: DefinitionRegistry;

  constructor(registry: DefinitionRegistry, snapshot?: CampaignSnapshot) {
    this.registry = registry;
    registry.projectStages.forEach((definition) => {
      this.trackers.set(definition.id, new ProjectStageTracker(definition));
    });
    if (snapshot) this.restore(snapshot);
  }

  progress(stageId: ProjectStageId): ProjectStageProgress | null {
    return this.trackers.get(stageId)?.progress() ?? null;
  }

  allProgress(): readonly ProjectStageProgress[] {
    return [...this.registry.projectStages.keys()].map((id) => this.trackers.get(id)!.progress());
  }

  isUnlocked(stageId: ProjectStageId): boolean {
    const tracker = this.trackers.get(stageId);
    if (!tracker) return false;
    return tracker.definition.prerequisiteIds.every((id) => this.trackers.get(id)?.progress().completed === true);
  }

  deliver(
    stageId: ProjectStageId,
    request: ProjectDeliveryRequest,
    suppliedPowerMW = 0,
  ): CampaignDeliveryResult {
    const tracker = this.trackers.get(stageId);
    if (!tracker) return { accepted: false, reason: "unknown_stage", portId: request.portId };
    if (!this.isUnlocked(stageId)) return { accepted: false, reason: "stage_locked", portId: request.portId };
    const requiredPowerMW = tracker.definition.dockPowerMode === "powered"
      ? tracker.definition.requiredPowerMW ?? 32
      : 0;
    if (suppliedPowerMW < requiredPowerMW) {
      return { accepted: false, reason: "power_insufficient", portId: request.portId, requiredPowerMW };
    }
    return tracker.deliver(request);
  }

  unlockedResourceIds(): ReadonlySet<ItemId> {
    const unlocked = new Set<ItemId>();
    this.registry.items.forEach((item) => {
      if (item.unlockId === "start" && item.category === "resource") unlocked.add(item.id);
    });
    this.trackers.forEach((tracker) => {
      if (!tracker.progress().completed) return;
      (tracker.definition.rewards.resourceIds ?? []).forEach((id) => unlocked.add(id));
    });
    return unlocked;
  }

  snapshot(): CampaignSnapshot {
    return { version: 1, stages: [...this.trackers.values()].map((tracker) => tracker.snapshot()) };
  }

  restore(snapshot: CampaignSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`unsupported campaign snapshot version: ${snapshot.version}`);
    const seen = new Set<ProjectStageId>();
    snapshot.stages.forEach((stage) => {
      if (seen.has(stage.stageId)) throw new Error(`duplicate campaign stage snapshot: ${stage.stageId}`);
      seen.add(stage.stageId);
      const tracker = this.trackers.get(stage.stageId);
      if (!tracker) throw new Error(`unknown campaign stage snapshot: ${stage.stageId}`);
      tracker.restore(stage);
    });
  }
}
