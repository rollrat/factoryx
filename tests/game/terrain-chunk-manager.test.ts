import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT, TerrainChunkManager } from "../../app/game/environment/index.ts";

test("terrain chunk pool retains nearby work, evicts it on policy expiry, and exposes disposal events", () => {
  const evicted: string[] = [];
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT, {
    retentionUpdates: 0,
    maxRetainedChunks: 25,
    onEvict: ({ x, z, reason }) => evicted.push(`${x},${z}:${reason}`),
  });
  chunks.update(0, 0, "low");
  assert.equal(chunks.diagnostics().active, 9);
  assert.equal(chunks.poolSnapshot().filter(({ lifecycle }) => lifecycle === "retained").length, 0);

  chunks.update(96, 0, "low");
  const releases = chunks.takeEvictions();
  assert.ok(releases.length > 0);
  assert.ok(releases.every(({ lifecycle, reason }) => lifecycle === "evicted" && reason === "retention-expired"));
  assert.equal(evicted.length, releases.length);
  assert.equal(chunks.diagnostics().retained, 0);
});

test("terrain chunk LOD rings keep every shared cardinal edge within one level", () => {
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT);
  const active = chunks.update(0, 0, "high");
  const byPosition = new Map(active.map((chunk) => [`${chunk.x},${chunk.z}`, chunk.lod]));
  active.forEach(({ x, z, lod }) => {
    [[1, 0], [0, 1]].forEach(([dx, dz]) => {
      const neighbor = byPosition.get(`${x + dx},${z + dz}`);
      if (neighbor !== undefined) assert.ok(Math.abs(lod - neighbor) <= 1, `${x},${z} -> ${x + dx},${z + dz}`);
    });
  });
  assert.equal(chunks.diagnostics().maxNeighborLodDelta, 1);
});

test("terrain LOD center applies a symmetric boundary hysteresis window", () => {
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT, { lodHysteresis: 4 });
  chunks.update(31.9, 0, "low");
  chunks.update(33, 0, "low");
  assert.deepEqual(chunks.diagnostics().lodCenter, { x: 0, z: 0 });
  chunks.update(36.1, 0, "low");
  assert.deepEqual(chunks.diagnostics().lodCenter, { x: 1, z: 0 });
  chunks.update(31, 0, "low");
  assert.deepEqual(chunks.diagnostics().lodCenter, { x: 1, z: 0 });
  chunks.update(27.9, 0, "low");
  assert.deepEqual(chunks.diagnostics().lodCenter, { x: 0, z: 0 });
});

test("quality transitions evict stale pooled buffers before activating the new preset", () => {
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT);
  assert.equal(chunks.update(0, 0, "high").length, 25);
  assert.equal(chunks.update(0, 0, "low").length, 9);
  const stale = chunks.takeEvictions();
  assert.equal(stale.length, 25);
  assert.ok(stale.every(({ reason }) => reason === "quality-change"));
  assert.deepEqual(new Set(chunks.poolSnapshot().map(({ quality }) => quality)), new Set(["low"]));
  assert.deepEqual(chunks.diagnostics(), {
    update: 2,
    quality: "low",
    active: 9,
    retained: 0,
    pooled: 9,
    evicted: 25,
    staleGeometryReleases: 25,
    qualityTransitions: 1,
    maxNeighborLodDelta: 1,
    lodCenter: { x: 0, z: 0 },
  });
});

test("retained pool pressure evicts only the overflow and stays bounded", () => {
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT, {
    retentionUpdates: 10,
    maxRetainedChunks: 1,
    lodHysteresis: 0,
  });
  chunks.update(0, 0, "high");
  chunks.update(32.1, 0, "high");
  const diagnostics = chunks.diagnostics();
  assert.equal(diagnostics.active, 25);
  assert.equal(diagnostics.retained, 1);
  assert.equal(diagnostics.pooled, 26);
  assert.equal(chunks.takeEvictions().filter(({ reason }) => reason === "pool-pressure").length, 4);
});
