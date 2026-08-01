"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { START_REGISTRY } from "../game/data/index.ts";
import type { BuildingDefinition, UnlockId } from "../game/domain/types.ts";
import styles from "./BuildCatalog.module.css";

export type BuildCategory = "production" | "logistics" | "fluid" | "power";

export type BuildCatalogProps = Readonly<{
  unlockedIds?: readonly UnlockId[];
  inventoryByItemId?: Readonly<Partial<Record<string, number>>>;
  constructionCredits?: Readonly<Record<string, number>>;
  credits?: number;
  selectedBuildingId?: string | null;
  onSelect: (building: BuildingDefinition) => void;
  className?: string;
}>;

export type BuildCatalogEntry = Readonly<{
  building: BuildingDefinition;
  category: BuildCategory;
  unlocked: boolean;
  searchableText: string;
}>;

const CATEGORY_ORDER: readonly BuildCategory[] = ["production", "logistics", "fluid", "power"];
const CATEGORY_LABEL: Readonly<Record<BuildCategory, string>> = {
  production: "생산",
  logistics: "물류",
  fluid: "유체",
  power: "전력",
};
const CATEGORY_CODE: Readonly<Record<BuildCategory, string>> = {
  production: "PRD",
  logistics: "LOG",
  fluid: "FLD",
  power: "PWR",
};
const UNLOCK_LABEL: Readonly<Record<UnlockId, string>> = {
  start: "시작",
  phase_1_complete: "1단계 완료",
  phase_2_complete: "2단계 완료",
  phase_3_complete: "3단계 완료",
  chemistry_stable: "화학 안정화",
  thermal_verified: "열관리 검증",
};

const LOGISTICS_IDS = new Set([
  "conveyor_mk1", "conveyor_mk2", "conveyor_mk3", "splitter", "merger",
  "small_storage", "industrial_storage",
]);
const FLUID_IDS = new Set([
  "fluid_extractor", "fractionation_refinery", "fluid_tank", "pipe_mk1",
  "pipe_t_junction", "pipe_pump", "emergency_flare",
]);
const POWER_IDS = new Set([
  "solid_fuel_generator", "combined_fuel_turbine", "high_density_thermal_plant",
  "distribution_pole_mk1", "distribution_pole_mk2", "high_voltage_tower", "substation",
  "power_breaker", "priority_switchboard", "industrial_accumulator",
]);

export const categoryForBuilding = (building: BuildingDefinition): BuildCategory => {
  if (POWER_IDS.has(building.id)) return "power";
  if (FLUID_IDS.has(building.id)) return "fluid";
  if (LOGISTICS_IDS.has(building.id)) return "logistics";
  return "production";
};

const buildCostLabel = (building: BuildingDefinition) => building.buildCost
  .map(({ itemId, amount }) => `${START_REGISTRY.items.get(itemId)?.name ?? itemId} ${amount}`)
  .join(" ");

