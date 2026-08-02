import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";

export type TerrainLod = 0 | 1 | 2;
export type TerrainChunkLifecycle = "unloaded" | "requested" | "sampled" | "uploaded" | "active" | "retained" | "evicted";
export type TerrainChunkEvictionReason = "retention-expired" | "pool-pressure" | "quality-change" | "dispose";

export type TerrainChunkState = Readonly<{ x: number; z: number; distance: number; lod: TerrainLod }>;
export type TerrainChunkPoolEntry = Readonly<{
  x: number;
  z: number;
  lod: TerrainLod;
  quality: EnvironmentQuality;
  lifecycle: TerrainChunkLifecycle;
  lastActiveUpdate: number;
}>;
export type TerrainChunkEviction = Readonly<TerrainChunkPoolEntry & { reason: TerrainChunkEvictionReason }>;
export type TerrainChunkDiagnostics = Readonly<{
  update: number;
  quality: EnvironmentQuality | null;
  active: number;
  retained: number;
  pooled: number;
  evicted: number;
  staleGeometryReleases: number;
  qualityTransitions: number;
  maxNeighborLodDelta: number;
  lodCenter: Readonly<{ x: number; z: number }> | null;
}>;

export type TerrainChunkManagerOptions = Readonly<{
  /** Number of subsequent updates an inactive chunk may remain reusable. */
  retentionUpdates?: number;
  /** Maximum number of inactive chunks retained alongside the active set. */
  maxRetainedChunks?: number;
  /** Distance inside an adjacent chunk required before changing the LOD center. */
  lodHysteresis?: number;
  /** Owner hook for disposing geometry/material buffers associated with an eviction. */
  onEvict?: (eviction: TerrainChunkEviction) => void;
}>;

type MutablePoolEntry = {
  x: number;
  z: number;
  lod: TerrainLod;
  quality: EnvironmentQuality;
  lifecycle: "active" | "retained";
  lastActiveUpdate: number;
};

const HIGH_RADIUS = 2;
const LOW_RADIUS = 1;
const DEFAULT_RETENTION_UPDATES = 2;
const DEFAULT_LOD_HYSTERESIS = 4;

/**
 * Computes the visible terrain ring and owns its logical streaming pool.
 *
 * Geometry owners can use `takeEvictions()` (or `onEvict`) to release GPU
 * resources. Keeping that ownership outside this class preserves the existing
 * renderer contract while making lifecycle work observable and bounded.
 */
export class TerrainChunkManager {
  private active: readonly TerrainChunkState[] = [];
  private readonly definition: EnvironmentDefinition;
  private readonly pool = new Map<string, MutablePoolEntry>();
  private readonly evictions: TerrainChunkEviction[] = [];
  private readonly retentionUpdates: number;
  private readonly maxRetainedChunks: number;
  private readonly lodHysteresis: number;
  private readonly onEvict?: (eviction: TerrainChunkEviction) => void;
  private updateCount = 0;
  private quality: EnvironmentQuality | null = null;
  private lodCenter: { x: number; z: number } | null = null;
  private evictedCount = 0;
  private staleGeometryReleases = 0;
  private qualityTransitions = 0;

  constructor(definition: EnvironmentDefinition, options: TerrainChunkManagerOptions = {}) {
    this.definition = definition;
    this.retentionUpdates = positiveInteger(options.retentionUpdates, DEFAULT_RETENTION_UPDATES, "retentionUpdates");
    this.maxRetainedChunks = positiveInteger(options.maxRetainedChunks, this.maxActiveChunkCount(), "maxRetainedChunks");
    this.lodHysteresis = finiteInRange(options.lodHysteresis, DEFAULT_LOD_HYSTERESIS, 0, definition.chunkSize / 2, "lodHysteresis");
    this.onEvict = options.onEvict;
  }

