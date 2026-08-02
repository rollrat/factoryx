export type FirstPersonActionMode =
  | "look"
  | "inspect"
  | "modal"
  | "build"
  | "belt_start"
  | "belt_route"
  | "cable_start"
  | "cable_end"
  | "demolish";

export type FirstPersonPointerLock = "unlocked" | "requesting" | "locked";

export type FirstPersonTool = "inspect" | "build" | "belt" | "cable" | "demolish";

export type FirstPersonModalKind = "catalog" | "lineage" | "project" | "power" | "exploration";

export type FirstPersonQuarterTurn = 0 | 1 | 2 | 3;

export type FirstPersonGridAnchor = Readonly<{
  x: number;
  z: number;
  stratumId: string;
}>;

export type FirstPersonCableEndpoint = Readonly<{
  ownerId: string;
  portId?: string;
}>;

type FirstPersonSelection = Readonly<{ selectedOwnerId: string | null }>;

/**
 * An action that is safe to restore after UI has released pointer lock.
 *
 * In-progress belt and cable sessions are deliberately absent. Opening a
 * modal, losing pointer lock, or changing camera mode can therefore retain a
 * tool without retaining a stale first endpoint.
 */
export type FirstPersonResumableAction =
  | (FirstPersonSelection & Readonly<{ mode: "look" }>)
  | Readonly<{ mode: "inspect"; selectedOwnerId: string }>
  | (FirstPersonSelection & Readonly<{
    mode: "build";
    buildingId: string;
    rotation: FirstPersonQuarterTurn;
  }>)
  | (FirstPersonSelection & Readonly<{
    mode: "belt_start";
    rotation: FirstPersonQuarterTurn;
  }>)
  | (FirstPersonSelection & Readonly<{ mode: "cable_start" }>)
  | (FirstPersonSelection & Readonly<{ mode: "demolish" }>);

export type FirstPersonActiveAction =
  | FirstPersonResumableAction
  | (FirstPersonSelection & Readonly<{
    mode: "belt_route";
    start: FirstPersonGridAnchor;
    rotation: FirstPersonQuarterTurn;
  }>)
  | (FirstPersonSelection & Readonly<{
    mode: "cable_end";
    start: FirstPersonCableEndpoint;
  }>);

type WithPointerLock<Action> = Action extends unknown
  ? Action & Readonly<{ pointerLock: FirstPersonPointerLock }>
  : never;

export type FirstPersonActiveState = WithPointerLock<FirstPersonActiveAction>;

export type FirstPersonModalState = Readonly<{
  mode: "modal";
  pointerLock: "unlocked";
  modal: FirstPersonModalKind;
  returnTo: FirstPersonResumableAction;
}>;

export type FirstPersonActionState = FirstPersonActiveState | FirstPersonModalState;

export type FirstPersonActionTarget =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "cell"; anchor: FirstPersonGridAnchor }>
  | Readonly<{ kind: "structure"; ownerId: string }>
  | Readonly<{ kind: "power_port"; endpoint: FirstPersonCableEndpoint }>;

export type FirstPersonToolSelection =
  | Readonly<{ tool: "inspect" }>
  | Readonly<{
    tool: "build";
    buildingId: string;
    rotation?: FirstPersonQuarterTurn;
  }>
  | Readonly<{
    tool: "belt";
    rotation?: FirstPersonQuarterTurn;
  }>
  | Readonly<{ tool: "cable" }>
  | Readonly<{ tool: "demolish" }>;

export type FirstPersonActionEvent =
  | Readonly<{ type: "primary_click"; target: FirstPersonActionTarget }>
  | Readonly<{ type: "pointer_lock_acquired" }>
  | Readonly<{ type: "pointer_lock_failed" }>
  | Readonly<{ type: "pointer_lock_lost" }>
  | Readonly<{ type: "inspect_target"; ownerId: string }>
  | Readonly<{ type: "tool_switch"; selection: FirstPersonToolSelection }>
  | Readonly<{ type: "rotate"; direction?: 1 | -1 }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "modal_enter"; modal: FirstPersonModalKind }>
  | Readonly<{ type: "modal_exit" }>;

