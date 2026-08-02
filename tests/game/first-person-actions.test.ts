import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialFirstPersonActionState,
  firstPersonActionReducer,
  getFirstPersonSelectedOwnerId,
  getFirstPersonTool,
  transitionFirstPersonAction,
  type FirstPersonActionState,
  type FirstPersonGridAnchor,
} from "../../app/game/interaction/firstPersonActions.ts";

const cellA: FirstPersonGridAnchor = { x: 4, z: 7, stratumId: "surface" };
const cellB: FirstPersonGridAnchor = { x: 9, z: 7, stratumId: "surface" };

const lockedLook = (selectedOwnerId: string | null = null): FirstPersonActionState => ({
  mode: "look",
  pointerLock: "locked",
  selectedOwnerId,
});

test("starts unlocked in look mode with no selection", () => {
  const state = createInitialFirstPersonActionState();
  assert.deepEqual(state, {
    mode: "look",
    pointerLock: "unlocked",
    selectedOwnerId: null,
  });
  assert.equal(getFirstPersonTool(state), "inspect");
  assert.equal(getFirstPersonSelectedOwnerId(state), null);
});

test("the pointer-lock acquisition click never confirms a build", () => {
  let state = transitionFirstPersonAction(createInitialFirstPersonActionState(), {
    type: "tool_switch",
    selection: { tool: "build", buildingId: "smelter", rotation: 2 },
  }).state;

  const acquisitionClick = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellA },
  });
  state = acquisitionClick.state;
  assert.equal(state.mode, "build");
  assert.equal(state.pointerLock, "requesting");
  assert.deepEqual(acquisitionClick.commands, [{ type: "request_pointer_lock" }]);

  state = transitionFirstPersonAction(state, { type: "pointer_lock_acquired" }).state;
  const actionClick = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellA },
  });
  assert.deepEqual(actionClick.commands, [{
    type: "confirm_build",
    buildingId: "smelter",
    anchor: cellA,
    rotation: 2,
  }]);
});

test("belt clicks advance start to route and commit back to a clean start state", () => {
  let state = transitionFirstPersonAction(lockedLook(), {
    type: "tool_switch",
    selection: { tool: "belt", rotation: 1 },
  }).state;
  state = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellA },
  }).state;
  assert.equal(state.mode, "belt_route");
  if (state.mode !== "belt_route") assert.fail("expected belt_route");
  assert.deepEqual(state.start, cellA);

  const committed = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellB },
  });
  assert.equal(committed.state.mode, "belt_start");
  assert.equal("start" in committed.state, false);
  assert.deepEqual(committed.commands, [{
    type: "commit_belt",
    start: cellA,
    end: cellB,
    startRotation: 1,
  }]);
});

test("cable clicks advance endpoint selection and commit back to a clean start state", () => {
  let state = transitionFirstPersonAction(lockedLook("pole-a"), {
    type: "tool_switch",
    selection: { tool: "cable" },
  }).state;
  state = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "power_port", endpoint: { ownerId: "pole-a", portId: "P1" } },
  }).state;
  assert.equal(state.mode, "cable_end");

  const committed = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "power_port", endpoint: { ownerId: "machine-b", portId: "power-in" } },
  });
  assert.equal(committed.state.mode, "cable_start");
  assert.equal("start" in committed.state, false);
  assert.deepEqual(committed.commands, [{
    type: "connect_cable",
    start: { ownerId: "pole-a", portId: "P1" },
    end: { ownerId: "machine-b", portId: "power-in" },
  }]);
});

test("cancel clears belt and cable endpoints before leaving their tools", () => {
  const beltRoute: FirstPersonActionState = {
    mode: "belt_route",
    pointerLock: "locked",
    selectedOwnerId: "machine-a",
    start: cellA,
    rotation: 3,
  };
  const beltCancelled = transitionFirstPersonAction(beltRoute, { type: "cancel" }).state;
  assert.deepEqual(beltCancelled, {
    mode: "belt_start",
    pointerLock: "locked",
    selectedOwnerId: "machine-a",
    rotation: 3,
  });
  assert.equal(transitionFirstPersonAction(beltCancelled, { type: "cancel" }).state.mode, "look");

  const cableEnd: FirstPersonActionState = {
    mode: "cable_end",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
    start: { ownerId: "pole-a", portId: "P2" },
  };
  const cableCancelled = transitionFirstPersonAction(cableEnd, { type: "cancel" }).state;
  assert.deepEqual(cableCancelled, {
    mode: "cable_start",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
  });
  assert.equal(transitionFirstPersonAction(cableCancelled, { type: "cancel" }).state.mode, "look");
});

