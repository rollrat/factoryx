import { START_REGISTRY } from "../data/index.ts";
import type {
  ItemId,
  PortId,
  ProjectStageDefinition,
  ProjectStageId,
} from "../domain/types.ts";

export const PHASE_ONE_PROJECT_ID = "phase_1_settlement_package";

export type ProjectDeliveryRequest = Readonly<{
  portId: PortId;
  itemId: ItemId;
  amount: number;
}>;

export type ProjectDeliveryResult =
  | Readonly<{ accepted: true; portId: PortId; itemId: ItemId; amount: number; remaining: number; completed: boolean }>
  | Readonly<{
    accepted: false;
    reason: "unknown_port" | "item_mismatch" | "invalid_amount" | "exceeds_requirement" | "stage_complete";
    portId: PortId;
    remaining?: number;
  }>;

export type ProjectStageSnapshot = Readonly<{
  stageId: ProjectStageId;
  delivered: readonly Readonly<{ portId: PortId; itemId: ItemId; amount: number }>[];
  completedCycles?: number;
}>;

export type ProjectDeliveryProgress = Readonly<{
  portId: PortId;
  itemId: ItemId;
  required: number;
  delivered: number;
  remaining: number;
  progress: number;
  completed: boolean;
  completedCycles: number;
  repeatable: boolean;
}>;

export type ProjectStageProgress = Readonly<{
  stageId: ProjectStageId;
  deliveries: readonly ProjectDeliveryProgress[];
  requiredTotal: number;
  deliveredTotal: number;
  totalProgress: number;
  completed: boolean;
}>;

const requiredPhaseOne = () => {
  const stage = START_REGISTRY.projectStages.get(PHASE_ONE_PROJECT_ID);
  if (!stage) throw new Error(`missing start project stage: ${PHASE_ONE_PROJECT_ID}`);
  return stage;
};

/** Deterministic, serializable cumulative delivery state for one project stage. */
export class ProjectStageTracker {
  readonly definition: ProjectStageDefinition;
  private readonly deliveredByPort = new Map<PortId, number>();
  private completedCycles = 0;

  constructor(definition: ProjectStageDefinition, snapshot?: ProjectStageSnapshot) {
    this.definition = definition;
    definition.deliveries.forEach(({ portId }) => this.deliveredByPort.set(portId, 0));
    if (snapshot) this.restore(snapshot);
  }

  deliver(request: ProjectDeliveryRequest): ProjectDeliveryResult {
    const requirement = this.definition.deliveries.find(({ portId }) => portId === request.portId);
    if (!requirement) return { accepted: false, reason: "unknown_port", portId: request.portId };
    const remaining = requirement.amount - (this.deliveredByPort.get(request.portId) ?? 0);
    if (this.progress().completed) {
      return { accepted: false, reason: "stage_complete", portId: request.portId, remaining };
    }
    if (request.itemId !== requirement.itemId) {
      return { accepted: false, reason: "item_mismatch", portId: request.portId, remaining };
    }
    const validSolidAmount = requirement.medium !== "solid" || Number.isSafeInteger(request.amount);
    if (!Number.isFinite(request.amount) || request.amount <= 0 || !validSolidAmount) {
      return { accepted: false, reason: "invalid_amount", portId: request.portId, remaining };
    }
    if (request.amount > remaining) {
      return { accepted: false, reason: "exceeds_requirement", portId: request.portId, remaining };
    }

    this.deliveredByPort.set(request.portId, requirement.amount - (remaining - request.amount));
    const completed = this.progress().completed;
    if (completed) this.completedCycles += 1;
    return {
      accepted: true,
      portId: request.portId,
      itemId: request.itemId,
      amount: request.amount,
      remaining: remaining - request.amount,
      completed,
    };
  }

  progress(): ProjectStageProgress {
    const deliveries = this.definition.deliveries.map((requirement) => {
      const delivered = this.deliveredByPort.get(requirement.portId) ?? 0;
      const remaining = requirement.amount - delivered;
      return {
        portId: requirement.portId,
        itemId: requirement.itemId,
        required: requirement.amount,
        delivered,
        remaining,
        progress: requirement.amount === 0 ? 1 : delivered / requirement.amount,
        completed: remaining === 0,
      };
    });
    const requiredTotal = deliveries.reduce((total, delivery) => total + delivery.required, 0);
    const deliveredTotal = deliveries.reduce((total, delivery) => total + delivery.delivered, 0);
    return {
      stageId: this.definition.id,
      deliveries,
      requiredTotal,
      deliveredTotal,
      totalProgress: requiredTotal === 0 ? 1 : deliveredTotal / requiredTotal,
      completed: deliveries.every((delivery) => delivery.completed),
      completedCycles: this.completedCycles,
      repeatable: this.definition.repeatable === true,
    };
  }

  snapshot(): ProjectStageSnapshot {
    return {
      stageId: this.definition.id,
      delivered: this.definition.deliveries.map((requirement) => ({
        portId: requirement.portId,
        itemId: requirement.itemId,
        amount: this.deliveredByPort.get(requirement.portId) ?? 0,
      })),
      completedCycles: this.completedCycles,
    };
  }

  restartRepeatableCycle(): boolean {
    if (!this.definition.repeatable || !this.progress().completed) return false;
    this.deliveredByPort.forEach((_amount, portId) => this.deliveredByPort.set(portId, 0));
    return true;
  }

  restore(snapshot: ProjectStageSnapshot) {
    if (snapshot.stageId !== this.definition.id) throw new Error("project snapshot stage id does not match");
    const seen = new Set<PortId>();
    snapshot.delivered.forEach((entry) => {
      if (seen.has(entry.portId)) throw new Error(`duplicate project snapshot port: ${entry.portId}`);
      seen.add(entry.portId);
      const requirement = this.definition.deliveries.find(({ portId }) => portId === entry.portId);
      if (!requirement) throw new Error(`unknown project snapshot port: ${entry.portId}`);
      if (entry.itemId !== requirement.itemId) throw new Error(`project snapshot item mismatch at ${entry.portId}`);
      const validSolidAmount = requirement.medium !== "solid" || Number.isSafeInteger(entry.amount);
      if (!Number.isFinite(entry.amount) || entry.amount < 0 || entry.amount > requirement.amount || !validSolidAmount) {
        throw new RangeError(`invalid project snapshot amount at ${entry.portId}`);
      }
      this.deliveredByPort.set(entry.portId, entry.amount);
    });
    const completedCycles = snapshot.completedCycles ?? (this.progress().completed ? 1 : 0);
    if (!Number.isSafeInteger(completedCycles) || completedCycles < 0) throw new RangeError("invalid project completed cycle count");
    this.completedCycles = completedCycles;
  }
}

export const createPhaseOneProject = (snapshot?: ProjectStageSnapshot) => (
  new ProjectStageTracker(requiredPhaseOne(), snapshot)
);
