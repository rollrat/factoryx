import { SIMULATION_TICK_SECONDS } from "./contracts.ts";

export type FixedStepClockSnapshot = Readonly<{
  tick: number;
  elapsedSeconds: number;
  accumulatorSeconds: number;
}>;

export type ClockAdvanceResult = Readonly<{
  steps: number;
  interpolationAlpha: number;
  snapshot: FixedStepClockSnapshot;
}>;

const assertFiniteNonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
};

/**
 * Deterministic 20 Hz clock. Wall-clock deltas are accumulated, while game
 * state only observes exact fixed-size steps.
 */
export class FixedStepClock {
  readonly stepSeconds: number;
  private accumulatorSeconds = 0;
  private currentTick = 0;

  constructor(
    stepSeconds = SIMULATION_TICK_SECONDS,
    snapshot?: FixedStepClockSnapshot,
  ) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new RangeError("stepSeconds must be a finite number greater than zero");
    }
    this.stepSeconds = stepSeconds;
    if (snapshot) this.restore(snapshot);
  }

  get tick() {
    return this.currentTick;
  }

  get elapsedSeconds() {
    return this.currentTick * this.stepSeconds;
  }

  get interpolationAlpha() {
    return this.accumulatorSeconds / this.stepSeconds;
  }

  advance(deltaSeconds: number, step: (tick: number, deltaSeconds: number) => void): ClockAdvanceResult {
    assertFiniteNonNegative(deltaSeconds, "deltaSeconds");
    this.accumulatorSeconds += deltaSeconds;

    // The epsilon prevents decimal accumulation from occasionally missing an
    // exact boundary such as 0.15 / 0.05 in headless tests.
    const epsilon = this.stepSeconds * 1e-9;
    let steps = 0;
    while (this.accumulatorSeconds + epsilon >= this.stepSeconds) {
      this.currentTick += 1;
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - this.stepSeconds);
      step(this.currentTick, this.stepSeconds);
      steps += 1;
    }

    return { steps, interpolationAlpha: this.interpolationAlpha, snapshot: this.snapshot() };
  }

  snapshot(): FixedStepClockSnapshot {
    return {
      tick: this.currentTick,
      elapsedSeconds: this.elapsedSeconds,
      accumulatorSeconds: this.accumulatorSeconds,
    };
  }

  restore(snapshot: FixedStepClockSnapshot) {
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) {
      throw new RangeError("snapshot.tick must be a non-negative integer");
    }
    assertFiniteNonNegative(snapshot.accumulatorSeconds, "snapshot.accumulatorSeconds");
    if (snapshot.accumulatorSeconds >= this.stepSeconds) {
      throw new RangeError("snapshot accumulator must be smaller than one fixed step");
    }
    const expectedElapsed = snapshot.tick * this.stepSeconds;
    if (Math.abs(snapshot.elapsedSeconds - expectedElapsed) > 1e-9) {
      throw new RangeError("snapshot elapsedSeconds does not match its tick");
    }
    this.currentTick = snapshot.tick;
    this.accumulatorSeconds = snapshot.accumulatorSeconds;
  }

  reset() {
    this.currentTick = 0;
    this.accumulatorSeconds = 0;
  }
}
