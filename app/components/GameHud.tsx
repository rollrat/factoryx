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
  return (
    <div className={`hud ${cameraMode === "firstPerson" ? "first-person" : ""}`}>
      <header className="topbar glass">
        <div className="brand">
          <div className="brand-mark">FX</div>
          <div>
            <div className="brand-name">FACTORY X</div>
            <div className="brand-sub">SECTOR A-17</div>
          </div>
        </div>
        <div className="divider" />
        <div className="metric-row">
          <div className="metric">
            <div className="metric-label">Credits</div>
            <div className="metric-value amber">₡ {credits.toLocaleString("ko-KR")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Power grid</div>
            <div className="metric-value cyan">68 / 120 MW</div>
          </div>
        </div>
        <div className="objective">
          <div className="objective-head">
            <strong>첫 자동화 라인</strong>
            <span>{motors} / 20 조립품</span>
          </div>
          <div className="progress" aria-label={`조립품 생산 진행률 ${motors}/20`}>
            <div style={{ width: `${Math.min(100, (motors / 20) * 100)}%` }} />
          </div>
        </div>
      </header>

      <section className="left-panel glass">
        <div className="eyebrow">ACTIVE MISSION</div>
        <h1 className="mission-title">자동화의 첫 박자</h1>
        <p className="mission-copy">출력 포트 방향으로 벨트를 연결해 광석을 주괴와 조립품으로 변환하세요.</p>
        <div className="mission-step">
          <span className="step-check">✓</span>
          <span>채굴 → 제련 → 조립 라인 가동</span>
        </div>
        <div className="mission-step">
          <span className="step-check">2</span>
          <span>주황 출력 포트에서 청록 입력 포트 방향으로 벨트를 연결하세요.</span>
        </div>
      </section>

      <aside className={`inspector glass ${selected ? "visible" : ""}`} aria-hidden={!selected}>
        <div className="eyebrow">EQUIPMENT</div>
        <div className="inspector-head">
          <div className="inspector-title">{selected ? TYPE_NAME[selected.type] : "설비"}</div>
          <span className="status-pill">{selected?.status ?? "대기"}</span>
        </div>
        <div className="inspector-grid">
          <div className="inspector-cell">
            <span>처리량</span>
            <strong>{selected ? TYPE_RATE[selected.type] : "—"}</strong>
          </div>
          <div className="inspector-cell">
              <span>공정 진행</span>
              <strong>{selected ? `${Math.round(selected.progress * 100)}%` : "—"}</strong>
          </div>
          <div className="inspector-cell">
              <span>입력·보관</span>
              <strong>{selected?.inputCount ?? 0}</strong>
          </div>
          <div className="inspector-cell">
              <span>출력 대기</span>
              <strong>{selected?.outputCount ?? 0}</strong>
          </div>
        </div>
      </aside>

      <div className={`toast ${toastVisible ? "visible" : ""}`} role="status">
        {toast}
      </div>

      {cameraMode === "overview" && activeTool === "belt" ? (
        <section className={`belt-build-panel glass ${beltBuildInfo.dragging ? "is-routing" : ""}`}>
          <div className="belt-build-icon" aria-hidden="true">
            <span /><span /><span />
          </div>
          <div className="belt-build-copy">
            <div className="belt-build-heading">
              <strong>컨베이어 경로</strong>
              {beltBuildInfo.dragging ? (
                <span className={beltBuildInfo.valid ? "route-valid" : "route-invalid"}>
                  {beltBuildInfo.valid ? "설치 가능" : "경로 막힘"}
                </span>
              ) : null}
            </div>
            <p>
              {beltBuildInfo.dragging
                ? `${beltBuildInfo.length}칸 · ${beltBuildInfo.cost.toLocaleString("ko-KR")} 크레딧`
                : "시작점을 누른 채 끝 지점까지 드래그"}
            </p>
            <div className="belt-build-controls">
              <span><kbd>SHIFT</kbd> 꺾임 우선</span>
              <span><kbd>R</kbd> 한 칸 방향</span>
              {beltBuildInfo.connectedStart ? <em>출력 포트 연결됨</em> : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="hintbar glass">
        {cameraMode === "firstPerson" ? (
          <><kbd>클릭</kbd> 시점 고정 <kbd>WASD</kbd> 이동 <kbd>SHIFT</kbd> 달리기 <kbd>V</kbd> 건설 시점</>
        ) : (
          <><kbd>WASD</kbd> 이동 <kbd>휠</kbd> 줌 <kbd>Q E</kbd> 회전 <kbd>V</kbd> 1인칭</>
        )}
      </div>

      <div className="toolbar-wrap glass">
        <nav className="toolbar" aria-label="건설 도구">
          {TOOL_INFO.map((tool) => (
            <button
              key={tool.id}
              className={`tool-button ${activeTool === tool.id ? "active" : ""}`}
              onClick={() => onToolChange(tool.id)}
              aria-pressed={activeTool === tool.id}
              aria-label={`${tool.name}${tool.cost ? `, 비용 ${tool.cost}` : ""}`}
            >
              <span className="tool-key">{tool.key}</span>
              {tool.id === "belt" ? (
                <span className="belt-tool-glyph" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="tool-glyph">{tool.glyph}</span>
              )}
              <span className="tool-name">{tool.name}</span>
              {tool.cost ? <span className="tool-cost">₡ {tool.cost}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      {cameraMode === "firstPerson" ? <div className="crosshair" aria-hidden="true" /> : null}
      {cameraMode === "firstPerson" && !pointerLocked ? <div className="pointer-lock-tip glass">화면을 클릭해 둘러보기</div> : null}
      <button className="camera-mode-button glass" onClick={onCameraModeChange} aria-label="카메라 모드 전환">
        <span>{cameraMode === "firstPerson" ? "▦" : "◉"}</span>
        {cameraMode === "firstPerson" ? "건설 시점" : "1인칭 탐험"}
        <kbd>V</kbd>
      </button>
    </div>
  );
}
