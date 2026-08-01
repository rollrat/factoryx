"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BuildCatalogDialog } from "./components/BuildCatalog";
import GameHud, { type ProjectHudState } from "./components/GameHud";
import ProjectProgressPanel from "./components/ProjectProgressPanel";
import PowerControlPanel from "./components/PowerControlPanel";
import ProductionLineageOverlay from "./components/ProductionLineageOverlay";
import { FactoryRuntime, type RuntimePowerControlSnapshot } from "./game/runtime";
import type { BuildingDefinition, ItemId, UnlockId } from "./game/domain/types.ts";
import type { CampaignSnapshot } from "./game/sim/campaign.ts";
import type { RuntimeTopology } from "./game/telemetry/topology.ts";
import { START_DEFINITIONS } from "./game/data/index.ts";
import { buildDefinitionLineageGraph, highlightLineagePath } from "./game/telemetry/definitionLineage.ts";
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
const DEFINITION_LINEAGE_GRAPH = buildDefinitionLineageGraph(START_DEFINITIONS);

const INITIAL_POWER: PowerInfo = { supplyMW: 24, demandMW: 0, servedMW: 0, overloaded: false };
const INITIAL_POWER_CONTROL: RuntimePowerControlSnapshot = {
  capacityMW: 0, dispatchableMW: 0, requestedMW: 0, servedMW: 0, storedMWh: 0,
  maxConsumptionMW: 0, nameplateReserveMW: 0, operatingReserveMW: 0,
  mainBreakerTripped: false, zones: [], breakers: [], switchboards: [],
};
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
      kind: node.kind === "contract"
        ? "project" as const
        : node.kind === "item"
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
  definitionLive: {
    updatedAt: topology.live.updatedAt,
    nodeStates: Object.fromEntries(Object.entries(topology.live.itemMetrics ?? {}).map(([itemId, metric]) => [
      `item:${itemId}`,
      {
        status: metric.collecting ? "idle" as const : metric.health,
        actualRatePerMinute: metric.producedPerMinute,
        stock: metric.stock,
      },
    ])),
  },
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
  const [projectOpen, setProjectOpen] = useState(false);
  const [powerControlOpen, setPowerControlOpen] = useState(false);
  const [catalogBuildingId, setCatalogBuildingId] = useState<string | null>(null);
  const [topology, setTopology] = useState<RuntimeTopology>(EMPTY_TOPOLOGY);
  const [power, setPower] = useState<PowerInfo>(INITIAL_POWER);
  const [project, setProject] = useState<ProjectHudState>(INITIAL_PROJECT);
  const [constructionState, setConstructionState] = useState(() => ({
    unlockedIds,
    inventoryByItemId: inventoryByItemId ?? {},
    constructionCredits: {} as Readonly<Record<string, number>>,
  }));
  const [campaignSnapshot, setCampaignSnapshot] = useState<CampaignSnapshot | null>(null);
  const [dockSuppliedPowerMW, setDockSuppliedPowerMW] = useState(0);
  const [powerControl, setPowerControl] = useState<RuntimePowerControlSnapshot>(INITIAL_POWER_CONTROL);
  const activeProjectStageId = useMemo(() => START_DEFINITIONS.projectStages.find((stage) => {
    const snapshot = campaignSnapshot?.stages.find((candidate) => candidate.stageId === stage.id);
    return stage.deliveries.some((delivery) => (
      (snapshot?.delivered.find(({ portId }) => portId === delivery.portId)?.amount ?? 0) < delivery.amount
    ));
  })?.id ?? null, [campaignSnapshot]);
  const definitionLineageGraph = useMemo(
    () => highlightLineagePath(DEFINITION_LINEAGE_GRAPH, activeProjectStageId),
    [activeProjectStageId],
  );

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
    setCampaignSnapshot(runtime.getCampaignSnapshot());
    setDockSuppliedPowerMW(runtime.getDockSuppliedPowerMW());
    setPowerControl(runtime.getPowerControlSnapshot());
    const telemetryTimer = window.setInterval(() => {
      setTopology(runtime.getProductionTopology());
      setCampaignSnapshot(runtime.getCampaignSnapshot());
      setDockSuppliedPowerMW(runtime.getDockSuppliedPowerMW());
      setPowerControl(runtime.getPowerControlSnapshot());
    }, 250);
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
        setProjectOpen(false);
        setPowerControlOpen(false);
        return;
      }
      if (
        event.key.toLowerCase() === "g"
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !isTextEntryTarget(event.target)
        && !catalogOpen
        && !projectOpen && !powerControlOpen
      ) {
        event.preventDefault();
        if (event.repeat) return;
        if (document.pointerLockElement) document.exitPointerLock();
        setLineageOpen((open) => !open);
      }
      if (
        event.key.toLowerCase() === "p"
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && !isTextEntryTarget(event.target)
        && !lineageOpen && !catalogOpen
        && !powerControlOpen
      ) {
        event.preventDefault();
        if (!event.repeat) setProjectOpen((open) => !open);
      }
      if (
        event.key.toLowerCase() === "h"
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && !isTextEntryTarget(event.target)
        && !lineageOpen && !catalogOpen && !projectOpen
      ) {
        event.preventDefault();
        if (!event.repeat) setPowerControlOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleLineageKey);
    return () => window.removeEventListener("keydown", handleLineageKey);
  }, [catalogOpen, lineageOpen, powerControlOpen, projectOpen]);

  useEffect(() => {
    runtimeRef.current?.setInputLocked(lineageOpen || catalogOpen || projectOpen || powerControlOpen);
  }, [catalogOpen, lineageOpen, powerControlOpen, projectOpen]);

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
          setProjectOpen(false);
          setPowerControlOpen(false);
          setLineageOpen((open) => !open);
        }}
        onBuildCatalogToggle={() => {
          setLineageOpen(false);
          setProjectOpen(false);
          setPowerControlOpen(false);
          setCatalogOpen((open) => !open);
        }}
        onProjectProgressToggle={() => {
          setLineageOpen(false);
          setCatalogOpen(false);
          setPowerControlOpen(false);
          setProjectOpen((open) => !open);
        }}
        onPowerControlToggle={() => {
          setLineageOpen(false);
          setCatalogOpen(false);
          setProjectOpen(false);
          setPowerControlOpen((open) => !open);
        }}
        onRecipeCycle={() => runtimeRef.current?.cycleSelectedRecipe()}
      />
      {powerControlOpen ? (
        <PowerControlPanel
          snapshot={powerControl}
          onClose={() => setPowerControlOpen(false)}
          onToggleBreaker={(instanceId) => {
            runtimeRef.current?.togglePowerBreaker(instanceId);
            if (runtimeRef.current) setPowerControl(runtimeRef.current.getPowerControlSnapshot());
          }}
          onTogglePriority={(instanceId, priority) => {
            runtimeRef.current?.togglePowerPriority(instanceId, priority);
            if (runtimeRef.current) setPowerControl(runtimeRef.current.getPowerControlSnapshot());
          }}
          onRestart={() => {
            runtimeRef.current?.sequentialPowerRestart();
            if (runtimeRef.current) setPowerControl(runtimeRef.current.getPowerControlSnapshot());
          }}
          onFocusInstance={(instanceId) => {
            runtimeRef.current?.setInputLocked(false);
            setPowerControlOpen(false);
            window.requestAnimationFrame(() => runtimeRef.current?.focusWorldInstance(instanceId));
          }}
        />
      ) : null}
      {projectOpen && campaignSnapshot ? (
        <div className="project-progress-overlay" role="dialog" aria-modal="true" aria-label="프로젝트 계약 진행 상황">
          <button className="project-progress-close" type="button" onClick={() => setProjectOpen(false)} aria-label="프로젝트 진행 상황 닫기">닫기 <kbd>ESC</kbd></button>
          <ProjectProgressPanel
            snapshot={campaignSnapshot}
            suppliedPowerMW={dockSuppliedPowerMW}
            onRestartRepeatable={(stageId) => {
              if (!runtimeRef.current?.restartRepeatableProject(stageId)) return;
              setCampaignSnapshot(runtimeRef.current.getCampaignSnapshot());
              setTopology(runtimeRef.current.getProductionTopology());
            }}
          />
        </div>
      ) : null}
      <BuildCatalogDialog
        open={catalogOpen}
        unlockedIds={constructionState.unlockedIds}
        inventoryByItemId={constructionState.inventoryByItemId}
        constructionCredits={constructionState.constructionCredits}
        credits={credits}
        selectedBuildingId={catalogBuildingId}
        onSelect={chooseCatalogBuilding}
        onClose={() => setCatalogOpen(false)}
      />
      <ProductionLineageOverlay
        open={lineageOpen}
        onClose={() => setLineageOpen(false)}
        definitionGraph={definitionLineageGraph}
        onWorldFocus={(nodeId) => {
          const instanceId = nodeId.replace(/^world:/, "");
          runtimeRef.current?.setInputLocked(false);
          setLineageOpen(false);
          window.requestAnimationFrame(() => runtimeRef.current?.focusWorldInstance(instanceId));
        }}
        onCycleRecipe={(nodeId) => {
          const instanceId = nodeId.replace(/^world:/, "");
          if (runtimeRef.current?.cycleWorldRecipe(instanceId)) setTopology(runtimeRef.current.getProductionTopology());
        }}
        {...topologyForOverlay(topology)}
      />
    </main>
  );
}
