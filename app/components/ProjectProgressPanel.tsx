"use client";

import {
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { START_REGISTRY } from "../game/data/index.ts";
import type { ProjectStageId } from "../game/domain/types.ts";
import { CampaignProjectTracker, type CampaignSnapshot } from "../game/sim/campaign.ts";
import styles from "./ProjectProgressPanel.module.css";

const STAGE_LABELS: Readonly<Record<string, string>> = {
  phase_1_settlement_package: "기초 정착 패키지",
  phase_2_industrial_power_node: "산업 전력 노드",
  phase_3_automation_core: "자동화 코어",
  phase_4_chemistry_stabilization: "화학 안정화",
  phase_4_thermal_management_verification: "열관리 검증",
  phase_4_colony_seed: "AX-17 개척 시드",
};

const UNLOCK_LABELS: Readonly<Record<string, string>> = {
  phase_1_complete: "산업 생산 체계",
  phase_2_complete: "자동화 생산 체계",
  phase_3_complete: "유체·석유 생산 체계",
  chemistry_stable: "경량 합금 생산 체계",
  thermal_verified: "고밀도 열관리 체계",
};

const CREDIT_LABELS: Readonly<Record<string, string>> = {
  pipe_mk1_length_m: "파이프 Mk.1",
  pipe_t_junction: "파이프 T 접합부",
  fluid_tank: "유체 탱크",
  pipe_pump: "파이프 펌프",
};

export type ProjectPanelStageStatus = "completed" | "current" | "locked" | "available";

export type ProjectProgressDeliveryView = Readonly<{
  portId: string;
  itemId: string;
  name: string;
  color: string;
  medium: "solid" | "fluid";
  unit: "item" | "m3";
  required: number;
  delivered: number;
  remaining: number;
  progress: number;
  completed: boolean;
}>;

export type ProjectProgressStageView = Readonly<{
  id: ProjectStageId;
  index: number;
  name: string;
  status: ProjectPanelStageStatus;
  completed: boolean;
  progress: number;
  deliveredTotal: number;
  requiredTotal: number;
  prerequisites: readonly Readonly<{ id: ProjectStageId; name: string; completed: boolean }>[];
  deliveries: readonly ProjectProgressDeliveryView[];
  power: Readonly<{
    mode: "manual" | "powered";
    requiredMW: number;
    suppliedMW: number;
    satisfied: boolean;
  }>;
  rewards: readonly string[];
  nextUnlock: string | null;
}>;

export type ProjectProgressView = Readonly<{
  stages: readonly ProjectProgressStageView[];
  currentStageId: ProjectStageId | null;
  completedCount: number;
  totalCount: number;
}>;

const nameStage = (id: ProjectStageId) => STAGE_LABELS[id] ?? id;
const colorValue = (value: number | `#${string}`) => (
  typeof value === "number" ? `#${value.toString(16).padStart(6, "0")}` : value
);

const rewardLabels = (stageId: ProjectStageId) => {
  const stage = START_REGISTRY.projectStages.get(stageId);
  if (!stage) return [];
  const labels: string[] = [];
  const resourceIds = new Set(stage.rewards.resourceIds ?? []);

  resourceIds.forEach((id) => labels.push(`자원 · ${START_REGISTRY.items.get(id)?.name ?? id}`));
  (stage.rewards.itemIds ?? []).forEach((id) => {
    if (!resourceIds.has(id)) labels.push(`품목 · ${START_REGISTRY.items.get(id)?.name ?? id}`);
  });
  stage.rewards.buildingIds.forEach((id) => labels.push(`설비 · ${START_REGISTRY.buildings.get(id)?.name ?? id}`));
  stage.rewards.recipeIds.forEach((id) => labels.push(`제법 · ${START_REGISTRY.recipes.get(id)?.name ?? id}`));
  Object.entries(stage.rewards.constructionCredits ?? {}).forEach(([id, amount]) => {
    const unit = id.endsWith("_length_m") ? "m" : "개";
    labels.push(`건설 지급 · ${CREDIT_LABELS[id] ?? id} ${amount}${unit}`);
  });
  return labels;
};

/** Converts persisted campaign state into a complete, presentation-ready six-stage view. */
export const buildProjectProgressView = (
  snapshot: CampaignSnapshot,
  suppliedPowerMW = 0,
): ProjectProgressView => {
  const tracker = new CampaignProjectTracker(START_REGISTRY, snapshot);
  const progressById = new Map(tracker.allProgress().map((progress) => [progress.stageId, progress]));
  const completed = new Set(
    tracker.allProgress().filter((progress) => progress.completed).map((progress) => progress.stageId),
  );
  const currentStageId = [...START_REGISTRY.projectStages.values()]
    .find((stage) => !completed.has(stage.id) && stage.prerequisiteIds.every((id) => completed.has(id)))?.id ?? null;

  const stages = [...START_REGISTRY.projectStages.values()].map((stage, index): ProjectProgressStageView => {
    const progress = progressById.get(stage.id);
    if (!progress) throw new Error(`missing project progress: ${stage.id}`);
    const unlocked = stage.prerequisiteIds.every((id) => completed.has(id));
    const requiredMW = stage.dockPowerMode === "powered" ? stage.requiredPowerMW ?? 32 : 0;
    return {
      id: stage.id,
      index: index + 1,
      name: nameStage(stage.id),
      status: progress.completed
        ? "completed"
        : stage.id === currentStageId
          ? "current"
          : unlocked ? "available" : "locked",
      completed: progress.completed,
      progress: progress.totalProgress,
      deliveredTotal: progress.deliveredTotal,
      requiredTotal: progress.requiredTotal,
      prerequisites: stage.prerequisiteIds.map((id) => ({ id, name: nameStage(id), completed: completed.has(id) })),
      deliveries: progress.deliveries.map((delivery) => {
        const definition = START_REGISTRY.items.get(delivery.itemId);
        const requirement = stage.deliveries.find(({ portId }) => portId === delivery.portId);
        return {
          ...delivery,
          name: definition?.name ?? delivery.itemId,
          color: definition ? colorValue(definition.defaultColor) : "#8ea09f",
          medium: requirement?.medium ?? "solid",
          unit: definition?.unit ?? "item",
        };
      }),
      power: {
        mode: stage.dockPowerMode,
        requiredMW,
        suppliedMW: Math.max(0, suppliedPowerMW),
        satisfied: stage.dockPowerMode === "manual" || suppliedPowerMW >= requiredMW,
      },
      rewards: rewardLabels(stage.id),
      nextUnlock: stage.completionUnlockId
        ? UNLOCK_LABELS[stage.completionUnlockId] ?? stage.completionUnlockId
        : null,
    };
  });

  return { stages, currentStageId, completedCount: completed.size, totalCount: stages.length };
};

export type ProjectProgressPanelProps = Readonly<{
  snapshot: CampaignSnapshot;
  suppliedPowerMW?: number;
  initialStageId?: ProjectStageId;
  onStageSelect?: (stageId: ProjectStageId) => void;
  className?: string;
}>;

const formatAmount = (amount: number, unit: "item" | "m3") => `${amount.toLocaleString("ko-KR")}${unit === "m3" ? " m³" : "개"}`;

export function ProjectProgressPanel({
  snapshot,
  suppliedPowerMW = 0,
  initialStageId,
  onStageSelect,
  className,
}: ProjectProgressPanelProps) {
  const view = useMemo(() => buildProjectProgressView(snapshot, suppliedPowerMW), [snapshot, suppliedPowerMW]);
  const fallbackId = initialStageId ?? view.currentStageId ?? view.stages.at(-1)?.id ?? "";
  const [selectedId, setSelectedId] = useState<ProjectStageId>(fallbackId);
  const selected = view.stages.find(({ id }) => id === selectedId) ?? view.stages[0];

  const select = (id: ProjectStageId) => {
    setSelectedId(id);
    onStageSelect?.(id);
  };
  const onStageKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = (index + 1) % view.stages.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = (index - 1 + view.stages.length) % view.stages.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = view.stages.length - 1;
    else return;
    event.preventDefault();
    select(view.stages[target].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[target]?.focus();
  };

  if (!selected) return null;
  const statusLabel = selected.completed ? "완료" : selected.status === "locked" ? "잠김" : "진행 중";

  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")} aria-labelledby="project-panel-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ORBITAL PROJECT CONTRACTS</span>
          <h2 id="project-panel-title">프로젝트 진행 상황</h2>
        </div>
        <div className={styles.overall} aria-label={`${view.totalCount}단계 중 ${view.completedCount}단계 완료`}>
          <strong>{view.completedCount}</strong><span>/ {view.totalCount} 완료</span>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.stageRail} role="tablist" aria-label="프로젝트 계약 단계" aria-orientation="vertical">
          {view.stages.map((stage, index) => (
            <button
              key={stage.id}
              id={`project-tab-${stage.id}`}
              role="tab"
              type="button"
              aria-selected={stage.id === selected.id}
              aria-controls={`project-panel-${stage.id}`}
              tabIndex={stage.id === selected.id ? 0 : -1}
              className={styles.stageTab}
              data-status={stage.status}
              onClick={() => select(stage.id)}
              onKeyDown={(event) => onStageKeyDown(event, index)}
            >
              <span className={styles.stageIndex}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.stageIdentity}><strong>{stage.name}</strong><small>{stage.status === "locked" ? "선행 계약 필요" : `${Math.round(stage.progress * 100)}% 진행`}</small></span>
              <span className={styles.stageMark} aria-hidden="true">{stage.completed ? "✓" : stage.status === "locked" ? "◇" : "●"}</span>
            </button>
          ))}
        </nav>

        <article
          className={styles.detail}
          id={`project-panel-${selected.id}`}
          role="tabpanel"
          aria-labelledby={`project-tab-${selected.id}`}
        >
          <div className={styles.detailHeader}>
            <div>
              <span className={styles.contractCode}>CONTRACT {String(selected.index).padStart(2, "0")}</span>
              <h3>{selected.name}</h3>
            </div>
            <span className={styles.status} data-status={selected.status}>{statusLabel}</span>
          </div>

          <div className={styles.progressBlock}>
            <div className={styles.progressMeta}><span>납품 총 진행률</span><strong>{Math.round(selected.progress * 100)}%</strong></div>
            <div className={styles.progressTrack} role="progressbar" aria-label={`${selected.name} 납품 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(selected.progress * 100)}>
              <span style={{ width: `${selected.progress * 100}%` }} />
            </div>
          </div>

          {selected.prerequisites.length > 0 && (
            <section className={styles.section} aria-labelledby="project-prerequisite-title">
              <h4 id="project-prerequisite-title">선행 조건</h4>
              <div className={styles.prerequisites}>
                {selected.prerequisites.map((prerequisite) => <span key={prerequisite.id} data-complete={prerequisite.completed}>{prerequisite.completed ? "✓" : "◇"} {prerequisite.name}</span>)}
              </div>
            </section>
          )}

          <section className={styles.section} aria-labelledby="project-delivery-title">
            <h4 id="project-delivery-title">품목별 부분 납품</h4>
            <div className={styles.deliveries}>
              {selected.deliveries.map((delivery) => (
                <div className={styles.delivery} key={delivery.portId}>
                  <span className={styles.itemSwatch} style={{ background: delivery.color }} aria-hidden="true" />
                  <div className={styles.deliveryName}><strong>{delivery.name}</strong><small>{delivery.medium === "fluid" ? "유체 입력" : "컨베이어 입력"}</small></div>
                  <div className={styles.deliveryAmount}><strong>{formatAmount(delivery.delivered, delivery.unit)}</strong><span>/ {formatAmount(delivery.required, delivery.unit)}</span></div>
                  <div className={styles.deliveryTrack} aria-hidden="true"><span style={{ width: `${delivery.progress * 100}%` }} /></div>
                  <span className={styles.remaining}>{delivery.completed ? "납품 완료" : `${formatAmount(delivery.remaining, delivery.unit)} 남음`}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.power} data-ready={selected.power.satisfied}>
            <div><span className={styles.powerIcon} aria-hidden="true">ϟ</span><strong>도킹 전력</strong></div>
            {selected.power.mode === "manual"
              ? <span>수동 잠금 · 전력 불필요</span>
              : <span><strong>{selected.power.requiredMW} MW 필요</strong> · {selected.power.suppliedMW} MW 공급 · {selected.power.satisfied ? "전력 준비" : "전력 부족"}</span>}
          </section>

          <section className={styles.section} aria-labelledby="project-reward-title">
            <div className={styles.rewardHeading}><h4 id="project-reward-title">완료 보상</h4>{selected.nextUnlock && <span>다음 해금 · {selected.nextUnlock}</span>}</div>
            <ul className={styles.rewards}>
              {selected.rewards.map((reward) => <li key={reward}>{reward}</li>)}
            </ul>
          </section>
        </article>
      </div>
    </section>
  );
}

export default ProjectProgressPanel;
