export const WORLD_SOURCE_FORMAT = "factoryx-world" as const;
export const WORLD_SOURCE_SCHEMA_VERSION = 3 as const;
export const WORLD_SOURCE_CHUNK_SIZE = 32 as const;
export const WORLD_SOURCE_SAMPLE_SPACING = 0.5 as const;

export type Vec2 = Readonly<{ x: number; z: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Quaternion = Readonly<{ x: number; y: number; z: number; w: number }>;
export type Size2 = Readonly<{ x: number; z: number }>;
export type WorldBounds = Readonly<{
  minX: number;
  maxXExclusive: number;
  minZ: number;
  maxZExclusive: number;
}>;

export type PolygonRegion = Readonly<{
  polygon: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
}>;

export type MacroFormKind =
  | "basin"
  | "plateau"
  | "ridge"
  | "fault-step"
  | "canyon"
  | "crater-ring"
  | "sinkhole"
  | "saddle";

export type MacroFormOperation = "add" | "min" | "max" | "carve" | "smooth-union";

export type MacroForm = Readonly<{
  id: string;
  kind: MacroFormKind;
  priority: number;
  operation: MacroFormOperation;
  center: Vec2;
  rotationRadians: number;
  size: Size2;
  height: number;
  falloff: number;
  biomeId: string;
  splineId?: string;
  gameplayTags: readonly string[];
}>;

export type BiomeRegion = Readonly<{
  id: string;
  biomeId: string;
  priority: number;
  polygon: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
  transition: Readonly<{
    terrain: number;
    material: number;
    vegetation: number;
    atmosphere: number;
  }>;
}>;

export type WorldSplineKind = "route" | "river" | "cliff" | "cave";
export type WorldSplineOperation = "flatten" | "carve" | "mark";

export type WorldSpline = Readonly<{
  id: string;
  kind: WorldSplineKind;
  priority: number;
  operation: WorldSplineOperation;
  stratumId: string;
  width: number;
  maxGradeDegrees: number;
  minTurnRadius: number;
  controlPoints: readonly Vec3[];
  bakedPolyline?: readonly Vec3[];
}>;

export type WaterBody =
  | Readonly<{
      id: string;
      kind: "lake" | "marsh";
      priority: number;
      polygon: readonly Vec2[];
      holes: readonly (readonly Vec2[])[];
      level: number;
      outletSplineId?: string;
    }>
  | Readonly<{
      id: string;
      kind: "river";
      priority: number;
      splineId: string;
      widthProfile: readonly number[];
      bedProfile: readonly number[];
      flowSpeed: number;
    }>
  | Readonly<{
      id: string;
      kind: "waterfall";
      priority: number;
      fromSocket: string;
      toSocket: string;
      width: number;
    }>;

export type GameplayVolume = Readonly<{
  kind: "box";
  center: Vec3;
  size: Vec3;
}>;

export type CaveRoom = Readonly<{
  id: string;
  shellAssetId: string;
  floorPolygon: readonly Vec2[];
  floorHeight: number;
  ceilingHeight: number;
  buildVolume?: GameplayVolume;
  portalIds: readonly string[];
}>;

export type CaveCorridor = Readonly<{
  id: string;
  fromRoomId: string;
  toRoomId: string;
  splineId: string;
  width: number;
  clearance: number;
}>;

export type CavePortal = Readonly<{
  id: string;
  roomId: string;
  position: Vec3;
  footprint: readonly Vec2[];
  transitionAssetId: string;
}>;

export type CaveGraph = Readonly<{
  id: string;
  stratumId: string;
  rooms: readonly CaveRoom[];
  corridors: readonly CaveCorridor[];
  portals: readonly CavePortal[];
}>;

export type GameplayZoneKind =
  | "build-patch"
  | "resource-pad"
  | "route-corridor"
  | "build-exclusion"
  | "hazard";

export type GameplayZone = Readonly<{
  id: string;
  kind: GameplayZoneKind;
  priority: number;
  operation: "include" | "exclude";
  stratumId: string;
  polygon: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
  elevationRange?: Readonly<{ min: number; max: number }>;
  tags: readonly string[];
}>;

export type AssetPlacement = Readonly<{
  id: string;
  assetId: string;
  priority: number;
  stratumId: string;
  biomeId: string;
  transform: Readonly<{
    position: Vec3;
    rotation: Quaternion;
    scale: Vec3;
  }>;
  tags: readonly string[];
}>;

export type ResourceAnchor = Readonly<{
  id: string;
  itemId: string;
  position: Vec3;
  extractionBuildingId: string;
  recipeId: string;
  unlockId: string;
  medium: "solid" | "fluid";
  stratumId: string;
  padRadius: number;
  protectionRadius: number;
}>;

export type ReviewCameraPurpose =
  | "baseline"
  | "topology"
  | "scale"
  | "route"
  | "reveal"
  | "water"
  | "cave"
  | "vista";

export type ReviewCamera = Readonly<{
  id: string;
  name: string;
  purpose: ReviewCameraPurpose;
  position: Vec3;
  target: Vec3;
  fov: number;
  timeOfDay: number;
  weather: "clear" | "mist" | "mineral_wind" | "electrical_storm";
  weatherStrength: number;
  quality: "low" | "high";
  expectedLandmarkIds: readonly string[];
}>;

export type LegacyTerrainAuthoringStroke = Readonly<{
  brush: "raise" | "lower" | "flatten" | "smooth" | "biome" | "surface" | "rock_scatter" | "vegetation_scatter";
  x: number;
  z: number;
  radius: number;
  strength: number;
  biomeId?: string;
  surface?: "stable" | "soft" | "steep" | "submerged" | "hazard" | "cave_floor";
  targetHeight?: number;
}>;

export type LegacySculptLayer = Readonly<{
  id: string;
  sourceFormat: "factoryx-world-studio";
  sourceVersion: 2;
  priority: number;
  operation: "legacy-sculpt";
  strokes: readonly LegacyTerrainAuthoringStroke[];
  environmentSettings: Readonly<{
    timeOfDay: number;
    sunAzimuth: number;
    fogDensity: number;
    weather: "clear" | "mist" | "mineral_wind" | "electrical_storm";
    weatherStrength: number;
    scatterDensity: number;
    landmarksVisible: boolean;
    resourceAnchorsVisible: boolean;
    quality: "low" | "high";
  }>;
  landmarkOffsets: Readonly<Record<string, Readonly<{ x: number; z: number; rotation: number }>>>;
}>;

export type WorldSourceV3 = Readonly<{
  format: typeof WORLD_SOURCE_FORMAT;
  schemaVersion: typeof WORLD_SOURCE_SCHEMA_VERSION;
  environmentId: string;
  environmentVersion: number;
  generatorVersion: number;
  seed: number;
  coordinateSystem: Readonly<{
    handedness: "right";
    up: "+Y";
    forward: "+Z";
    unit: "meter";
  }>;
  bounds: WorldBounds;
  chunkSize: typeof WORLD_SOURCE_CHUNK_SIZE;
  sampleSpacing: typeof WORLD_SOURCE_SAMPLE_SPACING;
  macroForms: readonly MacroForm[];
  biomeRegions: readonly BiomeRegion[];
  splines: readonly WorldSpline[];
  waterBodies: readonly WaterBody[];
  caves: readonly CaveGraph[];
  gameplayZones: readonly GameplayZone[];
  placements: readonly AssetPlacement[];
  resourceAnchors: readonly ResourceAnchor[];
  reviewCameras: readonly ReviewCamera[];
  legacySculptLayer?: LegacySculptLayer;
}>;

export type WorldSourceValidationIssue = Readonly<{
  code:
    | "invalid_json"
    | "invalid_type"
    | "unknown_property"
    | "missing_property"
    | "invalid_value"
    | "invalid_bounds"
    | "out_of_bounds"
    | "duplicate_id"
    | "invalid_polygon"
    | "invalid_spline"
    | "broken_reference";
  path: string;
  message: string;
}>;

export type WorldSourceParseResult =
  | Readonly<{ ok: true; value: WorldSourceV3 }>
  | Readonly<{ ok: false; issues: readonly WorldSourceValidationIssue[] }>;
