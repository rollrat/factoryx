import { TOOL_INFO, TYPE_NAME, TYPE_RATE } from "../game/config";
import type { BeltBuildInfo, CameraMode, SelectedInfo, Tool } from "../game/types";

type GameHudProps = {
  activeTool: Tool;
  cameraMode: CameraMode;
  pointerLocked: boolean;
  credits: number;
  motors: number;
  selected: SelectedInfo;
  beltBuildInfo: BeltBuildInfo;
  toast: string;
  toastVisible: boolean;
  onToolChange: (tool: Tool) => void;
  onCameraModeChange: () => void;
};

export default function GameHud({
  activeTool,
  cameraMode,
  pointerLocked,
  credits,
  motors,
  selected,
  beltBuildInfo,
  toast,
  toastVisible,
  onToolChange,
  onCameraModeChange,
}: GameHudProps) {
  const activeToolInfo = TOOL_INFO.find((tool) => tool.id === activeTool) ?? TOOL_INFO[0];
  const objectiveProgress = Math.min(100, (motors / 20) * 100);

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
          <div className="system-readout power-readout">
            <span>GRID</span>
            <strong>68 / 120</strong>
            <small>MW</small>
          </div>
        </div>

        <div className="objective-readout instrument-panel">
          <span className="objective-index">목표 01</span>
          <div className="objective-copy">
            <strong>조립품 생산</strong>
            <span>채굴 → 제련 → 조립</span>
          </div>
          <span className="objective-count"><b>{motors}</b> / 20</span>
          <div className="objective-track" aria-label={`조립품 생산 진행률 ${motors}/20`}>
            <div style={{ width: `${objectiveProgress}%` }} />
          </div>
        </div>
      </header>

      <aside className={`inspector instrument-panel ${selected ? "visible" : ""}`} aria-hidden={!selected}>
        <div className="inspector-rail">
          <span>EQP</span>
          <i />
        </div>
        <div className="inspector-body">
          <div className="inspector-head">
            <div>
              <span className="panel-label">선택 설비</span>
              <div className="inspector-title">{selected ? TYPE_NAME[selected.type] : "설비"}</div>
            </div>
            <div className="equipment-status">
              <i />
              <span>{selected?.status ?? "대기"}</span>
            </div>
          </div>

          <div className="process-meter">
            <div className="process-meter-head">
              <span>공정 진행</span>
              <strong>{selected ? `${Math.round(selected.progress * 100)}%` : "—"}</strong>
            </div>
            <div className="process-track">
              <div style={{ width: `${selected ? selected.progress * 100 : 0}%` }} />
            </div>
          </div>

          <dl className="equipment-data">
            <div>
              <dt>처리량</dt>
              <dd>{selected ? TYPE_RATE[selected.type] : "—"}</dd>
            </div>
            <div>
              <dt>입력 · 보관</dt>
              <dd>{selected?.inputCount ?? 0}</dd>
            </div>
            <div>
              <dt>출력 대기</dt>
              <dd>{selected?.outputCount ?? 0}</dd>
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
          <><span><kbd>WASD</kbd> 이동</span><span><kbd>휠</kbd> 줌</span><span><kbd>Q E</kbd> 회전</span></>
        )}
      </div>

      <div className="build-dock instrument-panel">
        <div className="active-tool-readout">
          <span>BUILD</span>
          <strong>{activeToolInfo.name}</strong>
          <em>{activeToolInfo.cost ? `₡ ${activeToolInfo.cost}` : "조작 도구"}</em>
        </div>
        <nav className="toolbar" aria-label="건설 도구">
          {TOOL_INFO.map((tool) => (
            <button
              key={tool.id}
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
      <button className="camera-mode-button instrument-panel" onClick={onCameraModeChange} aria-label="카메라 모드 전환">
        <span>{cameraMode === "firstPerson" ? "▦" : "◉"}</span>
        <strong>{cameraMode === "firstPerson" ? "건설 시점" : "현장 시점"}</strong>
        <kbd>V</kbd>
      </button>
    </div>
  );
}
