import type { DefinitionSource } from "../domain/validate.ts";
import type { LineageGraph } from "./lineage.ts";
import type { LiveFactoryTelemetry, LiveRuntimeState } from "./live.ts";

export type LineageViewStatus = LiveRuntimeState | "storing";

export type LineageView = Readonly<{
  graph: Readonly<{
    title: string;
    nodes: readonly Readonly<{
      id: string;
      label: string;
      kind: "resource" | "building" | "storage" | "project";
      detail?: string;
    }>[];
    edges: readonly Readonly<{
      id: string;
      from: string;
      to: string;
      itemName: string;
      medium: "solid" | "fluid";
      plannedRatePerMinute?: number;
    }>[];
  }>;
  live: Readonly<{
    nodeStates: Readonly<Record<string, Readonly<{
      status: LineageViewStatus;
      actualRatePerMinute?: number;
      stock?: number;
      capacity?: number;
      progress?: number;
    }> | undefined>>;
    updatedAt: number;
  }>;
}>;

const STATUS_PRIORITY: readonly LiveRuntimeState[] = [
  "blocked",
  "disconnected",
  "starved",
  "working",
  "idle",
];

const dominantStatus = (states: Readonly<Record<LiveRuntimeState, number>>): LiveRuntimeState =>
  STATUS_PRIORITY.find((status) => states[status] > 0) ?? "idle";

export function buildLineageView(
  graph: LineageGraph,
  definitions: DefinitionSource,
  telemetry: LiveFactoryTelemetry | null,
): LineageView {
  const items = new Map(definitions.items.map((item) => [item.id, item]));
  const buildings = new Map(definitions.buildings.map((building) => [building.id, building]));
  const recipes = new Map(definitions.recipes.map((recipe) => [recipe.id, recipe]));
  const nodeStates: Record<string, {
    status: LineageViewStatus;
    actualRatePerMinute?: number;
    stock?: number;
    capacity?: number;
    progress?: number;
  }> = {};

  graph.nodes.forEach((node) => {
    if (node.kind === "item") {
      const stock = telemetry?.itemStocks[node.entityId] ?? 0;
      nodeStates[node.id] = { status: stock > 0 ? "storing" : "idle", stock };
      return;
    }

    if (!telemetry) {
      nodeStates[node.id] = { status: "idle" };
      return;
    }
    if (node.entityId === telemetry.belts.buildingId) {
      nodeStates[node.id] = {
        status: telemetry.belts.jammed > 0 ? "blocked" : telemetry.belts.moving > 0 ? "working" : "idle",
        stock: telemetry.belts.itemsInTransit,
        capacity: telemetry.belts.count,
        progress: telemetry.belts.averageProgress,
      };
      return;
    }
    const aggregate = Object.values(telemetry.byType).find((entry) => entry.buildingId === node.entityId);
    if (!aggregate || aggregate.count === 0) {
      nodeStates[node.id] = { status: "idle" };
      return;
    }
    const buildingRecipes = definitions.recipes.filter((recipe) => recipe.buildingId === node.entityId);
    const peakRate = buildingRecipes.reduce((highest, recipe) => {
      const output = recipe.outputs.reduce((total, amount) => total + amount.amount, 0);
      return Math.max(highest, output / recipe.durationSeconds * 60);
    }, 0);
    const status = node.entityId === "small_storage" && aggregate.storedItems > 0 && aggregate.states.blocked === 0
      ? "storing"
      : dominantStatus(aggregate.states);
    nodeStates[node.id] = {
      status,
      actualRatePerMinute: peakRate * aggregate.states.working,
      stock: aggregate.inputItems + aggregate.outputItems + aggregate.storedItems,
      ...(node.entityId === "small_storage" ? { capacity: aggregate.count * 400 } : {}),
      progress: aggregate.averageProgress,
    };
  });

  return {
    graph: {
      title: "공장 전체 생산 계보",
      nodes: graph.nodes.map((node) => {
        if (node.kind === "item") {
          const item = items.get(node.entityId);
          return {
            id: node.id,
            label: node.label,
            kind: "resource" as const,
            detail: item ? `${item.category.toUpperCase()} · STACK ${item.stackSize}` : undefined,
          };
        }
        const building = buildings.get(node.entityId);
        return {
          id: node.id,
          label: node.label,
          kind: node.entityId === "small_storage"
            ? "storage" as const
            : node.entityId === "project_dock"
              ? "project" as const
              : "building" as const,
          detail: building ? `${building.recipeIds.length}개 공정 · ${building.footprint.x}×${building.footprint.z}` : undefined,
        };
      }),
      edges: graph.edges.map((edge) => {
        const recipe = recipes.get(edge.recipeId);
        const itemNode = graph.nodeById.get(edge.kind === "input" ? edge.source : edge.target);
        return {
          id: edge.id,
          from: edge.source,
          to: edge.target,
          itemName: itemNode?.label ?? "품목",
          medium: "solid" as const,
          plannedRatePerMinute: recipe ? edge.amount / recipe.durationSeconds * 60 : undefined,
        };
      }),
    },
    live: { nodeStates, updatedAt: Date.now() },
  };
}
