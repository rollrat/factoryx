import type { UnlockId } from "../domain/types.ts";

export type ExplorationReward = Readonly<{
  creditId: string;
  amount: number;
  label: string;
  unlockId?: UnlockId;
  recipeId?: string;
}>;
export type ExplorationSiteDefinition = Readonly<{
  id: string;
  name: string;
  position: Readonly<{ x: number; z: number }>;
  stratumId: string;
  discoveryRadius: number;
  reward: ExplorationReward;
  lore: string;
}>;

export const EXPLORATION_SITES = [
  { id: "windglass_calibration", name: "쌍침 측량 표식", position: { x: -24, z: -18 }, stratumId: "surface", discoveryRadius: 5, reward: { creditId: "foundation_2m", amount: 4, label: "산업 기초 설계권 4회 · 철판 직접 주조", unlockId: "survey_casting", recipeId: "alt_direct_cast_iron_plate" }, lore: "서풍에 닳은 쌍침의 자기 편차 기록이다. 낮은 풍압에서도 용탕을 얇게 펴는 직접 주조 조건이 남아 있다." },
  { id: "fault_bridge_cache", name: "철풍 교량 관측점", position: { x: 54, z: -42 }, stratumId: "surface", discoveryRadius: 6, reward: { creditId: "short_bridge", amount: 2, label: "단경간 교량 설계권 2회" }, lore: "탄소층 사이의 안정된 암반 간격을 표시한 개척대의 교량 측량 기록이다." },
  { id: "sail_optics_station", name: "규산 광학 관측기", position: { x: -54, z: 16 }, stratumId: "surface", discoveryRadius: 6, reward: { creditId: "conveyor_lift", amount: 2, label: "컨베이어 리프트 설계권 2회" }, lore: "규산 돛의 산란 패턴은 행성의 주풍이 수십 년 동안 거의 변하지 않았음을 보여 준다." },
  { id: "marsh_pressure_log", name: "수맥 압력 기록계", position: { x: 58, z: 50 }, stratumId: "surface", discoveryRadius: 6, reward: { creditId: "pipe_riser", amount: 3, label: "파이프 라이저 설계권 3회" }, lore: "검은수맥 아래 지열수와 원유층의 압력 주기가 같은 위상으로 맥동한다." },
  { id: "crown_wind_station", name: "왕관고원 풍향계", position: { x: -52, z: -62 }, stratumId: "surface", discoveryRadius: 6, reward: { creditId: "access_ramp", amount: 3, label: "접근 램프 설계권 3회" }, lore: "고원의 적철 지각은 바람에 깎인 것이 아니라 오래된 단층 고리가 융기한 흔적이다." },
  { id: "rift_calcite_archive", name: "심층 방해석 기록소", position: { x: -6, z: 119 }, stratumId: "rift_depths", discoveryRadius: 7, reward: { creditId: "shaft_logistics_socket", amount: 1, label: "갱도 물류 소켓 설계권 1회" }, lore: "방해석 맥의 성장선은 열극이 아직 식지 않았으며 심층 열원이 주기적으로 이동함을 기록한다." },
] as const satisfies readonly ExplorationSiteDefinition[];

export type ExplorationSnapshot = Readonly<{ version: 1; discoveredSiteIds: readonly string[] }>;

export class ExplorationTracker {
  private readonly discovered = new Set<string>();

  constructor(snapshot?: ExplorationSnapshot) {
    snapshot?.discoveredSiteIds.forEach((id) => {
      if (EXPLORATION_SITES.some((site) => site.id === id)) this.discovered.add(id);
    });
  }

  discoverNear(x: number, z: number, stratumId: string) {
    const discovered: ExplorationSiteDefinition[] = [];
    EXPLORATION_SITES.forEach((site) => {
      if (this.discovered.has(site.id) || site.stratumId !== stratumId
        || Math.hypot(site.position.x - x, site.position.z - z) > site.discoveryRadius) return;
      this.discovered.add(site.id);
      discovered.push(site);
    });
    return discovered;
  }

  isDiscovered(id: string) { return this.discovered.has(id); }
  total() { return EXPLORATION_SITES.length; }
  snapshot(): ExplorationSnapshot { return { version: 1, discoveredSiteIds: [...this.discovered].sort() }; }
}

export const isExplorationSnapshot = (value: unknown): value is ExplorationSnapshot => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<ExplorationSnapshot>;
  return snapshot.version === 1 && Array.isArray(snapshot.discoveredSiteIds)
    && new Set(snapshot.discoveredSiteIds).size === snapshot.discoveredSiteIds.length
    && snapshot.discoveredSiteIds.every((id) => typeof id === "string" && EXPLORATION_SITES.some((site) => site.id === id));
};
