import type { SimulationSnapshot } from "./sim/contracts.ts";

export const GAME_SAVE_FORMAT = "factoryx-local-save";
export const GAME_SAVE_VERSION = 1 as const;

export type GameSaveEnvelope<Snapshot> = Readonly<{
  format: typeof GAME_SAVE_FORMAT;
  version: typeof GAME_SAVE_VERSION;
  savedAt: number;
  pausedAt: number | null;
  snapshot: Snapshot;
}>;

export type SaveDecodeFailureReason =
  | "invalid_json"
  | "invalid_envelope"
  | "unsupported_version"
  | "migration_failed";

export type SaveDecodeResult<Snapshot> =
  | Readonly<{ ok: true; value: GameSaveEnvelope<Snapshot> }>
  | Readonly<{ ok: false; reason: SaveDecodeFailureReason }>;

export type SaveMigration = (
  envelope: Readonly<Record<string, unknown>>,
  fromVersion: number,
) => unknown;

export type SaveCodec<Snapshot> = Readonly<{
  encode: (
    snapshot: Snapshot,
    options?: Readonly<{ nowMs?: number; pausedAtMs?: number | null }>,
  ) => string;
  decode: (json: string) => SaveDecodeResult<Snapshot>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isNonNegativeFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  isNonNegativeFinite(value) && Number.isSafeInteger(value);

const isNullableNonNegativeInteger = (value: unknown): value is number | null =>
  value === null || isNonNegativeInteger(value);

const isString = (value: unknown): value is string => typeof value === "string";

const MACHINE_STATES = new Set([
  "idle", "working", "starved", "blocked", "disconnected", "paused",
]);

const isInventorySnapshot = (value: unknown) => {
  if (!isRecord(value) || !hasExactKeys(value, ["portId", "itemId", "amount", "capacity"])) return false;
  return isString(value.portId)
    && (value.itemId === null || isString(value.itemId))
    && isNonNegativeFinite(value.amount)
    && isNonNegativeFinite(value.capacity)
    && value.amount <= value.capacity;
};

const isWorkInProgress = (value: unknown) => {
  if (!isRecord(value) || !hasExactKeys(value, ["itemId", "amount"])) return false;
  return isString(value.itemId) && isNonNegativeFinite(value.amount);
};

const isMachineSnapshot = (value: unknown) => {
  if (!isRecord(value) || !hasExactKeys(value, [
    "structureId", "buildingId", "recipeId", "runtimeState", "progress",
    "inputBuffers", "outputBuffers", "workInProgress",
  ])) return false;
  return isNonNegativeInteger(value.structureId)
    && isString(value.buildingId)
    && (value.recipeId === null || isString(value.recipeId))
    && isString(value.runtimeState)
    && MACHINE_STATES.has(value.runtimeState)
    && isNonNegativeFinite(value.progress)
    && value.progress <= 1
    && Array.isArray(value.inputBuffers)
    && value.inputBuffers.every(isInventorySnapshot)
    && Array.isArray(value.outputBuffers)
    && value.outputBuffers.every(isInventorySnapshot)
    && Array.isArray(value.workInProgress)
    && value.workInProgress.every(isWorkInProgress);
};

/** Strict validator for the currently serializable deterministic simulation snapshot. */
export const isSimulationSnapshot = (value: unknown): value is SimulationSnapshot => {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "tick", "elapsedSeconds", "machines"])) return false;
  return value.version === 1
    && isNonNegativeInteger(value.tick)
    && isNonNegativeFinite(value.elapsedSeconds)
    && Array.isArray(value.machines)
    && value.machines.every(isMachineSnapshot);
};

const readVersion = (value: Record<string, unknown>) =>
  isNonNegativeInteger(value.version) ? value.version : null;

