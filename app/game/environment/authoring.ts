import type { EnvironmentDefinition, EnvironmentQuality, SurfaceType } from "./types.ts";
import type { WeatherKind } from "./render/WeatherSystem.ts";

// Keep the original key so existing local drafts can be migrated in place.
export const WORLD_STUDIO_STORAGE_KEY = "factoryx.world-studio.v1";
export const WORLD_STUDIO_DOCUMENT_VERSION = 2 as const;

export type TerrainAuthoringBrush = "raise" | "lower" | "flatten" | "smooth" | "biome" | "surface" | "rock_scatter" | "vegetation_scatter";
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

export type LandmarkAuthoringOffset = Readonly<{ x: number; z: number; rotation: number }>;

export type WorldStudioEnvironmentDocument = Readonly<{
  format: "factoryx-world-studio";
  version: typeof WORLD_STUDIO_DOCUMENT_VERSION;
  environmentId: string;
  environmentVersion: number;
  seed: number;
  strokes: readonly TerrainAuthoringStroke[];
  timeOfDay: number;
  sunAzimuth: number;
  fogDensity: number;
  weather: WeatherKind;
  weatherStrength: number;
  scatterDensity: number;
  landmarksVisible: boolean;
  resourceAnchorsVisible: boolean;
  quality: EnvironmentQuality;
  landmarkOffsets: Readonly<Record<string, LandmarkAuthoringOffset>>;
}>;

const BRUSHES = new Set<TerrainAuthoringBrush>(["raise", "lower", "flatten", "smooth", "biome", "surface", "rock_scatter", "vegetation_scatter"]);
const SURFACES = new Set<SurfaceType>(["stable", "soft", "steep", "submerged", "hazard", "cave_floor"]);
const WEATHERS = new Set<WeatherKind>(["clear", "mist", "mineral_wind", "electrical_storm"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: unknown, fallback: number, min: number, max: number) => finite(value) ? Math.max(min, Math.min(max, value)) : fallback;

const parseStroke = (value: unknown, definition: EnvironmentDefinition): TerrainAuthoringStroke | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stroke = value as Record<string, unknown>;
  if (!BRUSHES.has(stroke.brush as TerrainAuthoringBrush) || !finite(stroke.x) || !finite(stroke.z)
    || !finite(stroke.radius) || stroke.radius <= 0 || stroke.radius > 64
    || !finite(stroke.strength) || stroke.strength < 0 || stroke.strength > 4) return null;
  const brush = stroke.brush as TerrainAuthoringBrush;
  if (stroke.x < definition.worldBounds.minX || stroke.x > definition.worldBounds.maxX
    || stroke.z < definition.worldBounds.minZ || stroke.z > definition.worldBounds.maxZ) return null;
  if (brush === "surface" && !SURFACES.has(stroke.surface as SurfaceType)) return null;
  if (brush === "biome" && (typeof stroke.biomeId !== "string" || !definition.biomeIds.includes(stroke.biomeId))) return null;
  if (stroke.targetHeight !== undefined && !finite(stroke.targetHeight)) return null;
  return {
    brush,
    x: stroke.x,
    z: stroke.z,
    radius: stroke.radius,
    strength: stroke.strength,
    ...(typeof stroke.biomeId === "string" ? { biomeId: stroke.biomeId } : {}),
    ...(SURFACES.has(stroke.surface as SurfaceType) ? { surface: stroke.surface as SurfaceType } : {}),
    ...(finite(stroke.targetHeight) ? { targetHeight: stroke.targetHeight } : {}),
  };
};

const parseLandmarkOffsets = (value: unknown, definition: EnvironmentDefinition): Readonly<Record<string, LandmarkAuthoringOffset>> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, LandmarkAuthoringOffset> = {};
  const landmarkIds = new Set(definition.landmarks.map(({ id }) => id));
  for (const [id, raw] of Object.entries(value)) {
    if (!landmarkIds.has(id)) return null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const offset = raw as Record<string, unknown>;
    if (!finite(offset.x) || !finite(offset.z) || !finite(offset.rotation)) return null;
    result[id] = { x: clamp(offset.x, 0, -64, 64), z: clamp(offset.z, 0, -64, 64), rotation: clamp(offset.rotation, 0, -Math.PI * 2, Math.PI * 2) };
  }
  return result;
};

/** Strictly validates authoring data and migrates the legacy v1 shape to v2 defaults. */
export const parseWorldStudioDocument = (value: unknown, definition: EnvironmentDefinition): WorldStudioEnvironmentDocument | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (document.format !== "factoryx-world-studio" || (document.version !== 1 && document.version !== 2)
    || document.environmentId !== definition.id
    || !Number.isSafeInteger(document.environmentVersion) || (document.environmentVersion as number) < 1
    || (document.environmentVersion as number) > definition.version
    || document.seed !== definition.seed
    || !Array.isArray(document.strokes) || document.strokes.length > 4096) return null;
  const isV2 = document.version === 2;
  if (isV2 && (!Number.isSafeInteger(document.environmentVersion) || !Number.isSafeInteger(document.seed)
    || !finite(document.timeOfDay) || !finite(document.sunAzimuth) || !finite(document.fogDensity)
    || !WEATHERS.has(document.weather as WeatherKind) || !finite(document.weatherStrength) || !finite(document.scatterDensity)
    || typeof document.landmarksVisible !== "boolean" || typeof document.resourceAnchorsVisible !== "boolean"
    || (document.quality !== "low" && document.quality !== "high"))) return null;
  const strokes = document.strokes.map((stroke) => parseStroke(stroke, definition));
  // A partially accepted edit list is dangerous: reject the whole file instead.
  if (strokes.some((stroke) => stroke === null)) return null;
  const landmarkOffsets = parseLandmarkOffsets(document.landmarkOffsets ?? (isV2 ? null : {}), definition);
  if (!landmarkOffsets) return null;
  return {
    format: "factoryx-world-studio",
    version: WORLD_STUDIO_DOCUMENT_VERSION,
    environmentId: definition.id,
    environmentVersion: definition.version,
    seed: definition.seed,
    strokes: strokes as TerrainAuthoringStroke[],
    timeOfDay: clamp(document.timeOfDay, 0.68, 0, 1),
    sunAzimuth: clamp(document.sunAzimuth, 0, -1, 1),
    fogDensity: clamp(document.fogDensity, 0.0085, 0, 0.04),
    weather: WEATHERS.has(document.weather as WeatherKind) ? document.weather as WeatherKind : "mineral_wind",
    weatherStrength: clamp(document.weatherStrength, 0.34, 0, 1),
    scatterDensity: clamp(document.scatterDensity, 1, 0, 1),
    landmarksVisible: typeof document.landmarksVisible === "boolean" ? document.landmarksVisible : true,
    resourceAnchorsVisible: typeof document.resourceAnchorsVisible === "boolean" ? document.resourceAnchorsVisible : true,
    quality: document.quality === "low" ? "low" : "high",
    landmarkOffsets,
  };
};
