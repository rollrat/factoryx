import type { CaveZoneDefinition } from "../types.ts";

export const CAVE_ZONES = [
  {
    id: "thermal_rift_depths",
    name: "열극 심층부",
    stratumId: "rift_depths",
    portals: [{ x: 18, y: 4, z: 92 }, { x: -2, y: 2, z: 118 }],
    rooms: [
      { id: "entry_gallery", center: { x: 14, y: -5, z: 98 }, radius: 12, clearance: 8 },
      { id: "factory_chamber", center: { x: 4, y: -12, z: 108 }, radius: 18, clearance: 13 },
      { id: "deep_chamber", center: { x: -6, y: -22, z: 119 }, radius: 14, clearance: 10 },
    ],
    ambientProfile: "geothermal",
    fogColor: 0x263d3f,
  },
] as const satisfies readonly CaveZoneDefinition[];
