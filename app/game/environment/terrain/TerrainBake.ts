import type { TerrainSample } from "../types.ts";
import type { WorldBounds, WorldSourceV3 } from "../worldSourceV3/types.ts";

/** A stable key for one independently baked chunk/LOD payload. */
export type TerrainBakeChunkKey = Readonly<{ x: number; z: number; lod: number }>;

/** The immutable source identity carried across the main-thread/worker boundary. */
export type TerrainBakeSourceIdentity = Readonly<Pick<WorldSourceV3,
  "environmentId" | "environmentVersion" | "generatorVersion" | "seed"
>>;

export type TerrainBakeRequest = Readonly<{
  type: "terrain-chunk-bake-request";
  requestId: number;
  terrainRevision: number;
  source: TerrainBakeSourceIdentity;
  chunk: TerrainBakeChunkKey;
  chunkSize: number;
  sampleSpacing: number;
  stratumId?: string;
}>;

export type TerrainBakeGrid = Readonly<{
  /** Number of in-chunk cells along each axis. */
  segments: number;
  /** Spacing after the LOD divisor is applied. */
  sampleSpacing: number;
  /** Samples stored beyond every edge for normal/seam consumers. */
  haloSamples: 1;
  /** Samples per axis including the halo on both sides. */
  sampleCount: number;
}>;

export type TerrainBakeResult = Readonly<{
  type: "terrain-chunk-bake-result";
  requestId: number;
  terrainRevision: number;
  source: TerrainBakeSourceIdentity;
  chunk: TerrainBakeChunkKey;
  stratumId: string;
  grid: TerrainBakeGrid;
  /** Float32 xyz triples, ordered row-major by z then x, including the halo. */
  positions: ArrayBuffer;
  /** Float32 xyz triples, matching positions. */
  normals: ArrayBuffer;
  /** Uint8 surface/buildability codes, matching positions. */
  masks: ArrayBuffer;
}>;

/** Only the sampler contract is needed, so this module remains renderer-independent. */
export type TerrainBakeSampler = Readonly<{
  sample: (x: number, z: number, stratumId?: string) => TerrainSample;
}>;

export type TerrainDirtyBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
export type TerrainDirtyChunkOptions = Readonly<{
  chunkSize: number;
  sampleSpacing: number;
  lods?: readonly number[];
  /** WorldSourceV3 uses half-open bounds, which lets this clamp exact edge chunks safely. */
  worldBounds?: WorldBounds;
}>;

const surfaceMask = new Map<TerrainSample["surface"], number>([
  ["stable", 0], ["soft", 1], ["steep", 2], ["submerged", 3], ["hazard", 4], ["cave_floor", 5],
]);
const buildabilityMask = new Map<TerrainSample["buildability"], number>([
  ["allowed", 0], ["foundation_required", 1], ["restricted", 2],
]);

const assertPositiveFinite = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
};

const assertIntegerAtLeast = (value: number, minimum: number, name: string) => {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
};

const assertSourceIdentity = (source: TerrainBakeSourceIdentity) => {
  if (!source || typeof source.environmentId !== "string" || source.environmentId.length === 0) {
    throw new Error("source.environmentId must be a non-empty string");
  }
  assertIntegerAtLeast(source.environmentVersion, 1, "source.environmentVersion");
  assertIntegerAtLeast(source.generatorVersion, 1, "source.generatorVersion");
  if (!Number.isSafeInteger(source.seed)) throw new Error("source.seed must be a safe integer");
};

const gridFor = (chunkSize: number, sampleSpacing: number, lod: number): TerrainBakeGrid => {
  assertPositiveFinite(chunkSize, "chunkSize");
  assertPositiveFinite(sampleSpacing, "sampleSpacing");
  assertIntegerAtLeast(lod, 0, "chunk.lod");
  const lodDivisor = 2 ** lod;
  const spacing = sampleSpacing * lodDivisor;
  const segments = chunkSize / spacing;
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error("chunkSize must be divisible by sampleSpacing * 2^lod");
  }
  return { segments, sampleSpacing: spacing, haloSamples: 1, sampleCount: segments + 3 };
};

