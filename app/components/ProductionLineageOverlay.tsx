"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import "../production-lineage.css";

export type ProductionLineageStatus =
  | "working" | "partial" | "storing" | "starved" | "blocked" | "disconnected" | "paused" | "idle";

export type ProductionLineageNode = Readonly<{
  id: string;
  label: string;
  kind: "resource" | "building" | "storage" | "project";
  detail?: string;
  column?: number;
  order?: number;
  instanceLabel?: string;
  highlighted?: boolean;
}>;

export type ProductionLineageEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  itemName: string;
  medium?: "solid" | "fluid" | "power";
  plannedRatePerMinute?: number;
  connected?: boolean;
  beltCount?: number;
  jammed?: boolean;
  highlighted?: boolean;
}>;

export type ProductionLineageGraph = Readonly<{
  title?: string;
  nodes: readonly ProductionLineageNode[];
  edges: readonly ProductionLineageEdge[];
}>;

export type ProductionLineageNodeLiveState = Readonly<{
  status: ProductionLineageStatus;
  actualRatePerMinute?: number;
  stock?: number;
  capacity?: number;
  progress?: number;
}>;

export type ProductionLineageLiveSnapshot = Readonly<{
  nodeStates: Readonly<Record<string, ProductionLineageNodeLiveState | undefined>>;
  updatedAt?: string | number | Date;
}>;

export type LineageMode = "lineage" | "factory" | "power";
export type LineageLayout = "graph" | "list";
export type NavigationDirection = "left" | "right" | "up" | "down";
export type GraphViewport = Readonly<{ x: number; y: number; scale: number }>;

export type ProductionLineageOverlayProps = Readonly<{
  open: boolean;
  onClose: () => void;
  graph: ProductionLineageGraph;
  definitionGraph?: ProductionLineageGraph;
  live: ProductionLineageLiveSnapshot;
  definitionLive?: ProductionLineageLiveSnapshot;
  initialMode?: LineageMode;
  onWorldFocus?: (nodeId: string) => void;
  onCycleRecipe?: (nodeId: string) => void;
}>;

const STATUS_LABEL: Record<ProductionLineageStatus, string> = {
  working: "가동", partial: "부분 가동", storing: "저장", starved: "원료 부족", blocked: "출력 막힘",
  disconnected: "연결 끊김", paused: "일시 정지", idle: "대기",
};
const KIND_LABEL: Record<ProductionLineageNode["kind"], string> = {
  resource: "RESOURCE", building: "FACILITY", storage: "STORAGE", project: "PROJECT",
};
const MODE_LABEL: Record<LineageMode, Readonly<{ label: string; eyebrow: string; description: string }>> = {
  lineage: { label: "계보", eyebrow: "MATERIAL LINEAGE", description: "현재 공장에 존재하는 품목 흐름" },
  factory: { label: "공장 현황", eyebrow: "LIVE FACTORY", description: "실제 설치 설비와 물리 연결" },
  power: { label: "전력망", eyebrow: "POWER GRID", description: "실제 전력 연결 요소" },
};
const MODE_ORDER: readonly LineageMode[] = ["lineage", "factory", "power"];
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.8;

export const zoomViewportAtPoint = (
  viewport: GraphViewport,
  point: Readonly<{ x: number; y: number }>,
  requestedScale: number,
): GraphViewport => {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: point.x - (point.x - viewport.x) * ratio,
    y: point.y - (point.y - viewport.y) * ratio,
  };
};

