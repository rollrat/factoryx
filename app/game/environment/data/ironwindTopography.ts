export type IronwindTerrainProfile = Readonly<{
  height: number;
  influence: number;
  faultProgress: number;
  region: "outside" | "lower_terrace" | "fault_wall" | "upper_terrace";
}>;

export const IRONWIND_TOPOGRAPHY = {
  lowerTerrace: { center: { x: 34, z: -48 }, radiusX: 21, radiusZ: 18, height: 1.75 },
  upperTerrace: { center: { x: 80, z: -48 }, radiusX: 28, radiusZ: 23, height: 23.75 },
  fault: { baseX: 50, amplitude: 4.5, wavelength: 0.052, transitionWidth: 5.5 },
  relief: 22,
  vehicleCorridorWidth: 10,
} as const;

/** A narrow diagonal shelf that crosses the fault faster than the coal vehicle road. */
export const IRONWIND_PEDESTRIAN_SHORTCUT = [
  { x: 39, z: -34 },
  { x: 46, z: -48 },
  { x: 57, z: -65 },
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const ellipseMask = (x: number, z: number, centerX: number, centerZ: number, radiusX: number, radiusZ: number, feather = 0.22) => {
  const distance = Math.hypot((x - centerX) / radiusX, (z - centerZ) / radiusZ);
  return 1 - smoothstep((distance - (1 - feather)) / feather);
};

/**
 * P0/P1 macro blockout for Ironwind Faults.
 *
 * It deliberately describes a few readable landforms instead of stacking more
 * terrain noise: a low construction bench, one 22 m fault, and a broad upper
 * construction bench. Vertical cliff meshes can later replace the narrow
 * height-field transition without changing these authored top/bottom levels.
 */
export const sampleIronwindTopography = (x: number, z: number, surroundingHeight: number): IronwindTerrainProfile => {
  const regionDistance = Math.hypot((x - 72) / 70, (z + 48) / 72);
  const influence = 1 - smoothstep((regionDistance - 0.76) / 0.24);
  if (influence <= 0) return { height: surroundingHeight, influence: 0, faultProgress: 0, region: "outside" };

  const faultX = IRONWIND_TOPOGRAPHY.fault.baseX
    + Math.sin((z + 18) * IRONWIND_TOPOGRAPHY.fault.wavelength) * IRONWIND_TOPOGRAPHY.fault.amplitude;
  const faultProgress = smoothstep((x - faultX + IRONWIND_TOPOGRAPHY.fault.transitionWidth * 0.5)
    / IRONWIND_TOPOGRAPHY.fault.transitionWidth);
  const macroHeight = IRONWIND_TOPOGRAPHY.lowerTerrace.height + faultProgress * IRONWIND_TOPOGRAPHY.relief;

  const lowerMask = ellipseMask(
    x, z,
    IRONWIND_TOPOGRAPHY.lowerTerrace.center.x, IRONWIND_TOPOGRAPHY.lowerTerrace.center.z,
    IRONWIND_TOPOGRAPHY.lowerTerrace.radiusX, IRONWIND_TOPOGRAPHY.lowerTerrace.radiusZ,
  ) * (1 - faultProgress);
  const upperMask = ellipseMask(
    x, z,
    IRONWIND_TOPOGRAPHY.upperTerrace.center.x, IRONWIND_TOPOGRAPHY.upperTerrace.center.z,
    IRONWIND_TOPOGRAPHY.upperTerrace.radiusX, IRONWIND_TOPOGRAPHY.upperTerrace.radiusZ,
  ) * faultProgress;
  const terraceHeight = macroHeight
    + (IRONWIND_TOPOGRAPHY.lowerTerrace.height - macroHeight) * lowerMask
    + (IRONWIND_TOPOGRAPHY.upperTerrace.height - macroHeight) * upperMask;

  // Keep only restrained undulation on the benches. The generic field provides
  // continuity near the biome boundary, not the silhouette-defining form.
  const restrainedSurrounding = surroundingHeight * 0.18;
  const authoredHeight = terraceHeight + restrainedSurrounding * (1 - Math.max(lowerMask, upperMask));
  const height = surroundingHeight + (authoredHeight - surroundingHeight) * influence;
  const region = faultProgress > 0.12 && faultProgress < 0.88
    ? "fault_wall"
    : faultProgress >= 0.88
      ? "upper_terrace"
      : "lower_terrace";
  return { height, influence, faultProgress, region };
};
