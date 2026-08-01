export type LoadPriority = 1 | 2 | 3 | 4;

export type PowerGeneratorInput = Readonly<{
  id: string;
  nameplateMW: number;
  dispatchableMW?: number;
  minimumLoadMW?: number;
  dispatchPriority: number;
  connected?: boolean;
  enabled?: boolean;
  requiresFuel?: boolean;
  fuelAvailable?: boolean;
}>;

export type PowerConsumerInput = Readonly<{
  id: string;
  active: boolean;
  activeMW: number;
  idleMW: number;
  requestedMW?: number;
  priority?: LoadPriority;
  connected?: boolean;
}>;

export type PowerBatteryInput = Readonly<{
  id: string;
  capacityMWh: number;
  storedMWh: number;
  maxChargeMW: number;
  maxDischargeMW: number;
  connected?: boolean;
}>;

export type PowerGridInputSnapshot = Readonly<{
  gridId: string;
  deltaSeconds: number;
  generators: readonly PowerGeneratorInput[];
  consumers: readonly PowerConsumerInput[];
  batteries: readonly PowerBatteryInput[];
}>;

export type AdvancedPowerGridSnapshot = Readonly<{
  version: 1;
  gridId: string;
  batteries: readonly Readonly<{ id: string; storedMWh: number }>[];
  shedConsumerIds: readonly string[];
  lowSatisfactionSeconds: number;
  recoveryStableSeconds: number;
  secondsSinceRecovery: number;
  mainBreakerTripped: boolean;
}>;

export type PowerGridResult = Readonly<{
  gridId: string;
  capacityMW: number;
  dispatchableMW: number;
  requestedMW: number;
  servedMW: number;
  generationMW: number;
  maxConsumptionMW: number;
  batteryChargeMW: number;
  batteryDischargeMW: number;
  curtailedMW: number;
  storedMWh: number;
  nameplateReserveMW: number;
  operatingReserveMW: number;
  operatingReserveRatio: number;
  satisfaction: number;
  mainBreakerTripped: boolean;
  shedConsumerIds: readonly string[];
  generators: readonly Readonly<{ id: string; generationMW: number; dispatchableMW: number }>[];
  consumers: readonly Readonly<{
    id: string;
    priority: LoadPriority;
    requestedMW: number;
    servedMW: number;
    satisfaction: number;
    shed: boolean;
  }>[];
  batteries: readonly Readonly<{
    id: string;
    chargeMW: number;
    dischargeMW: number;
    storedMWh: number;
  }>[];
}>;

const LOW_VOLTAGE_THRESHOLD = 0.8;
const SHED_DELAY_SECONDS = 3;
const RECOVERY_STABLE_SECONDS = 10;
const RECOVERY_INTERVAL_SECONDS = 3;
const RECOVERY_RESERVE_RATIO = 0.1;
const EPSILON = 1e-9;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const assertNonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
};
const assertUniqueIds = (values: readonly Readonly<{ id: string }>[], label: string) => {
  const ids = new Set<string>();
  values.forEach(({ id }) => {
    if (!id) throw new Error(`${label} id is required`);
    if (ids.has(id)) throw new Error(`duplicate ${label} id: ${id}`);
    ids.add(id);
  });
};

const consumerRequest = (consumer: PowerConsumerInput) => (
  consumer.requestedMW ?? (consumer.active ? consumer.activeMW : consumer.idleMW)
);

/** Stateful deterministic calculation for one independent power grid. */
export class AdvancedPowerGrid {
  readonly gridId: string;
  private readonly batteryEnergy = new Map<string, number>();
  private readonly shedConsumerIds = new Set<string>();
  private lowSatisfactionSeconds = 0;
  private recoveryStableSeconds = 0;
  // A finite ready value keeps snapshots JSON-safe while allowing immediate first recovery.
  private secondsSinceRecovery = RECOVERY_INTERVAL_SECONDS;
  private mainBreakerTripped = false;

  constructor(gridId: string, snapshot?: AdvancedPowerGridSnapshot) {
    if (!gridId) throw new Error("gridId is required");
    this.gridId = gridId;
    if (snapshot) this.restore(snapshot);
  }

