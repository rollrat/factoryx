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