export const terrainBakeSourceIdentity = (source: WorldSourceV3): TerrainBakeSourceIdentity => ({
  environmentId: source.environmentId,
  environmentVersion: source.environmentVersion,
  generatorVersion: source.generatorVersion,
  seed: source.seed,
});

export const terrainBakeChunkKey = ({ x, z, lod }: TerrainBakeChunkKey) => `${x},${z}:lod${lod}`;

export const createTerrainBakeRequest = (request: Omit<TerrainBakeRequest, "type">): TerrainBakeRequest => {
  assertIntegerAtLeast(request.requestId, 1, "requestId");
  assertIntegerAtLeast(request.terrainRevision, 0, "terrainRevision");
  assertIntegerAtLeast(request.chunk.x, Number.MIN_SAFE_INTEGER, "chunk.x");
  assertIntegerAtLeast(request.chunk.z, Number.MIN_SAFE_INTEGER, "chunk.z");
  assertSourceIdentity(request.source);
  if (request.stratumId !== undefined && (typeof request.stratumId !== "string" || request.stratumId.length === 0)) {
    throw new Error("stratumId must be a non-empty string when supplied");
  }
  gridFor(request.chunkSize, request.sampleSpacing, request.chunk.lod);
  return { ...request, type: "terrain-chunk-bake-request" };
};

/**
 * Packs the authored terrain sample into one byte: bits 0-2 are surface and
 * bits 3-4 are buildability. The encoding is intentionally renderer-neutral.
 */
export const encodeTerrainBakeMask = (sample: TerrainSample) => (
  (surfaceMask.get(sample.surface) ?? 0) | ((buildabilityMask.get(sample.buildability) ?? 0) << 3)
);

/** Bakes transferable buffers for one chunk, retaining one sample around all four edges. */
export const bakeTerrainChunk = (request: TerrainBakeRequest, sampler: TerrainBakeSampler): TerrainBakeResult => {
  const grid = gridFor(request.chunkSize, request.sampleSpacing, request.chunk.lod);
  const positionValues = new Float32Array(grid.sampleCount * grid.sampleCount * 3);
  const normalValues = new Float32Array(grid.sampleCount * grid.sampleCount * 3);
  const maskValues = new Uint8Array(grid.sampleCount * grid.sampleCount);
  const originX = request.chunk.x * request.chunkSize;
  const originZ = request.chunk.z * request.chunkSize;
  const stratumId = request.stratumId ?? "surface";

  for (let row = 0; row < grid.sampleCount; row += 1) {
    for (let column = 0; column < grid.sampleCount; column += 1) {
      const x = originX + (column - grid.haloSamples) * grid.sampleSpacing;
      const z = originZ + (row - grid.haloSamples) * grid.sampleSpacing;
      const sample = sampler.sample(x, z, stratumId);
      const sampleIndex = row * grid.sampleCount + column;
      const vectorIndex = sampleIndex * 3;
      positionValues[vectorIndex] = x;
      positionValues[vectorIndex + 1] = sample.height;
      positionValues[vectorIndex + 2] = z;
      normalValues[vectorIndex] = sample.normal.x;
      normalValues[vectorIndex + 1] = sample.normal.y;
      normalValues[vectorIndex + 2] = sample.normal.z;
      maskValues[sampleIndex] = encodeTerrainBakeMask(sample);
    }
  }

  return {
    type: "terrain-chunk-bake-result",
    requestId: request.requestId,
    terrainRevision: request.terrainRevision,
    source: request.source,
    chunk: request.chunk,
    stratumId,
    grid,
    positions: positionValues.buffer,
    normals: normalValues.buffer,
    masks: maskValues.buffer,
  };
};

/** The exact transfer list to pass to postMessage for a result. */
export const terrainBakeTransferables = (result: TerrainBakeResult): Transferable[] => [
  result.positions,
  result.normals,
  result.masks,
];

