import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserSaveStorage,
  GAME_SAVE_FORMAT,
  GAME_SAVE_VERSION,
  createJsonSaveCodec,
  isSimulationSnapshot,
  simulationSaveCodec,
  type StorageLike,
} from "../../app/game/persistence.ts";
import type { SimulationSnapshot } from "../../app/game/sim/contracts.ts";

const snapshot = (): SimulationSnapshot => ({
  version: 1,
  tick: 240,
  elapsedSeconds: 12,
  machines: [{
    structureId: 7,
    buildingId: "arc_smelter",
    recipeId: "smelt_iron_ingot",
    runtimeState: "working",
    progress: 0.5,
    inputBuffers: [{ portId: "solid_in", itemId: "iron_ore", amount: 1, capacity: 2 }],
    outputBuffers: [{ portId: "solid_out", itemId: null, amount: 0, capacity: 2 }],
    workInProgress: [{ itemId: "iron_ore", amount: 2 }],
  }],
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("versioned codec round-trips the current simulation snapshot", () => {
  const encoded = simulationSaveCodec.encode(snapshot(), { nowMs: 1_000 });
  const raw = JSON.parse(encoded) as Record<string, unknown>;
  assert.equal(raw.format, GAME_SAVE_FORMAT);
  assert.equal(raw.version, GAME_SAVE_VERSION);
  assert.equal(raw.savedAt, 1_000);
  assert.equal(raw.pausedAt, null);

  const decoded = simulationSaveCodec.decode(encoded);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value.snapshot, snapshot());
});

test("strict validation rejects malformed snapshots and unknown fields", () => {
  assert.equal(isSimulationSnapshot({ ...snapshot(), tick: -1 }), false);
  assert.equal(isSimulationSnapshot({ ...snapshot(), extra: true }), false);
  assert.throws(() => simulationSaveCodec.encode({ ...snapshot(), elapsedSeconds: Number.NaN }));

  const envelope = JSON.parse(simulationSaveCodec.encode(snapshot(), { nowMs: 10 })) as Record<string, unknown>;
  assert.deepEqual(simulationSaveCodec.decode(JSON.stringify({ ...envelope, extra: true })), {
    ok: false,
    reason: "invalid_envelope",
  });
});

test("corrupted JSON and unsupported versions fail safely", () => {
  assert.deepEqual(simulationSaveCodec.decode("{bad json"), { ok: false, reason: "invalid_json" });
  assert.deepEqual(simulationSaveCodec.decode(JSON.stringify({
    format: GAME_SAVE_FORMAT,
    version: 999,
    savedAt: 1,
    pausedAt: null,
    snapshot: snapshot(),
  })), { ok: false, reason: "unsupported_version" });
});

test("a migration hook must produce a strictly valid current envelope", () => {
  const codec = createJsonSaveCodec<SimulationSnapshot>({
    validateSnapshot: isSimulationSnapshot,
    migrate(old, version) {
      assert.equal(version, 0);
      return {
        format: GAME_SAVE_FORMAT,
        version: GAME_SAVE_VERSION,
        savedAt: old.savedAt,
        pausedAt: null,
        snapshot: old.payload,
      };
    },
  });
  const decoded = codec.decode(JSON.stringify({ version: 0, savedAt: 25, payload: snapshot() }));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value.snapshot, snapshot());

  const failing = createJsonSaveCodec<SimulationSnapshot>({
    validateSnapshot: isSimulationSnapshot,
    migrate: () => ({ version: 1 }),
  });
  assert.deepEqual(failing.decode(JSON.stringify({ version: 0 })), { ok: false, reason: "migration_failed" });
});

test("Storage adapter saves, loads, deletes, and preserves corrupt entries", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSaveStorage(storage, "factoryx:test", simulationSaveCodec);
  assert.deepEqual(repository.load(), { ok: true, value: null });
  assert.deepEqual(repository.save(snapshot(), { nowMs: 30 }), { ok: true });
  const loaded = repository.load();
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.value?.snapshot, snapshot());
  assert.deepEqual(repository.delete(), { ok: true });
  assert.deepEqual(repository.load(), { ok: true, value: null });

  storage.setItem("factoryx:test", "not json");
  assert.deepEqual(repository.load(), { ok: false, reason: "invalid_json" });
  assert.equal(storage.getItem("factoryx:test"), "not json", "a failed load must not mutate user data");
});

test("page-hidden save records pausedAt and never applies offline catch-up", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSaveStorage(storage, "factoryx:hidden", simulationSaveCodec);
  const beforeHide = snapshot();
  assert.deepEqual(repository.saveForPageHide(beforeHide, 50_000), { ok: true });

  // Loading much later still returns the exact deterministic simulation state.
  const loaded = repository.load();
  assert.equal(loaded.ok, true);
  if (!loaded.ok || !loaded.value) return;
  assert.equal(loaded.value.pausedAt, 50_000);
  assert.equal(loaded.value.savedAt, 50_000);
  assert.equal(loaded.value.snapshot.tick, beforeHide.tick);
  assert.equal(loaded.value.snapshot.elapsedSeconds, beforeHide.elapsedSeconds);
});

test("Storage exceptions are converted to safe results", () => {
  const broken: StorageLike = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("denied"); },
  };
  const repository = new BrowserSaveStorage(broken, "factoryx:broken", simulationSaveCodec);
  assert.deepEqual(repository.load(), { ok: false, reason: "storage_error" });
  assert.deepEqual(repository.save(snapshot()), { ok: false, reason: "storage_error" });
  assert.deepEqual(repository.delete(), { ok: false, reason: "storage_error" });
});
