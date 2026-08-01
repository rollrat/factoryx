import type { EnvironmentPropDefinition } from "../types.ts";

export type EnvironmentPropModelKey = EnvironmentPropDefinition["modelKey"];
export type EnvironmentPropKind = "rock" | "vegetation";

export type PropScatterProfile = Readonly<{
  rockDensity: number;
  vegetationDensity: number;
  rockWeights: Readonly<Partial<Record<EnvironmentPropModelKey, number>>>;
  vegetationWeights: Readonly<Partial<Record<EnvironmentPropModelKey, number>>>;
}>;

export const ROCK_PROP_KEYS = ["basalt", "hematite", "silicate"] as const;
export const VEGETATION_PROP_KEYS = ["fan", "tube", "membrane", "plate"] as const;

/**
 * Authoring-level scatter language for A-17. Profiles deliberately overlap so
 * biome borders blend instead of looking like asset-set boundaries.
 */
export const PROP_SCATTER_PROFILES: Readonly<Record<string, PropScatterProfile>> = {
  windglass_basin: {
    rockDensity: 0.58,
    vegetationDensity: 0.76,
    rockWeights: { basalt: 0.62, hematite: 0.16, silicate: 0.22 },
    vegetationWeights: { fan: 0.56, tube: 0.06, membrane: 0.24, plate: 0.14 },
  },
  ironwind_faults: {
    rockDensity: 0.86,
    vegetationDensity: 0.32,
    rockWeights: { basalt: 0.5, hematite: 0.44, silicate: 0.06 },
    vegetationWeights: { fan: 0.24, tube: 0.04, membrane: 0.12, plate: 0.6 },
  },
  silicate_sailwood: {
    rockDensity: 0.62,
    vegetationDensity: 0.9,
    rockWeights: { basalt: 0.12, hematite: 0.08, silicate: 0.8 },
    vegetationWeights: { fan: 0.12, tube: 0.04, membrane: 0.72, plate: 0.12 },
  },
  blackwater_marsh: {
    rockDensity: 0.36,
    vegetationDensity: 0.94,
    rockWeights: { basalt: 0.5, hematite: 0.38, silicate: 0.12 },
    vegetationWeights: { fan: 0.09, tube: 0.69, membrane: 0.16, plate: 0.06 },
  },
  hematite_crown: {
    rockDensity: 0.9,
    vegetationDensity: 0.42,
    rockWeights: { basalt: 0.18, hematite: 0.76, silicate: 0.06 },
    vegetationWeights: { fan: 0.15, tube: 0.03, membrane: 0.12, plate: 0.7 },
  },
  thermal_rift: {
    rockDensity: 0.78,
    vegetationDensity: 0.27,
    rockWeights: { basalt: 0.66, hematite: 0.12, silicate: 0.22 },
    vegetationWeights: { fan: 0.08, tube: 0.36, membrane: 0.08, plate: 0.48 },
  },
};

export const DEFAULT_PROP_SCATTER_PROFILE = PROP_SCATTER_PROFILES.windglass_basin;

export function propScatterProfileForBiome(biomeId: string): PropScatterProfile {
  return PROP_SCATTER_PROFILES[biomeId] ?? DEFAULT_PROP_SCATTER_PROFILE;
}

export function choosePropModel(
  profile: PropScatterProfile,
  kind: EnvironmentPropKind,
  roll: number,
): EnvironmentPropModelKey {
  const keys = kind === "rock" ? ROCK_PROP_KEYS : VEGETATION_PROP_KEYS;
  const weights = kind === "rock" ? profile.rockWeights : profile.vegetationWeights;
  const total = keys.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (total <= 0) return keys[0];
  let cursor = Math.min(Math.max(roll, 0), 0.999999999) * total;
  for (const key of keys) {
    cursor -= weights[key] ?? 0;
    if (cursor < 0) return key;
  }
  return keys[keys.length - 1];
}
