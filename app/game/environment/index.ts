export { A17_ENVIRONMENT, ENVIRONMENT_PROPS } from "./data/environment.ts";
export {
  PROP_SCATTER_PROFILES,
  ROCK_PROP_KEYS,
  VEGETATION_PROP_KEYS,
  choosePropModel,
  propScatterProfileForBiome,
} from "./data/propScatterProfiles.ts";
export { BIOMES, BIOME_BY_ID } from "./data/biomes.ts";
export { CAVE_ZONES } from "./data/caveZones.ts";
export { IRONWIND_PEDESTRIAN_SHORTCUT, IRONWIND_TOPOGRAPHY, sampleIronwindTopography } from "./data/ironwindTopography.ts";
export type { IronwindTerrainProfile } from "./data/ironwindTopography.ts";
export { A17_TERRAIN_REVIEW_CAMERAS } from "./data/terrainReviewCameras.ts";
export type { TerrainReviewCamera, TerrainReviewCameraPurpose } from "./data/terrainReviewCameras.ts";
export { TerrainSampler, SURFACE_ACCESS_ROUTES } from "./terrain/TerrainSampler.ts";
export { WorldSourceSampler, createWorldSourceSampler } from "./worldSourceSampler/index.ts";
export type { SourceRouteSample, SourceSamplerBiome, WorldSourceHeightSample } from "./worldSourceSampler/index.ts";
export { WorldSourceEnvironmentSampler, createWorldSourceEnvironmentSampler } from "./worldSourceSampler/index.ts";
export type { WorldSourceEnvironmentSamplerOptions } from "./worldSourceSampler/index.ts";
export { CaveRuntimeSampler, CaveRuntimeValidationError, createCaveRuntimeView, safeCreateCaveRuntimeView } from "./worldSourceCaves/index.ts";
export { CaveSourceRenderer } from "./worldSourceCaves/index.ts";
export type {
  CaveRoutePosition,
  CaveRouteSegment,
  CaveRuntimeCorridor,
  CaveRuntimeGraph,
  CaveRuntimeIssue,
  CaveRuntimePortal,
  CaveRuntimeRoom,
  CaveRuntimeView,
  CaveRuntimeViewResult,
  CaveSourceRenderCounts,
  CaveSpaceSample,
} from "./worldSourceCaves/index.ts";
export { WorldWaterSampler } from "./water/index.ts";
export type { WaterShorelineRibbon, WorldWaterKind, WorldWaterSample } from "./water/index.ts";
export { TerrainChunkManager } from "./terrain/TerrainChunkManager.ts";
export {
  TerrainBakeRequestTracker,
  bakeTerrainChunk,
  createTerrainBakeRequest,
  encodeTerrainBakeMask,
  isTerrainBakeResultCurrent,
  terrainBakeChunkKey,
  terrainBakeChunkKeysForDirtyBounds,
  terrainBakeSourceIdentity,
  terrainBakeTransferables,
} from "./terrain/TerrainBake.ts";
export type {
  TerrainBakeChunkKey,
  TerrainBakeGrid,
  TerrainBakeRequest,
  TerrainBakeResult,
  TerrainBakeSampler,
  TerrainBakeSourceIdentity,
  TerrainDirtyBounds,
  TerrainDirtyChunkOptions,
} from "./terrain/TerrainBake.ts";
export { createTerrainBakeWorkerMessageHandler, isTerrainBakeRequest } from "./terrain/TerrainBakeWorker.ts";
export type { TerrainBakeWorkerScope } from "./terrain/TerrainBakeWorker.ts";
export { evaluateTerrainPlacement, createTerrainPlacementValidator } from "./terrain/TerrainPlacementRules.ts";
export { EnvironmentRenderer } from "./render/EnvironmentRenderer.ts";
export type { EnvironmentRendererOptions } from "./render/EnvironmentRenderer.ts";
export { WaterSourceRenderer } from "./render/WaterSourceRenderer.ts";
export { TerrainDetailRenderer } from "./render/TerrainDetailRenderer.ts";
export type { IndustrialFootprint } from "./render/TerrainDetailRenderer.ts";
export { DistantHorizonRenderer } from "./render/DistantHorizonRenderer.ts";
export { EnvironmentAudioSystem } from "./EnvironmentAudioSystem.ts";
export { EnvironmentCycle, A17_DAY_LENGTH_SECONDS, A17_DAY_PHASES, a17SolarElevationAt } from "./EnvironmentCycle.ts";
export { browserEnvironmentQuality, chooseEnvironmentQuality } from "./quality.ts";
export { WORLD_STUDIO_STORAGE_KEY, parseWorldStudioDocument } from "./authoring.ts";
export type * from "./authoring.ts";
export { EXPLORATION_SITES, ExplorationTracker, isExplorationSnapshot } from "./exploration.ts";
export type * from "./exploration.ts";
export { resolveTerrainMovement, infrastructureHeightAt } from "./collision/TerrainCollision.ts";
export type { TerrainInfrastructureSurface } from "./collision/TerrainCollision.ts";
export { EnvironmentObstacleIndex } from "./collision/EnvironmentObstacleIndex.ts";
export type * from "./types.ts";
