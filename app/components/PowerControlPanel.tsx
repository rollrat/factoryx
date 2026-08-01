"use client";

import type { RuntimePowerControlSnapshot } from "../game/runtime.ts";
import type { LoadPriority } from "../game/sim/powerGrid.ts";
import styles from "./PowerControlPanel.module.css";

type Props = Readonly<{
  snapshot: RuntimePowerControlSnapshot;
  onClose: () => void;
  onToggleBreaker: (instanceId: string) => void;
  onTogglePriority: (instanceId: string, priority: LoadPriority) => void;
  onRestart: () => void;
}>;

const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

export default function PowerControlPanel({
  snapshot,
  onClose,
  onToggleBreaker,
  onTogglePriority,
  onRestart,
}: Props) {
  const satisfaction = snapshot.requestedMW > 0 ? snapshot.servedMW / snapshot.requestedMW : 1;
  return (
    <section className={styles.panel} role="dialog" aria-modal="true" aria-label="전력망 제어실">
      <header className={styles.header}>
        <div><span>POWER CONTROL / LIVE</span><h2>전력망 제어실</h2></div>
        <button type="button" onClick={onClose} aria-label="전력망 제어실 닫기">닫기 <kbd>ESC</kbd></button>
      </header>

      <div className={styles.metrics}>
        <div><span>실제 공급</span><strong>{number(snapshot.servedMW)} MW</strong></div>
        <div><span>현재 요청</span><strong>{number(snapshot.requestedMW)} MW</strong></div>
        <div><span>가용 발전</span><strong>{number(snapshot.dispatchableMW)} MW</strong></div>
        <div><span>이름표 용량</span><strong>{number(snapshot.capacityMW)} MW</strong></div>
        <div><span>축전량</span><strong>{number(snapshot.storedMWh)} MWh</strong></div>
        <div><span>만족도</span><strong>{Math.round(satisfaction * 100)}%</strong></div>
      </div>

      {snapshot.mainBreakerTripped ? (
        <div className={styles.trip} role="alert">
          <span>주 차단기 트립</span>
          <button type="button" onClick={onRestart}>P1부터 순차 재기동</button>
        </div>
      ) : (
        <button className={styles.restart} type="button" onClick={onRestart}>전체 순차 재기동</button>
      )}

      <div className={styles.grid}>
        <section>
          <h3>연결 구역</h3>
          <ul className={styles.zones}>
            {snapshot.zones.map((zone, index) => (
              <li key={zone.id} data-connected={zone.connected}>
                <span><i /> GRID {index + 1}</span>
                <strong>{zone.connected ? "송전 중" : "독립/미연결"}</strong>
                <small>발전 {zone.generators} · 소비 {zone.consumers} · 축전 {zone.batteries}</small>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>차단기</h3>
          {snapshot.breakers.length ? snapshot.breakers.map((breaker) => (
            <button
              className={styles.controlRow}
              type="button"
              key={breaker.instanceId}
              data-enabled={breaker.state === "closed"}
              aria-pressed={breaker.state === "closed"}
              onClick={() => onToggleBreaker(breaker.instanceId)}
            >
              <span>{breaker.name}</span><strong>{breaker.state === "closed" ? "투입" : breaker.state === "tripped" ? "트립" : "차단"}</strong>
            </button>
          )) : <p className={styles.empty}>설치된 전력 차단기가 없습니다.</p>}
        </section>

        <section className={styles.switchboards}>
          <h3>우선순위 구역</h3>
          {snapshot.switchboards.length ? snapshot.switchboards.map((board) => (
            <div className={styles.board} key={board.instanceId}>
              <strong>{board.name}</strong>
              <div>{([1, 2, 3, 4] as const).map((priority) => (
                <button
                  type="button"
                  key={priority}
                  data-enabled={board.outputs[priority]}
                  aria-pressed={board.outputs[priority]}
                  onClick={() => onTogglePriority(board.instanceId, priority)}
                >P{priority}<small>{board.outputs[priority] ? "ON" : "OFF"}</small></button>
              ))}</div>
            </div>
          )) : <p className={styles.empty}>우선순위 분전반을 설치하면 P1~P4 구역을 원격 차단할 수 있습니다.</p>}
        </section>
      </div>
    </section>
  );
}
