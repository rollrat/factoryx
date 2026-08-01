import type { WeatherKind } from "./render/WeatherSystem.ts";

export const A17_DAY_LENGTH_SECONDS = 36 * 60;

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
