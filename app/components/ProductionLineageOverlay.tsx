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
}>;

export type ProductionLineageEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  itemName: string;
  medium?: "solid" | "fluid";
  plannedRatePerMinute?: number;
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

const statusRank: Record<ProductionLineageStatus, number> = {
  disconnected: 6,
  blocked: 5,
  starved: 4,
  paused: 3,
  storing: 2,
  working: 1,
  idle: 0,
};

const formatRate = (value?: number) => Number.isFinite(value) ? `${value!.toLocaleString("ko-KR")} /분` : "—";

const formatUpdatedAt = (value?: string | number | Date) => {
  if (value === undefined) return "실시간 연결";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "실시간 연결" : `${date.toLocaleTimeString("ko-KR")} 갱신`;
};

function LineageNodeCard({
  node,
  live,
  port,
}: Readonly<{
  node: ProductionLineageNode;
  live?: ProductionLineageNodeLiveState;
  port?: "input" | "output";
}>) {
  const status = live?.status ?? "idle";
  const progress = Number.isFinite(live?.progress)
    ? Math.max(0, Math.min(100, (live?.progress ?? 0) * 100))
    : null;

  return (
    <section className={`lineage-node lineage-node-${node.kind} lineage-status-${status} ${port ? `lineage-port-${port}` : ""}`}>
      <div className="lineage-node-heading">
        <span>{KIND_LABEL[node.kind]}</span>
        <em><i aria-hidden="true" />{STATUS_LABEL[status]}</em>
      </div>
      <strong>{node.label}</strong>
      {node.detail ? <p>{node.detail}</p> : null}
      <dl>
        <div><dt>실측</dt><dd>{formatRate(live?.actualRatePerMinute)}</dd></div>
        {live?.stock !== undefined ? (
          <div>
            <dt>재고</dt>
            <dd>{live.stock.toLocaleString("ko-KR")}{live.capacity !== undefined ? ` / ${live.capacity.toLocaleString("ko-KR")}` : ""}</dd>
          </div>
        ) : null}
      </dl>
      {progress !== null ? (
        <div
          className="lineage-node-progress"
          role="progressbar"
          aria-label={`${node.label} 진행률`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        ><i style={{ width: `${progress}%` }} /></div>
      ) : null}
    </section>
  );
}

export default function ProductionLineageOverlay({ open, onClose, graph, live }: ProductionLineageOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const liveStates = Object.values(live.nodeStates).filter((state): state is ProductionLineageNodeLiveState => Boolean(state));
  const activeCount = liveStates.filter((state) => state.status === "working" || state.status === "storing").length;
  const problemCount = liveStates.filter((state) => statusRank[state.status] >= statusRank.starved).length;
  const totalRate = liveStates.reduce((sum, state) => sum + (state.actualRatePerMinute ?? 0), 0);
  const totalStock = liveStates.reduce((sum, state) => sum + (state.stock ?? 0), 0);
  const isolatedNodes = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.from === node.id || edge.to === node.id));

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
    <div className="lineage-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="lineage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lineage-title"
        tabIndex={-1}
      >
        <header className="lineage-header">
          <div className="lineage-heading-mark" aria-hidden="true">FX</div>
          <div>
            <span>PRODUCTION ATLAS / LIVE</span>
            <h2 id="lineage-title">{graph.title ?? "생산 계보"}</h2>
          </div>
          <div className="lineage-live"><i aria-hidden="true" />{formatUpdatedAt(live.updatedAt)}</div>
          <button type="button" className="lineage-close" onClick={onClose} aria-label="생산 계보 닫기">
            <span>닫기</span><kbd>ESC</kbd>
          </button>
        </header>

        <section className="lineage-summary" aria-label="생산 계보 요약">
          <div><span>가동 설비</span><strong>{activeCount}</strong><small> / {graph.nodes.length}</small></div>
          <div className={problemCount > 0 ? "is-warning" : ""}><span>병목·이상</span><strong>{problemCount}</strong><small> NODE</small></div>
          <div><span>실측 흐름</span><strong>{totalRate.toLocaleString("ko-KR")}</strong><small> /분</small></div>
          <div><span>총 재고</span><strong>{totalStock.toLocaleString("ko-KR")}</strong><small> ITEM</small></div>
        </section>

        <div className="lineage-main">
          <section className="lineage-board" aria-label="생산 흐름 연결 목록">
            <div className="lineage-board-label">
              <span>INPUT</span><strong>연결 흐름</strong><span>OUTPUT</span>
            </div>
            {graph.edges.length === 0 ? <p className="lineage-empty">표시할 생산 연결이 없습니다.</p> : null}
            {graph.edges.map((edge) => {
              const source = nodeById.get(edge.from);
              const target = nodeById.get(edge.to);
              if (!source || !target) return null;
              const sourceLive = live.nodeStates[source.id];
              const targetLive = live.nodeStates[target.id];
              const flowStatus = [sourceLive?.status, targetLive?.status]
                .filter((status): status is ProductionLineageStatus => Boolean(status))
                .sort((a, b) => statusRank[b] - statusRank[a])[0] ?? "idle";
              return (
                <article className={`lineage-flow-row lineage-flow-${flowStatus}`} key={edge.id}>
                  <LineageNodeCard node={source} live={sourceLive} port="output" />
                  <div className="lineage-connection" aria-label={`${source.label}에서 ${target.label}로 ${edge.itemName} 운송`}>
                    <span className="lineage-connection-line" aria-hidden="true"><i /><i /><i /></span>
                    <strong>{edge.itemName}</strong>
                    <small>{edge.medium === "fluid" ? "PIPE" : "BELT"} · {formatRate(edge.plannedRatePerMinute)}</small>
                  </div>
                  <LineageNodeCard node={target} live={targetLive} port="input" />
                </article>
              );
            })}
            {isolatedNodes.length > 0 ? (
              <div className="lineage-isolated" aria-label="연결되지 않은 노드">
                {isolatedNodes.map((node) => <LineageNodeCard key={node.id} node={node} live={live.nodeStates[node.id]} />)}
              </div>
            ) : null}
          </section>

          <aside className="lineage-legend" aria-label="설비 상태 범례">
            <span>STATUS LEGEND</span>
            {(Object.keys(STATUS_LABEL) as ProductionLineageStatus[]).map((status) => (
              <div className={`lineage-legend-${status}`} key={status}><i aria-hidden="true" />{STATUS_LABEL[status]}</div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}
