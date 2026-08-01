"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MinerStudioRuntime,
  type MinerStudioMode,
  type MinerStudioStats,
  type MinerStudioView,
} from "../game/minerStudio";
import styles from "../studio/studio.module.css";

const MODES: Array<{ id: MinerStudioMode; label: string; description: string }> = [
  { id: "working", label: "가동", description: "정상 채굴 사이클" },
  { id: "idle", label: "대기", description: "연결됨, 정지 상태" },
  { id: "blocked", label: "막힘", description: "출력 슈트 정체" },
  { id: "disconnected", label: "미연결", description: "출력 벨트 없음" },
];

const VIEWS: Array<{ id: MinerStudioView; label: string }> = [
  { id: "threeQuarter", label: "3/4" },
  { id: "output", label: "출력" },
  { id: "side", label: "측면" },
  { id: "top", label: "상단" },
];

const EMPTY_STATS: MinerStudioStats = { meshes: 0, triangles: 0, materials: 0 };

export default function MinerStudio() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MinerStudioRuntime | null>(null);
  const [mode, setMode] = useState<MinerStudioMode>("working");
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [contextVisible, setContextVisible] = useState(true);
  const [silhouette, setSilhouette] = useState(false);
  const [stats, setStats] = useState<MinerStudioStats>(EMPTY_STATS);
  const studioStateRef = useRef({
    mode,
    playing,
    progress,
    speed,
    gridVisible,
    contextVisible,
    silhouette,
  });

  useEffect(() => {
    studioStateRef.current = {
      mode,
      playing,
      progress,
      speed,
      gridVisible,
      contextVisible,
      silhouette,
    };
  }, [contextVisible, gridVisible, mode, playing, progress, silhouette, speed]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const runtime = new MinerStudioRuntime(mount, {
      onProgress: setProgress,
      onStats: setStats,
    });
    const current = studioStateRef.current;
    runtime.setMode(current.mode);
    runtime.setPlaying(current.playing);
    runtime.setProgress(current.progress);
    runtime.setSpeed(current.speed);
    runtime.setGridVisible(current.gridVisible);
    runtime.setContextVisible(current.contextVisible);
    runtime.setSilhouette(current.silhouette);
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const chooseMode = (nextMode: MinerStudioMode) => {
    const shouldPlay = nextMode === "working";
    setMode(nextMode);
    setPlaying(shouldPlay);
    runtimeRef.current?.setMode(nextMode);
    runtimeRef.current?.setPlaying(shouldPlay);
  };

  const togglePlayback = () => {
    const next = !playing;
    setPlaying(next);
    if (next) setMode("working");
    runtimeRef.current?.setPlaying(next);
  };

  const changeProgress = (value: number) => {
    setProgress(value);
    setPlaying(false);
    setMode("working");
    runtimeRef.current?.setMode("working");
    runtimeRef.current?.setPlaying(false);
    runtimeRef.current?.setProgress(value);
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    runtimeRef.current?.setSpeed(value);
  };

  const changeGrid = (next: boolean) => {
    setGridVisible(next);
    runtimeRef.current?.setGridVisible(next);
  };

  const changeContext = (next: boolean) => {
    setContextVisible(next);
    runtimeRef.current?.setContextVisible(next);
  };

  const changeSilhouette = (next: boolean) => {
    setSilhouette(next);
    runtimeRef.current?.setSilhouette(next);
  };

  const currentMode = MODES.find((item) => item.id === mode) ?? MODES[0];

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>FX</span>
          <div>
            <strong>MINER DESIGN STUDIO</strong>
            <span>실시간 모델 검사 환경</span>
          </div>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.liveDot} />
          로컬 라이브
          <Link href="/" className={styles.backLink}>공장으로 돌아가기</Link>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.viewportPanel}>
          <div ref={mountRef} className={styles.viewport} data-testid="miner-studio-viewport" />
          <div className={styles.viewportTopLeft}>
            <span>IRON MINER / BLOCKOUT 01</span>
            <strong>{currentMode.label}</strong>
          </div>
          <div className={styles.viewportBottomLeft}>
            드래그 회전 · 휠 확대 · 우클릭 이동
          </div>
          <div className={styles.axis} aria-hidden="true">
            <span className={styles.axisY}>Y</span>
            <span className={styles.axisX}>X</span>
            <span className={styles.axisZ}>Z</span>
          </div>
        </div>

        <aside className={styles.panel} aria-label="채굴기 디자인 제어판">
          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>01 / STATE</span>
                <h2>작동 상태</h2>
              </div>
              <button
                type="button"
                className={playing ? styles.pauseButton : styles.playButton}
                onClick={togglePlayback}
                data-testid="studio-playback"
              >
                {playing ? "일시정지" : "재생"}
              </button>
            </div>
            <div className={styles.modeGrid}>
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.modeButton} ${mode === item.id ? styles.active : ""}`}
                  onClick={() => chooseMode(item.id)}
                  aria-pressed={mode === item.id}
                  data-testid={`studio-mode-${item.id}`}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>02 / CYCLE</span>
                <h2>생산 주기</h2>
              </div>
              <output aria-live="polite">{Math.round(progress * 100)}%</output>
            </div>
            <input
              className={styles.range}
              type="range"
              min="0"
              max="1"
              step="0.005"
              value={progress}
              onChange={(event) => changeProgress(Number(event.target.value))}
              aria-label="생산 진행도"
              data-testid="studio-progress"
            />
            <div className={styles.cycleLabels}>
              <span>시동</span>
              <span>하강</span>
              <span>채굴</span>
              <span>배출</span>
            </div>
            <label className={styles.selectRow}>
              <span>재생 속도</span>
              <select
                value={speed}
                onChange={(event) => changeSpeed(Number(event.target.value))}
                aria-label="재생 속도"
                data-testid="studio-speed"
              >
                <option value="0.5">0.5×</option>
                <option value="1">1.0×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2.0×</option>
              </select>
            </label>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>03 / INSPECT</span>
                <h2>검사 뷰</h2>
              </div>
            </div>
            <div className={styles.viewGrid}>
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => runtimeRef.current?.setView(view.id)}
                  data-testid={`studio-view-${view.id}`}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <div className={styles.toggleList}>
              <label>
                <input
                  type="checkbox"
                  checked={gridVisible}
                  onChange={(event) => changeGrid(event.target.checked)}
                  data-testid="studio-grid-toggle"
                />
                <span>그리드 표시</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={contextVisible}
                  onChange={(event) => changeContext(event.target.checked)}
                  data-testid="studio-context-toggle"
                />
                <span>광맥·벨트 표시</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={silhouette}
                  onChange={(event) => changeSilhouette(event.target.checked)}
                  data-testid="studio-silhouette-toggle"
                />
                <span>실루엣 검사</span>
              </label>
            </div>
          </section>

          <section className={styles.metrics} aria-label="모델 통계">
            <div><span>메시</span><strong>{stats.meshes}</strong></div>
            <div><span>삼각형</span><strong>{stats.triangles.toLocaleString()}</strong></div>
            <div><span>재질</span><strong>{stats.materials}</strong></div>
          </section>

          <section className={styles.reviewNote}>
            <span>DESIGN CHECK</span>
            <p>{currentMode.description}. 원거리 실루엣, 출력 방향, 힘 전달 구조를 같은 화면에서 반복 확인합니다.</p>
          </section>
        </aside>
      </section>
    </main>
  );
}