  step(input: PowerGridInputSnapshot): PowerGridResult {
    this.validateInput(input);
    const deltaSeconds = input.deltaSeconds;
    this.secondsSinceRecovery += deltaSeconds;

    const generators = input.generators.map((generator) => {
      const connected = generator.connected ?? true;
      const enabled = generator.enabled ?? true;
      const fuelReady = !generator.requiresFuel || (generator.fuelAvailable ?? false);
      const available = generator.dispatchableMW ?? generator.nameplateMW;
      return {
        ...generator,
        connected,
        enabled,
        dispatchableMW: connected && enabled && fuelReady ? Math.min(generator.nameplateMW, available) : 0,
        minimumLoadMW: generator.minimumLoadMW ?? 0,
      };
    });
    const capacityMW = input.generators
      .filter((generator) => generator.connected ?? true)
      .reduce((total, generator) => total + generator.nameplateMW, 0);
    const dispatchableMW = generators.reduce((total, generator) => total + generator.dispatchableMW, 0);

    const inputBatteryIds = new Set(input.batteries.map(({ id }) => id));
    this.batteryEnergy.forEach((_energy, id) => {
      if (!inputBatteryIds.has(id)) this.batteryEnergy.delete(id);
    });
    const batteryStates = input.batteries.map((battery) => {
      const storedMWh = this.batteryEnergy.get(battery.id) ?? battery.storedMWh;
      if (storedMWh > battery.capacityMWh + EPSILON) {
        throw new RangeError(`battery ${battery.id} storedMWh exceeds capacity`);
      }
      return { ...battery, connected: battery.connected ?? true, storedMWh, chargeMW: 0, dischargeMW: 0 };
    });
    const batteryDischargeCapacityMW = batteryStates.reduce((total, battery) => (
      total + (battery.connected
        ? Math.min(battery.maxDischargeMW, battery.storedMWh * 3600 / deltaSeconds)
        : 0)
    ), 0);

    const consumers = input.consumers.map((consumer) => ({
      ...consumer,
      connected: consumer.connected ?? true,
      priority: consumer.priority ?? 3,
      requestedMW: consumerRequest(consumer),
    }));
    const maxConsumptionMW = consumers
      .filter((consumer) => consumer.connected)
      .reduce((total, consumer) => total + consumer.activeMW, 0);

    this.removeMissingShedConsumers(consumers);
    let connectedConsumers = consumers.filter((consumer) => (
      consumer.connected && !this.shedConsumerIds.has(consumer.id)
    ));
    let requestedMW = connectedConsumers.reduce((total, consumer) => total + consumer.requestedMW, 0);
    const immediatelyAvailableMW = dispatchableMW + batteryDischargeCapacityMW;
    const initialSatisfaction = requestedMW === 0 ? 1 : clamp01(immediatelyAvailableMW / requestedMW);

    if (!this.mainBreakerTripped && initialSatisfaction < LOW_VOLTAGE_THRESHOLD) {
      this.lowSatisfactionSeconds += deltaSeconds;
    } else {
      this.lowSatisfactionSeconds = 0;
    }

    if (!this.mainBreakerTripped && this.lowSatisfactionSeconds + EPSILON >= SHED_DELAY_SECONDS) {
      const candidates = connectedConsumers
        .filter((consumer) => consumer.priority > 1)
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      for (const consumer of candidates) {
        if (requestedMW === 0 || immediatelyAvailableMW / requestedMW >= LOW_VOLTAGE_THRESHOLD) break;
        this.shedConsumerIds.add(consumer.id);
        requestedMW -= consumer.requestedMW;
      }
      connectedConsumers = consumers.filter((consumer) => (
        consumer.connected && !this.shedConsumerIds.has(consumer.id)
      ));
      requestedMW = connectedConsumers.reduce((total, consumer) => total + consumer.requestedMW, 0);
      const p1RequestedMW = connectedConsumers
        .filter((consumer) => consumer.priority === 1)
        .reduce((total, consumer) => total + consumer.requestedMW, 0);
      if (p1RequestedMW > immediatelyAvailableMW + EPSILON) this.mainBreakerTripped = true;
    }

    this.tryRecoverOneConsumer(consumers, dispatchableMW, deltaSeconds);
    connectedConsumers = consumers.filter((consumer) => (
      consumer.connected && !this.shedConsumerIds.has(consumer.id)
    ));
    requestedMW = connectedConsumers.reduce((total, consumer) => total + consumer.requestedMW, 0);

    if (this.mainBreakerTripped) {
      return this.trippedResult(input, generators, consumers, batteryStates, capacityMW, dispatchableMW, maxConsumptionMW);
    }

    const generatorResults = generators
      .map((generator) => ({ ...generator, generationMW: 0 }))
      .sort((a, b) => a.dispatchPriority - b.dispatchPriority || a.id.localeCompare(b.id));
    let remainingDemandMW = requestedMW;
    let generationMW = 0;
    generatorResults.forEach((generator) => {
      if (generator.dispatchableMW <= 0 || remainingDemandMW <= EPSILON) return;
      const generation = Math.min(
        generator.dispatchableMW,
        Math.max(generator.minimumLoadMW, remainingDemandMW),
      );
      generator.generationMW = generation;
      generationMW += generation;
      remainingDemandMW = Math.max(0, remainingDemandMW - generation);
    });

    let surplusMW = Math.max(0, generationMW - requestedMW);
    let shortageMW = Math.max(0, requestedMW - generationMW);
    if (shortageMW > EPSILON) {
      for (const battery of [...batteryStates].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!battery.connected || shortageMW <= EPSILON) continue;
        const availableMW = Math.min(battery.maxDischargeMW, battery.storedMWh * 3600 / deltaSeconds);
        battery.dischargeMW = Math.min(shortageMW, availableMW);
        shortageMW -= battery.dischargeMW;
      }
    } else if (surplusMW > EPSILON) {
      for (const battery of [...batteryStates].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!battery.connected || surplusMW <= EPSILON) continue;
        const headroomMW = Math.max(0, (battery.capacityMWh - battery.storedMWh) * 3600 / deltaSeconds);
        battery.chargeMW = Math.min(surplusMW, battery.maxChargeMW, headroomMW);
        surplusMW -= battery.chargeMW;
      }
    }

    const batteryChargeMW = batteryStates.reduce((total, battery) => total + battery.chargeMW, 0);
    const batteryDischargeMW = batteryStates.reduce((total, battery) => total + battery.dischargeMW, 0);
    const availableForConsumersMW = generationMW + batteryDischargeMW - batteryChargeMW;
    const servedMW = Math.min(requestedMW, Math.max(0, availableForConsumersMW));
    const curtailedMW = Math.max(0, generationMW + batteryDischargeMW - servedMW - batteryChargeMW);
    const satisfaction = requestedMW === 0 ? 1 : clamp01(servedMW / requestedMW);

    batteryStates.forEach((battery) => {
      battery.storedMWh += (battery.chargeMW - battery.dischargeMW) * deltaSeconds / 3600;
      battery.storedMWh = Math.min(battery.capacityMWh, Math.max(0, battery.storedMWh));
      this.batteryEnergy.set(battery.id, battery.storedMWh);
    });

    const consumerResults = consumers.map((consumer) => {
      const shed = !consumer.connected || this.shedConsumerIds.has(consumer.id);
      return {
        id: consumer.id,
        priority: consumer.priority,
        requestedMW: shed ? 0 : consumer.requestedMW,
        servedMW: shed ? 0 : consumer.requestedMW * satisfaction,
        satisfaction: shed ? 0 : satisfaction,
        shed,
      };
    });
    const storedMWh = batteryStates.reduce((total, battery) => total + battery.storedMWh, 0);
    const operatingReserveMW = dispatchableMW - requestedMW;
    return {
      gridId: this.gridId,
      capacityMW,
      dispatchableMW,
      requestedMW,
      servedMW,
      generationMW,
      maxConsumptionMW,
      batteryChargeMW,
      batteryDischargeMW,
      curtailedMW,
      storedMWh,
      nameplateReserveMW: capacityMW - maxConsumptionMW,
      operatingReserveMW,
      operatingReserveRatio: dispatchableMW === 0 ? 0 : operatingReserveMW / dispatchableMW,
      satisfaction,
      mainBreakerTripped: false,
      shedConsumerIds: [...this.shedConsumerIds].sort(),
      generators: generatorResults
        .map(({ id, generationMW: output, dispatchableMW: available }) => ({ id, generationMW: output, dispatchableMW: available }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      consumers: consumerResults.sort((a, b) => a.id.localeCompare(b.id)),
      batteries: batteryStates
        .map(({ id, chargeMW, dischargeMW, storedMWh: energy }) => ({ id, chargeMW, dischargeMW, storedMWh: energy }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  /** Player-issued black-start action; P1 sufficiency is checked again on the next tick. */
  sequentialRestart(): void {
    this.mainBreakerTripped = false;
    this.lowSatisfactionSeconds = 0;
    this.recoveryStableSeconds = 0;
  }

  snapshot(): AdvancedPowerGridSnapshot {
    return {
      version: 1,
      gridId: this.gridId,
      batteries: [...this.batteryEnergy].map(([id, storedMWh]) => ({ id, storedMWh })).sort((a, b) => a.id.localeCompare(b.id)),
      shedConsumerIds: [...this.shedConsumerIds].sort(),
      lowSatisfactionSeconds: this.lowSatisfactionSeconds,
      recoveryStableSeconds: this.recoveryStableSeconds,
      secondsSinceRecovery: this.secondsSinceRecovery,
      mainBreakerTripped: this.mainBreakerTripped,
    };
  }

  restore(snapshot: AdvancedPowerGridSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`unsupported power grid snapshot version: ${snapshot.version}`);
    if (snapshot.gridId !== this.gridId) throw new Error("power grid snapshot gridId does not match");
    assertUniqueIds(snapshot.batteries, "snapshot battery");
    snapshot.batteries.forEach(({ id, storedMWh }) => {
      assertNonNegative(storedMWh, `snapshot battery ${id} storedMWh`);
    });
    [snapshot.lowSatisfactionSeconds, snapshot.recoveryStableSeconds].forEach((value, index) => {
      assertNonNegative(value, index === 0 ? "lowSatisfactionSeconds" : "recoveryStableSeconds");
    });
    assertNonNegative(snapshot.secondsSinceRecovery, "secondsSinceRecovery");
    this.batteryEnergy.clear();
    snapshot.batteries.forEach(({ id, storedMWh }) => this.batteryEnergy.set(id, storedMWh));
    this.shedConsumerIds.clear();
    snapshot.shedConsumerIds.forEach((id) => this.shedConsumerIds.add(id));
    this.lowSatisfactionSeconds = snapshot.lowSatisfactionSeconds;
    this.recoveryStableSeconds = snapshot.recoveryStableSeconds;
    this.secondsSinceRecovery = snapshot.secondsSinceRecovery;
    this.mainBreakerTripped = snapshot.mainBreakerTripped;
  }

  private validateInput(input: PowerGridInputSnapshot) {
    if (input.gridId !== this.gridId) throw new Error("power grid input gridId does not match");
    if (!Number.isFinite(input.deltaSeconds) || input.deltaSeconds <= 0) {
      throw new RangeError("deltaSeconds must be finite and greater than zero");
    }
    assertUniqueIds(input.generators, "generator");
    assertUniqueIds(input.consumers, "consumer");
    assertUniqueIds(input.batteries, "battery");
    input.generators.forEach((generator) => {
      assertNonNegative(generator.nameplateMW, `${generator.id}.nameplateMW`);
      assertNonNegative(generator.dispatchableMW ?? generator.nameplateMW, `${generator.id}.dispatchableMW`);
      assertNonNegative(generator.minimumLoadMW ?? 0, `${generator.id}.minimumLoadMW`);
      if ((generator.dispatchableMW ?? generator.nameplateMW) > generator.nameplateMW + EPSILON) {
        throw new RangeError(`${generator.id}.dispatchableMW exceeds nameplateMW`);
      }
      if ((generator.minimumLoadMW ?? 0) > (generator.dispatchableMW ?? generator.nameplateMW) + EPSILON) {
        throw new RangeError(`${generator.id}.minimumLoadMW exceeds dispatchableMW`);
      }
      if (!Number.isFinite(generator.dispatchPriority)) throw new RangeError(`${generator.id}.dispatchPriority must be finite`);
    });
    input.consumers.forEach((consumer) => {
      assertNonNegative(consumer.activeMW, `${consumer.id}.activeMW`);
      assertNonNegative(consumer.idleMW, `${consumer.id}.idleMW`);
      assertNonNegative(consumerRequest(consumer), `${consumer.id}.requestedMW`);
      if (consumer.priority !== undefined && ![1, 2, 3, 4].includes(consumer.priority)) {
        throw new RangeError(`${consumer.id}.priority must be P1 through P4`);
      }
    });
    input.batteries.forEach((battery) => {
      assertNonNegative(battery.capacityMWh, `${battery.id}.capacityMWh`);
      assertNonNegative(battery.storedMWh, `${battery.id}.storedMWh`);
      assertNonNegative(battery.maxChargeMW, `${battery.id}.maxChargeMW`);
      assertNonNegative(battery.maxDischargeMW, `${battery.id}.maxDischargeMW`);
    });
  }

  private removeMissingShedConsumers(consumers: readonly Readonly<{ id: string }>[]) {
    const ids = new Set(consumers.map(({ id }) => id));
    this.shedConsumerIds.forEach((id) => {
      if (!ids.has(id)) this.shedConsumerIds.delete(id);
    });
  }

  private tryRecoverOneConsumer(
    consumers: readonly Readonly<{ id: string; connected: boolean; requestedMW: number; priority: LoadPriority }>[],
    dispatchableMW: number,
    deltaSeconds: number,
  ) {
    if (this.mainBreakerTripped || this.shedConsumerIds.size === 0) {
      this.recoveryStableSeconds = 0;
      return;
    }
    const candidate = consumers
      .filter((consumer) => consumer.connected && this.shedConsumerIds.has(consumer.id))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
    if (!candidate) return;
    const currentRequestedMW = consumers
      .filter((consumer) => consumer.connected && !this.shedConsumerIds.has(consumer.id))
      .reduce((total, consumer) => total + consumer.requestedMW, 0);
    const predictedRequestedMW = currentRequestedMW + candidate.requestedMW;
    const predictedSatisfaction = predictedRequestedMW === 0 ? 1 : clamp01(dispatchableMW / predictedRequestedMW);
    const predictedReserveRatio = dispatchableMW === 0
      ? 0
      : (dispatchableMW - predictedRequestedMW) / dispatchableMW;
    if (predictedSatisfaction >= 1 && predictedReserveRatio + EPSILON >= RECOVERY_RESERVE_RATIO) {
      this.recoveryStableSeconds += deltaSeconds;
    } else {
      this.recoveryStableSeconds = 0;
    }
    if (this.recoveryStableSeconds + EPSILON >= RECOVERY_STABLE_SECONDS
      && this.secondsSinceRecovery + EPSILON >= RECOVERY_INTERVAL_SECONDS) {
      this.shedConsumerIds.delete(candidate.id);
      this.recoveryStableSeconds = 0;
      this.secondsSinceRecovery = 0;
    }
  }

  private trippedResult(
    input: PowerGridInputSnapshot,
    generators: readonly Readonly<{ id: string; dispatchableMW: number }>[],
    consumers: readonly Readonly<{ id: string; priority: LoadPriority; requestedMW: number; connected: boolean }>[],
    batteries: readonly Readonly<{ id: string; storedMWh: number }>[],
    capacityMW: number,
    dispatchableMW: number,
    maxConsumptionMW: number,
  ): PowerGridResult {
    const storedMWh = batteries.reduce((total, battery) => total + battery.storedMWh, 0);
    return {
      gridId: this.gridId,
      capacityMW,
      dispatchableMW,
      requestedMW: 0,
      servedMW: 0,
      generationMW: 0,
      maxConsumptionMW,
      batteryChargeMW: 0,
      batteryDischargeMW: 0,
      curtailedMW: 0,
      storedMWh,
      nameplateReserveMW: capacityMW - maxConsumptionMW,
      operatingReserveMW: dispatchableMW,
      operatingReserveRatio: dispatchableMW === 0 ? 0 : 1,
      satisfaction: 1,
      mainBreakerTripped: true,
      shedConsumerIds: [...this.shedConsumerIds].sort(),
      generators: generators.map(({ id, dispatchableMW: available }) => ({ id, generationMW: 0, dispatchableMW: available })).sort((a, b) => a.id.localeCompare(b.id)),
      consumers: consumers.map((consumer) => ({
        id: consumer.id,
        priority: consumer.priority,
        requestedMW: 0,
        servedMW: 0,
        satisfaction: 0,
        shed: !consumer.connected || this.shedConsumerIds.has(consumer.id),
      })).sort((a, b) => a.id.localeCompare(b.id)),
      batteries: input.batteries.map(({ id }) => ({
        id,
        chargeMW: 0,
        dischargeMW: 0,
        storedMWh: batteries.find((battery) => battery.id === id)?.storedMWh ?? 0,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
