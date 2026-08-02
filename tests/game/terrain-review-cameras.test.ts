import assert from "node:assert/strict";
import test from "node:test";

import { A17_ENVIRONMENT } from "../../app/game/environment/data/environment.ts";
import {
  A17_TERRAIN_REVIEW_CAMERAS,
  type TerrainReviewCameraPurpose,
} from "../../app/game/environment/data/terrainReviewCameras.ts";

test("P0 defines the eight stable terrain review views", () => {
  assert.equal(A17_TERRAIN_REVIEW_CAMERAS.length, 8);
  assert.equal(new Set(A17_TERRAIN_REVIEW_CAMERAS.map(({ id }) => id)).size, A17_TERRAIN_REVIEW_CAMERAS.length);

  const requiredPurposes = new Set<TerrainReviewCameraPurpose>([
    "baseline", "topology", "scale", "route", "reveal", "water", "vista",
  ]);
  A17_TERRAIN_REVIEW_CAMERAS.forEach(({ purpose }) => requiredPurposes.delete(purpose));
  assert.deepEqual([...requiredPurposes], []);
});

test("terrain review cameras stay valid for deterministic screenshot regression", () => {
  const landmarkIds = new Set(A17_ENVIRONMENT.landmarks.map(({ id }) => id));
  for (const camera of A17_TERRAIN_REVIEW_CAMERAS) {
    assert.ok(camera.fov >= 35 && camera.fov <= 70, `${camera.id} has an invalid FOV`);
    assert.ok(camera.timeOfDay >= 0 && camera.timeOfDay <= 1, `${camera.id} has an invalid time`);
    assert.ok(camera.weatherStrength >= 0 && camera.weatherStrength <= 1, `${camera.id} has invalid weather strength`);
    assert.equal(camera.quality, "high");

    for (const coordinate of [camera.position.x, camera.position.z, camera.target.x, camera.target.z]) {
      assert.ok(coordinate >= A17_ENVIRONMENT.worldBounds.minX && coordinate <= A17_ENVIRONMENT.worldBounds.maxX,
        `${camera.id} leaves the authored 256m sector`);
    }

    const distance = Math.hypot(
      camera.target.x - camera.position.x,
      camera.target.y - camera.position.y,
      camera.target.z - camera.position.z,
    );
    assert.ok(distance > 8, `${camera.id} does not frame a meaningful terrain distance`);
    assert.ok(camera.expectedLandmarkIds.length > 0, `${camera.id} has no expected navigation anchor`);
    camera.expectedLandmarkIds.forEach((id) => assert.ok(landmarkIds.has(id), `${camera.id} references missing landmark ${id}`));
  }
});

test("macro silhouette review defaults cannot hide terrain behind weather", () => {
  for (const camera of A17_TERRAIN_REVIEW_CAMERAS) {
    assert.equal(camera.weather, "clear");
    assert.ok(camera.weatherStrength <= 0.1, `${camera.id} hides the terrain with atmosphere`);
  }
});
