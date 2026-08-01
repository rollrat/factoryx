import { useEffect, useRef } from "react";
import { TOOL_INFO, TYPE_NAME, TYPE_RATE } from "../game/config";
import { START_REGISTRY } from "../game/data/index.ts";
import type { BeltBuildInfo, CameraMode, SelectedInfo, Tool } from "../game/types";

export type ProjectHudRequirement = Readonly<{
  itemId: string;
  name: string;
  delivered: number;
  total: number;
}>;

export type ProjectHudState = Readonly<{
  stageName: string;
  delivered: number;
  total: number;
  completed: boolean;
  requirements: readonly ProjectHudRequirement[];
}>;

type GameHudProps = {
  activeTool: Tool;
  cameraMode: CameraMode;
  pointerLocked: boolean;
  credits: number;
  project: ProjectHudState;
  powerSupply: number;
  powerDemand: number;
  powerServed: number;
  powerOverloaded: boolean;
  selected: SelectedInfo;
  beltBuildInfo: BeltBuildInfo;
  toast: string;
  toastVisible: boolean;
  onToolChange: (tool: Tool) => void;
  onCameraModeChange: () => void;
  onLineageToggle: () => void;
  onBuildCatalogToggle: () => void;
  onProjectProgressToggle: () => void;
  onPowerControlToggle: () => void;
  onRecipeCycle: () => void;
};

type EquipmentStatus = "working" | "starved" | "blocked" | "disconnected" | "storing" | "idle";
type SelectedDetails = NonNullable<SelectedInfo> & {
  runtimeState?: string;
  recipeName?: string;
  inputCapacity?: number;
  outputCapacity?: number;
  inputItems?: readonly Readonly<{ itemId: string; name: string; amount: number }>[];
  outputItems?: readonly Readonly<{ itemId: string; name: string; amount: number }>[];
};

const getEquipmentStatus = (selected: SelectedDetails): EquipmentStatus => {
  const runtimeState = selected.runtimeState?.toLocaleLowerCase("ko-KR");
  if (runtimeState === "working") return selected.type === "storage" ? "storing" : "working";
  if (runtimeState === "starved") return "starved";
  if (runtimeState === "blocked") return "blocked";
  if (runtimeState === "disconnected") return "disconnected";
  if (runtimeState === "storing") return "storing";

  const status = selected.status.toLocaleLowerCase("ko-KR");
  if (/막|출력|가득|blocked|jam|full/.test(status)) return "blocked";
  if (/원료|재료|입력|부족|starv/.test(status)) return "starved";
  if (selected.type === "storage" && (/보관|저장|입고/.test(status) || selected.inputCount > 0)) return "storing";
  if (/가동|작업|운송|working|processing/.test(status)) return "working";
  if (selected.progress > 0 && selected.progress < 1) return "working";
  if (selected.outputCount > 0) return "blocked";
  return "idle";
};

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  working: "가동 중",
  starved: "원료 부족",
  blocked: "출력 막힘",
  disconnected: "연결 끊김",
  storing: "저장 중",
  idle: "대기",
};

const formatPower = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString("ko-KR", {
  maximumFractionDigits: 1,
});

const itemSummary = (
  items: SelectedDetails["inputItems"],
  fallbackCount: number,
) => items?.length
  ? items.map((item) => `${item.name} ${item.amount}`).join(", ")
  : `${fallbackCount}`;

