import type {
  BuildingDefinition,
  ItemDefinition,
  UnlockId,
} from "../domain/types.ts";
import type { DefinitionSource } from "../domain/validate.ts";

export type LineageNodeKind = "item" | "building";

export type LineageNode = Readonly<{
  id: string;
  entityId: string;
  kind: LineageNodeKind;
  label: string;
  category: ItemDefinition["category"] | "building";
  unlockId: UnlockId;
  tier: number;
  column: number;
}>;

export type LineageEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  kind: "input" | "output";
  amount: number;
  recipeId: string;
}>;

export type LineageGraph = Readonly<{
  nodes: readonly LineageNode[];
  edges: readonly LineageEdge[];
  nodeById: ReadonlyMap<string, LineageNode>;
}>;

const UNLOCK_ORDER: readonly UnlockId[] = [
  "start",
  "phase_1_complete",
  "phase_2_complete",
  "phase_3_complete",
  "chemistry_stable",
  "thermal_verified",
];

const unlockTier = new Map<UnlockId, number>(UNLOCK_ORDER.map((unlockId, index) => [unlockId, index]));

export const itemNodeId = (itemId: string) => `item:${itemId}`;
export const buildingNodeId = (buildingId: string) => `building:${buildingId}`;

type MutableNode = Omit<LineageNode, "column"> & { column: number };

const itemNode = (item: ItemDefinition): MutableNode => ({
  id: itemNodeId(item.id),
  entityId: item.id,
  kind: "item",
  label: item.name,
  category: item.category,
  unlockId: item.unlockId,
  tier: unlockTier.get(item.unlockId) ?? UNLOCK_ORDER.length,
  column: 0,
});

const buildingNode = (building: BuildingDefinition): MutableNode => ({
  id: buildingNodeId(building.id),
  entityId: building.id,
  kind: "building",
  label: building.name,
  category: "building",
  unlockId: building.unlockId,
  tier: unlockTier.get(building.unlockId) ?? UNLOCK_ORDER.length,
  column: 0,
});

/** Tarjan SCC condensation keeps column layout finite even for recipe loops. */
const computeColumns = (nodeIds: readonly string[], edges: readonly LineageEdge[]) => {
  const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  edges.forEach((edge) => adjacency.get(edge.source)?.add(edge.target));

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (nodeId: string) => {
    const nodeIndex = nextIndex;
    nextIndex += 1;
    indices.set(nodeId, nodeIndex);
    lowLinks.set(nodeId, nodeIndex);
    stack.push(nodeId);
    onStack.add(nodeId);

    adjacency.get(nodeId)?.forEach((targetId) => {
      if (!indices.has(targetId)) {
        connect(targetId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(targetId)!));
      }
    });

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== nodeId);
    components.push(component);
  };

  nodeIds.forEach((nodeId) => {
    if (!indices.has(nodeId)) connect(nodeId);
  });

  const componentFor = new Map<string, number>();
  components.forEach((component, componentId) => {
    component.forEach((nodeId) => componentFor.set(nodeId, componentId));
  });
  const outgoing = new Map(components.map((_, componentId) => [componentId, new Set<number>()]));
  const indegree = new Map(components.map((_, componentId) => [componentId, 0]));
  edges.forEach((edge) => {
    const source = componentFor.get(edge.source);
    const target = componentFor.get(edge.target);
    if (source === undefined || target === undefined || source === target || outgoing.get(source)?.has(target)) return;
    outgoing.get(source)!.add(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  });

  const componentColumn = new Map<number, number>();
  const queue = components
    .map((_, componentId) => componentId)
    .filter((componentId) => indegree.get(componentId) === 0)
    .sort((a, b) => a - b);
  queue.forEach((componentId) => componentColumn.set(componentId, 0));
  while (queue.length > 0) {
    const source = queue.shift()!;
    const sourceColumn = componentColumn.get(source) ?? 0;
    [...(outgoing.get(source) ?? [])].sort((a, b) => a - b).forEach((target) => {
      componentColumn.set(target, Math.max(componentColumn.get(target) ?? 0, sourceColumn + 1));
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    });
    queue.sort((a, b) => a - b);
  }

  return new Map(nodeIds.map((nodeId) => [nodeId, componentColumn.get(componentFor.get(nodeId)!) ?? 0]));
};

/**
 * Builds one integrated item/building graph. Invalid references are skipped so
 * telemetry can still render diagnostics for a partial or forward-compatible
 * definition set; the domain validator remains responsible for rejecting it.
 */
export function buildLineageGraph(definitions: DefinitionSource): LineageGraph {
  const mutableNodes = new Map<string, MutableNode>();
  definitions.items.forEach((item) => mutableNodes.set(itemNodeId(item.id), itemNode(item)));
  definitions.buildings.forEach((building) => mutableNodes.set(buildingNodeId(building.id), buildingNode(building)));

  const edges: LineageEdge[] = [];
  definitions.recipes.forEach((recipe, recipeIndex) => {
    const machineId = buildingNodeId(recipe.buildingId);
    if (!mutableNodes.has(machineId)) return;
    recipe.inputs.forEach((input, amountIndex) => {
      const source = itemNodeId(input.itemId);
      if (!mutableNodes.has(source)) return;
      edges.push({
        id: `recipe:${recipe.id}:${recipeIndex}:input:${amountIndex}`,
        source,
        target: machineId,
        kind: "input",
        amount: input.amount,
        recipeId: recipe.id,
      });
    });
    recipe.outputs.forEach((output, amountIndex) => {
      const target = itemNodeId(output.itemId);
      if (!mutableNodes.has(target)) return;
      edges.push({
        id: `recipe:${recipe.id}:${recipeIndex}:output:${amountIndex}`,
        source: machineId,
        target,
        kind: "output",
        amount: output.amount,
        recipeId: recipe.id,
      });
    });
  });

  const columns = computeColumns([...mutableNodes.keys()], edges);
  const nodes = [...mutableNodes.values()].map((node) => Object.freeze({
    ...node,
    column: columns.get(node.id) ?? 0,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return { nodes, edges, nodeById };
}

