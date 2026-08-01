"use client";

import { useEffect, useMemo, useRef } from "react";
import "../production-lineage.css";

export type ProductionLineageStatus =
  | "working"
  | "storing"
  | "starved"
  | "blocked"
  | "disconnected"
  | "paused"
  | "idle";

export type ProductionLineageNode = Readonly<{
  id: string;
  label: string;
  kind: "resource" | "building" | "storage" | "project";
  detail?: string;
  column?: number;
  order?: number;
  instanceLabel?: string;
}>;

export type ProductionLineageEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  itemName: string;
  medium?: "solid" | "fluid";
  plannedRatePerMinute?: number;
  connected?: boolean;
  beltCount?: number;
  jammed?: boolean;
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

export type ProductionLineageOverlayProps = Readonly<{
  open: boolean;
  onClose: () => void;
  graph: ProductionLineageGraph;
  live: ProductionLineageLiveSnapshot;
}>;

const STATUS_LABEL: Record<ProductionLineageStatus, string> = {
  working: "가동",
  storing: "저장",
  starved: "원료 부족",
  blocked: "출력 막힘",
  disconnected: "연결 끊김",
  paused: "일시 정지",
  idle: "대기",
};

const KIND_LABEL: Record<ProductionLineageNode["kind"], string> = {
  resource: "RESOURCE",
  building: "FACILITY",
  storage: "STORAGE",
  project: "PROJECT",
};

const formatRate = (value?: number) => Number.isFinite(value) ? `${value!.toLocaleString("ko-KR")} /분` : "—";

const formatUpdatedAt = (value?: string | number | Date) => {
  if (value === undefined) return "실시간 연결";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "실시간 연결" : `${date.toLocaleTimeString("ko-KR")} 갱신`;
};

const edgeState = (edge: ProductionLineageEdge) => {
  if (edge.connected === false) return { key: "disconnected", label: "끊김" } as const;
  if (edge.jammed) return { key: "jammed", label: "막힘" } as const;
  return {
    key: "connected",
    label: edge.beltCount === undefined ? "연결됨" : `벨트 ${edge.beltCount}칸`,
  } as const;
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
    <li className={`factory-edge factory-edge-${state.key}`}>
      <i aria-hidden="true" />
      <div>
        <span>{direction === "input" ? "←" : "→"} {peer?.instanceLabel ?? peer?.label ?? "알 수 없는 설비"}</span>
        <strong>{edge.itemName}</strong>
      </div>
      <em>{state.label}</em>
    </li>
  );
}

