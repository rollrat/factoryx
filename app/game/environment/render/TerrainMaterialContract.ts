import type { TerrainSample } from "../types.ts";

export type TerrainMaterialMask = Readonly<{
  /** Biome is carried by the terrain vertex color; this is the geometric blend input. */
  slope: number;
  wetness: number;
  exposure: number;
  /** 0 means no natural cluster/material breakup may be placed here. */
  clusterSafe: number;
}>;

export type TerrainClusterExclusion = Readonly<{
  excluded: boolean;
  reason: "water" | "cliff" | "hazard" | null;
}>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Shared CPU/GPU-facing terrain material contract. Biome color stays in the
 * existing vertex-color channel, while this mask makes slope, water contact,
 * exposure, and natural-cluster exclusions explicit and reviewable.
 */
export const terrainClusterExclusionAt = (sample: TerrainSample): TerrainClusterExclusion => {
  if (sample.surface === "submerged") return { excluded: true, reason: "water" };
  if (sample.surface === "hazard") return { excluded: true, reason: "hazard" };
  if (sample.slopeDegrees >= 28 || sample.surface === "steep") return { excluded: true, reason: "cliff" };
  return { excluded: false, reason: null };
};

export const terrainMaterialMaskAt = (sample: TerrainSample): TerrainMaterialMask => {
  const slope = clamp01(1 - sample.normal.y);
  const wetness = sample.surface === "submerged" ? 1
    : sample.surface === "soft" ? 0.44
      : sample.surface === "hazard" ? 0.24 : 0;
  // Fixed lightward axis: deterministic, world-space exposure rather than a
  // repeated texture value. It is deliberately restrained on steep faces.
  const lightward = sample.normal.x * -0.48 + sample.normal.y * 0.74 + sample.normal.z * 0.46;
  const exposure = clamp01(0.42 + lightward * 0.46 - slope * 0.14);
  return { slope, wetness, exposure, clusterSafe: terrainClusterExclusionAt(sample).excluded ? 0 : 1 };
};

/** Normalized axis weights for world-space triplanar breakup. */
export const terrainTriplanarWeights = (normal: Readonly<{ x: number; y: number; z: number }>) => {
  const total = Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z);
  if (total <= Number.EPSILON) return { x: 0, y: 1, z: 0 } as const;
  return { x: Math.abs(normal.x) / total, y: Math.abs(normal.y) / total, z: Math.abs(normal.z) / total } as const;
};