test("tool switches discard every pending belt or cable endpoint", () => {
  const beltRoute: FirstPersonActionState = {
    mode: "belt_route",
    pointerLock: "locked",
    selectedOwnerId: "machine-a",
    start: cellA,
    rotation: 0,
  };
  const cable = transitionFirstPersonAction(beltRoute, {
    type: "tool_switch",
    selection: { tool: "cable" },
  }).state;
  assert.deepEqual(cable, {
    mode: "cable_start",
    pointerLock: "locked",
    selectedOwnerId: "machine-a",
  });

  const cableEnd: FirstPersonActionState = {
    mode: "cable_end",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
    start: { ownerId: "pole-a" },
  };
  const demolish = transitionFirstPersonAction(cableEnd, {
    type: "tool_switch",
    selection: { tool: "demolish" },
  }).state;
  assert.deepEqual(demolish, {
    mode: "demolish",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
  });
});

test("modal entry stores only a resumable belt state and exit requires a fresh lock click", () => {
  const beltRoute: FirstPersonActionState = {
    mode: "belt_route",
    pointerLock: "locked",
    selectedOwnerId: "machine-a",
    start: cellA,
    rotation: 2,
  };
  const entered = transitionFirstPersonAction(beltRoute, {
    type: "modal_enter",
    modal: "catalog",
  });
  assert.deepEqual(entered.commands, [{ type: "release_pointer_lock" }]);
  assert.deepEqual(entered.state, {
    mode: "modal",
    pointerLock: "unlocked",
    modal: "catalog",
    returnTo: {
      mode: "belt_start",
      selectedOwnerId: "machine-a",
      rotation: 2,
    },
  });

  let state = transitionFirstPersonAction(entered.state, { type: "modal_exit" }).state;
  assert.deepEqual(state, {
    mode: "belt_start",
    pointerLock: "unlocked",
    selectedOwnerId: "machine-a",
    rotation: 2,
  });
  const reacquisitionClick = transitionFirstPersonAction(state, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellB },
  });
  state = reacquisitionClick.state;
  assert.equal(state.mode, "belt_start");
  assert.equal(state.pointerLock, "requesting");
  assert.equal("start" in state, false);
  assert.deepEqual(reacquisitionClick.commands, [{ type: "request_pointer_lock" }]);
});

test("modal entry and cancel discard a pending cable endpoint", () => {
  const cableEnd: FirstPersonActionState = {
    mode: "cable_end",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
    start: { ownerId: "pole-a", portId: "P3" },
  };
  const modal = transitionFirstPersonAction(cableEnd, {
    type: "modal_enter",
    modal: "power",
  }).state;
  assert.equal(modal.mode, "modal");
  if (modal.mode !== "modal") assert.fail("expected modal");
  assert.deepEqual(modal.returnTo, {
    mode: "cable_start",
    selectedOwnerId: "pole-a",
  });

  const resumed = transitionFirstPersonAction(modal, { type: "cancel" }).state;
  assert.deepEqual(resumed, {
    mode: "cable_start",
    pointerLock: "unlocked",
    selectedOwnerId: "pole-a",
  });
});