export const adjacentLineageNodeId = (
  nodes: readonly ProductionLineageNode[],
  currentId: string,
  direction: NavigationDirection,
  edges: readonly ProductionLineageEdge[] = [],
): string | null => {
  const derived = edges.length > 0 ? groupNodesByColumn(nodes, edges) : [];
  const coordinates = new Map<string, Readonly<{ column: number; row: number }>>();
  derived.forEach(([column, columnNodes]) => columnNodes.forEach((node, row) => coordinates.set(node.id, { column, row })));
  nodes.forEach((node) => {
    if (!coordinates.has(node.id)) coordinates.set(node.id, { column: node.column ?? 0, row: node.order ?? 0 });
  });
  const ordered = [...nodes].sort((a, b) => (coordinates.get(a.id)?.column ?? 0) - (coordinates.get(b.id)?.column ?? 0)
    || (coordinates.get(a.id)?.row ?? 0) - (coordinates.get(b.id)?.row ?? 0) || a.label.localeCompare(b.label, "ko"));
  const current = ordered.find((node) => node.id === currentId);
  if (!current) return ordered[0]?.id ?? null;
  const column = coordinates.get(current.id)?.column ?? 0;
  const row = coordinates.get(current.id)?.row ?? 0;
  if (direction === "up" || direction === "down") {
    const peers = ordered.filter((node) => (coordinates.get(node.id)?.column ?? 0) === column);
    const index = peers.findIndex((node) => node.id === currentId);
    return peers[index + (direction === "up" ? -1 : 1)]?.id ?? currentId;
  }
  const candidateColumns = [...new Set(ordered.map((node) => coordinates.get(node.id)?.column ?? 0))]
    .filter((candidate) => direction === "left" ? candidate < column : candidate > column)
    .sort((a, b) => direction === "left" ? b - a : a - b);
  const targetColumn = candidateColumns[0];
  if (targetColumn === undefined) return currentId;
  return ordered.filter((node) => (coordinates.get(node.id)?.column ?? 0) === targetColumn)
    .sort((a, b) => Math.abs((coordinates.get(a.id)?.row ?? 0) - row) - Math.abs((coordinates.get(b.id)?.row ?? 0) - row)
      || (coordinates.get(a.id)?.row ?? 0) - (coordinates.get(b.id)?.row ?? 0))[0]?.id ?? currentId;
};

export const toggleComparedNode = (ids: readonly string[], nodeId: string): readonly string[] => {
  if (ids.includes(nodeId)) return ids.filter((id) => id !== nodeId);
  return [...ids.slice(-1), nodeId];
};

type GraphFilter = "all" | "facility" | "item" | "problem";
const FILTER_LABEL: Record<GraphFilter, string> = { all: "전체", facility: "설비", item: "품목", problem: "문제" };

const formatRate = (value?: number) => Number.isFinite(value) ? `${value!.toLocaleString("ko-KR")} /분` : "—";
const formatUpdatedAt = (value?: string | number | Date) => {
  if (value === undefined) return "실시간 연결";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "실시간 연결" : `${date.toLocaleTimeString("ko-KR")} 갱신`;
};
const effectiveStatus = (
  node: ProductionLineageNode,
  live: ProductionLineageLiveSnapshot,
  disconnectedIds: ReadonlySet<string>,
): ProductionLineageStatus => live.nodeStates[node.id]?.status ?? (disconnectedIds.has(node.id) ? "disconnected" : "idle");

const edgeState = (edge: ProductionLineageEdge) => {
  if (edge.connected === false) return { key: "disconnected", label: "끊김" } as const;
  if (edge.jammed) return { key: "jammed", label: "막힘" } as const;
  if (edge.medium === "power") return { key: "connected", label: "전력 연결" } as const;
  if (edge.medium === "fluid") return { key: "connected", label: "파이프 연결" } as const;
  return { key: "connected", label: edge.beltCount === undefined ? "연결됨" : `벨트 ${edge.beltCount}칸` } as const;
};

/** Derives each mode only from supplied runtime topology; it never synthesizes definitions or facilities. */
export const graphForLineageMode = (graph: ProductionLineageGraph, mode: LineageMode): ProductionLineageGraph => {
  if (mode === "factory") return graph;
  const edges = graph.edges.filter((edge) => mode === "power" ? edge.medium === "power" : edge.medium !== "power");
  const referenced = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = graph.nodes.filter((node) => referenced.has(node.id));
  return { title: graph.title, nodes, edges };
};