export function createJsonSaveCodec<Snapshot>(options: Readonly<{
  validateSnapshot: (value: unknown) => value is Snapshot;
  migrate?: SaveMigration;
}>): SaveCodec<Snapshot> {
  const validateEnvelope = (value: unknown): value is GameSaveEnvelope<Snapshot> => {
    if (!isRecord(value) || !hasExactKeys(value, ["format", "version", "savedAt", "pausedAt", "snapshot"])) return false;
    return value.format === GAME_SAVE_FORMAT
      && value.version === GAME_SAVE_VERSION
      && isNonNegativeInteger(value.savedAt)
      && isNullableNonNegativeInteger(value.pausedAt)
      && options.validateSnapshot(value.snapshot);
  };

  return {
    encode(snapshot, encodeOptions = {}) {
      if (!options.validateSnapshot(snapshot)) throw new TypeError("invalid game snapshot");
      const savedAt = encodeOptions.nowMs ?? Date.now();
      const pausedAt = encodeOptions.pausedAtMs ?? null;
      if (!isNonNegativeInteger(savedAt) || !isNullableNonNegativeInteger(pausedAt)) {
        throw new RangeError("save timestamps must be non-negative integer milliseconds");
      }
      return JSON.stringify({
        format: GAME_SAVE_FORMAT,
        version: GAME_SAVE_VERSION,
        savedAt,
        pausedAt,
        snapshot,
      } satisfies GameSaveEnvelope<Snapshot>);
    },

    decode(json) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json) as unknown;
      } catch {
        return { ok: false, reason: "invalid_json" };
      }
      if (!isRecord(parsed)) return { ok: false, reason: "invalid_envelope" };

      const version = readVersion(parsed);
      if (version === null) return { ok: false, reason: "invalid_envelope" };
      if (version !== GAME_SAVE_VERSION) {
        if (!options.migrate) return { ok: false, reason: "unsupported_version" };
        try {
          parsed = options.migrate(parsed, version);
        } catch {
          return { ok: false, reason: "migration_failed" };
        }
        if (!validateEnvelope(parsed)) return { ok: false, reason: "migration_failed" };
      }

      return validateEnvelope(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: "invalid_envelope" };
    },
  };
}

export const simulationSaveCodec = createJsonSaveCodec<SimulationSnapshot>({
  validateSnapshot: isSimulationSnapshot,
});

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SaveStorageFailureReason = SaveDecodeFailureReason | "storage_error";

export type SaveLoadResult<Snapshot> =
  | Readonly<{ ok: true; value: GameSaveEnvelope<Snapshot> | null }>
  | Readonly<{ ok: false; reason: SaveStorageFailureReason }>;

export type SaveWriteResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "storage_error" | "invalid_snapshot" }>;

/** Browser Storage adapter. The codec itself deliberately has no localStorage dependency. */
export class BrowserSaveStorage<Snapshot> {
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly codec: SaveCodec<Snapshot>;

  constructor(
    storage: StorageLike,
    key: string,
    codec: SaveCodec<Snapshot>,
  ) {
    this.storage = storage;
    this.key = key;
    this.codec = codec;
  }

  save(snapshot: Snapshot, options?: Readonly<{ nowMs?: number; pausedAtMs?: number | null }>): SaveWriteResult {
    let encoded: string;
    try {
      encoded = this.codec.encode(snapshot, options);
    } catch {
      return { ok: false, reason: "invalid_snapshot" };
    }
    try {
      this.storage.setItem(this.key, encoded);
      return { ok: true };
    } catch {
      return { ok: false, reason: "storage_error" };
    }
  }

  /**
   * Page-hidden saves record a pause boundary. Loading returns the exact snapshot;
   * elapsed wall time is never applied as offline simulation catch-up.
   */
  saveForPageHide(snapshot: Snapshot, nowMs = Date.now()): SaveWriteResult {
    return this.save(snapshot, { nowMs, pausedAtMs: nowMs });
  }

  load(): SaveLoadResult<Snapshot> {
    let encoded: string | null;
    try {
      encoded = this.storage.getItem(this.key);
    } catch {
      return { ok: false, reason: "storage_error" };
    }
    if (encoded === null) return { ok: true, value: null };
    const decoded = this.codec.decode(encoded);
    return decoded.ok ? decoded : { ok: false, reason: decoded.reason };
  }

  delete(): SaveWriteResult {
    try {
      this.storage.removeItem(this.key);
      return { ok: true };
    } catch {
      return { ok: false, reason: "storage_error" };
    }
  }
}
