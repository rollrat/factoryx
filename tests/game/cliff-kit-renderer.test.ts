import assert from "node:assert/strict";
import test from "node:test";

import { cliffLodForDistance } from "../../app/game/environment/render/CliffKitRenderer.ts";

test("cliff-kit LOD keeps nearby silhouettes detailed and reduces distant geometry", () => {
  assert.equal(cliffLodForDistance(20, "high"), 0);
  assert.equal(cliffLodForDistance(80, "high"), 1);
  assert.equal(cliffLodForDistance(150, "high"), 2);
  assert.equal(cliffLodForDistance(20, "low"), 1);
  assert.equal(cliffLodForDistance(90, "low"), 2);
});

test("cliff-kit LOD hysteresis does not thrash near distance thresholds", () => {
  assert.equal(cliffLodForDistance(60, "high", 0), 0);
  assert.equal(cliffLodForDistance(60, "high", 1), 1);
  assert.equal(cliffLodForDistance(135, "high", 1), 1);
  assert.equal(cliffLodForDistance(120, "high", 2), 2);
  assert.equal(cliffLodForDistance(110, "high", 2), 1);
});
