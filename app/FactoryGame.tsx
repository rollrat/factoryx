"use client";

import { useEffect, useRef, useState } from "react";
import GameHud from "./components/GameHud";
import { FactoryRuntime } from "./game/runtime";
import type { BeltBuildInfo, CameraMode, SelectedInfo, Tool } from "./game/types";

const IDLE_BELT_BUILD: BeltBuildInfo = {
  dragging: false,
  length: 0,
  cost: 0,
  valid: true,
  connectedStart: false,
};

export default function FactoryGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<FactoryRuntime | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("inspect");
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [credits, setCredits] = useState(1200);
  const [motors, setMotors] = useState(0);
  const [selected, setSelected] = useState<SelectedInfo>(null);
  const [beltBuildInfo, setBeltBuildInfo] = useState<BeltBuildInfo>(IDLE_BELT_BUILD);
  const [toast, setToast] = useState("출력 포트에서 벨트를 연결하세요");
  const [toastVisible, setToastVisible] = useState(true);

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
      onMotors: setMotors,
      onSelected: setSelected,
      onToast: showToast,
      onToolChange: setActiveTool,
      onCameraMode: setCameraMode,
      onPointerLock: setPointerLocked,
      onBeltBuildInfo: setBeltBuildInfo,
    });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const chooseTool = (tool: Tool) => runtimeRef.current?.setTool(tool);
  const toggleCameraMode = () => runtimeRef.current?.toggleCameraMode();

  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" />
      <GameHud
        activeTool={activeTool}
        cameraMode={cameraMode}
        pointerLocked={pointerLocked}
        credits={credits}
        motors={motors}
        selected={selected}
        beltBuildInfo={beltBuildInfo}
        toast={toast}
        toastVisible={toastVisible}
        onToolChange={chooseTool}
        onCameraModeChange={toggleCameraMode}
      />
    </main>
  );
}
