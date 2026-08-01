import { CAMPAIGN_UNLOCK_STAGE } from "../data/campaign.ts";
import type {
  BuildCost,
  BuildingDefinition,
  BuildingId,
  DefinitionRegistry,
  ItemId,
  ItemStack,
  ProjectStageId,
  UnlockId,
} from "../domain/types.ts";

export type ConstructionInventorySnapshot = Readonly<{
  version: 1;
  items: readonly ItemStack[];
  constructionCredits: readonly Readonly<{ id: string; amount: number }>[];
}>;

export class ConstructionInventory {
  private readonly items = new Map<ItemId, number>();
  private readonly credits = new Map<string, number>();

  constructor(initialItems: readonly ItemStack[] = [], snapshot?: ConstructionInventorySnapshot) {
    initialItems.forEach(({ itemId, amount }) => this.add(itemId, amount));
    if (snapshot) this.restore(snapshot);
  }

  amount(itemId: ItemId): number { return this.items.get(itemId) ?? 0; }
  creditAmount(id: string): number { return this.credits.get(id) ?? 0; }
  canAfford(cost: readonly BuildCost[]): boolean {
    return cost.every(({ itemId, amount }) => this.amount(itemId) >= amount);
  }

  spend(cost: readonly BuildCost[]): boolean {
    if (!this.canAfford(cost)) return false;
    cost.forEach(({ itemId, amount }) => this.set(itemId, this.amount(itemId) - amount));
    return true;
  }

  refund(cost: readonly BuildCost[], ratio = 1): void {
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError("refund ratio must be between 0 and 1");
    cost.forEach(({ itemId, amount }) => this.add(itemId, amount * ratio));
  }

  add(itemId: ItemId, amount: number): void {
    this.assertAmount(amount);
    this.set(itemId, this.amount(itemId) + amount);
  }

  addConstructionCredits(values: Readonly<Record<string, number>>): void {
    Object.entries(values).forEach(([id, amount]) => {
      this.assertAmount(amount);
      this.credits.set(id, this.creditAmount(id) + amount);
    });
  }

  spendConstructionCredit(id: string, amount: number): boolean {
    this.assertAmount(amount);
    if (this.creditAmount(id) < amount) return false;
    this.credits.set(id, this.creditAmount(id) - amount);
    return true;
  }

  snapshot(): ConstructionInventorySnapshot {
    return {
      version: 1,
      items: [...this.items].map(([itemId, amount]) => ({ itemId, amount })),
      constructionCredits: [...this.credits].map(([id, amount]) => ({ id, amount })),
    };
  }

  restore(snapshot: ConstructionInventorySnapshot): void {
    if (snapshot.version !== 1) throw new Error(`unsupported construction inventory version: ${snapshot.version}`);
    const items = new Map<ItemId, number>();
    snapshot.items.forEach(({ itemId, amount }) => {
      this.assertAmount(amount);
      if (items.has(itemId)) throw new Error(`duplicate construction inventory item: ${itemId}`);
      if (amount > 0) items.set(itemId, amount);
    });
    const credits = new Map<string, number>();
    snapshot.constructionCredits.forEach(({ id, amount }) => {
      this.assertAmount(amount);
      if (credits.has(id)) throw new Error(`duplicate construction credit: ${id}`);
      if (amount > 0) credits.set(id, amount);
    });
    this.items.clear();
    items.forEach((amount, itemId) => this.items.set(itemId, amount));
    this.credits.clear();
    credits.forEach((amount, id) => this.credits.set(id, amount));
  }

  private set(itemId: ItemId, amount: number): void {
    this.assertAmount(amount);
    if (amount === 0) this.items.delete(itemId);
    else this.items.set(itemId, amount);
  }

  private assertAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError("inventory amount must be finite and non-negative");
  }
}

export class CampaignUnlocks {
  private readonly completedStages = new Set<ProjectStageId>();
  private readonly mode: "campaign" | "sandbox";

  constructor(mode: "campaign" | "sandbox" = "campaign") { this.mode = mode; }

  complete(stageId: ProjectStageId): void { this.completedStages.add(stageId); }
  isStageComplete(stageId: ProjectStageId): boolean { return this.completedStages.has(stageId); }

  isUnlockAvailable(unlockId: UnlockId): boolean {
    if (this.mode === "sandbox") return true;
    if (unlockId === "start") return true;
    const stageId = CAMPAIGN_UNLOCK_STAGE[unlockId];
    return stageId !== undefined && this.completedStages.has(stageId);
  }

  snapshot(): readonly ProjectStageId[] { return [...this.completedStages].sort(); }
}

export type ConstructionResult =
  | Readonly<{ ok: true; building: BuildingDefinition }>
  | Readonly<{ ok: false; reason: "unknown_building" | "not_buildable" | "locked" | "insufficient_materials"; buildingId: BuildingId }>;

export class ConstructionService {
  private readonly registry: DefinitionRegistry;
  private readonly unlocks: CampaignUnlocks;
  private readonly inventory: ConstructionInventory;

  constructor(
    registry: DefinitionRegistry,
    unlocks: CampaignUnlocks,
    inventory: ConstructionInventory,
  ) {
    this.registry = registry;
    this.unlocks = unlocks;
    this.inventory = inventory;
  }

  construct(buildingId: BuildingId): ConstructionResult {
    const building = this.registry.buildings.get(buildingId);
    if (!building) return { ok: false, reason: "unknown_building", buildingId };
    if (building.placementMode !== "buildable") return { ok: false, reason: "not_buildable", buildingId };
    if (!this.unlocks.isUnlockAvailable(building.unlockId)) return { ok: false, reason: "locked", buildingId };
    if (!this.inventory.spend(building.buildCost)) return { ok: false, reason: "insufficient_materials", buildingId };
    return { ok: true, building };
  }

  demolish(buildingId: BuildingId, refundRatio = 1): boolean {
    const building = this.registry.buildings.get(buildingId);
    if (!building || building.placementMode !== "buildable") return false;
    this.inventory.refund(building.buildCost, refundRatio);
    return true;
  }
}
