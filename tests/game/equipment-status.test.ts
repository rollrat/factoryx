import assert from "node:assert/strict";
import test from "node:test";

import {
  EQUIPMENT_OPERATIONAL_STATES,
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_STATE_PRIORITY,
  getEquipmentStatusLabel,
  reduceEquipmentStatus,
  type EquipmentStatusCause,
} from "../../app/game/presentation/equipmentStatus.ts";

test("equipment status contract includes every operational state exactly once", () => {
  assert.equal(new Set(EQUIPMENT_OPERATIONAL_STATES).size, EQUIPMENT_OPERATIONAL_STATES.length);
  assert.deepEqual(
    [...EQUIPMENT_STATE_PRIORITY].sort(),
    [...EQUIPMENT_OPERATIONAL_STATES].sort(),
  );
});

test("each operational state has a stable Korean label", () => {
  assert.deepEqual(EQUIPMENT_STATE_LABELS, {
    tripped: "보호 트립",
    unconnected: "연결 없음",
    shed: "부하 차단",
    fuel_starved: "연료 없음",
    power_limited: "전력 제한",
    missing_input: "입력 부족",
    output_blocked: "출력 막힘",
    recipe_missing: "레시피 없음",
    manual_off: "수동 정지",
    restoring: "복구 중",
    idle: "대기",
    working: "정상 가동",
  });
  EQUIPMENT_OPERATIONAL_STATES.forEach((state) => {
    assert.equal(getEquipmentStatusLabel(state), EQUIPMENT_STATE_LABELS[state]);
  });
});

test("reducer selects the first active state in the documented priority order", () => {
  EQUIPMENT_STATE_PRIORITY.forEach((expected, index) => {
    const activeStates = EQUIPMENT_STATE_PRIORITY.slice(index);
    assert.equal(
      reduceEquipmentStatus({ activeStates }).primaryState,
      expected,
      `${expected} should outrank ${activeStates.slice(1).join(", ")}`,
    );
  });
});

test("structured causes activate their state and survive reduction unchanged", () => {
  const causes = [
    {
      state: "power_limited",
      code: "grid_supply_shortfall",
      label: "24 MW 요청 중 12 MW 공급",
      detail: "전력망 발전 용량을 늘리세요.",
      sourceId: "grid:a",
    },
    {
      state: "missing_input",
      code: "empty_input_port",
      label: "철광석 입력 없음",
      portIds: ["ore_in"],
    },
  ] as const satisfies readonly EquipmentStatusCause[];

  const result = reduceEquipmentStatus({ activeStates: ["working"], causes });

  assert.equal(result.primaryState, "power_limited");
  assert.equal(result.primaryLabel, "전력 제한");
  assert.equal(result.primaryCause, causes[0]);
  assert.equal(result.causes, causes);
  assert.deepEqual(result.causes, causes);
});

test("human-readable cause text never reclassifies the structured state", () => {
  const misleadingText = [{
    state: "working",
    code: "operator_note",
    label: "보호 트립, 연료 없음, 전력 부족이라는 문자열",
  }] as const satisfies readonly EquipmentStatusCause[];

  const result = reduceEquipmentStatus({ causes: misleadingText });

  assert.equal(result.primaryState, "working");
  assert.equal(result.primaryLabel, "정상 가동");
});

test("reducer uses an explicit baseline fallback and otherwise defaults to idle", () => {
  assert.deepEqual(reduceEquipmentStatus({}), {
    primaryState: "idle",
    primaryLabel: "대기",
    primaryCause: undefined,
    causes: [],
  });
  assert.equal(reduceEquipmentStatus({ fallbackState: "working" }).primaryState, "working");
  assert.equal(reduceEquipmentStatus({ activeStates: ["idle", "working"] }).primaryState, "idle");
});

