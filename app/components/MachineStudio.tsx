"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MachineType } from "../game/types";
import {
  MachineStudioRuntime,
  type MachineStudioMode,
  type MachineStudioStats,
  type MachineStudioView,
} from "../game/machineStudio";
import styles from "../studio/studio.module.css";

type MachineDefinition = {
  id: MachineType;
  short: string;
  label: string;
  code: string;
  cycleTitle: string;
  cycleLabels: [string, string, string, string];
  focus: string;
  modes: Record<MachineStudioMode, { label: string; description: string }>;
};

const MACHINES: MachineDefinition[] = [
  {
    id: "miner",
    short: "M",
    label: "채굴기",
    code: "IRON MINER / BLOCKOUT 02",
    cycleTitle: "채굴 주기",
    cycleLabels: ["시동", "하강", "채굴", "배출"],
    focus: "수직 드릴의 힘 전달, 지면 접촉점, 출력 슈트 연결",
    modes: {
      working: { label: "가동", description: "정상 채굴 사이클" },
      idle: { label: "대기", description: "연결됨, 정지 상태" },
      blocked: { label: "막힘", description: "출력 슈트 정체" },
      disconnected: { label: "미연결", description: "출력 벨트 없음" },
    },
  },
  {
    id: "smelter",
    short: "S",
    label: "제련기",
    code: "ARC SMELTER / BLOCKOUT 02",
    cycleTitle: "제련 주기",
    cycleLabels: ["투입", "가열", "안정", "주조"],
    focus: "광석 투입, 작은 노심 발광, 굴뚝 배기, 잉곳 주조 흐름",
    modes: {
      working: { label: "가동", description: "광석 제련 사이클" },
      idle: { label: "대기", description: "노심 냉각, 재료 대기" },
      blocked: { label: "막힘", description: "주조 슈트 잉곳 정체" },
      disconnected: { label: "미연결", description: "입출력 벨트 없음" },
    },
  },
  {
    id: "assembler",
    short: "A",
    label: "조립기",
    code: "PRECISION ASSEMBLER / BLOCKOUT 02",
    cycleTitle: "조립 주기",
    cycleLabels: ["투입", "고정", "가공", "배출"],
    focus: "두 입력 레인, 비대칭 공구, 중앙 작업셀, 단일 출력 흐름",
    modes: {
      working: { label: "가동", description: "2개 재료 조립 사이클" },
      idle: { label: "대기", description: "재료 두 개 대기" },
      blocked: { label: "막힘", description: "완성 부품 출력 정체" },
      disconnected: { label: "미연결", description: "입출력 벨트 없음" },
    },
  },
  {
    id: "storage",
    short: "C",
    label: "창고",
    code: "COMPACT STORAGE / BLOCKOUT 02",
    cycleTitle: "적재 미리보기",
    cycleLabels: ["비어 있음", "저용량", "적재 중", "가득 참"],
    focus: "입고 순간, 적층 모듈, 용량 게이지, 사람 크기 정비 구조",
    modes: {
      working: { label: "입고", description: "부품 수납 펄스" },
      idle: { label: "비어 있음", description: "입력 대기 상태" },
      blocked: { label: "가득 참", description: "400 슬롯 적재 완료" },
      disconnected: { label: "미연결", description: "입력 벨트 없음" },
    },
  },
];

const MODE_ORDER: MachineStudioMode[] = ["working", "idle", "blocked", "disconnected"];
const VIEWS: Array<{ id: MachineStudioView; label: string }> = [
  { id: "threeQuarter", label: "3/4" },
  { id: "output", label: "물류" },
  { id: "side", label: "측면" },
  { id: "top", label: "상단" },
];
const EMPTY_STATS: MachineStudioStats = { meshes: 0, triangles: 0, materials: 0 };