export const getBuildCatalogEntries = (
  unlockedIds: readonly UnlockId[] = ["start"],
  category: BuildCategory | "all" = "all",
  query = "",
): readonly BuildCatalogEntry[] => {
  const unlocked = new Set(unlockedIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  return [...START_REGISTRY.buildings.values()]
    .filter((building) => building.placementMode !== "preplaced_unique")
    .map((building) => {
      const buildingCategory = categoryForBuilding(building);
      const searchableText = `${building.name} ${building.id} ${CATEGORY_LABEL[buildingCategory]} ${buildCostLabel(building)}`.toLocaleLowerCase("ko-KR");
      return { building, category: buildingCategory, unlocked: unlocked.has(building.unlockId), searchableText };
    })
    .filter((entry) => (category === "all" || entry.category === category)
      && (normalizedQuery.length === 0 || entry.searchableText.includes(normalizedQuery)));
};

const categoryCount = (category: BuildCategory) =>
  getBuildCatalogEntries(["start", "phase_1_complete", "phase_2_complete", "phase_3_complete", "chemistry_stable", "thermal_verified"], category).length;

export default function BuildCatalog({
  unlockedIds = ["start"],
  inventoryByItemId,
  constructionCredits = {},
  credits,
  selectedBuildingId = null,
  onSelect,
  className,
}: BuildCatalogProps) {
  const [category, setCategory] = useState<BuildCategory>("production");
  const [query, setQuery] = useState("");
  const categoryRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const entries = useMemo(
    () => getBuildCatalogEntries(unlockedIds, category, query),
    [category, query, unlockedIds],
  );

  const moveCategoryFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % CATEGORY_ORDER.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = CATEGORY_ORDER.length - 1;
    else return;
    event.preventDefault();
    const nextCategory = CATEGORY_ORDER[next];
    setCategory(nextCategory);
    categoryRefs.current[next]?.focus();
  };

  return (
    <section className={`${styles.catalog}${className ? ` ${className}` : ""}`} aria-labelledby="build-catalog-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>A-17 / BUILD SYSTEM</span>
          <h2 id="build-catalog-title">건설 카탈로그</h2>
        </div>
        <output className={styles.resultCount} aria-live="polite">
          {credits === undefined ? null : <span className={styles.credits}>CR {Math.max(0, credits).toLocaleString("ko-KR")}</span>}
          <strong>{entries.length}</strong><span>개 설비</span>
        </output>
      </header>

      <label className={styles.search}>
        <span>설비 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="설비명, ID, 건설 재료"
          autoComplete="off"
        />
        <kbd aria-hidden="true">/</kbd>
      </label>

      <div className={styles.categories} role="tablist" aria-label="건설 설비 카테고리">
        {CATEGORY_ORDER.map((option, index) => (
          <button
            key={option}
            ref={(element) => { categoryRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`build-category-${option}`}
            aria-controls="build-catalog-grid"
            aria-selected={category === option}
            tabIndex={category === option ? 0 : -1}
            className={category === option ? styles.activeCategory : undefined}
            onClick={() => setCategory(option)}
            onKeyDown={(event) => moveCategoryFocus(event, index)}
          >
            <span>{CATEGORY_CODE[option]}</span>
            <strong>{CATEGORY_LABEL[option]}</strong>
            <small>{categoryCount(option)}</small>
          </button>
        ))}
      </div>

      <div
        id="build-catalog-grid"
        className={styles.grid}
        role="tabpanel"
        aria-labelledby={`build-category-${category}`}
      >
        {entries.length === 0 ? (
          <p className={styles.empty}>검색 조건에 맞는 설비가 없습니다.</p>
        ) : entries.map(({ building, category: entryCategory, unlocked }) => {
          const selected = selectedBuildingId === building.id;
          const powerLabel = building.activeMW === undefined ? null : `${building.activeMW} MW`;
          const creditId = building.id === "pipe_mk1" ? "pipe_mk1_length_m" : building.id;
          const availableCredit = constructionCredits[creditId] ?? 0;
          const sponsored = availableCredit >= 1;
          const affordable = sponsored || inventoryByItemId === undefined || building.buildCost.every(
            ({ itemId, amount }) => (inventoryByItemId[itemId] ?? 0) >= amount,
          );
          const selectable = unlocked && affordable;
          return (
            <button
              key={building.id}
              type="button"
              className={`${styles.card}${selected ? ` ${styles.selected}` : ""}${selectable ? "" : ` ${styles.locked}`}`}
              aria-pressed={selected}
              aria-disabled={!selectable}
              aria-label={`${building.name}, ${!unlocked ? `${UNLOCK_LABEL[building.unlockId]} 필요` : affordable ? "건설 가능" : "건설 재료 부족"}`}
              onClick={() => { if (selectable) onSelect(building); }}
            >
              <span className={styles.cardCode}>{CATEGORY_CODE[entryCategory]} · {building.id}</span>
              <span className={styles.cardGlyph} aria-hidden="true">{CATEGORY_CODE[entryCategory].slice(0, 1)}</span>
              <span className={styles.cardTitle}>{building.name}</span>
              <span className={styles.cardMeta}>
                <span>{building.footprint.x}×{building.footprint.z}</span>
                {powerLabel ? <span>{powerLabel}</span> : null}
                <span>{building.recipeIds.length > 0 ? `${building.recipeIds.length} 공정` : "기반 설비"}</span>
              </span>
              <span className={styles.costTitle}>건설 비용</span>
              {sponsored ? <span className={styles.credit}>스타터 크레딧 · {availableCredit}회 남음</span> : null}
              <span className={styles.costs}>
                {building.buildCost.map(({ itemId, amount }) => (
                  <span key={itemId}>
                    <i aria-hidden="true" />
                    {START_REGISTRY.items.get(itemId)?.name ?? itemId}
                    <b>×{amount}</b>
                    {inventoryByItemId === undefined ? null : <small>보유 {inventoryByItemId[itemId] ?? 0}</small>}
                  </span>
                ))}
              </span>
              <span className={styles.state}>
                {!unlocked
                  ? <><span aria-hidden="true">LOCK</span>{UNLOCK_LABEL[building.unlockId]}</>
                  : affordable ? "선택" : <><span aria-hidden="true">LOW</span>재료 부족</>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export type BuildCatalogDialogProps = BuildCatalogProps & Readonly<{
  open: boolean;
  onClose: () => void;
}>;

export function BuildCatalogDialog({ open, onClose, ...catalogProps }: BuildCatalogDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="건설 카탈로그" tabIndex={-1}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="건설 카탈로그 닫기">
          닫기 <kbd>ESC</kbd>
        </button>
        <BuildCatalog {...catalogProps} />
      </div>
    </div>
  );
}