function FactoryNodeCard({
  node,
  live,
  inputs,
  outputs,
  nodeById,
}: Readonly<{
  node: ProductionLineageNode;
  live?: ProductionLineageNodeLiveState;
  inputs: readonly ProductionLineageEdge[];
  outputs: readonly ProductionLineageEdge[];
  nodeById: ReadonlyMap<string, ProductionLineageNode>;
}>) {
  const status = live?.status ?? (inputs.some((edge) => edge.connected === false) ? "disconnected" : "idle");
  const progress = Number.isFinite(live?.progress) ? Math.max(0, Math.min(100, (live?.progress ?? 0) * 100)) : null;
  return (
    <article className={`factory-node factory-node-${node.kind} factory-status-${status}`} role="listitem">
      <header>
        <span>{KIND_LABEL[node.kind]}</span>
        <em><i aria-hidden="true" />{STATUS_LABEL[status]}</em>
      </header>
      {node.instanceLabel ? <div className="factory-instance">{node.instanceLabel}</div> : null}
      <h3>{node.label}</h3>
      {node.detail ? <p>{node.detail}</p> : null}
      <dl className="factory-node-metrics">
        <div><dt>실측</dt><dd>{formatRate(live?.actualRatePerMinute)}</dd></div>
        {live?.stock !== undefined ? <div><dt>재고</dt><dd>{live.stock.toLocaleString("ko-KR")}{live.capacity !== undefined ? ` / ${live.capacity.toLocaleString("ko-KR")}` : ""}</dd></div> : null}
      </dl>
      {progress !== null ? (
        <div className="factory-node-progress" role="progressbar" aria-label={`${node.label} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <i style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className="factory-node-ports">
        <section aria-label={`${node.label} 입력 연결`}>
          <h4>INPUT <b>{inputs.length}</b></h4>
          {inputs.length > 0 ? <ul>{inputs.map((edge) => <EdgeSummary key={edge.id} edge={edge} peer={nodeById.get(edge.from)} direction="input" />)}</ul> : <p>직접 공급 또는 입력 없음</p>}
        </section>
        <section aria-label={`${node.label} 출력 연결`}>
          <h4>OUTPUT <b>{outputs.length}</b></h4>
          {outputs.length > 0 ? <ul>{outputs.map((edge) => <EdgeSummary key={edge.id} edge={edge} peer={nodeById.get(edge.to)} direction="output" />)}</ul> : <p>최종 소비처 또는 출력 없음</p>}
        </section>
      </div>
    </article>
  );
}

export default function ProductionLineageOverlay({ open, onClose, graph, live }: ProductionLineageOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const columns = useMemo(() => groupNodesByColumn(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const inputsByNode = useMemo(() => {
    const grouped = new Map<string, ProductionLineageEdge[]>();
    graph.edges.forEach((edge) => grouped.set(edge.to, [...(grouped.get(edge.to) ?? []), edge]));
    return grouped;
  }, [graph.edges]);
  const outputsByNode = useMemo(() => {
    const grouped = new Map<string, ProductionLineageEdge[]>();
    graph.edges.forEach((edge) => grouped.set(edge.from, [...(grouped.get(edge.from) ?? []), edge]));
    return grouped;
  }, [graph.edges]);
  const facilityNodes = graph.nodes.filter((node) => node.kind !== "resource");
  const activeCount = facilityNodes.filter((node) => {
    const state = live.nodeStates[node.id];
    return state?.status === "working" || state?.status === "storing";
  }).length;
  const disconnectedCount = graph.edges.filter((edge) => edge.connected === false).length;
  const jammedCount = graph.edges.filter((edge) => edge.jammed).length;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="factory-graph-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="factory-graph-dialog" role="dialog" aria-modal="true" aria-labelledby="factory-graph-title" tabIndex={-1}>
        <header className="factory-graph-header">
          <div className="factory-graph-mark" aria-hidden="true">FX</div>
          <div><span>LIVE FACTORY / PHYSICAL CONNECTIONS</span><h2 id="factory-graph-title">{graph.title ?? "실제 공장 생산 계보"}</h2></div>
          <div className="factory-graph-live"><i aria-hidden="true" />{formatUpdatedAt(live.updatedAt)}</div>
          <button type="button" className="factory-graph-close" onClick={onClose} aria-label="실제 공장 생산 계보 닫기"><span>닫기</span><kbd>ESC</kbd></button>
        </header>

        <section className="factory-graph-summary" aria-label="실제 공장 연결 요약">
          <div><span>실제 설비</span><strong>{facilityNodes.length}</strong><small> NODE</small></div>
          <div><span>가동 설비</span><strong>{activeCount}</strong><small> LIVE</small></div>
          <div className={disconnectedCount > 0 ? "is-danger" : ""}><span>끊긴 연결</span><strong>{disconnectedCount}</strong><small> EDGE</small></div>
          <div className={jammedCount > 0 ? "is-warning" : ""}><span>막힌 벨트</span><strong>{jammedCount}</strong><small> EDGE</small></div>
        </section>

        <div className="factory-graph-main">
          <section className="factory-columns" aria-label="실제 공장 가로 생산 흐름" role="list">
            {columns.length === 0 ? <p className="factory-graph-empty">배치된 실제 설비가 없습니다.</p> : null}
            {columns.map(([column, nodes], index) => (
              <section className="factory-column" key={column} aria-labelledby={`factory-column-${column}`}>
                <header><span>STEP {String(index + 1).padStart(2, "0")}</span><strong id={`factory-column-${column}`}>생산 단계 {index + 1}</strong><em>{nodes.length} 설비</em></header>
                <div>
                  {nodes.map((node) => (
                    <FactoryNodeCard
                      key={node.id}
                      node={node}
                      live={live.nodeStates[node.id]}
                      inputs={inputsByNode.get(node.id) ?? []}
                      outputs={outputsByNode.get(node.id) ?? []}
                      nodeById={nodeById}
                    />
                  ))}
                </div>
              </section>
            ))}
          </section>

          <aside className="factory-graph-legend" aria-label="연결 및 설비 상태 범례">
            <span>STATUS</span>
            <div className="legend-working"><i aria-hidden="true" />가동·연결</div>
            <div className="legend-starved"><i aria-hidden="true" />원료 부족</div>
            <div className="legend-jammed"><i aria-hidden="true" />벨트 막힘</div>
            <div className="legend-disconnected"><i aria-hidden="true" />연결 끊김</div>
          </aside>
        </div>
      </div>
    </div>
  );
}
