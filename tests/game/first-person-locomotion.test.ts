import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_PERSON_LOCOMOTION,
  initialVerticalLocomotionState,
  updatePlanarVelocity,
  updateVerticalLocomotion,
} from "../../app/game/sim/firstPersonLocomotion.ts";

test("planar locomotion accelerates and brakes without instant speed changes", () => {
  const accelerated = updatePlanarVelocity({ x: 0, z: 0 }, { x: 0, z: 5.4 }, 1 / 60, true);
  assert.ok(accelerated.z > 0 && accelerated.z < 5.4);
  const braked = updatePlanarVelocity(accelerated, { x: 0, z: 0 }, 1 / 60, true);
  assert.ok(braked.z < accelerated.z);
});

test("jump rises, falls and lands back on the ground", () => {
  const groundEyeHeight = 1.62;
  let eyeHeight = groundEyeHeight;
  let state = initialVerticalLocomotionState();
  let apex = eyeHeight;
  let landed = false;
  for (let frame = 0; frame < 180; frame += 1) {
    const result = updateVerticalLocomotion(state, {
      delta: 1 / 60,
      eyeHeight,
      groundEyeHeight,
      jumpPressed: frame === 0,
    });
    state = result.state;
    eyeHeight = result.eyeHeight;
    apex = Math.max(apex, eyeHeight);
    landed ||= result.landed;
  }
  assert.ok(apex - groundEyeHeight > 0.7);
  assert.ok(apex - groundEyeHeight < 1.2);
  assert.equal(landed, true);
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(eyeHeight - groundEyeHeight) < 0.001);
});

test("coyote time accepts a jump shortly after leaving ground", () => {
  const initial = { ...initialVerticalLocomotionState(), grounded: false };
  const result = updateVerticalLocomotion(initial, {
    delta: FIRST_PERSON_LOCOMOTION.coyoteSeconds * 0.5,
    eyeHeight: 2,
    groundEyeHeight: 1,
    jumpPressed: true,
  });
  assert.equal(result.jumped, true);
  assert.ok(result.state.velocity > 0);
});

test("jump buffer fires when the player lands", () => {
  const result = updateVerticalLocomotion({
    ...initialVerticalLocomotionState(),
    grounded: false,
    velocity: -3,
    coyoteRemaining: 0,
  }, {
    delta: 1 / 60,
    eyeHeight: 1.65,
    groundEyeHeight: 1.62,
    jumpPressed: true,
  });
  assert.equal(result.landed, true);
  assert.ok(result.state.jumpBufferRemaining > 0);

  const bounced = updateVerticalLocomotion(result.state, {
    delta: 1 / 60,
    eyeHeight: result.eyeHeight,
    groundEyeHeight: 1.62,
    jumpPressed: false,
  });
  assert.equal(bounced.jumped, true);
});