  update(cameraX: number, cameraZ: number, quality: EnvironmentQuality, radiusOverride?: number): readonly TerrainChunkState[] {
    if (!Number.isFinite(cameraX) || !Number.isFinite(cameraZ)) throw new RangeError("terrain chunk camera coordinates must be finite");
    this.updateCount += 1;
    if (this.quality !== null && this.quality !== quality) {
      this.qualityTransitions += 1;
      // Buffer layouts are quality-specific. Never let a lower/higher-detail
      // allocation masquerade as current geometry after a preset switch.
      const released = this.pool.size;
      [...this.pool.values()].forEach((entry) => this.evict(entry, "quality-change"));
      this.staleGeometryReleases += released;
    }
    this.quality = quality;

    const radius = radiusOverride === undefined
      ? quality === "high" ? HIGH_RADIUS : LOW_RADIUS
      : positiveInteger(radiusOverride, HIGH_RADIUS, "radiusOverride");
    const center = this.resolveLodCenter(cameraX, cameraZ);
    const chunks: TerrainChunkState[] = [];
    for (let z = center.z - radius; z <= center.z + radius; z += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (!this.isChunkInBounds(x, z)) continue;
        const distance = Math.max(Math.abs(x - center.x), Math.abs(z - center.z));
        chunks.push({ x, z, distance, lod: lodForDistance(distance) });
      }
    }
    this.assertNeighborLodContinuity(chunks);
    const activeKeys = new Set(chunks.map(({ x, z }) => chunkKey(x, z)));
    this.pool.forEach((entry, key) => {
      if (!activeKeys.has(key)) entry.lifecycle = "retained";
    });
    chunks.forEach((chunk) => this.activate(chunk, quality));
    this.evictExpiredRetained();
    this.evictRetainedOverCapacity();
    this.active = chunks;
    return chunks;
  }

  snapshot(): TerrainChunkState[] {
    return this.active.map((chunk) => ({ ...chunk }));
  }

  /** Complete logical pool state, including entries retained to avoid boundary churn. */
  poolSnapshot(): TerrainChunkPoolEntry[] {
    return [...this.pool.values()]
      .map((entry) => ({ ...entry }))
      .sort(compareChunkEntries);
  }

  /** Drains eviction notifications so a geometry owner can explicitly dispose stale buffers. */
  takeEvictions(): TerrainChunkEviction[] {
    return this.evictions.splice(0).map((entry) => ({ ...entry }));
  }

  diagnostics(): TerrainChunkDiagnostics {
    let active = 0;
    let retained = 0;
    this.pool.forEach((entry) => {
      if (entry.lifecycle === "active") active += 1;
      else retained += 1;
    });
    return {
      update: this.updateCount,
      quality: this.quality,
      active,
      retained,
      pooled: this.pool.size,
      evicted: this.evictedCount,
      staleGeometryReleases: this.staleGeometryReleases,
      qualityTransitions: this.qualityTransitions,
      maxNeighborLodDelta: maxNeighborLodDelta(this.active),
      lodCenter: this.lodCenter ? { ...this.lodCenter } : null,
    };
  }

  /** Explicitly evicts every retained and active allocation during environment teardown. */
  dispose() {
    [...this.pool.values()].forEach((entry) => this.evict(entry, "dispose"));
    this.active = [];
    this.lodCenter = null;
  }

  private activate(chunk: TerrainChunkState, quality: EnvironmentQuality) {
    const key = chunkKey(chunk.x, chunk.z);
    const existing = this.pool.get(key);
    if (existing) {
      existing.lifecycle = "active";
      existing.lod = chunk.lod;
      existing.quality = quality;
      existing.lastActiveUpdate = this.updateCount;
      return;
    }
    this.pool.set(key, {
      x: chunk.x,
      z: chunk.z,
      lod: chunk.lod,
      quality,
      lifecycle: "active",
      lastActiveUpdate: this.updateCount,
    });
  }

  private evictExpiredRetained() {
    this.pool.forEach((entry) => {
      if (entry.lifecycle === "retained" && this.updateCount - entry.lastActiveUpdate > this.retentionUpdates) {
        this.evict(entry, "retention-expired");
      }
    });
  }

  private evictRetainedOverCapacity() {
    const retained = [...this.pool.values()]
      .filter((entry) => entry.lifecycle === "retained")
      .sort((a, b) => a.lastActiveUpdate - b.lastActiveUpdate || compareChunkEntries(a, b));
    const overflow = Math.max(0, retained.length - this.maxRetainedChunks);
    retained.slice(0, overflow).forEach((entry) => this.evict(entry, "pool-pressure"));
  }

  private evict(entry: MutablePoolEntry, reason: TerrainChunkEvictionReason) {
    const key = chunkKey(entry.x, entry.z);
    if (!this.pool.delete(key)) return;
    const eviction: TerrainChunkEviction = { ...entry, lifecycle: "evicted", reason };
    this.evictions.push(eviction);
    this.evictedCount += 1;
    this.onEvict?.(eviction);
  }

  private resolveLodCenter(cameraX: number, cameraZ: number) {
    const candidate = {
      x: Math.floor(cameraX / this.definition.chunkSize),
      z: Math.floor(cameraZ / this.definition.chunkSize),
    };
    if (!this.lodCenter) {
      this.lodCenter = candidate;
      return candidate;
    }
    this.lodCenter = {
      x: this.hystereticAxis(this.lodCenter.x, candidate.x, cameraX),
      z: this.hystereticAxis(this.lodCenter.z, candidate.z, cameraZ),
    };
    return this.lodCenter;
  }

  private hystereticAxis(current: number, candidate: number, cameraCoordinate: number) {
    if (candidate === current) return current;
    if (candidate > current) {
      const threshold = (current + 1) * this.definition.chunkSize + this.lodHysteresis;
      return cameraCoordinate >= threshold ? candidate : current;
    }
    const threshold = current * this.definition.chunkSize - this.lodHysteresis;
    return cameraCoordinate < threshold ? candidate : current;
  }

  private isChunkInBounds(x: number, z: number) {
    const worldX = x * this.definition.chunkSize;
    const worldZ = z * this.definition.chunkSize;
    return worldX >= this.definition.worldBounds.minX && worldX <= this.definition.worldBounds.maxX
      && worldZ >= this.definition.worldBounds.minZ && worldZ <= this.definition.worldBounds.maxZ;
  }

  private maxActiveChunkCount() {
    return (HIGH_RADIUS * 2 + 1) ** 2;
  }

  private assertNeighborLodContinuity(chunks: readonly TerrainChunkState[]) {
    const delta = maxNeighborLodDelta(chunks);
    if (delta > 1) throw new Error(`terrain chunk LOD neighbor delta ${delta} exceeds one`);
  }
}

function lodForDistance(distance: number): TerrainLod {
  return distance === 0 ? 0 : distance === 1 ? 1 : 2;
}

function chunkKey(x: number, z: number) { return `${x},${z}`; }

function maxNeighborLodDelta(chunks: readonly TerrainChunkState[]) {
  const lods = new Map(chunks.map((chunk) => [chunkKey(chunk.x, chunk.z), chunk.lod]));
  let maximum = 0;
  chunks.forEach(({ x, z, lod }) => {
    [[1, 0], [0, 1]].forEach(([dx, dz]) => {
      const neighbor = lods.get(chunkKey(x + dx, z + dz));
      if (neighbor !== undefined) maximum = Math.max(maximum, Math.abs(lod - neighbor));
    });
  });
  return maximum;
}

function compareChunkEntries(a: Readonly<{ x: number; z: number }>, b: Readonly<{ x: number; z: number }>) {
  return a.z - b.z || a.x - b.x;
}

function positiveInteger(value: number | undefined, fallback: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return resolved;
}

function finiteInRange(value: number | undefined, fallback: number, min: number, max: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) throw new RangeError(`${name} must be between ${min} and ${max}`);
  return resolved;
}
