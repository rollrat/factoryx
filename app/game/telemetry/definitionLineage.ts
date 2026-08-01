import type { DefinitionSource } from "../domain/validate.ts";
import { buildLineageGraph, type LineageEdge } from "./lineage.ts";
import { calculateProjectProductionPlan } from "./productionPlanning.ts";
import type { ProductionLineageGraph } from "../../components/ProductionLineageOverlay.tsx";

const STAGE_LABELS: Readonly<Record<string, string>> = {
  phase_1_settlement_package: "기초 정착 패키지",
  phase_2_industrial_power_node: "산업 전력 노드",
  phase_3_automation_core: "자동화 코어",
  phase_4_chemistry_stabilization: "화학 안정화",
  phase_4_thermal_management_verification: "열관리 검증",
  phase_4_colony_seed: "AX-17 개척 시드",
};

const recipeEdges = (edges: readonly LineageEdge[], recipeId: string) => {
  const recipe = edges.filter((edge) => edge.recipeId === recipeId);
  return {
    inputs: recipe.filter((edge) => edge.kind === "input"),
    outputs: recipe.filter((edge) => edge.kind === "output"),
  };
};

/**
 * Adapts the canonical SCC-safe lineage graph to the Production Atlas view and
 * appends project delivery contracts. No screen-specific coordinates or
 * duplicated progression tables are kept here.
 */
export const buildDefinitionLineageGraph = (definitions: DefinitionSource): ProductionLineageGraph => {
  const canonical = buildLineageGraph(definitions);
  const items = new Map(definitions.items.map((item) => [item.id, item]));
  const itemOrder = new Map(definitions.items.map((item, index) => [item.id, index]));

  const nodes: ProductionLineageGraph["nodes"][number][] = canonical.nodes
    .filter((node) => node.kind === "item")
    .map((node) => {
      const item = items.get(node.entityId)!;
      return {
        id: node.id,
        label: node.label,
        kind: item.category === "project" ? "project" : "resource",
        detail: `${item.category.toUpperCase()} · ${item.medium === "fluid" ? "m³" : "개"} · ${item.unlockId}`,
        column: node.column,
        order: node.tier * 10_000 + (itemOrder.get(item.id) ?? 0),
      };
    });

  const maxColumn = Math.max(0, ...nodes.map((node) => node.column ?? 0));
  definitions.projectStages.forEach((stage, index) => {
    const plan = calculateProjectProductionPlan(definitions, stage.id);
    const raw = [...plan.rawRequirements].slice(0, 4)
      .map(([itemId, amount]) => `${items.get(itemId)?.name ?? itemId} ${Number(amount.toFixed(2))}`)
      .join(", ");
    nodes.push({
      id: `stage:${stage.id}`,
      label: STAGE_LABELS[stage.id] ?? stage.id.replaceAll("_", " "),
      kind: "project",
      detail: `${stage.dockPowerMode === "powered" ? `${stage.requiredPowerMW ?? 32} MW` : "수동"} 도크 · 역산 ${plan.machineMinutes.toFixed(1)} 기계-분 · ${raw}`,
      column: maxColumn + 1 + index,
      order: index,
    });
  });

  const edges: ProductionLineageGraph["edges"][number][] = [];
  definitions.recipes.forEach((recipe) => {
    const { inputs, outputs } = recipeEdges(canonical.edges, recipe.id);
    inputs.forEach((input) => outputs.forEach((output, outputIndex) => {
      const outputItem = items.get(output.target.replace(/^item:/, ""));
      edges.push({
        id: `recipe:${recipe.id}:${input.source}>${output.target}:${outputIndex}`,
        from: input.source,
        to: output.target,
        itemName: `${recipe.name} · ${input.amount} → ${output.amount}`,
        medium: outputItem?.medium ?? "solid",
        plannedRatePerMinute: output.amount * 60 / recipe.durationSeconds,
        connected: true,
        beltCount: 0,
        jammed: false,
      });
    }));
  });
  definitions.projectStages.forEach((stage) => stage.deliveries.forEach((delivery) => edges.push({
    id: `delivery:${stage.id}:${delivery.portId}`,
    from: `item:${delivery.itemId}`,
    to: `stage:${stage.id}`,
    itemName: `납품 ${delivery.amount}${delivery.medium === "fluid" ? "m³" : "개"}`,
    medium: delivery.medium,
    connected: true,
    beltCount: 0,
    jammed: false,
  })));

  return { title: "FactoryX 전체 생산 계보", nodes, edges };
};

/** Highlights the active contract and every upstream recipe path feeding it. */
export const highlightLineagePath = (graph: ProductionLineageGraph, stageId: string | null): ProductionLineageGraph => {
  if (!stageId) return graph;
  const target = `stage:${stageId}`;
  const incoming = new Map<string, ProductionLineageGraph["edges"][number][]>();
  graph.edges.forEach((edge) => incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]));
  const highlightedNodes = new Set<string>([target]);
  const highlightedEdges = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    (incoming.get(nodeId) ?? []).forEach((edge) => {
      if (highlightedEdges.has(edge.id)) return;
      highlightedEdges.add(edge.id);
      if (!highlightedNodes.has(edge.from)) {
        highlightedNodes.add(edge.from);
        queue.push(edge.from);
      }
    });
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, highlighted: highlightedNodes.has(node.id) })),
    edges: graph.edges.map((edge) => ({ ...edge, highlighted: highlightedEdges.has(edge.id) })),
  };
};
