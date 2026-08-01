import type { WeatherKind } from "./render/WeatherSystem.ts";

export const A17_DAY_LENGTH_SECONDS = 36 * 60;
export const A17_DAY_PHASES = {
  dawnStart: 3 / 36,
  dayStart: 7 / 36,
  duskStart: 29 / 36,
  nightStart: 33 / 36,
} as const;

const smooth01 = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

/** Explicit 4m dawn + 22m day + 4m dusk + 6m night light curve. */
export const a17SolarElevationAt = (normalized: number) => {
  const time = ((normalized % 1) + 1) % 1;
  const { dawnStart, dayStart, duskStart, nightStart } = A17_DAY_PHASES;
  if (time < dawnStart || time >= nightStart) return -0.18;
  if (time < dayStart) return -0.08 + smooth01((time - dawnStart) / (dayStart - dawnStart)) * 0.43;
  if (time < duskStart) {
    const progress = (time - dayStart) / (duskStart - dayStart);
    return 0.35 + Math.sin(progress * Math.PI) * 0.65;
  }
  return 0.35 - smooth01((time - duskStart) / (nightStart - duskStart)) * 0.43;
};

type WeatherPhase = Readonly<{
  kind: WeatherKind;
  duration: number;
  peakStrength: number;
}>;

const WEATHER_PHASES: readonly WeatherPhase[] = [
  { kind: "clear", duration: 180, peakStrength: 0 },
  { kind: "mist", duration: 150, peakStrength: 0.46 },
  { kind: "mineral_wind", duration: 150, peakStrength: 0.68 },
  { kind: "electrical_storm", duration: 90, peakStrength: 0.82 },
  { kind: "clear", duration: 90, peakStrength: 0 },
];

const WEATHER_CYCLE_SECONDS = WEATHER_PHASES.reduce((sum, phase) => sum + phase.duration, 0);

export type EnvironmentCycleState = Readonly<{
  timeOfDay: number;
  weather: WeatherKind;
  weatherStrength: number;
}>;
export type EnvironmentCycleSnapshot = Readonly<{ dayElapsedSeconds: number; weatherElapsedSeconds: number }>;

const smoothPulse = (progress: number) => {
  const edge = 0.16;
  if (progress < edge) return progress / edge;
  if (progress > 1 - edge) return (1 - progress) / edge;
  return 1;
};

/** A deterministic clock keeps every save on the same authored day/weather cadence. */
export class EnvironmentCycle {
  private dayElapsedSeconds: number;
  private weatherElapsedSeconds: number;

  constructor(initialTimeOfDay = 0.68, initialWeatherOffsetSeconds = 24) {
    this.dayElapsedSeconds = initialTimeOfDay * A17_DAY_LENGTH_SECONDS;
    this.weatherElapsedSeconds = initialWeatherOffsetSeconds;
  }

  advance(deltaSeconds: number) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    this.dayElapsedSeconds += delta;
    this.weatherElapsedSeconds += delta;
    return this.state();
  }

  seed(timeOfDay: number, weather: WeatherKind, strength = 0.5) {
    this.dayElapsedSeconds = Math.max(0, Math.min(1, timeOfDay)) * A17_DAY_LENGTH_SECONDS;
    let offset = 0;
    const phaseIndex = WEATHER_PHASES.findIndex((phase) => phase.kind === weather);
    const index = phaseIndex >= 0 ? phaseIndex : 0;
    for (let cursor = 0; cursor < index; cursor += 1) offset += WEATHER_PHASES[cursor].duration;
    const phase = WEATHER_PHASES[index];
    const ratio = phase.peakStrength <= 0 ? 0.5 : Math.max(0, Math.min(1, strength / phase.peakStrength));
    const progress = ratio >= 0.999 ? 0.5 : ratio * 0.16;
    this.weatherElapsedSeconds = offset + phase.duration * progress;
    return this.state();
  }

  state(): EnvironmentCycleState {
    const timeOfDay = (this.dayElapsedSeconds / A17_DAY_LENGTH_SECONDS) % 1;
    let cursor = this.weatherElapsedSeconds % WEATHER_CYCLE_SECONDS;
    for (const phase of WEATHER_PHASES) {
      if (cursor <= phase.duration) {
        const progress = cursor / phase.duration;
        return {
          timeOfDay,
          weather: phase.kind,
          weatherStrength: phase.peakStrength * smoothPulse(progress),
        };
      }
      cursor -= phase.duration;
    }
    return { timeOfDay, weather: "clear", weatherStrength: 0 };
  }

  snapshot(): EnvironmentCycleSnapshot {
    return { dayElapsedSeconds: this.dayElapsedSeconds, weatherElapsedSeconds: this.weatherElapsedSeconds };
  }

  restore(snapshot: EnvironmentCycleSnapshot) {
    if (!Number.isFinite(snapshot.dayElapsedSeconds) || snapshot.dayElapsedSeconds < 0
      || !Number.isFinite(snapshot.weatherElapsedSeconds) || snapshot.weatherElapsedSeconds < 0) return false;
    this.dayElapsedSeconds = snapshot.dayElapsedSeconds;
    this.weatherElapsedSeconds = snapshot.weatherElapsedSeconds;
    return true;
  }
}
