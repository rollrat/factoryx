import type { SurfaceType } from "./types.ts";
import type { WeatherKind } from "./render/WeatherSystem.ts";

export const WORLD_STUDIO_STORAGE_KEY = "factoryx.world-studio.v1";

export type TerrainAuthoringBrush = "raise" | "lower" | "flatten" | "smooth" | "biome" | "surface";
export type TerrainAuthoringStroke = Readonly<{
  brush: TerrainAuthoringBrush;
  x: number;
  z: number;
  radius: number;
  strength: number;
  biomeId?: string;
  surface?: SurfaceType;
  targetHeight?: number;
}>;

export type WorldStudioEnvironmentDocument = Readonly<{
  format: "factoryx-world-studio";
  version: 1;
  environmentId: string;
  environmentVersion: number;
  seed: number;
  strokes: readonly TerrainAuthoringStroke[];
  timeOfDay: number;
  fogDensity: number;
  weather: WeatherKind;
  weatherStrength: number;
}>;

export const parseWorldStudioDocument = (value: unknown, environmentId: string): WorldStudioEnvironmentDocument | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Partial<WorldStudioEnvironmentDocument>;
  if (document.format !== "factoryx-world-studio" || document.version !== 1
    || document.environmentId !== environmentId || !Array.isArray(document.strokes)) return null;
  const strokes = document.strokes.filter((stroke): stroke is TerrainAuthoringStroke => Boolean(stroke
    && typeof stroke === "object" && typeof stroke.x === "number" && Number.isFinite(stroke.x)
    && typeof stroke.z === "number" && Number.isFinite(stroke.z)
    && typeof stroke.radius === "number" && stroke.radius > 0
    && typeof stroke.strength === "number" && Number.isFinite(stroke.strength)));
  return {
    format: "factoryx-world-studio",
    version: 1,
    environmentId,
    environmentVersion: Number.isSafeInteger(document.environmentVersion) ? document.environmentVersion! : 1,
    seed: Number.isSafeInteger(document.seed) ? document.seed! : 0,
    strokes,
    timeOfDay: typeof document.timeOfDay === "number" ? document.timeOfDay : 0.68,
    fogDensity: typeof document.fogDensity === "number" ? document.fogDensity : 0.0085,
    weather: document.weather === "clear" || document.weather === "mist" || document.weather === "electrical_storm" ? document.weather : "mineral_wind",
    weatherStrength: typeof document.weatherStrength === "number" ? document.weatherStrength : 0.34,
  };
};