export default function MachineStudio() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MachineStudioRuntime | null>(null);
  const [machine, setMachine] = useState<MachineType>("miner");
  const [mode, setMode] = useState<MachineStudioMode>("working");
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [contextVisible, setContextVisible] = useState(true);
  const [silhouette, setSilhouette] = useState(false);
  const [stats, setStats] = useState<MachineStudioStats>(EMPTY_STATS);
  const studioStateRef = useRef({
    machine,
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
      machine,
      mode,
      playing,
      progress,
      speed,
      gridVisible,
      contextVisible,
      silhouette,
    };
  }, [contextVisible, gridVisible, machine, mode, playing, progress, silhouette, speed]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const runtime = new MachineStudioRuntime(mount, {
      onProgress: setProgress,
      onStats: setStats,
    });
    const current = studioStateRef.current;
    runtime.setMachine(current.machine);
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

  const definition = MACHINES.find((item) => item.id === machine) ?? MACHINES[0];
  const currentMode = definition.modes[mode];

  const chooseMachine = (nextMachine: MachineType) => {
    const nextProgress = nextMachine === "storage" ? 0.2 : 0;
    setMachine(nextMachine);
    setMode("working");
    setPlaying(true);
    setProgress(nextProgress);
    runtimeRef.current?.setMachine(nextMachine);
    runtimeRef.current?.setMode("working");
    runtimeRef.current?.setPlaying(true);
    runtimeRef.current?.setProgress(nextProgress);
  };

  const chooseMode = (nextMode: MachineStudioMode) => {
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

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>FX</span>
          <div>
            <strong>MACHINE DESIGN STUDIO</strong>
            <span>실시간 설비 모델 검사 환경</span>
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
          <div ref={mountRef} className={styles.viewport} data-testid="machine-studio-viewport" />
          <div className={styles.viewportTopLeft}>
            <span>{definition.code}</span>
            <strong>{currentMode.label}</strong>
          </div>
          <div className={styles.viewportBottomLeft}>드래그 회전 · 휠 확대 · 우클릭 이동</div>
          <div className={styles.axis} aria-hidden="true">
            <span className={styles.axisY}>Y</span>
            <span className={styles.axisX}>X</span>
            <span className={styles.axisZ}>Z</span>
          </div>
        </div>

        <aside className={styles.panel} aria-label="설비 디자인 제어판">
          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div><span>00 / MACHINE</span><h2>검사 설비</h2></div>
            </div>
            <div className={styles.machineGrid}>
              {MACHINES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.machineButton} ${machine === item.id ? styles.active : ""}`}
                  onClick={() => chooseMachine(item.id)}
                  aria-pressed={machine === item.id}
                  data-testid={`studio-machine-${item.id}`}
                >
                  <span>{item.short}</span>
                  <strong>{item.label}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div><span>01 / STATE</span><h2>작동 상태</h2></div>
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
              {MODE_ORDER.map((modeId) => {
                const item = definition.modes[modeId];
                return (
                  <button
                    key={modeId}
                    type="button"
                    className={`${styles.modeButton} ${mode === modeId ? styles.active : ""}`}
                    onClick={() => chooseMode(modeId)}
                    aria-pressed={mode === modeId}
                    data-testid={`studio-mode-${modeId}`}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <div><span>02 / CYCLE</span><h2>{definition.cycleTitle}</h2></div>
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
              aria-label={definition.cycleTitle}
              data-testid="studio-progress"
            />
            <div className={styles.cycleLabels}>
              {definition.cycleLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            <label className={styles.selectRow}>
              <span>재생 속도</span>
              <select
                value={speed}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSpeed(next);
                  runtimeRef.current?.setSpeed(next);
                }}
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
              <div><span>03 / INSPECT</span><h2>검사 뷰</h2></div>
            </div>
            <div className={styles.viewGrid}>
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => runtimeRef.current?.setView(view.id)}
                  data-testid={`studio-view-${view.id}`}
                >{view.label}</button>
              ))}
            </div>
            <div className={styles.toggleList}>
              <label>
                <input
                  type="checkbox"
                  checked={gridVisible}
                  onChange={(event) => {
                    setGridVisible(event.target.checked);
                    runtimeRef.current?.setGridVisible(event.target.checked);
                  }}
                  data-testid="studio-grid-toggle"
                />
                <span>그리드 표시</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={contextVisible}
                  onChange={(event) => {
                    setContextVisible(event.target.checked);
                    runtimeRef.current?.setContextVisible(event.target.checked);
                  }}
                  data-testid="studio-context-toggle"
                />
                <span>물류·광맥 표시</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={silhouette}
                  onChange={(event) => {
                    setSilhouette(event.target.checked);
                    runtimeRef.current?.setSilhouette(event.target.checked);
                  }}
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
            <p>{currentMode.description}. {definition.focus} 항목을 같은 화면에서 반복 확인합니다.</p>
          </section>
        </aside>
      </section>
    </main>
  );
}