function FlowContents({
  items,
  count,
  capacity,
}: Readonly<{
  items: SelectedDetails["inputItems"];
  count: number;
  capacity?: number;
}>) {
  if (items?.length) {
    return (
      <ul className="flow-items">
        {items.map((item, index) => (
          <li key={`${item.itemId}-${index}`} title={`${item.name} ${item.amount}`}>
            <span>{item.name}</span>
            <strong>×{Number.isFinite(item.amount) ? item.amount.toLocaleString("ko-KR") : 0}</strong>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <strong className="flow-count">
      {count}
      {capacity !== undefined ? <small> / {capacity}</small> : null}
    </strong>
  );
}

export default function GameHud({
  activeTool,
  cameraMode,
  pointerLocked,
  credits,
  project,
  powerSupply,
  powerDemand,
  powerServed,
  powerOverloaded,
  selected,
  beltBuildInfo,
  toast,
  toastVisible,
  onToolChange,
  onCameraModeChange,
  onLineageToggle,
  onBuildCatalogToggle,
  onProjectProgressToggle,
  onPowerControlToggle,
  onRecipeCycle,
}: GameHudProps) {
  const activeToolButtonRef = useRef<HTMLButtonElement>(null);
  const activeToolInfo = TOOL_INFO.find((tool) => tool.id === activeTool) ?? TOOL_INFO[0];
  const numericToolKeys = TOOL_INFO.map((tool) => tool.key).filter((key) => /^\d$/.test(key));
  const toolKeyRange = numericToolKeys.length > 1
    ? `${numericToolKeys[0]}–${numericToolKeys[numericToolKeys.length - 1]}`
    : numericToolKeys[0] ?? "숫자";
  const isPowerLimited = powerOverloaded || powerDemand > powerSupply || powerServed < powerDemand;
  const projectDelivered = Math.max(0, Number.isFinite(project.delivered) ? project.delivered : 0);
  const projectTotal = Math.max(0, Number.isFinite(project.total) ? project.total : 0);
  const objectiveProgress = project.completed
    ? 100
    : projectTotal > 0 ? Math.min(100, (projectDelivered / projectTotal) * 100) : 0;
  const selectedDetails = selected as SelectedDetails | null;
  const selectedStatus = selectedDetails ? getEquipmentStatus(selectedDetails) : "idle";
  const selectedProgress = selectedDetails && Number.isFinite(selectedDetails.progress)
    ? Math.max(0, Math.min(100, selectedDetails.progress * 100))
    : 0;
  const selectedType = selectedDetails?.type as string | undefined;
  const selectedName = selectedDetails?.buildingId
    ? START_REGISTRY.buildings.get(selectedDetails.buildingId)?.name ?? TYPE_NAME[selectedDetails.type]
    : selectedDetails ? TYPE_NAME[selectedDetails.type] : "설비";
  const isSplitter = selectedType === "splitter";
  const isMerger = selectedType === "merger";
  const isCrusher = selectedType === "crusher";
  const progressLabel = isCrusher
    ? "파쇄 진행"
    : isSplitter
    ? "분배 흐름"
    : isMerger ? "병합 흐름" : selectedDetails?.type === "storage"
    ? "저장 용량"
    : selectedDetails?.type === "belt" ? "운송 진행" : "공정 진행";
  const flowInputLabel = isCrusher ? "원광 투입" : isMerger ? "병합 입력" : selected?.type === "storage" ? "보관" : "입력";
  const flowOutputLabel = isCrusher ? "파쇄물" : isSplitter ? "분배 출력" : "출력";
  const equipmentMode = selectedDetails?.recipeName
    ?? (isCrusher
      ? "원광을 파쇄해 다음 공정으로 공급"
      : isSplitter ? "연결된 출력으로 균등 분배" : isMerger ? "준비된 입력을 순차 병합" : null);
  const canCycleRecipe = Boolean(selectedDetails?.buildingId
    && (START_REGISTRY.buildings.get(selectedDetails.buildingId)?.recipeIds.length ?? 0) > 1);

  useEffect(() => {
    activeToolButtonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTool]);

  return (
    <div className={`hud ${cameraMode === "firstPerson" ? "first-person" : ""}`}>
      <header className="status-rail">
        <div className="sector-tag instrument-panel">
          <span className="sector-mark">FX</span>
          <span className="sector-code">A-17</span>
        </div>

        <div className="system-readouts instrument-panel">
          <div className="system-readout">
            <span>CR</span>
            <strong>{credits.toLocaleString("ko-KR")}</strong>
          </div>
          <div className="readout-divider" />
          <div
            className={`system-readout power-readout ${isPowerLimited ? "is-overloaded" : ""}`}
            role="status"
            aria-label={`전력 공급 ${formatPower(powerServed)} 메가와트, 요청 부하 ${formatPower(powerDemand)} 메가와트, 설비 용량 ${formatPower(powerSupply)} 메가와트${isPowerLimited ? ", 과부하" : ""}`}
          >
            <span>{isPowerLimited ? "OVERLOAD" : "GRID"}</span>
            <strong>{formatPower(powerServed)} / {formatPower(powerDemand)}</strong>
            <small>MW</small>
            <em>CAP {formatPower(powerSupply)}</em>
          </div>
        </div>

        <div className={`objective-readout instrument-panel ${project.completed ? "is-completed" : ""}`}>
          <span className="objective-index">{project.completed ? "COMPLETE" : "PROJECT"}</span>
          <div className="objective-copy">
            <strong>{project.stageName}</strong>
            <span>{project.requirements.length > 0 ? `${project.requirements.length}개 품목 납품 계약` : "납품 요구사항 없음"}</span>
          </div>
          <span className="objective-count"><b>{projectDelivered.toLocaleString("ko-KR")}</b> / {projectTotal.toLocaleString("ko-KR")}</span>
          <div
            className="objective-track"
            role="progressbar"
            aria-label={`${project.stageName} 진행률`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(objectiveProgress)}
          >
            <div style={{ width: `${objectiveProgress}%` }} />
          </div>
          <ul className="objective-requirements" aria-label="프로젝트 납품 요구사항">
            {project.requirements.length > 0 ? project.requirements.map((requirement) => {
              const delivered = Math.max(0, Number.isFinite(requirement.delivered) ? requirement.delivered : 0);
              const total = Math.max(0, Number.isFinite(requirement.total) ? requirement.total : 0);
              const complete = total > 0 && delivered >= total;
              return (
                <li className={complete ? "is-complete" : ""} key={requirement.itemId} title={`${requirement.name} ${delivered}/${total}`}>
                  <span>{requirement.name}</span>
                  <strong>{delivered.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}</strong>
                </li>
              );
            }) : <li className="is-empty">현재 단계에 필요한 품목이 없습니다</li>}
          </ul>
        </div>
      </header>

      <aside
        className={`inspector instrument-panel status-${selectedStatus} ${selected ? "visible" : ""}`}
        aria-hidden={!selected}
        aria-label={selected ? `${selectedName} 설비 상태` : undefined}
      >
        <div className="inspector-rail">
          <span>EQP</span>
          <i />
        </div>
        <div className="inspector-body">
          <div className="inspector-head">
            <div>
              <span className="panel-label">선택 설비</span>
              <div className="inspector-title">{selectedName}</div>
            </div>
            <div className={`equipment-status status-${selectedStatus}`} aria-label={`상태: ${STATUS_LABEL[selectedStatus]}`}>
              <i aria-hidden="true" />
              <span>{STATUS_LABEL[selectedStatus]}</span>
            </div>
          </div>

          {equipmentMode ? (
            <div className="equipment-recipe-row">
              <div className="equipment-recipe">{equipmentMode}</div>
              {canCycleRecipe ? <button type="button" onClick={onRecipeCycle}>레시피 변경 <kbd>F</kbd></button> : null}
            </div>
          ) : null}

          <div className="process-meter">
            <div className="process-meter-head">
              <span>{progressLabel}</span>
              <strong>{selected ? `${Math.round(selectedProgress)}%` : "—"}</strong>
            </div>
            <div
              className="process-track"
              role="progressbar"
              aria-label={progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(selectedProgress)}
            >
              <div style={{ width: `${selectedProgress}%` }} />
            </div>
          </div>

          <div
            className="equipment-flow"
            aria-label={`입력 ${itemSummary(selectedDetails?.inputItems, selected?.inputCount ?? 0)}, 출력 ${itemSummary(selectedDetails?.outputItems, selected?.outputCount ?? 0)}`}
          >
            <div className="flow-node flow-input">
              <span>{flowInputLabel}</span>
              <FlowContents
                items={selectedDetails?.inputItems}
                count={selected?.inputCount ?? 0}
                capacity={selectedDetails?.inputCapacity}
              />
            </div>
            <div className={`flow-path ${selectedStatus === "working" || selectedStatus === "storing" ? "active" : ""}`} aria-hidden="true">
              <i /><i /><i />
            </div>
            <div className="flow-node flow-output">
              <span>{flowOutputLabel}</span>
              <FlowContents
                items={selectedDetails?.outputItems}
                count={selected?.outputCount ?? 0}
                capacity={selectedDetails?.outputCapacity}
              />
            </div>
          </div>

          <dl className="equipment-data">
            <div>
              <dt>기준 처리량</dt>
              <dd>{selected ? TYPE_RATE[selected.type] : "—"}</dd>
            </div>
          </dl>
        </div>
      </aside>

      <div className={`toast ${toastVisible ? "visible" : ""}`} role="status">
        <span>SYS</span>
        {toast}
      </div>

      {cameraMode === "overview" && activeTool === "belt" ? (
        <section className={`belt-build-panel instrument-panel ${beltBuildInfo.dragging ? "is-routing" : ""}`}>
          <div className="belt-build-icon" aria-hidden="true">
            <span /><span /><span />
          </div>
          <div className="belt-build-copy">
            <div className="belt-build-heading">
              <span className="panel-label">배치 도구</span>
              <strong>컨베이어 경로</strong>
            </div>
            <div className="route-readout">
              <span className={beltBuildInfo.dragging && !beltBuildInfo.valid ? "route-invalid" : "route-valid"}>
                <i />
                {beltBuildInfo.dragging
                  ? beltBuildInfo.valid ? "설치 가능" : "경로 막힘"
                  : "시작점 선택"}
              </span>
              <strong>
                {beltBuildInfo.dragging
                  ? `${beltBuildInfo.length}칸  /  ₡ ${beltBuildInfo.cost.toLocaleString("ko-KR")}`
                  : "드래그하여 경로 지정"}
              </strong>
            </div>
            <div className="belt-build-controls">
              <span><kbd>SHIFT</kbd> 꺾임 우선</span>
              <span><kbd>R</kbd> 방향 회전</span>
              {beltBuildInfo.connectedStart ? <em>출력 포트 연결</em> : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="control-strip">
        {cameraMode === "firstPerson" ? (
          <><span><kbd>클릭</kbd> 시점 고정</span><span><kbd>WASD</kbd> 이동</span><span><kbd>SHIFT</kbd> 달리기</span></>
        ) : (
          <><span><kbd>WASD</kbd> 이동</span><span><kbd>휠</kbd> 줌</span><span><kbd>Q E</kbd> 회전</span><span><kbd>{toolKeyRange}</kbd> 도구</span></>
        )}
      </div>

      <div className="build-dock instrument-panel">
        <div className="active-tool-readout">
          <div className="active-tool-heading"><span>BUILD</span><kbd>{activeToolInfo.key}</kbd></div>
          <strong>{activeToolInfo.name}</strong>
          <em>{activeToolInfo.cost ? `₡ ${activeToolInfo.cost}` : "조작 도구"}</em>
        </div>
        <nav className="toolbar" aria-label="건설 도구" title="항목이 더 있으면 가로로 스크롤하세요.">
          {TOOL_INFO.map((tool) => (
            <button
              key={tool.id}
              ref={activeTool === tool.id ? activeToolButtonRef : undefined}
              className={`tool-button tool-${tool.id} ${activeTool === tool.id ? "active" : ""}`}
              onClick={() => onToolChange(tool.id)}
              aria-pressed={activeTool === tool.id}
              aria-label={`${tool.name}${tool.cost ? `, 비용 ${tool.cost}` : ""}`}
              title={tool.name}
            >
              <span className="tool-key">{tool.key}</span>
              {tool.id === "belt" ? (
                <span className="belt-tool-glyph" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="tool-glyph">{tool.glyph}</span>
              )}
              <span className="tool-name">{tool.name}</span>
              {tool.cost ? <span className="tool-cost">₡{tool.cost}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      {cameraMode === "firstPerson" ? <div className="crosshair" aria-hidden="true"><i /></div> : null}
      {cameraMode === "firstPerson" && !pointerLocked ? <div className="pointer-lock-tip">클릭하여 시점 제어</div> : null}
      <button className="lineage-launch-button instrument-panel" onClick={onLineageToggle} aria-label="공장 전체 생산 계보 열기">
        <span>⌘</span>
        <strong>생산 계보</strong>
        <kbd>G</kbd>
      </button>

      <button className="catalog-launch-button instrument-panel" onClick={onBuildCatalogToggle} aria-label="전체 건설 카탈로그 열기">
        <span aria-hidden="true">▦</span>
        <strong>건설 카탈로그</strong>
      </button>
      <button className="project-launch-button instrument-panel" onClick={onProjectProgressToggle} aria-label="전체 프로젝트 진행 상황 열기">
        <span aria-hidden="true">◈</span>
        <strong>프로젝트 계약</strong>
        <kbd>P</kbd>
      </button>
      <button className="power-control-button instrument-panel" onClick={onPowerControlToggle} aria-label="전력망 제어실 열기">
        <span aria-hidden="true">ϟ</span>
        <strong>전력망 제어</strong>
        <kbd>H</kbd>
      </button>
      <button className="camera-mode-button instrument-panel" onClick={onCameraModeChange} aria-label="카메라 모드 전환">
        <span>{cameraMode === "firstPerson" ? "▦" : "◉"}</span>
        <strong>{cameraMode === "firstPerson" ? "건설 시점" : "현장 시점"}</strong>
        <kbd>V</kbd>
      </button>
    </div>
  );
}