const groupNodesByColumn = (nodes: readonly ProductionLineageNode[], edges: readonly ProductionLineageEdge[]) => {
  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const explicit = new Set(uniqueNodes.filter((node) => node.column !== undefined).map((node) => node.id));
  const columns = new Map(uniqueNodes.map((node) => [node.id, node.column]));
  const incomingCount = new Map(uniqueNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(uniqueNodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (!incomingCount.has(edge.to) || !outgoing.has(edge.from)) return;
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });
  const queue = uniqueNodes.filter((node) => incomingCount.get(node.id) === 0).map((node) => node.id);
  queue.forEach((id) => { if (columns.get(id) === undefined) columns.set(id, 0); });
  while (queue.length > 0) {
    const sourceId = queue.shift()!;
    const sourceColumn = columns.get(sourceId) ?? 0;
    outgoing.get(sourceId)?.forEach((targetId) => {
      if (!explicit.has(targetId)) columns.set(targetId, Math.max(columns.get(targetId) ?? 0, sourceColumn + 1));
      incomingCount.set(targetId, (incomingCount.get(targetId) ?? 1) - 1);
      if (incomingCount.get(targetId) === 0) queue.push(targetId);
    });
  }
  const grouped = new Map<number, ProductionLineageNode[]>();
  uniqueNodes.forEach((node) => {
    const column = Math.max(0, columns.get(node.id) ?? 0);
    grouped.set(column, [...(grouped.get(column) ?? []), node]);
  });
  grouped.forEach((columnNodes) => columnNodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, "ko")));
  return [...grouped.entries()].sort(([a], [b]) => a - b);
};

function EdgeSummary({ edge, peer, direction }: Readonly<{
  edge: ProductionLineageEdge;
  peer?: ProductionLineageNode;
  direction: "input" | "output";
}>) {
  const state = edgeState(edge);
  return (
    <li className={`factory-edge factory-edge-${state.key} ${edge.highlighted ? "is-highlighted" : ""}`}>
      <i aria-hidden="true" />
      <div><span>{direction === "input" ? "←" : "→"} {peer?.instanceLabel ?? peer?.label ?? "알 수 없는 설비"}</span><strong>{edge.itemName}</strong></div>
      <em>{state.label}</em>
    </li>
  );
}

