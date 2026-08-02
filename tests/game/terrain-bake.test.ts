import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT } from "../../app/game/environment/data/environment.ts";
import {
  TerrainBakeRequestTracker,
  TerrainSampler,
  bakeTerrainChunk,
  createTerrainBakeRequest,
  createTerrainBakeWorkerMessageHandler,
  encodeTerrainBakeMask,
  isTerrainBakeResultCurrent,
  terrainBakeChunkKey,
  terrainBakeChunkKeysForDirtyBounds,
  terrainBakeSourceIdentity,
  terrainBakeTransferables,
} from "../../app/game/environment/index.ts";
import { IRONWIND_WORLD_SOURCE_V3 } from "../../app/game/environment/worldSourceV3/index.ts";

const source = terrainBakeSourceIdentity(IRONWIND_WORLD_SOURCE_V3);
const sampler = new TerrainSampler(A17_ENVIRONMENT);

test("terrain bake produces transferable position, normal, and mask buffers with a one-sample halo", () => {
  const request = createTerrainBakeRequest({
    requestId: 1,
    terrainRevision: 4,
    source,
    chunk: { x: 0, z: 0, lod: 1 },
    chunkSize: 32,
    sampleSpacing: 0.5,
  });
  const result = bakeTerrainChunk(request, sampler);
  const positions = new Float32Array(result.positions);
  const normals = new Float32Array(result.normals);
  const masks = new Uint8Array(result.masks);

  assert.deepEqual(result.grid, { segments: 32, sampleSpacing: 1, haloSamples: 1, sampleCount: 35 });
  assert.equal(positions.length, 35 * 35 * 3);
  assert.equal(normals.length, positions.length);
  assert.equal(masks.length, 35 * 35);
  assert.deepEqual([...positions.slice(0, 3)], [-1, sampler.sample(-1, -1).height, -1]);
  const firstInterior = (35 + 1) * 3;
  assert.deepEqual([...positions.slice(firstInterior, firstInterior + 3)], [0, sampler.sample(0, 0).height, 0]);
  assert.equal(masks[35 + 1], encodeTerrainBakeMask(sampler.sample(0, 0)));
  assert.deepEqual(terrainBakeTransferables(result), [result.positions, result.normals, result.masks]);
});

test("terrain bake revision tracker rejects stale and superseded responses", () => {
  const tracker = new TerrainBakeRequestTracker(3);
  const common = { source, chunk: { x: 0, z: 0, lod: 0 }, chunkSize: 32, sampleSpacing: 0.5 };
  const first = tracker.createRequest(common);
  const superseding = tracker.createRequest(common);
  const firstResult = bakeTerrainChunk(first, sampler);
  const secondResult = bakeTerrainChunk(superseding, sampler);

  assert.equal(tracker.accept(firstResult), false);
  assert.equal(tracker.accept(secondResult), true);
  tracker.setTerrainRevision(4);
  assert.equal(isTerrainBakeResultCurrent(secondResult, tracker.terrainRevision()), false);
  assert.equal(tracker.accept(secondResult), false);
  assert.throws(() => tracker.setTerrainRevision(2), /cannot move backwards/);
});

test("dirty bounds expand one LOD sample and clamp to WorldSourceV3 half-open chunk bounds", () => {
  const affected = terrainBakeChunkKeysForDirtyBounds(
    { minX: 31.8, maxX: 32.2, minZ: -0.1, maxZ: 0.1 },
    {
      chunkSize: IRONWIND_WORLD_SOURCE_V3.chunkSize,
      sampleSpacing: IRONWIND_WORLD_SOURCE_V3.sampleSpacing,
      lods: [1, 0, 1],
      worldBounds: IRONWIND_WORLD_SOURCE_V3.bounds,
    },
  );
  assert.deepEqual(affected, [
    { x: 0, z: -1, lod: 0 }, { x: 1, z: -1, lod: 0 }, { x: 0, z: 0, lod: 0 }, { x: 1, z: 0, lod: 0 },
    { x: 0, z: -1, lod: 1 }, { x: 1, z: -1, lod: 1 }, { x: 0, z: 0, lod: 1 }, { x: 1, z: 0, lod: 1 },
  ]);
  const edge = terrainBakeChunkKeysForDirtyBounds(
    { minX: -128, maxX: -127.9, minZ: -128, maxZ: -127.9 },
    { chunkSize: 32, sampleSpacing: 0.5, worldBounds: IRONWIND_WORLD_SOURCE_V3.bounds },
  );
  assert.deepEqual(edge, [{ x: -4, z: -4, lod: 0 }]);
  assert.equal(terrainBakeChunkKey({ x: -4, z: -4, lod: 0 }), "-4,-4:lod0");
});

test("the minimal worker bridge bakes only terrain bake protocol messages and transfers its buffers", () => {
  const posted: { result?: ReturnType<typeof bakeTerrainChunk>; transfer?: Transferable[] } = {};
  const handler = createTerrainBakeWorkerMessageHandler({
    postMessage(result, transfer) {
      posted.result = result;
      posted.transfer = transfer;
    },
  }, sampler);
  handler({ data: { type: "unrelated" } });
  assert.equal(posted.result, undefined);
  handler({ data: { type: "terrain-chunk-bake-request", requestId: 1 } });
  assert.equal(posted.result, undefined, "malformed protocol messages are ignored");
  const request = createTerrainBakeRequest({
    requestId: 8, terrainRevision: 0, source, chunk: { x: -1, z: 2, lod: 2 }, chunkSize: 32, sampleSpacing: 0.5,
  });
  handler({ data: request });
  const result = posted.result as ReturnType<typeof bakeTerrainChunk> | undefined;
  assert.ok(result);
  assert.equal(result.requestId, 8);
  assert.deepEqual(posted.transfer, [result.positions, result.normals, result.masks]);
});