test("catalog selection enters unlocked build mode and still needs a lock-only click", () => {
  const catalog = transitionFirstPersonAction(lockedLook("machine-a"), {
    type: "modal_enter",
    modal: "catalog",
  }).state;
  const building = transitionFirstPersonAction(catalog, {
    type: "tool_switch",
    selection: { tool: "build", buildingId: "assembler", rotation: 1 },
  }).state;
  assert.deepEqual(building, {
    mode: "build",
    pointerLock: "unlocked",
    selectedOwnerId: "machine-a",
    buildingId: "assembler",
    rotation: 1,
  });

  const firstClick = transitionFirstPersonAction(building, {
    type: "primary_click",
    target: { kind: "cell", anchor: cellA },
  });
  assert.equal(firstClick.state.mode, "build");
  assert.equal(firstClick.state.pointerLock, "requesting");
  assert.deepEqual(firstClick.commands, [{ type: "request_pointer_lock" }]);
});

test("modal round trips preserve safe inspect and build context", () => {
  let inspected = transitionFirstPersonAction(lockedLook(), {
    type: "inspect_target",
    ownerId: "assembler-4",
  }).state;
  inspected = transitionFirstPersonAction(inspected, {
    type: "modal_enter",
    modal: "lineage",
  }).state;
  assert.equal(getFirstPersonSelectedOwnerId(inspected), "assembler-4");
  assert.equal(getFirstPersonTool(inspected), "inspect");
  inspected = transitionFirstPersonAction(inspected, { type: "modal_exit" }).state;
  assert.deepEqual(inspected, {
    mode: "inspect",
    pointerLock: "unlocked",
    selectedOwnerId: "assembler-4",
  });

  let building = transitionFirstPersonAction(lockedLook("assembler-4"), {
    type: "tool_switch",
    selection: { tool: "build", buildingId: "storage", rotation: 3 },
  }).state;
  building = transitionFirstPersonAction(building, {
    type: "modal_enter",
    modal: "project",
  }).state;
  building = transitionFirstPersonAction(building, { type: "modal_exit" }).state;
  assert.deepEqual(building, {
    mode: "build",
    pointerLock: "unlocked",
    selectedOwnerId: "assembler-4",
    buildingId: "storage",
    rotation: 3,
  });
});

test("pointer-lock loss sanitizes pending sessions and late acquisition cannot lock a modal", () => {
  const cableEnd: FirstPersonActionState = {
    mode: "cable_end",
    pointerLock: "locked",
    selectedOwnerId: "pole-a",
    start: { ownerId: "pole-a", portId: "P1" },
  };
  const lost = transitionFirstPersonAction(cableEnd, { type: "pointer_lock_lost" }).state;
  assert.deepEqual(lost, {
    mode: "cable_start",
    pointerLock: "unlocked",
    selectedOwnerId: "pole-a",
  });

  const modal = transitionFirstPersonAction(lockedLook(), {
    type: "modal_enter",
    modal: "power",
  }).state;
  const lateAcquisition = transitionFirstPersonAction(modal, { type: "pointer_lock_acquired" });
  assert.equal(lateAcquisition.state, modal);
  assert.deepEqual(lateAcquisition.commands, [{ type: "release_pointer_lock" }]);
});

test("inspect and demolition actions are ignored without pointer lock", () => {
  const unlocked = createInitialFirstPersonActionState();
  assert.equal(transitionFirstPersonAction(unlocked, {
    type: "inspect_target",
    ownerId: "machine-a",
  }).state, unlocked);

  const demolish = transitionFirstPersonAction(unlocked, {
    type: "tool_switch",
    selection: { tool: "demolish" },
  }).state;
  const firstClick = transitionFirstPersonAction(demolish, {
    type: "primary_click",
    target: { kind: "structure", ownerId: "machine-a" },
  });
  assert.deepEqual(firstClick.commands, [{ type: "request_pointer_lock" }]);

  const locked = transitionFirstPersonAction(firstClick.state, { type: "pointer_lock_acquired" }).state;
  assert.deepEqual(transitionFirstPersonAction(locked, {
    type: "primary_click",
    target: { kind: "structure", ownerId: "machine-a" },
  }).commands, [{ type: "demolish", ownerId: "machine-a" }]);
});

test("the reducer adapter returns exactly the transition state", () => {
  const state = lockedLook("machine-a");
  const event = { type: "tool_switch", selection: { tool: "belt", rotation: 3 } } as const;
  assert.deepEqual(
    firstPersonActionReducer(state, event),
    transitionFirstPersonAction(state, event).state,
  );
});