export type FirstPersonActionCommand =
  | Readonly<{ type: "request_pointer_lock" }>
  | Readonly<{ type: "release_pointer_lock" }>
  | Readonly<{
    type: "confirm_build";
    buildingId: string;
    anchor: FirstPersonGridAnchor;
    rotation: FirstPersonQuarterTurn;
  }>
  | Readonly<{
    type: "commit_belt";
    start: FirstPersonGridAnchor;
    end: FirstPersonGridAnchor;
    startRotation: FirstPersonQuarterTurn;
  }>
  | Readonly<{
    type: "connect_cable";
    start: FirstPersonCableEndpoint;
    end: FirstPersonCableEndpoint;
  }>
  | Readonly<{ type: "demolish"; ownerId: string }>;

export type FirstPersonActionTransition = Readonly<{
  state: FirstPersonActionState;
  commands: readonly FirstPersonActionCommand[];
}>;

const NO_COMMANDS: readonly FirstPersonActionCommand[] = Object.freeze([]);

const unchanged = (state: FirstPersonActionState): FirstPersonActionTransition => ({
  state,
  commands: NO_COMMANDS,
});

const transitioned = (
  state: FirstPersonActionState,
  ...commands: readonly FirstPersonActionCommand[]
): FirstPersonActionTransition => ({ state, commands });

const activeState = (
  action: FirstPersonActiveAction,
  pointerLock: FirstPersonPointerLock,
): FirstPersonActiveState => ({ ...action, pointerLock }) as FirstPersonActiveState;

const copyGridAnchor = (anchor: FirstPersonGridAnchor): FirstPersonGridAnchor => ({
  x: anchor.x,
  z: anchor.z,
  stratumId: anchor.stratumId,
});

const copyCableEndpoint = (endpoint: FirstPersonCableEndpoint): FirstPersonCableEndpoint => ({
  ownerId: endpoint.ownerId,
  ...(endpoint.portId === undefined ? {} : { portId: endpoint.portId }),
});

const rotateQuarterTurn = (
  rotation: FirstPersonQuarterTurn,
  direction: 1 | -1,
): FirstPersonQuarterTurn => ((rotation + direction + 4) % 4) as FirstPersonQuarterTurn;

const toResumableAction = (state: FirstPersonActiveState): FirstPersonResumableAction => {
  switch (state.mode) {
    case "look":
      return { mode: "look", selectedOwnerId: state.selectedOwnerId };
    case "inspect":
      return { mode: "inspect", selectedOwnerId: state.selectedOwnerId };
    case "build":
      return {
        mode: "build",
        selectedOwnerId: state.selectedOwnerId,
        buildingId: state.buildingId,
        rotation: state.rotation,
      };
    case "belt_start":
      return {
        mode: "belt_start",
        selectedOwnerId: state.selectedOwnerId,
        rotation: state.rotation,
      };
    case "belt_route":
      return {
        mode: "belt_start",
        selectedOwnerId: state.selectedOwnerId,
        rotation: state.rotation,
      };
    case "cable_start":
    case "cable_end":
      return { mode: "cable_start", selectedOwnerId: state.selectedOwnerId };
    case "demolish":
      return { mode: "demolish", selectedOwnerId: state.selectedOwnerId };
  }
};

const clearUnsafeSession = (
  state: FirstPersonActiveState,
  pointerLock: FirstPersonPointerLock,
): FirstPersonActiveState => activeState(toResumableAction(state), pointerLock);

const selectionOf = (state: FirstPersonActionState): string | null => (
  state.mode === "modal" ? state.returnTo.selectedOwnerId : state.selectedOwnerId
);

const lockOf = (state: FirstPersonActionState): FirstPersonPointerLock => (
  state.mode === "modal" ? "unlocked" : state.pointerLock
);

