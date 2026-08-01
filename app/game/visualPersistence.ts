import { BrowserSaveStorage, createJsonSaveCodec } from "./persistence.ts";
import { FactorySimulation, type FactorySimulationSnapshot } from "./simulation.ts";
import type { CameraMode } from "./types.ts";

export const VISUAL_RUNTIME_SAVE_KEY = "factoryx.visual-runtime.v1";

export type FactoryRuntimeSnapshot = Readonly<{
  version: 1;
  simulation: FactorySimulationSnapshot;
  credits: number;
  nextId: number;
  cameraMode: CameraMode;
  cameraAngle: number;
  cameraZoom: number;
  cameraTarget: readonly [number, number, number];
  playerPosition: readonly [number, number, number];
  firstPersonYaw: number;
  firstPersonPitch: number;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isVector = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);

export const isFactoryRuntimeSnapshot = (value: unknown): value is FactoryRuntimeSnapshot => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    "cameraAngle", "cameraMode", "cameraTarget", "cameraZoom", "credits",
    "firstPersonPitch", "firstPersonYaw", "nextId", "playerPosition", "simulation", "version",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (value.version !== 1
    || !Number.isSafeInteger(value.credits) || (value.credits as number) < 0
    || !Number.isSafeInteger(value.nextId) || (value.nextId as number) < 1
    || (value.cameraMode !== "overview" && value.cameraMode !== "firstPerson")
    || !isFiniteNumber(value.cameraAngle)
    || !isFiniteNumber(value.cameraZoom) || value.cameraZoom <= 0
    || !isVector(value.cameraTarget)
    || !isVector(value.playerPosition)
    || !isFiniteNumber(value.firstPersonYaw)
    || !isFiniteNumber(value.firstPersonPitch)) return false;
  try {
    new FactorySimulation(24, value.simulation as FactorySimulationSnapshot);
    return true;
  } catch {
    return false;
  }
};

export const factoryRuntimeSaveCodec = createJsonSaveCodec<FactoryRuntimeSnapshot>({
  validateSnapshot: isFactoryRuntimeSnapshot,
});

export const createFactoryRuntimeSaveStorage = (storage: Storage) =>
  new BrowserSaveStorage(storage, VISUAL_RUNTIME_SAVE_KEY, factoryRuntimeSaveCodec);
