import type * as THREE from "three";

export type SurfaceType = "stable" | "soft" | "steep" | "submerged" | "hazard" | "cave_floor";
export type TerrainBuildability = "allowed" | "foundation_required" | "restricted";

export type EnvironmentPalette = Readonly<{
  ground: number;
  groundSecondary: number;
  rock: number;
  accent: number;
  vegetation: number;
  fog: number;
}>;

export type BiomeDefinition = Readonly<{
  id: string;
  name: string;
  center: Readonly<{ x: number; z: number }>;
  radius: number;
  palette: EnvironmentPalette;
  surfaceProfiles: readonly SurfaceType[];
  resourceAffinity: readonly string[];
  landmark: string;
}>;

export type EnvironmentLandmarkDefinition = Readonly<{
  id: string;
  name: string;
  kind: "spire" | "sail" | "vent" | "crown" | "sinkhole" | "rib";
  position: Readonly<{ x: number; y: number; z: number }>;
  scale: Readonly<{ x: number; y: number; z: number }>;
  biomeId: string;
}>;

export type EnvironmentPropDefinition = Readonly<{
  id: string;
  modelKey: "basalt" | "hematite" | "silicate" | "fan" | "tube" | "membrane" | "plate";
  collisionMode: "none" | "solid";
  lodDistances: readonly [number, number];
  shadowDistance: number;
  removableByFoundation: boolean;
}>;

export type CaveZoneDefinition = Readonly<{
  id: string;
  name: string;
  stratumId: string;
  portals: readonly Readonly<{ x: number; y: number; z: number }>[];
  rooms: readonly Readonly<{ id: string; center: Readonly<{ x: number; y: number; z: number }>; radius: number; clearance: number }>[];
  ambientProfile: "geothermal";
  fogColor: number;
}>;

export type EnvironmentDefinition = Readonly<{
  id: string;
  version: number;
  seed: number;
  worldBounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  constructionBounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  chunkSize: number;
  biomeIds: readonly string[];
  skyProfileId: string;
  landmarks: readonly EnvironmentLandmarkDefinition[];
  caveZoneIds: readonly string[];
}>;

export type TerrainSample = Readonly<{
  height: number;
  normal: Readonly<{ x: number; y: number; z: number }>;
  slopeDegrees: number;
  biomeId: string;
  surface: SurfaceType;
  buildability: TerrainBuildability;
  stratumId: "surface" | string;
}>;

export type EnvironmentQuality = "low" | "high";

export type EnvironmentFrameStats = Readonly<{
  activeChunks: number;
  visibleProps: number;
  triangles: number;
  drawCalls: number;
}>;

export type EnvironmentDisposable = Readonly<{
  root: THREE.Object3D;
  dispose: () => void;
}>;