const switchTool = (
  state: FirstPersonActionState,
  selection: FirstPersonToolSelection,
): FirstPersonActiveState => {
  const selectedOwnerId = selectionOf(state);
  const pointerLock = lockOf(state);

  switch (selection.tool) {
    case "inspect":
      return selectedOwnerId === null
        ? activeState({ mode: "look", selectedOwnerId }, pointerLock)
        : activeState({ mode: "inspect", selectedOwnerId }, pointerLock);
    case "build":
      return activeState({
        mode: "build",
        selectedOwnerId,
        buildingId: selection.buildingId,
        rotation: selection.rotation ?? 0,
      }, pointerLock);
    case "belt":
      return activeState({
        mode: "belt_start",
        selectedOwnerId,
        rotation: selection.rotation ?? 0,
      }, pointerLock);
    case "cable":
      return activeState({ mode: "cable_start", selectedOwnerId }, pointerLock);
    case "demolish":
      return activeState({ mode: "demolish", selectedOwnerId }, pointerLock);
  }
};

const cancelActiveAction = (state: FirstPersonActiveState): FirstPersonActiveState => {
  const pointerLock = state.pointerLock === "requesting" ? "unlocked" : state.pointerLock;

  switch (state.mode) {
    case "look":
      return activeState({ mode: "look", selectedOwnerId: state.selectedOwnerId }, pointerLock);
    case "inspect":
      return activeState({ mode: "look", selectedOwnerId: null }, pointerLock);
    case "build":
    case "belt_start":
    case "cable_start":
    case "demolish":
      return activeState({ mode: "look", selectedOwnerId: state.selectedOwnerId }, pointerLock);
    case "belt_route":
      return activeState({
        mode: "belt_start",
        selectedOwnerId: state.selectedOwnerId,
        rotation: state.rotation,
      }, pointerLock);
    case "cable_end":
      return activeState({ mode: "cable_start", selectedOwnerId: state.selectedOwnerId }, pointerLock);
  }
};

const rotateActiveAction = (
  state: FirstPersonActiveState,
  direction: 1 | -1,
): FirstPersonActiveState => {
  switch (state.mode) {
    case "build":
      return activeState({
        mode: "build",
        selectedOwnerId: state.selectedOwnerId,
        buildingId: state.buildingId,
        rotation: rotateQuarterTurn(state.rotation, direction),
      }, state.pointerLock);
    case "belt_start":
      return activeState({
        mode: "belt_start",
        selectedOwnerId: state.selectedOwnerId,
        rotation: rotateQuarterTurn(state.rotation, direction),
      }, state.pointerLock);
    case "belt_route":
      return activeState({
        mode: "belt_route",
        selectedOwnerId: state.selectedOwnerId,
        start: state.start,
        rotation: rotateQuarterTurn(state.rotation, direction),
      }, state.pointerLock);
    default:
      return state;
  }
};

const handleLockedPrimaryClick = (
  state: FirstPersonActiveState,
  target: FirstPersonActionTarget,
): FirstPersonActionTransition => {
  switch (state.mode) {
    case "build":
      return target.kind === "cell"
        ? transitioned(state, {
          type: "confirm_build",
          buildingId: state.buildingId,
          anchor: copyGridAnchor(target.anchor),
          rotation: state.rotation,
        })
        : unchanged(state);
    case "belt_start":
      return target.kind === "cell"
        ? transitioned(activeState({
          mode: "belt_route",
          selectedOwnerId: state.selectedOwnerId,
          start: copyGridAnchor(target.anchor),
          rotation: state.rotation,
        }, "locked"))
        : unchanged(state);
    case "belt_route":
      return target.kind === "cell"
        ? transitioned(activeState({
          mode: "belt_start",
          selectedOwnerId: state.selectedOwnerId,
          rotation: state.rotation,
        }, "locked"), {
          type: "commit_belt",
          start: copyGridAnchor(state.start),
          end: copyGridAnchor(target.anchor),
          startRotation: state.rotation,
        })
        : unchanged(state);
    case "cable_start":
      return target.kind === "power_port"
        ? transitioned(activeState({
          mode: "cable_end",
          selectedOwnerId: state.selectedOwnerId,
          start: copyCableEndpoint(target.endpoint),
        }, "locked"))
        : unchanged(state);
    case "cable_end":
      return target.kind === "power_port"
        ? transitioned(activeState({
          mode: "cable_start",
          selectedOwnerId: state.selectedOwnerId,
        }, "locked"), {
          type: "connect_cable",
          start: copyCableEndpoint(state.start),
          end: copyCableEndpoint(target.endpoint),
        })
        : unchanged(state);
    case "demolish":
      return target.kind === "structure"
        ? transitioned(state, { type: "demolish", ownerId: target.ownerId })
        : unchanged(state);
    case "look":
    case "inspect":
      return unchanged(state);
  }
};

