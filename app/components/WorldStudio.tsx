"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BIOMES, WORLD_STUDIO_STORAGE_KEY } from "../game/environment/index.ts";
import type { SurfaceType } from "../game/environment/types.ts";
import type { WeatherKind } from "../game/environment/render/WeatherSystem.ts";
import {
  WorldStudioRuntime,
  type WorldStudioBrush,
  type WorldStudioDocument,
  type WorldStudioOverlay,
  type WorldStudioStats,
  type WorldStudioView,
} from "../game/worldStudio.ts";
import styles from "../world-studio/world-studio.module.css";

const EMPTY_STATS: WorldStudioStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, activeChunks: 0, visibleProps: 0 };
const BRUSHES: readonly Readonly<{ id: WorldStudioBrush; label: string; key: string }>[] = [
  { id: "raise", label: "높이기", key: "1" },
  { id: "lower", label: "낮추기", key: "2" },
  { id: "flatten", label: "평탄화", key: "3" },
  { id: "smooth", label: "부드럽게", key: "4" },
  { id: "biome", label: "바이옴 페인트", key: "5" },
  { id: "surface", label: "표면 페인트", key: "6" },
];
const SURFACES: readonly Readonly<{ id: SurfaceType; label: string }>[] = [
  { id: "stable", label: "안정 기반암" },
  { id: "soft", label: "연약 지반" },
  { id: "steep", label: "급경사" },
  { id: "submerged", label: "침수" },
  { id: "hazard", label: "위험" },
  { id: "cave_floor", label: "동굴 바닥" },
];
const OVERLAYS: readonly Readonly<{ id: WorldStudioOverlay; label: string }>[] = [
  { id: "none", label: "자연색" }, { id: "biome", label: "바이옴" }, { id: "surface", label: "표면" },
  { id: "buildability", label: "건설 판정" }, { id: "chunks", label: "청크 LOD" },
];
const VIEWS: readonly Readonly<{ id: WorldStudioView; label: string }>[] = [
  { id: "overview", label: "오버뷰" }, { id: "firstPerson", label: "1인칭" },
  { id: "distance", label: "원경" }, { id: "caveCutaway", label: "동굴 절단" },
];

