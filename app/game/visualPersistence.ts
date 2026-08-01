import { BrowserSaveStorage, createJsonSaveCodec } from "./persistence.ts";
import { FactorySimulation, type FactorySimulationSnapshot } from "./simulation.ts";
import { START_REGISTRY } from "./data/index.ts";
import { DataDrivenWorld, type WorldSnapshot } from "./sim/world.ts";
import { CampaignWorldRuntime, type CampaignWorldSnapshot } from "./sim/campaignWorld.ts";
import { WorldProductionSimulation, type WorldProductionSnapshot } from "./sim/worldProduction.ts";
import type { PowerNetworkControls } from "./sim/physicalPowerNetwork.ts";
import type { CameraMode } from "./types.ts";

export const VISUAL_RUNTIME_SAVE_KEY = "factoryx.visual-runtime.v1";

export type FactoryRuntimeSnapshot = Readonly<{
  version: 1;
  simulation: FactorySimulationSnapshot;
  world?: WorldSnapshot;
  campaignWorld?: CampaignWorldSnapshot;
  worldProduction?: WorldProductionSnapshot;
  dockFluidTransferCredit?: number;
  powerControls?: PowerNetworkControls;
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
  const expectedWithWorld = [...expected, "world"].sort();
  const expectedWithCampaign = [...expected, "world", "campaignWorld"].sort();
  const expectedWithProduction = [...expected, "world", "campaignWorld", "worldProduction"].sort();
  const expectedWithFluidDelivery = [...expectedWithProduction, "dockFluidTransferCredit"].sort();
  const expectedWithPowerControls = [...expectedWithFluidDelivery, "powerControls"].sort();
  const matches = (candidate: readonly string[]) => keys.length === candidate.length
    && keys.every((key, index) => key === candidate[index]);
  if (!matches(expected) && !matches(expectedWithWorld) && !matches(expectedWithCampaign)
    && !matches(expectedWithProduction) && !matches(expectedWithFluidDelivery) && !matches(expectedWithPowerControls)) return false;
  if (value.version !== 1
    || !Number.isSafeInteger(value.credits) || (value.credits as number) < 0
    || !Number.isSafeInteger(value.nextId) || (value.nextId as number) < 1
    || (value.cameraMode !== "overview" && value.cameraMode !== "firstPerson")
    || !isFiniteNumber(value.cameraAngle)
    || !isFiniteNumber(value.cameraZoom) || value.cameraZoom <= 0
    || !isVector(value.cameraTarget)
    || !isVector(value.playerPosition)
    || !isFiniteNumber(value.firstPersonYaw)
    || !isFiniteNumber(value.firstPersonPitch)
    || (value.dockFluidTransferCredit !== undefined
      && (!isFiniteNumber(value.dockFluidTransferCredit) || value.dockFluidTransferCredit < 0 || value.dockFluidTransferCredit > 1 + Number.EPSILON))) return false;
  if (value.powerControls !== undefined) {
    if (!isRecord(value.powerControls)) return false;
    const controlKeys = Object.keys(value.powerControls);
    if (controlKeys.some((key) => key !== "breakers" && key !== "switchboardOutputs")) return false;
    if (value.powerControls.breakers !== undefined) {
      if (!isRecord(value.powerControls.breakers)
        || Object.values(value.powerControls.breakers).some((state) => !["closed", "open", "tripped"].includes(state as string))) return false;
    }
    if (value.powerControls.switchboardOutputs !== undefined) {
      if (!isRecord(value.powerControls.switchboardOutputs)) return false;
      for (const outputs of Object.values(value.powerControls.switchboardOutputs)) {
        if (!isRecord(outputs) || Object.keys(outputs).some((priority) => !["1", "2", "3", "4"].includes(priority))
          || Object.values(outputs).some((enabled) => typeof enabled !== "boolean")) return false;
      }
    }
  }
  try {
    new FactorySimulation(24, value.simulation as FactorySimulationSnapshot);
    if (value.world !== undefined) {
      if (!isRecord(value.world) || !isRecord(value.world.bounds)) return false;
      const bounds = value.world.bounds as WorldSnapshot["bounds"];
      new DataDrivenWorld({ registry: START_REGISTRY, bounds, snapshot: value.world as WorldSnapshot });
    }
    if (value.campaignWorld !== undefined) {
      if (!isRecord(value.campaignWorld) || !isRecord(value.campaignWorld.world)) return false;
      const campaignSnapshot = value.campaignWorld as CampaignWorldSnapshot;
      const bounds = campaignSnapshot.world.bounds;
      new CampaignWorldRuntime({ registry: START_REGISTRY, bounds, snapshot: campaignSnapshot });
      if (value.world !== undefined && JSON.stringify(value.world) !== JSON.stringify(campaignSnapshot.world)) return false;
    }
    if (value.worldProduction !== undefined) {
      const worldSnapshot = (value.campaignWorld as CampaignWorldSnapshot | undefined)?.world ?? value.world as WorldSnapshot | undefined;
      if (!worldSnapshot) return false;
      const world = new DataDrivenWorld({ registry: START_REGISTRY, bounds: worldSnapshot.bounds, snapshot: worldSnapshot });
      new WorldProductionSimulation(world, value.worldProduction as WorldProductionSnapshot);
    }
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