/** Returns true only when a response still represents the requested terrain revision. */
export const isTerrainBakeResultCurrent = (result: TerrainBakeResult, terrainRevision: number) => (
  result.terrainRevision === terrainRevision
);

/**
 * Tracks the latest request per chunk so responses from a superseded request
 * cannot replace data from a newer request at the same terrain revision.
 */
export class TerrainBakeRequestTracker {
  private revision: number;
  private nextRequestId = 1;
  private readonly latestRequestByChunk = new Map<string, number>();

  constructor(initialTerrainRevision = 0) {
    assertIntegerAtLeast(initialTerrainRevision, 0, "initialTerrainRevision");
    this.revision = initialTerrainRevision;
  }

  terrainRevision() { return this.revision; }

  setTerrainRevision(revision: number) {
    assertIntegerAtLeast(revision, 0, "terrainRevision");
    if (revision < this.revision) throw new Error("terrainRevision cannot move backwards");
    if (revision !== this.revision) this.latestRequestByChunk.clear();
    this.revision = revision;
  }

  createRequest(input: Omit<TerrainBakeRequest, "type" | "requestId" | "terrainRevision">): TerrainBakeRequest {
    const request = createTerrainBakeRequest({ ...input, requestId: this.nextRequestId, terrainRevision: this.revision });
    this.nextRequestId += 1;
    this.latestRequestByChunk.set(terrainBakeChunkKey(request.chunk), request.requestId);
    return request;
  }

  accept(result: TerrainBakeResult) {
    if (!isTerrainBakeResultCurrent(result, this.revision)) return false;
    const key = terrainBakeChunkKey(result.chunk);
    if (this.latestRequestByChunk.get(key) !== result.requestId) return false;
    this.latestRequestByChunk.delete(key);
    return true;
  }
}

/**
 * Computes every chunk whose mesh or one-sample halo can see a dirty area.
 * Returned keys are canonical and sorted row-major for deterministic queues.
 */
export const terrainBakeChunkKeysForDirtyBounds = (
  dirty: TerrainDirtyBounds,
  { chunkSize, sampleSpacing, lods = [0], worldBounds }: TerrainDirtyChunkOptions,
): readonly TerrainBakeChunkKey[] => {
  assertPositiveFinite(chunkSize, "chunkSize");
  assertPositiveFinite(sampleSpacing, "sampleSpacing");
  if (![dirty.minX, dirty.maxX, dirty.minZ, dirty.maxZ].every(Number.isFinite)
    || dirty.minX > dirty.maxX || dirty.minZ > dirty.maxZ) throw new Error("dirty bounds must be finite and increasing");
  const uniqueLods = [...new Set(lods)].sort((a, b) => a - b);
  uniqueLods.forEach((lod) => assertIntegerAtLeast(lod, 0, "lod"));
  const output: TerrainBakeChunkKey[] = [];
  for (const lod of uniqueLods) {
    const halo = sampleSpacing * (2 ** lod);
    let minChunkX = Math.floor((dirty.minX - halo) / chunkSize);
    let maxChunkX = Math.floor((dirty.maxX + halo) / chunkSize);
    let minChunkZ = Math.floor((dirty.minZ - halo) / chunkSize);
    let maxChunkZ = Math.floor((dirty.maxZ + halo) / chunkSize);
    if (worldBounds) {
      minChunkX = Math.max(minChunkX, Math.floor(worldBounds.minX / chunkSize));
      maxChunkX = Math.min(maxChunkX, Math.ceil(worldBounds.maxXExclusive / chunkSize) - 1);
      minChunkZ = Math.max(minChunkZ, Math.floor(worldBounds.minZ / chunkSize));
      maxChunkZ = Math.min(maxChunkZ, Math.ceil(worldBounds.maxZExclusive / chunkSize) - 1);
    }
    for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
      for (let x = minChunkX; x <= maxChunkX; x += 1) output.push({ x, z, lod });
    }
  }
  return output;
};