function FactoryNodeCard({ node, live, inputs, outputs, nodeById, bottleneck, disconnected, selected, compared, nodeRef, onSelect, onFocusRequest }: Readonly<{
  node: ProductionLineageNode;
  live?: ProductionLineageNodeLiveState;
  inputs: readonly ProductionLineageEdge[];
  outputs: readonly ProductionLineageEdge[];
  nodeById: ReadonlyMap<string, ProductionLineageNode>;
  bottleneck: boolean;
  disconnected: boolean;
  selected: boolean;
  compared: boolean;
  nodeRef: (element: HTMLElement | null) => void;
  onSelect: (shiftKey: boolean) => void;
  onFocusRequest: (direction: NavigationDirection | "center") => void;
}>) {
  const status = live?.status ?? (disconnected ? "disconnected" : "idle");
  const progress = Number.isFinite(live?.progress) ? Math.max(0, Math.min(100, (live?.progress ?? 0) * 100)) : null;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const direction: Partial<Record<string, NavigationDirection>> = {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    };
    if (direction[event.key]) {
      event.preventDefault();
      onFocusRequest(direction[event.key]!);
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      onFocusRequest("center");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(event.shiftKey);
    }
  };
  return (
    <article
      ref={nodeRef}
      className={`factory-node factory-node-${node.kind} factory-status-${status} ${node.highlighted ? "is-highlighted" : ""} ${bottleneck ? "is-bottleneck" : ""} ${disconnected ? "is-disconnected" : ""} ${selected ? "is-selected" : ""} ${compared ? "is-compared" : ""}`}
      role="button"
      data-node-id={node.id}
      tabIndex={0}
      aria-pressed={selected}
      aria-describedby={compared ? "factory-comparison-status" : undefined}
      aria-label={`${node.instanceLabel ?? node.label}, ${STATUS_LABEL[status]}, 상세 보기`}
      onClick={(event) => onSelect(event.shiftKey)}
      onDoubleClick={() => onFocusRequest("center")}
      onKeyDown={handleKeyDown}
    >
      <header><span>{KIND_LABEL[node.kind]}</span><em><i aria-hidden="true" />{STATUS_LABEL[status]}</em></header>
      {node.instanceLabel ? <div className="factory-instance">{node.instanceLabel}</div> : null}
      <h3>{node.label}</h3>
      {node.detail ? <p>{node.detail}</p> : null}
      {bottleneck || disconnected ? <div className="factory-node-alerts" aria-label="문제 상태">
        {bottleneck ? <span className="is-bottleneck">병목</span> : null}
        {disconnected ? <span className="is-disconnected">연결 끊김</span> : null}
      </div> : null}
      <dl className="factory-node-metrics">
        <div><dt>실측</dt><dd>{formatRate(live?.actualRatePerMinute)}</dd></div>
        {live?.stock !== undefined ? <div><dt>재고</dt><dd>{live.stock.toLocaleString("ko-KR")}{live.capacity !== undefined ? ` / ${live.capacity.toLocaleString("ko-KR")}` : ""}</dd></div> : null}
      </dl>
      {progress !== null ? <div className="factory-node-progress" role="progressbar" aria-label={`${node.label} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div> : null}
      <div className="factory-node-ports">
        <section aria-label={`${node.label} 입력 연결`}><h4>INPUT <b>{inputs.length}</b></h4>{inputs.length > 0 ? <ul>{inputs.map((edge) => <EdgeSummary key={edge.id} edge={edge} peer={nodeById.get(edge.from)} direction="input" />)}</ul> : <p>직접 공급 또는 입력 없음</p>}</section>
        <section aria-label={`${node.label} 출력 연결`}><h4>OUTPUT <b>{outputs.length}</b></h4>{outputs.length > 0 ? <ul>{outputs.map((edge) => <EdgeSummary key={edge.id} edge={edge} peer={nodeById.get(edge.to)} direction="output" />)}</ul> : <p>최종 소비처 또는 출력 없음</p>}</section>
      </div>
    </article>
  );
}

function NodeDetail({ node, live, inputs, outputs, nodeById, onClear, onWorldFocus, onCycleRecipe }: Readonly<{
  node?: ProductionLineageNode;
  live?: ProductionLineageNodeLiveState;
  inputs: readonly ProductionLineageEdge[];
  outputs: readonly ProductionLineageEdge[];
  nodeById: ReadonlyMap<string, ProductionLineageNode>;
  onClear: () => void;
  onWorldFocus?: (nodeId: string) => void;
  onCycleRecipe?: (nodeId: string) => void;
}>) {
  if (!node) return <aside className="factory-node-detail is-empty" aria-label="선택 설비 상세"><span>NODE DETAIL</span><strong>노드를 선택하세요</strong><p>실제 설비의 상태와 연결 정보를 확인할 수 있습니다.</p></aside>;
  return (
    <aside className="factory-node-detail" aria-label={`${node.label} 상세`}>
      <header><span>NODE DETAIL</span><button type="button" onClick={onClear} aria-label="선택 해제">×</button></header>
      <em>{node.instanceLabel ?? KIND_LABEL[node.kind]}</em><h3>{node.label}</h3>
      {node.detail ? <p>{node.detail}</p> : null}
      <dl>
        <div><dt>상태</dt><dd>{STATUS_LABEL[live?.status ?? "idle"]}</dd></div>
        <div><dt>실측 처리량</dt><dd>{formatRate(live?.actualRatePerMinute)}</dd></div>
        {live?.stock !== undefined ? <div><dt>재고</dt><dd>{live.stock.toLocaleString("ko-KR")}{live.capacity === undefined ? "" : ` / ${live.capacity.toLocaleString("ko-KR")}`}</dd></div> : null}
        <div><dt>입력 / 출력</dt><dd>{inputs.length} / {outputs.length}</dd></div>
      </dl>
      {node.id.startsWith("world:") && (onWorldFocus || onCycleRecipe) ? <div className="factory-node-actions">
        {onWorldFocus ? <button type="button" onClick={() => onWorldFocus(node.id)}>월드에서 보기</button> : null}
        {onCycleRecipe ? <button type="button" onClick={() => onCycleRecipe(node.id)}>대체 레시피 전환</button> : null}
      </div> : null}
      <section><h4>연결된 상류</h4>{inputs.length ? <ul>{inputs.map((edge) => <li key={edge.id}>{nodeById.get(edge.from)?.instanceLabel ?? nodeById.get(edge.from)?.label ?? edge.from}<b>{edge.itemName}</b></li>)}</ul> : <p>없음</p>}</section>
      <section><h4>연결된 하류</h4>{outputs.length ? <ul>{outputs.map((edge) => <li key={edge.id}>{nodeById.get(edge.to)?.instanceLabel ?? nodeById.get(edge.to)?.label ?? edge.to}<b>{edge.itemName}</b></li>)}</ul> : <p>없음</p>}</section>
    </aside>
  );
}

function ComparisonDetail({ nodes, live, onClear }: Readonly<{
  nodes: readonly ProductionLineageNode[];
  live: ProductionLineageLiveSnapshot;
  onClear: () => void;
}>) {
  if (nodes.length === 0) return null;
  return <section className="factory-node-comparison" aria-label="고정 노드 비교" id="factory-comparison-status">
    <header><span>PINNED COMPARISON · {nodes.length}/2</span><button type="button" onClick={onClear}>비교 해제</button></header>
    <div>{nodes.map((node) => {
      const state = live.nodeStates[node.id];
      return <article key={node.id}><em>{node.instanceLabel ?? KIND_LABEL[node.kind]}</em><strong>{node.label}</strong><dl><div><dt>상태</dt><dd>{STATUS_LABEL[state?.status ?? "idle"]}</dd></div><div><dt>실측</dt><dd>{formatRate(state?.actualRatePerMinute)}</dd></div><div><dt>재고</dt><dd>{state?.stock?.toLocaleString("ko-KR") ?? "—"}</dd></div></dl></article>;
    })}</div>
  </section>;
}

export default function ProductionLineageOverlay({ open, onClose, graph, definitionGraph, live, definitionLive, initialMode = "lineage", onWorldFocus, onCycleRecipe }: ProductionLineageOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<Readonly<{ pointerId: number; x: number; y: number; originX: number; originY: number }> | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [mode, setMode] = useState<LineageMode>(initialMode);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GraphFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProductionLineageStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<number | "all">("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [comparedNodeIds, setComparedNodeIds] = useState<readonly string[]>([]);
  const [layout, setLayout] = useState<LineageLayout>("graph");
  const [viewport, setViewport] = useState<GraphViewport>({ x: 0, y: 0, scale: 1 });
  const modeGraph = useMemo(
    () => mode === "lineage" && definitionGraph ? definitionGraph : graphForLineageMode(graph, mode),
    [definitionGraph, graph, mode],
  );
  const activeLive = mode === "lineage" && definitionLive ? definitionLive : live;
  const nodeById = useMemo(() => new Map(modeGraph.nodes.map((node) => [node.id, node])), [modeGraph.nodes]);
  const inputsByNode = useMemo(() => {
    const grouped = new Map<string, ProductionLineageEdge[]>();
    modeGraph.edges.forEach((edge) => grouped.set(edge.to, [...(grouped.get(edge.to) ?? []), edge]));
    return grouped;
  }, [modeGraph.edges]);
  const outputsByNode = useMemo(() => {
    const grouped = new Map<string, ProductionLineageEdge[]>();
    modeGraph.edges.forEach((edge) => grouped.set(edge.from, [...(grouped.get(edge.from) ?? []), edge]));
    return grouped;
  }, [modeGraph.edges]);
  const disconnectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    modeGraph.edges.forEach((edge) => { if (edge.connected === false) { ids.add(edge.from); ids.add(edge.to); } });
    modeGraph.nodes.forEach((node) => { if (activeLive.nodeStates[node.id]?.status === "disconnected") ids.add(node.id); });
    return ids;
  }, [activeLive.nodeStates, modeGraph.edges, modeGraph.nodes]);
  const bottleneckNodeIds = useMemo(() => {
    const ids = new Set<string>();
    modeGraph.edges.forEach((edge) => { if (edge.jammed) { ids.add(edge.from); ids.add(edge.to); } });
    modeGraph.nodes.forEach((node) => { const status = activeLive.nodeStates[node.id]?.status; if (status === "blocked" || status === "starved") ids.add(node.id); });
    return ids;
  }, [activeLive.nodeStates, modeGraph.edges, modeGraph.nodes]);
  const problemNodeIds = useMemo(() => new Set([...disconnectedNodeIds, ...bottleneckNodeIds]), [bottleneckNodeIds, disconnectedNodeIds]);
  const stages = useMemo(() => [...new Set(modeGraph.nodes.map((node) => Math.max(0, node.column ?? 0)))].sort((a, b) => a - b), [modeGraph.nodes]);
  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return modeGraph.nodes.filter((node) => {
      const status = effectiveStatus(node, activeLive, disconnectedNodeIds);
      const matchesQuery = normalizedQuery.length === 0 || [node.id, node.label, node.instanceLabel, node.detail].some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
      const matchesKind = filter === "all" || (filter === "facility" && node.kind !== "resource") || (filter === "item" && node.kind === "resource") || (filter === "problem" && problemNodeIds.has(node.id));
      return matchesQuery && matchesKind && (statusFilter === "all" || status === statusFilter) && (stageFilter === "all" || Math.max(0, node.column ?? 0) === stageFilter);
    });
  }, [activeLive, disconnectedNodeIds, filter, modeGraph.nodes, problemNodeIds, query, stageFilter, statusFilter]);
  const columns = useMemo(() => groupNodesByColumn(visibleNodes, modeGraph.edges), [modeGraph.edges, visibleNodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const comparedNodes = comparedNodeIds.map((id) => nodeById.get(id)).filter((node): node is ProductionLineageNode => Boolean(node));
  const facilityNodes = modeGraph.nodes.filter((node) => node.kind !== "resource");
  const activeCount = facilityNodes.filter((node) => ["working", "storing"].includes(activeLive.nodeStates[node.id]?.status ?? "")).length;
  const disconnectedCount = modeGraph.edges.filter((edge) => edge.connected === false).length;
  const bottleneckCount = bottleneckNodeIds.size;

  const changeModeByKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % MODE_ORDER.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + MODE_ORDER.length) % MODE_ORDER.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODE_ORDER.length - 1;
    else return;
    event.preventDefault();
    setMode(MODE_ORDER[next]);
    setSelectedNodeId(null);
    setComparedNodeIds([]);
    setViewport({ x: 0, y: 0, scale: 1 });
    modeRefs.current[next]?.focus();
  };

  const centerNode = useCallback((nodeId: string) => {
    if (layout !== "graph") return;
    const container = viewportRef.current;
    const node = nodeRefs.current.get(nodeId);
    if (!container || !node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    setViewport((current) => ({
      ...current,
      x: current.x + containerRect.left + containerRect.width / 2 - (nodeRect.left + nodeRect.width / 2),
      y: current.y + containerRect.top + containerRect.height / 2 - (nodeRect.top + nodeRect.height / 2),
    }));
  }, [layout]);

  const moveNodeFocus = (currentId: string, direction: NavigationDirection | "center") => {
    if (direction === "center") {
      setSelectedNodeId(currentId);
      centerNode(currentId);
      return;
    }
    const nextId = adjacentLineageNodeId(visibleNodes, currentId, direction, modeGraph.edges);
    if (!nextId) return;
    setSelectedNodeId(nextId);
    nodeRefs.current.get(nextId)?.focus();
  };

  const selectNode = (nodeId: string, compare: boolean) => {
    setSelectedNodeId(nodeId);
    if (compare) setComparedNodeIds((ids) => toggleComparedNode(ids, nodeId));
  };
  const closeOverlay = useCallback(() => {
    setSelectedNodeId(null);
    setComparedNodeIds([]);
    onClose();
  }, [onClose]);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (layout !== "graph" || event.button !== 0 || (event.target as HTMLElement).closest("[data-node-id], button, input, select")) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-panning");
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({ ...current, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }));
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.classList.remove("is-panning");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const zoomAtPointer = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (layout !== "graph") return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0012);
    setViewport((current) => zoomViewportAtPoint(
      current,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      current.scale * factor,
    ));
  };

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus();
      if (window.matchMedia("(max-width: 760px)").matches) setLayout("list");
    });
    return () => { cancelAnimationFrame(frame); previousFocusRef.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (selectedNodeId) {
          setSelectedNodeId(null);
        } else closeOverlay();
      } else if ((event.key === "f" || event.key === "F") && selectedNodeId
        && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        centerNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); };
  }, [centerNode, closeOverlay, open, selectedNodeId]);

  if (!open) return null;
  const modeMeta = MODE_LABEL[mode];
  return (
    <div className="factory-graph-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeOverlay()}>
      <div ref={dialogRef} className="factory-graph-dialog" role="dialog" aria-modal="true" aria-labelledby="factory-graph-title" tabIndex={-1}>
        <header className="factory-graph-header">
          <div className="factory-graph-mark" aria-hidden="true">FX</div>
          <div><span>{modeMeta.eyebrow} / ACTUAL DATA</span><h2 id="factory-graph-title">{modeMeta.label} · {graph.title ?? "생산 계보"}</h2><p>{modeMeta.description}</p></div>
          <div className="factory-graph-live"><i aria-hidden="true" />{formatUpdatedAt(activeLive.updatedAt)}</div>
          <button type="button" className="factory-graph-close" onClick={closeOverlay} aria-label="생산 계보 창 닫기"><span>닫기</span><kbd>ESC</kbd></button>
        </header>

        <nav className="factory-graph-modes" role="tablist" aria-label="생산 계보 보기 모드">
          {MODE_ORDER.map((option, index) => {
            const count = graphForLineageMode(graph, option).nodes.length;
            return <button key={option} ref={(element) => { modeRefs.current[index] = element; }} type="button" role="tab" aria-selected={mode === option} tabIndex={mode === option ? 0 : -1} onClick={() => { setMode(option); setSelectedNodeId(null); setComparedNodeIds([]); setViewport({ x: 0, y: 0, scale: 1 }); }} onKeyDown={(event) => changeModeByKey(event, index)}><span>{MODE_LABEL[option].label}</span><small>{count}</small></button>;
          })}
        </nav>

        <section className="factory-graph-summary" aria-label={`${modeMeta.label} 요약`}>
          <div className="factory-summary-cell"><span>실제 노드</span><strong>{modeGraph.nodes.length}</strong><small> NODE</small></div>
          <div className="factory-summary-cell"><span>가동 설비</span><strong>{activeCount}</strong><small> LIVE</small></div>
          <button type="button" className={`factory-summary-cell ${bottleneckCount > 0 ? "is-warning" : ""}`} onClick={() => setFilter("problem")} aria-label={`병목 관련 노드 ${bottleneckCount}개만 보기`}><span>병목 노드</span><strong>{bottleneckCount}</strong><small> NODE</small></button>
          <button type="button" className={`factory-summary-cell ${disconnectedCount > 0 ? "is-danger" : ""}`} onClick={() => setFilter("problem")} aria-label={`끊긴 연결 ${disconnectedCount}개와 관련된 노드 보기`}><span>끊긴 연결</span><strong>{disconnectedCount}</strong><small> EDGE</small></button>
        </section>

        <section className="factory-graph-controls" aria-label="그래프 검색 및 표시 필터">
          <label className="factory-graph-search"><span>NODE SEARCH</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="노드명 또는 ID 검색" autoComplete="off" /></label>
          <div className="factory-graph-filters" role="group" aria-label="노드 표시 범위">{(Object.keys(FILTER_LABEL) as GraphFilter[]).map((option) => <button type="button" key={option} className={filter === option ? "is-active" : ""} aria-pressed={filter === option} onClick={() => setFilter(option)}>{FILTER_LABEL[option]}{option === "problem" && problemNodeIds.size > 0 ? ` ${problemNodeIds.size}` : ""}</button>)}</div>
          <label className="factory-mobile-filter"><span>표시</span><select aria-label="모바일 노드 표시 범위" value={filter} onChange={(event) => setFilter(event.target.value as GraphFilter)}>{(Object.keys(FILTER_LABEL) as GraphFilter[]).map((option) => <option key={option} value={option}>{FILTER_LABEL[option]}{option === "problem" && problemNodeIds.size > 0 ? ` ${problemNodeIds.size}` : ""}</option>)}</select></label>
          <label className="factory-graph-select"><span>상태</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProductionLineageStatus | "all")}><option value="all">전체 상태</option>{(Object.keys(STATUS_LABEL) as ProductionLineageStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}</select></label>
          <label className="factory-graph-select"><span>단계</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">전체 단계</option>{stages.map((stage) => <option key={stage} value={stage}>단계 {stage + 1}</option>)}</select></label>
          <div className="factory-layout-toggle" role="group" aria-label="그래프 표시 방식">
            <button type="button" aria-pressed={layout === "graph"} onClick={() => setLayout("graph")}>그래프</button>
            <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>계층 목록</button>
          </div>
          {layout === "graph" ? <div className="factory-zoom-status" aria-label={`확대율 ${Math.round(viewport.scale * 100)}퍼센트`}><button type="button" onClick={() => setViewport((current) => zoomViewportAtPoint(current, { x: 0, y: 0 }, current.scale / 1.15))} aria-label="축소">−</button><span>{Math.round(viewport.scale * 100)}%</span><button type="button" onClick={() => setViewport((current) => zoomViewportAtPoint(current, { x: 0, y: 0 }, current.scale * 1.15))} aria-label="확대">＋</button></div> : null}
          <output aria-live="polite">{visibleNodes.length} / {nodeById.size} 노드</output>
        </section>

        <div className="factory-graph-main">
          <div className={`factory-graph-workspace is-${layout}`}>
            <div
              ref={viewportRef}
              className="factory-graph-viewport"
              tabIndex={0}
              aria-label={layout === "graph" ? `${modeMeta.label} 그래프. 빈 공간을 드래그해 이동하고 휠로 확대 또는 축소합니다.` : `${modeMeta.label} 계층형 목록`}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onWheel={zoomAtPointer}
            >
            <section className="factory-columns" aria-label={`${modeMeta.label} 실제 흐름`} role="list" style={layout === "graph" ? { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` } : undefined}>
              {columns.length === 0 ? <p className="factory-graph-empty">{modeGraph.nodes.length === 0 ? `${modeMeta.label}에 표시할 실제 연결 데이터가 없습니다.` : "검색 또는 필터 조건에 맞는 노드가 없습니다."}</p> : null}
              {columns.map(([column, nodes], index) => <section className="factory-column" key={column} aria-labelledby={`factory-column-${mode}-${column}`}><header><span>STEP {String(index + 1).padStart(2, "0")}</span><strong id={`factory-column-${mode}-${column}`}>생산 단계 {column + 1}</strong><em>{nodes.length} 노드</em></header><div>{nodes.map((node) => <FactoryNodeCard key={node.id} node={node} nodeRef={(element) => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} live={activeLive.nodeStates[node.id]} inputs={inputsByNode.get(node.id) ?? []} outputs={outputsByNode.get(node.id) ?? []} nodeById={nodeById} bottleneck={bottleneckNodeIds.has(node.id)} disconnected={disconnectedNodeIds.has(node.id)} selected={selectedNodeId === node.id} compared={comparedNodeIds.includes(node.id)} onSelect={(shiftKey) => selectNode(node.id, shiftKey)} onFocusRequest={(direction) => moveNodeFocus(node.id, direction)} />)}</div></section>)}
            </section>
            </div>
            <div className="factory-detail-stack">
            <NodeDetail
              node={selectedNode}
              live={selectedNode ? {
                ...(activeLive.nodeStates[selectedNode.id] ?? {}),
                status: effectiveStatus(selectedNode, activeLive, disconnectedNodeIds),
              } : undefined}
              inputs={selectedNode ? inputsByNode.get(selectedNode.id) ?? [] : []}
              outputs={selectedNode ? outputsByNode.get(selectedNode.id) ?? [] : []}
              nodeById={nodeById}
              onClear={() => setSelectedNodeId(null)}
              onWorldFocus={mode === "factory" ? onWorldFocus : undefined}
              onCycleRecipe={mode === "factory" ? onCycleRecipe : undefined}
            />
            <ComparisonDetail nodes={comparedNodes} live={activeLive} onClear={() => setComparedNodeIds([])} />
            </div>
          </div>
          <aside className="factory-graph-legend" aria-label="연결 및 설비 상태 범례"><span>STATUS</span><div className="legend-working"><i aria-hidden="true" />가동·연결</div><div className="legend-starved"><i aria-hidden="true" />원료 부족</div><div className="legend-jammed"><i aria-hidden="true" />흐름 막힘</div><div className="legend-disconnected"><i aria-hidden="true" />연결 끊김</div></aside>
        </div>
      </div>
    </div>
  );
}
