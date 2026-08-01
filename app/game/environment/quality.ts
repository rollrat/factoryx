import type { EnvironmentQuality } from "./types.ts";

export type EnvironmentHardwareHints = Readonly<{
  deviceMemory?: number;
  hardwareConcurrency?: number;
  pixelRatio?: number;
  reducedMotion?: boolean;
}>;

export const chooseEnvironmentQuality = (hints: EnvironmentHardwareHints): EnvironmentQuality => (
  hints.reducedMotion
  || (hints.deviceMemory !== undefined && hints.deviceMemory <= 4)
  || (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 4)
  || (hints.pixelRatio ?? 1) > 2.25
    ? "low"
    : "high"
);

export const browserEnvironmentQuality = (): EnvironmentQuality => {
  if (typeof window === "undefined") return "high";
  const navigatorHints = navigator as Navigator & { deviceMemory?: number };
  return chooseEnvironmentQuality({
    deviceMemory: navigatorHints.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    pixelRatio: window.devicePixelRatio,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  });
};
