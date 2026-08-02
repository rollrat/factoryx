import {
  bakeTerrainChunk,
  createTerrainBakeRequest,
  terrainBakeTransferables,
  type TerrainBakeRequest,
  type TerrainBakeResult,
  type TerrainBakeSampler,
} from "./TerrainBake.ts";

/** Minimal browser-worker bridge; callers own Worker construction and lifecycle. */
export type TerrainBakeWorkerScope = Readonly<{
  postMessage: (message: TerrainBakeResult, transfer: Transferable[]) => void;
}>;

export const isTerrainBakeRequest = (value: unknown): value is TerrainBakeRequest => (
  (() => {
    if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "terrain-chunk-bake-request") return false;
    try {
      createTerrainBakeRequest(value as Omit<TerrainBakeRequest, "type">);
      return true;
    } catch {
      return false;
    }
  })()
);

/**
 * Installs a message handler onto any Worker-like scope without importing Node
 * worker_threads or touching global self. This keeps the module safe for web
 * bundles and lets an application choose its own worker entry strategy.
 */
export const createTerrainBakeWorkerMessageHandler = (scope: TerrainBakeWorkerScope, sampler: TerrainBakeSampler) => (
  event: Readonly<{ data: unknown }>,
) => {
  if (!isTerrainBakeRequest(event.data)) return;
  const result = bakeTerrainChunk(event.data, sampler);
  scope.postMessage(result, terrainBakeTransferables(result));
};
