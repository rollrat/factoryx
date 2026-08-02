export const FIRST_PERSON_LOCOMOTION = Object.freeze({
  walkSpeed: 3.2,
  sprintSpeed: 5.4,
  groundAcceleration: 14,
  groundBraking: 20,
  airAcceleration: 5,
  jumpSpeed: 5.7,
  gravity: 16,
  coyoteSeconds: 0.1,
  jumpBufferSeconds: 0.12,
  groundSnapDistance: 0.38,
});

export type PlanarVelocity = Readonly<{ x: number; z: number }>;

export type VerticalLocomotionState = Readonly<{
  velocity: number;
  grounded: boolean;
  coyoteRemaining: number;
  jumpBufferRemaining: number;
  landingCompression: number;
}>;

export const initialVerticalLocomotionState = (): VerticalLocomotionState => ({
  velocity: 0,
  grounded: true,
  coyoteRemaining: FIRST_PERSON_LOCOMOTION.coyoteSeconds,
  jumpBufferRemaining: 0,
  landingCompression: 0,
});

const approach = (current: number, target: number, sharpness: number, delta: number) => (
  current + (target - current) * (1 - Math.exp(-sharpness * delta))
);

export const updatePlanarVelocity = (
  current: PlanarVelocity,
  desired: PlanarVelocity,
  delta: number,
  grounded: boolean,
): PlanarVelocity => {
  const hasInput = desired.x * desired.x + desired.z * desired.z > 0.0001;
  const sharpness = grounded
    ? hasInput ? FIRST_PERSON_LOCOMOTION.groundAcceleration : FIRST_PERSON_LOCOMOTION.groundBraking
    : FIRST_PERSON_LOCOMOTION.airAcceleration;
  return {
    x: approach(current.x, desired.x, sharpness, delta),
    z: approach(current.z, desired.z, sharpness, delta),
  };
};

export type VerticalLocomotionInput = Readonly<{
  delta: number;
  eyeHeight: number;
  groundEyeHeight: number;
  jumpPressed: boolean;
}>;

export type VerticalLocomotionResult = Readonly<{
  eyeHeight: number;
  state: VerticalLocomotionState;
  jumped: boolean;
  landed: boolean;
}>;

/** Fixed-rule vertical locomotion with forgiving jump timing and a short landing spring. */
export const updateVerticalLocomotion = (
  previous: VerticalLocomotionState,
  input: VerticalLocomotionInput,
): VerticalLocomotionResult => {
  const delta = Math.max(0, Math.min(input.delta, 0.05));
  let grounded = previous.grounded;
  let velocity = previous.velocity;
  let eyeHeight = input.eyeHeight;
  let coyoteRemaining = grounded
    ? FIRST_PERSON_LOCOMOTION.coyoteSeconds
    : Math.max(0, previous.coyoteRemaining - delta);
  let jumpBufferRemaining = input.jumpPressed
    ? FIRST_PERSON_LOCOMOTION.jumpBufferSeconds
    : Math.max(0, previous.jumpBufferRemaining - delta);
  let landingCompression = approach(previous.landingCompression, 0, 18, delta);

  const groundGap = eyeHeight - input.groundEyeHeight;
  if (grounded && groundGap > FIRST_PERSON_LOCOMOTION.groundSnapDistance) grounded = false;

  let jumped = false;
  if (jumpBufferRemaining > 0 && coyoteRemaining > 0) {
    velocity = FIRST_PERSON_LOCOMOTION.jumpSpeed;
    grounded = false;
    coyoteRemaining = 0;
    jumpBufferRemaining = 0;
    jumped = true;
  }

  if (grounded) {
    eyeHeight = approach(eyeHeight, input.groundEyeHeight, 20, delta);
    velocity = 0;
  } else {
    velocity -= FIRST_PERSON_LOCOMOTION.gravity * delta;
    eyeHeight += velocity * delta;
  }

  let landed = false;
  if (!grounded && velocity <= 0 && eyeHeight <= input.groundEyeHeight) {
    const impactSpeed = -velocity;
    eyeHeight = input.groundEyeHeight;
    velocity = 0;
    grounded = true;
    coyoteRemaining = FIRST_PERSON_LOCOMOTION.coyoteSeconds;
    landingCompression = -Math.min(0.09, impactSpeed * 0.012);
    landed = true;
  }

  return {
    eyeHeight,
    state: { velocity, grounded, coyoteRemaining, jumpBufferRemaining, landingCompression },
    jumped,
    landed,
  };
};
