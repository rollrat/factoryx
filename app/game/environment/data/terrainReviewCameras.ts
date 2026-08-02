import type { EnvironmentQuality } from "../types.ts";

export type TerrainReviewCameraPurpose =
  | "baseline"
  | "topology"
  | "scale"
  | "route"
  | "reveal"
  | "water"
  | "cave"
  | "vista";

export type TerrainReviewCamera = Readonly<{
  id: string;
  name: string;
  purpose: TerrainReviewCameraPurpose;
  position: Readonly<{ x: number; y: number; z: number }>;
  target: Readonly<{ x: number; y: number; z: number }>;
  fov: number;
  timeOfDay: number;
  weather: "clear" | "mist" | "mineral_wind" | "electrical_storm";
  weatherStrength: number;
  quality: EnvironmentQuality;
  expectedLandmarkIds: readonly string[];
}>;

/**
 * Stable P0/P1 review views for screenshot regression.
 *
 * These cameras deliberately use clear weather and a low weather strength so
 * macro silhouettes, gaps, LOD seams, routes and build terraces cannot be
 * hidden by the atmosphere. World Studio v3 can persist the same contract.
 */
export const A17_TERRAIN_REVIEW_CAMERAS = [
  {
    id: "survey_start_first_person",
    name: "조사 패드 시작 시점",
    purpose: "baseline",
    position: { x: 9, y: 2.2, z: 11 },
    target: { x: 0, y: 1, z: -8 },
    fov: 58,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["twin_needles", "iron_ribs"],
  },
  {
    id: "sector_topology_overview",
    name: "첫 섹터 토폴로지",
    purpose: "topology",
    position: { x: 2, y: 142, z: 5 },
    target: { x: 2, y: 0, z: -8 },
    fov: 54,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["twin_needles", "iron_ribs", "pressure_vent"],
  },
  {
    id: "ironwind_fault_lower_scale",
    name: "철풍 단층 하부 규모",
    purpose: "scale",
    position: { x: 18, y: 16, z: -86 },
    target: { x: 60, y: 12, z: -50 },
    fov: 54,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["iron_ribs"],
  },
  {
    id: "ironwind_upper_logistics_route",
    name: "철풍 단층 상부 물류로",
    purpose: "route",
    position: { x: 108, y: 40, z: -84 },
    target: { x: 58, y: 12, z: -52 },
    fov: 50,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["iron_ribs", "twin_needles"],
  },
  {
    id: "ironwind_arch_approach",
    name: "자연 아치 접근",
    purpose: "route",
    position: { x: 29, y: 5, z: -20 },
    target: { x: 54, y: 14, z: -39 },
    fov: 57,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["iron_ribs"],
  },
  {
    id: "ironwind_arch_reveal",
    name: "자연 아치 통과 후 분지 공개",
    purpose: "reveal",
    position: { x: 67, y: 10, z: -54 },
    target: { x: 2, y: 0, z: -2 },
    fov: 62,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["twin_needles"],
  },
  {
    id: "blackwater_watershed_edge",
    name: "흑수 수계 경계",
    purpose: "water",
    position: { x: 50, y: 10, z: 33 },
    target: { x: 73, y: -1, z: 59 },
    fov: 52,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0.08,
    quality: "high",
    expectedLandmarkIds: ["pressure_vent"],
  },
  {
    id: "basin_to_ironwind_vista",
    name: "분지에서 철풍 원경",
    purpose: "vista",
    position: { x: -16, y: 15, z: -2 },
    target: { x: 69, y: 18, z: -54 },
    fov: 45,
    timeOfDay: 0.68,
    weather: "clear",
    weatherStrength: 0,
    quality: "high",
    expectedLandmarkIds: ["twin_needles", "iron_ribs"],
  },
] as const satisfies readonly TerrainReviewCamera[];
