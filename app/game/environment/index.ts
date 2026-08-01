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
export { TerrainSampler, SURFACE_ACCESS_ROUTES } from "./terrain/TerrainSampler.ts";
export { TerrainChunkManager } from "./terrain/TerrainChunkManager.ts";
export { evaluateTerrainPlacement, createTerrainPlacementValidator } from "./terrain/TerrainPlacementRules.ts";
export { EnvironmentRenderer } from "./render/EnvironmentRenderer.ts";
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
