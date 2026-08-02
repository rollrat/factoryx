import assert from "node:assert/strict";
import test from "node:test";

import { IRONWIND_CLIFF_PLACEMENTS, createIronwindCliffPlacements } from "../../app/game/environment/data/ironwindCliffPlacements.ts";
import { IRONWIND_TOPOGRAPHY } from "../../app/game/environment/data/ironwindTopography.ts";

const distance = (from: Readonly<{ x: number; z: number }>, to: Readonly<{ x: number; z: number }>) => (
  Math.hypot(to.x - from.x, to.z - from.z)
);

test("Ironwind cliff placement is deterministic and exposes stable runtime contracts", () => {
  assert.deepEqual(createIronwindCliffPlacements(), createIronwindCliffPlacements());
  assert.equal(new Set(IRONWIND_CLIFF_PLACEMENTS.map(({ id }) => id)).size, IRONWIND_CLIFF_PLACEMENTS.length);
  assert.ok(IRONWIND_CLIFF_PLACEMENTS.some(({ assetId }) => assetId === "ironwind_cliff_straight_16m"));
  assert.equal(IRONWIND_CLIFF_PLACEMENTS.filter(({ assetId }) => assetId === "ironwind_cliff_outer_corner").length, 1);
  assert.equal(IRONWIND_CLIFF_PLACEMENTS.filter(({ assetId }) => assetId === "ironwind_natural_arch").length, 1);
  IRONWIND_CLIFF_PLACEMENTS.forEach(({ transform, metadata }) => {
    assert.ok(Number.isFinite(transform.position.x + transform.position.y + transform.position.z));
    assert.deepEqual(metadata.lod.nodes, ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"]);
    assert.ok(metadata.collision.nodes.includes("COL_WALL"));
  });
});

test("sixteen metre straight modules meet without visible seam gaps", () => {
  const straights = IRONWIND_CLIFF_PLACEMENTS.filter(({ assetId }) => assetId === "ironwind_cliff_straight_16m");
  assert.ok(straights.length >= 5);
  straights.forEach(({ metadata, transform }) => {
    const span = distance(metadata.seams.start, metadata.seams.end);
    assert.ok(span >= 16 && span <= 16.6, `unexpected module span ${span}`);
    assert.ok(transform.scale.x >= 1 && transform.scale.x <= 1.04, `unexpected seam correction scale ${transform.scale.x}`);
  });
  straights.slice(1).forEach(({ metadata }, index) => {
    const previousIndex = Number(straights[index].id.split(":").at(-1));
    const currentIndex = Number(straights[index + 1].id.split(":").at(-1));
    if (currentIndex === previousIndex + 1) {
      assert.ok(distance(straights[index].metadata.seams.end, metadata.seams.start) < 1e-9, "adjacent sockets must coincide");
    }
  });
  const corner = IRONWIND_CLIFF_PLACEMENTS.find(({ assetId }) => assetId === "ironwind_cliff_outer_corner")!;
  assert.ok(distance(straights[straights.length - 1].metadata.seams.end, corner.metadata.seams.start) < 1e-9);
});

test("the natural arch leaves the complete ten metre vehicle corridor open", () => {
  const arch = IRONWIND_CLIFF_PLACEMENTS.find(({ assetId }) => assetId === "ironwind_natural_arch")!;
  assert.equal(arch.metadata.collision.mode, "arch_opening");
  assert.ok(arch.metadata.passage);
  assert.ok(arch.metadata.passage.width >= IRONWIND_TOPOGRAPHY.vehicleCorridorWidth);
  assert.ok(arch.metadata.passage.height >= 6);
  const vehicleHeading = Math.atan2(69 - 38, -53 - (-25));
  assert.ok(Math.abs(arch.metadata.passage.heading - vehicleHeading) < 1e-12, "arch passage must align to the coal road");
});
