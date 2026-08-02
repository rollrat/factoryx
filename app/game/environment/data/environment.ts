import type { EnvironmentDefinition, EnvironmentPropDefinition } from "../types.ts";
import { BIOMES } from "./biomes.ts";
import { CAVE_ZONES } from "./caveZones.ts";

export const A17_ENVIRONMENT: EnvironmentDefinition = {
  id: "a17_folded_by_wind",
  version: 2,
  seed: 171703,
  worldBounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
  constructionBounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
  chunkSize: 32,
  biomeIds: BIOMES.map(({ id }) => id),
  skyProfileId: "a17_platinum_afternoon",
  caveZoneIds: CAVE_ZONES.map(({ id }) => id),
  landmarks: [
    { id: "twin_needles", name: "쌍침", kind: "spire", position: { x: -29, y: 0, z: -22 }, scale: { x: 8, y: 38, z: 7 }, biomeId: "windglass_basin" },
    { id: "iron_ribs", name: "철풍 늑골", kind: "rib", position: { x: 68, y: 3, z: -54 }, scale: { x: 34, y: 28, z: 18 }, biomeId: "ironwind_faults" },
    { id: "great_sail", name: "유리 돛", kind: "sail", position: { x: -66, y: 1, z: 20 }, scale: { x: 22, y: 48, z: 6 }, biomeId: "silicate_sailwood" },
    { id: "pressure_vent", name: "압력 분출공", kind: "vent", position: { x: 72, y: -1, z: 58 }, scale: { x: 15, y: 20, z: 15 }, biomeId: "blackwater_marsh" },
    { id: "crown_fault", name: "왕관 단층", kind: "crown", position: { x: -62, y: 8, z: -75 }, scale: { x: 38, y: 42, z: 38 }, biomeId: "hematite_crown" },
    { id: "rift_eye", name: "열극 천공", kind: "sinkhole", position: { x: 12, y: 1, z: 99 }, scale: { x: 26, y: 18, z: 26 }, biomeId: "thermal_rift" },
  ],
};

export const ENVIRONMENT_PROPS = [
  { id: "basalt_cluster", modelKey: "basalt", collisionMode: "solid", lodDistances: [42, 96], shadowDistance: 38, removableByFoundation: true },
  { id: "hematite_slab", modelKey: "hematite", collisionMode: "solid", lodDistances: [42, 96], shadowDistance: 38, removableByFoundation: true },
  { id: "silicate_shard", modelKey: "silicate", collisionMode: "solid", lodDistances: [46, 110], shadowDistance: 42, removableByFoundation: true },
  { id: "wind_fan", modelKey: "fan", collisionMode: "none", lodDistances: [32, 74], shadowDistance: 26, removableByFoundation: true },
  { id: "marsh_tube", modelKey: "tube", collisionMode: "none", lodDistances: [32, 74], shadowDistance: 26, removableByFoundation: true },
  { id: "sail_membrane", modelKey: "membrane", collisionMode: "solid", lodDistances: [52, 120], shadowDistance: 42, removableByFoundation: true },
  { id: "layered_plate", modelKey: "plate", collisionMode: "none", lodDistances: [32, 74], shadowDistance: 24, removableByFoundation: true },
] as const satisfies readonly EnvironmentPropDefinition[];