export const createInitialFirstPersonActionState = (): FirstPersonActionState => ({
  mode: "look",
  pointerLock: "unlocked",
  selectedOwnerId: null,
});

export const getFirstPersonSelectedOwnerId = (state: FirstPersonActionState): string | null => (
  selectionOf(state)
);

export const getFirstPersonTool = (state: FirstPersonActionState): FirstPersonTool => {
  const mode = state.mode === "modal" ? state.returnTo.mode : state.mode;
  switch (mode) {
    case "look":
    case "inspect":
      return "inspect";
    case "build":
      return "build";
    case "belt_start":
    case "belt_route":
      return "belt";
    case "cable_start":
    case "cable_end":
      return "cable";
    case "demolish":
      return "demolish";
  }
};

/**
 * Pure transition API. Commands describe the browser/world effects that the
 * runtime may execute after accepting the returned state.
 */
export const transitionFirstPersonAction = (
  state: FirstPersonActionState,
  event: FirstPersonActionEvent,
): FirstPersonActionTransition => {
  switch (event.type) {
    case "primary_click": {
      if (state.mode === "modal") return unchanged(state);
      if (state.pointerLock === "unlocked") {
        return transitioned(activeState(toResumableAction(state), "requesting"), {
          type: "request_pointer_lock",
        });
      }
      if (state.pointerLock === "requesting") return unchanged(state);
      return handleLockedPrimaryClick(state, event.target);
    }
    case "pointer_lock_acquired":
      if (state.mode === "modal") {
        return transitioned(state, { type: "release_pointer_lock" });
      }
      return transitioned(activeState(state, "locked"));
    case "pointer_lock_failed":
    case "pointer_lock_lost":
      return state.mode === "modal"
        ? unchanged(state)
        : transitioned(clearUnsafeSession(state, "unlocked"));
    case "inspect_target":
      if (state.mode === "modal" || state.pointerLock !== "locked") return unchanged(state);
      return transitioned(activeState({
        mode: "inspect",
        selectedOwnerId: event.ownerId,
      }, "locked"));
    case "tool_switch":
      return transitioned(switchTool(state, event.selection));
    case "rotate":
      return state.mode === "modal"
        ? unchanged(state)
        : transitioned(rotateActiveAction(state, event.direction ?? 1));
    case "cancel":
      if (state.mode === "modal") {
        return transitioned(activeState(state.returnTo, "unlocked"));
      }
      return state.pointerLock === "requesting"
        ? transitioned(cancelActiveAction(state), { type: "release_pointer_lock" })
        : transitioned(cancelActiveAction(state));
    case "modal_enter":
      if (state.mode === "modal") {
        return state.modal === event.modal
          ? unchanged(state)
          : transitioned({ ...state, modal: event.modal });
      }
      return transitioned({
        mode: "modal",
        pointerLock: "unlocked",
        modal: event.modal,
        returnTo: toResumableAction(state),
      }, ...(state.pointerLock === "unlocked" ? [] : [{ type: "release_pointer_lock" } as const]));
    case "modal_exit":
      return state.mode === "modal"
        ? transitioned(activeState(state.returnTo, "unlocked"))
        : unchanged(state);
  }
};

/** Standard reducer adapter for stores that execute effects elsewhere. */
export const firstPersonActionReducer = (
  state: FirstPersonActionState,
  event: FirstPersonActionEvent,
): FirstPersonActionState => transitionFirstPersonAction(state, event).state;