export default function WorldStudio() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<WorldStudioRuntime | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [brush, setBrush] = useState<WorldStudioBrush>("raise");
  const [radius, setRadius] = useState(8);
  const [strength, setStrength] = useState(0.6);
  const [biomeId, setBiomeId] = useState(BIOMES[0].id as string);
  const [surface, setSurface] = useState<SurfaceType>("stable");
  const [overlay, setOverlay] = useState<WorldStudioOverlay>("none");
  const [time, setTime] = useState(0.68);
  const [fog, setFog] = useState(0.0085);
  const [weather, setWeather] = useState<WeatherKind>("mineral_wind");
  const [weatherStrength, setWeatherStrength] = useState(0.34);
  const [propsVisible, setPropsVisible] = useState(true);
  const [landmarksVisible, setLandmarksVisible] = useState(true);
  const [notice, setNotice] = useState("좌클릭 드래그로 지형을 편집하세요. Alt+드래그는 카메라 회전입니다.");

  useEffect(() => {
    if (!mountRef.current) return;
    const runtime = new WorldStudioRuntime(mountRef.current, setStats);
    runtimeRef.current = runtime;
    const saved = window.localStorage.getItem(WORLD_STUDIO_STORAGE_KEY);
    if (saved) {
      try { if (runtime.importDocument(JSON.parse(saved))) setNotice("로컬 작업본을 불러왔습니다."); } catch { /* Ignore malformed local drafts. */ }
    }
    return () => { runtime.dispose(); runtimeRef.current = null; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const item = BRUSHES.find(({ key }) => key === event.key);
      if (!item) return;
      setBrush(item.id);
      runtimeRef.current?.setBrush(item.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const documentJson = () => JSON.stringify(runtimeRef.current?.exportDocument(), null, 2);
  const saveLocal = () => {
    window.localStorage.setItem(WORLD_STUDIO_STORAGE_KEY, documentJson());
    setNotice("이 브라우저에 작업본을 저장했습니다.");
  };
  const downloadJson = () => {
    const url = URL.createObjectURL(new Blob([documentJson()], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "a17-environment.world.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("환경 정의 JSON을 내보냈습니다.");
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as WorldStudioDocument;
      if (!runtimeRef.current?.importDocument(value)) throw new Error("invalid");
      setTime(value.timeOfDay);
      setFog(value.fogDensity);
      setWeather(value.weather);
      setWeatherStrength(value.weatherStrength);
      setNotice("환경 정의를 불러왔습니다.");
    } catch {
      setNotice("이 프로젝트에서 사용할 수 없는 환경 JSON입니다.");
    }
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><b>WX</b><div><strong>WORLD DESIGN STUDIO</strong><span>A-17 / 바람에 접힌 개척지</span></div></div>
        <div className={styles.headerActions}>
          <span className={styles.live}>LIVE</span>
          <button type="button" onClick={saveLocal}>로컬 저장</button>
          <button type="button" onClick={downloadJson}>JSON 내보내기</button>
          <button type="button" onClick={() => importRef.current?.click()}>불러오기</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(event) => void importJson(event.target.files?.[0])} />
          <Link href="/">공장으로</Link>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.leftPanel} aria-label="환경 편집 도구">
          <section>
            <span className={styles.eyebrow}>01 / TERRAIN</span><h2>지형 브러시</h2>
            <div className={styles.toolGrid}>{BRUSHES.map((item) => <button key={item.id} type="button" data-active={brush === item.id} onClick={() => { setBrush(item.id); runtimeRef.current?.setBrush(item.id); }}><kbd>{item.key}</kbd>{item.label}</button>)}</div>
            <label><span>반경 <output>{radius}m</output></span><input type="range" min="1" max="24" value={radius} onChange={(event) => { const value = Number(event.target.value); setRadius(value); runtimeRef.current?.setBrushRadius(value); }} /></label>
            <label><span>강도 <output>{strength.toFixed(2)}</output></span><input type="range" min="0.05" max="2" step="0.05" value={strength} onChange={(event) => { const value = Number(event.target.value); setStrength(value); runtimeRef.current?.setBrushStrength(value); }} /></label>
          </section>
          <section>
            <span className={styles.eyebrow}>02 / MASK</span><h2>바이옴·표면</h2>
            <label><span>바이옴</span><select value={biomeId} onChange={(event) => { setBiomeId(event.target.value); runtimeRef.current?.setBiome(event.target.value); }}>{BIOMES.map((biome) => <option key={biome.id} value={biome.id}>{biome.name}</option>)}</select></label>
            <label><span>표면 규칙</span><select value={surface} onChange={(event) => { const value = event.target.value as SurfaceType; setSurface(value); runtimeRef.current?.setSurface(value); }}>{SURFACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </section>
          <section>
            <span className={styles.eyebrow}>03 / SCATTER</span><h2>환경 레이어</h2>
            <label className={styles.check}><input type="checkbox" checked={propsVisible} onChange={(event) => { setPropsVisible(event.target.checked); runtimeRef.current?.setPropsVisible(event.target.checked); }} />암석·식생 군락</label>
            <label className={styles.check}><input type="checkbox" checked={landmarksVisible} onChange={(event) => { setLandmarksVisible(event.target.checked); runtimeRef.current?.setLandmarksVisible(event.target.checked); }} />대형 랜드마크</label>
          </section>
          <button className={styles.reset} type="button" onClick={() => { runtimeRef.current?.reset(); setNotice("편집 스트로크를 초기화했습니다."); }}>편집 초기화</button>
        </aside>

        <section className={styles.viewportPanel}>
          <div ref={mountRef} className={styles.viewport} data-testid="world-studio-viewport" />
          <div className={styles.viewportLabel}><span>SECTOR 00 / 256×256m</span><strong>{BIOMES.find(({ id }) => id === biomeId)?.name}</strong></div>
          <div className={styles.notice}>{notice}</div>
          <div className={styles.viewTabs}>{VIEWS.map((item) => <button key={item.id} type="button" onClick={() => runtimeRef.current?.setView(item.id)}>{item.label}</button>)}</div>
        </section>

        <aside className={styles.rightPanel} aria-label="환경 검사 제어">
          <section>
            <span className={styles.eyebrow}>04 / OVERLAY</span><h2>검사 오버레이</h2>
            <div className={styles.overlayGrid}>{OVERLAYS.map((item) => <button key={item.id} type="button" data-active={overlay === item.id} onClick={() => { setOverlay(item.id); runtimeRef.current?.setOverlay(item.id); }}>{item.label}</button>)}</div>
          </section>
          <section>
            <span className={styles.eyebrow}>05 / ATMOSPHERE</span><h2>하늘·날씨</h2>
            <label><span>시간 <output>{Math.round(time * 24).toString().padStart(2, "0")}:00</output></span><input type="range" min="0" max="1" step="0.01" value={time} onChange={(event) => { const value = Number(event.target.value); setTime(value); runtimeRef.current?.setTimeOfDay(value); }} /></label>
            <label><span>안개 <output>{fog.toFixed(3)}</output></span><input type="range" min="0" max="0.025" step="0.0005" value={fog} onChange={(event) => { const value = Number(event.target.value); setFog(value); runtimeRef.current?.setFogDensity(value); }} /></label>
            <label><span>날씨</span><select value={weather} onChange={(event) => { const value = event.target.value as WeatherKind; setWeather(value); runtimeRef.current?.setWeather(value, weatherStrength); }}><option value="clear">맑음</option><option value="mineral_wind">광물 바람</option><option value="mist">지면 안개</option><option value="electrical_storm">전기성 폭풍</option></select></label>
            <label><span>강도 <output>{Math.round(weatherStrength * 100)}%</output></span><input type="range" min="0" max="1" step="0.01" value={weatherStrength} onChange={(event) => { const value = Number(event.target.value); setWeatherStrength(value); runtimeRef.current?.setWeather(weather, value); }} /></label>
          </section>
          <section>
            <span className={styles.eyebrow}>06 / BUDGET</span><h2>실시간 성능</h2>
            <div className={styles.metrics}>
              <div data-pass={stats.fps >= 55}><span>FPS</span><strong>{stats.fps}</strong><small>목표 60</small></div>
              <div data-pass={stats.drawCalls <= 220}><span>드로우콜</span><strong>{stats.drawCalls}</strong><small>≤ 220</small></div>
              <div data-pass={stats.triangles <= 700000}><span>삼각형</span><strong>{stats.triangles.toLocaleString()}</strong><small>≤ 700k</small></div>
              <div data-pass={stats.activeChunks <= 25}><span>청크</span><strong>{stats.activeChunks}</strong><small>≤ 25</small></div>
              <div><span>소품</span><strong>{stats.visibleProps}</strong><small>인스턴스</small></div>
              <div><span>프레임</span><strong>{stats.frameMs}</strong><small>ms</small></div>
            </div>
          </section>
          <section className={styles.legend}><span className={styles.eyebrow}>BUILDABILITY</span><p><i data-color="ok" />바로 건설</p><p><i data-color="warn" />기초 필요</p><p><i data-color="bad" />건설 금지</p></section>
        </aside>
      </div>
    </main>
  );
}
