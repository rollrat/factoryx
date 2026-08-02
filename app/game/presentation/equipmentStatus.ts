/**
 * Player-facing equipment states. These are deliberately independent from the
 * simulation state enums: presentation needs to retain actionable power and
 * logistics causes even when the mathematical grid satisfaction is `1`.
 */
export const EQUIPMENT_OPERATIONAL_STATES = [
  "tripped",
  "unconnected",
  "shed",
  "fuel_starved",
  "power_limited",
  "missing_input",
  "output_blocked",
  "recipe_missing",
  "manual_off",
  "restoring",
  "idle",
  "working",
] as const;

export type EquipmentOperationalState = (typeof EQUIPMENT_OPERATIONAL_STATES)[number];
export type EquipmentBaselineState = Extract<EquipmentOperationalState, "idle" | "working">;

/**
 * Highest severity first.
 *
 * `unconnected` represents a missing required physical connection. Once a
 * required connection exists, `missing_input` represents material starvation.
 * `restoring` is informative rather than a fault, so actionable faults remain
 * visible while a grid is recovering.
 */
export const EQUIPMENT_STATE_PRIORITY = [
  "tripped",
  "unconnected",
  "shed",
  "fuel_starved",
  "power_limited",
  "manual_off",
  "recipe_missing",
  "output_blocked",
  "missing_input",
  "restoring",
  "idle",
  "working",
] as const satisfies readonly EquipmentOperationalState[];

export const EQUIPMENT_STATE_LABELS = {
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
} as const satisfies Readonly<Record<EquipmentOperationalState, string>>;

/** Structured cause data survives reduction so panels can explain and locate it. */
export type EquipmentStatusCause = Readonly<{
  state: EquipmentOperationalState;
  code: string;
  label: string;
  detail?: string;
  sourceId?: string;
  portIds?: readonly string[];
}>;

export type EquipmentStatusReducerInput<TCause extends EquipmentStatusCause = EquipmentStatusCause> = Readonly<{
  activeStates?: readonly EquipmentOperationalState[];
  causes?: readonly TCause[];
  fallbackState?: EquipmentBaselineState;
}>;

export type EquipmentStatusPresentation<TCause extends EquipmentStatusCause = EquipmentStatusCause> = Readonly<{
  primaryState: EquipmentOperationalState;
  primaryLabel: string;
  primaryCause?: TCause;
  causes: readonly TCause[];
}>;

export const getEquipmentStatusLabel = (state: EquipmentOperationalState) => EQUIPMENT_STATE_LABELS[state];

/**
 * Selects one representative state from structured signals without inspecting
 * human-readable labels. Cause ordering and metadata are returned unchanged.
 */
export function reduceEquipmentStatus<TCause extends EquipmentStatusCause = EquipmentStatusCause>(
  input: EquipmentStatusReducerInput<TCause>,
): EquipmentStatusPresentation<TCause> {
  const causes = input.causes ?? [];
  const activeStates = new Set<EquipmentOperationalState>(input.activeStates ?? []);
  causes.forEach(({ state }) => activeStates.add(state));

  const primaryState = EQUIPMENT_STATE_PRIORITY.find((state) => activeStates.has(state))
    ?? input.fallbackState
    ?? "idle";

  return {
    primaryState,
    primaryLabel: getEquipmentStatusLabel(primaryState),
    primaryCause: causes.find(({ state }) => state === primaryState),
    causes,
  };
}
