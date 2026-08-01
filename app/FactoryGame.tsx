"use client";

import { useEffect, useRef, useState } from "react";
import { BuildCatalogDialog } from "./components/BuildCatalog";
import GameHud, { type ProjectHudState } from "./components/GameHud";
import ProductionLineageOverlay from "./components/ProductionLineageOverlay";
import { FactoryRuntime } from "./game/runtime";
import type { BuildingDefinition, ItemId, UnlockId } from "./game/domain/types.ts";
import type { RuntimeTopology } from "./game/telemetry/topology.ts";
import type { BeltBuildInfo, CameraMode, PowerInfo, SelectedInfo, Tool } from "./game/types";

const IDLE_BELT_BUILD: BeltBuildInfo = {
  dragging: false,
  length: 0,
  cost: 0,
  valid: true,
  connectedStart: false,
};

const EMPTY_TOPOLOGY: RuntimeTopology = {
  graph: { title: "실제 공장 생산 계보", nodes: [], edges: [] },
  live: { nodeStates: {}, updatedAt: 0 },
};

const INITIAL_POWER: PowerInfo = { supplyMW: 24, demandMW: 0, servedMW: 0, overloaded: false };
const START_UNLOCKS: readonly UnlockId[] = ["start"];
const INITIAL_PROJECT: ProjectHudState = {
  stageName: "기초 정착 패키지",
  delivered: 0,
  total: 240,
  completed: false,
  requirements: [
    { itemId: "iron_plate", name: "철판", delivered: 0, total: 120 },
    { itemId: "construction_block", name: "건축 블록", delivered: 0, total: 80 },
    { itemId: "fastener_pack", name: "체결재 팩", delivered: 0, total: 40 },
  ],
};

const isTextEntryTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
};

const topologyForOverlay = (topology: RuntimeTopology) => ({
  graph: {
    title: topology.graph.title,
    nodes: topology.graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind === "item" || node.kind === "contract"
        ? "resource" as const
        : node.buildingId === "project_dock"
          ? "project" as const
          : node.buildingId === "small_storage"
          ? "storage" as const
          : "building" as const,
      detail: node.kind === "item" ? "현재 공장 내 실재고" : node.statusLabel,
      column: node.column,
      order: node.order,
      instanceLabel: node.structureId === null ? undefined : `설비 #${node.structureId}`,
    })),
    edges: topology.graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      itemName: edge.itemName,
      medium: edge.medium,
      connected: edge.connected,
      beltCount: edge.beltCount,
      jammed: edge.jammed,
    })),
  },
  live: topology.live,
});

export type FactoryGameProps = Readonly<{
  unlockedIds?: readonly UnlockId[];
  inventoryByItemId?: Readonly<Partial<Record<ItemId, number>>>;
}>;

export default function FactoryGame({
  unlockedIds = START_UNLOCKS,
  inventoryByItemId,
}: FactoryGameProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<FactoryRuntime | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("inspect");
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [credits, setCredits] = useState(1200);
  const [selected, setSelected] = useState<SelectedInfo>(null);
  const [beltBuildInfo, setBeltBuildInfo] = useState<BeltBuildInfo>(IDLE_BELT_BUILD);
  const [toast, setToast] = useState("출력 포트에서 벨트를 연결하세요");
  const [toastVisible, setToastVisible] = useState(true);
  const [lineageOpen, setLineageOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogBuildingId, setCatalogBuildingId] = useState<string | null>(null);
  const [topology, setTopology] = useState<RuntimeTopology>(EMPTY_TOPOLOGY);
  const [power, setPower] = useState<PowerInfo>(INITIAL_POWER);
  const [project, setProject] = useState<ProjectHudState>(INITIAL_PROJECT);
  const [constructionState, setConstructionState] = useState(() => ({
    unlockedIds,
    inventoryByItemId: inventoryByItemId ?? {},
  }));

  const showToast = (message: string) => {
    setToast(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1800);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const runtime = new FactoryRuntime(mount, {
      onCredits: setCredits,
      onMotors: () => {},
      onSelected: setSelected,
      onToast: showToast,
      onToolChange: setActiveTool,
      onCameraMode: setCameraMode,
      onPointerLock: setPointerLocked,
      onBeltBuildInfo: setBeltBuildInfo,
      onPower: setPower,
      onProject: setProject,
      onConstructionState: setConstructionState,
    });
    runtimeRef.current = runtime;
    setTopology(runtime.getProductionTopology());
    const telemetryTimer = window.setInterval(() => setTopology(runtime.getProductionTopology()), 250);
    return () => {
      window.clearInterval(telemetryTimer);
      runtime.dispose();
      runtimeRef.current = null;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleLineageKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLineageOpen(false);
        setCatalogOpen(false);
        return;
      }
      if (
        event.key.toLowerCase() === "g"
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !isTextEntryTarget(event.target)
        && !catalogOpen
      ) {
        event.preventDefault();
        if (event.repeat) return;
        if (document.pointerLockElement) document.exitPointerLock();
        setLineageOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleLineageKey);
    return () => window.removeEventListener("keydown", handleLineageKey);
  }, [catalogOpen]);

  useEffect(() => {
    runtimeRef.current?.setInputLocked(lineageOpen || catalogOpen);
  }, [catalogOpen, lineageOpen]);

  const chooseTool = (tool: Tool) => runtimeRef.current?.setTool(tool);
  const toggleCameraMode = () => runtimeRef.current?.toggleCameraMode();
  const chooseCatalogBuilding = (building: BuildingDefinition) => {
    const runtime = runtimeRef.current as (FactoryRuntime & { selectBuilding: (buildingId: string) => unknown }) | null;
    if (!runtime) return;
    runtime.setInputLocked(false);
    runtime.selectBuilding(building.id);
    setCatalogBuildingId(building.id);
    setCatalogOpen(false);
  };

  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" />
      <GameHud
        activeTool={activeTool}
        cameraMode={cameraMode}
        pointerLocked={pointerLocked}
        credits={credits}
        project={project}
        powerSupply={power.supplyMW}
        powerDemand={power.demandMW}
        powerServed={power.servedMW}
        powerOverloaded={power.overloaded}
        selected={selected}
        beltBuildInfo={beltBuildInfo}
        toast={toast}
        toastVisible={toastVisible}
        onToolChange={chooseTool}
        onCameraModeChange={toggleCameraMode}
        onLineageToggle={() => {
          setCatalogOpen(false);
          setLineageOpen((open) => !open);
        }}
        onBuildCatalogToggle={() => {
          setLineageOpen(false);
          setCatalogOpen((open) => !open);
        }}
      />
      <BuildCatalogDialog
        open={catalogOpen}
        unlockedIds={constructionState.unlockedIds}
        inventoryByItemId={constructionState.inventoryByItemId}
        credits={credits}
        selectedBuildingId={catalogBuildingId}
        onSelect={chooseCatalogBuilding}
        onClose={() => setCatalogOpen(false)}
      />
      <ProductionLineageOverlay
        open={lineageOpen}
        onClose={() => setLineageOpen(false)}
        {...topologyForOverlay(topology)}
      />
    </main>
  );
}
