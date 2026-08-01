"use client";

import { useEffect, useRef, useState } from "react";
import GameHud from "./components/GameHud";
import { FactoryRuntime } from "./game/runtime";
import type { SelectedInfo, Tool } from "./game/types";

export default function FactoryGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<FactoryRuntime | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("inspect");
  const [credits, setCredits] = useState(1200);
  const [motors, setMotors] = useState(0);
  const [selected, setSelected] = useState<SelectedInfo>(null);
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
    });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const chooseTool = (tool: Tool) => runtimeRef.current?.setTool(tool);

  return (
    <main className="game-shell">
      <div ref={mountRef} className="game-canvas" />
      <GameHud
        activeTool={activeTool}
        credits={credits}
        motors={motors}
        selected={selected}
        toast={toast}
        toastVisible={toastVisible}
        onToolChange={chooseTool}
      />
    </main>
  );
}
