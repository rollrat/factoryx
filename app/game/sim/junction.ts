export type RouterSnapshot<PortId extends string = string> = Readonly<{
  lastSelectedPortId: PortId | null;
}>;

export type SplitterOutput<PortId extends string, ItemType> = Readonly<{
  portId: PortId;
  connected: boolean;
  blocked: boolean;
  accepts?: (item: ItemType) => boolean;
}>;

export type SplitterDecision<PortId extends string, ItemType> = Readonly<{
  portId: PortId;
  item: ItemType;
}>;

export type MergerInput<PortId extends string, ItemType> = Readonly<{
  portId: PortId;
  connected: boolean;
  item: ItemType | null;
}>;

export type MergerDecision<PortId extends string, ItemType> = Readonly<{
  portId: PortId;
  item: ItemType;
}>;

const assertUniquePorts = <PortId extends string>(candidates: readonly { portId: PortId }[]) => {
  const ids = new Set<PortId>();
  candidates.forEach(({ portId }) => {
    if (ids.has(portId)) throw new Error(`duplicate junction port id: ${portId}`);
    ids.add(portId);
  });
};

const roundRobinOrder = <PortId extends string, Candidate extends { portId: PortId }>(
  candidates: readonly Candidate[],
  lastSelectedPortId: PortId | null,
) => {
  if (candidates.length === 0) return [];
  const lastIndex = lastSelectedPortId === null
    ? -1
    : candidates.findIndex(({ portId }) => portId === lastSelectedPortId);
  const startIndex = lastIndex < 0 ? 0 : (lastIndex + 1) % candidates.length;
  return candidates.map((_, offset) => candidates[(startIndex + offset) % candidates.length]);
};

/** Deterministic one-item splitter policy over caller-defined stable port order. */
export class SplitterRouter<ItemType, PortId extends string = string> {
  private lastSelectedPortId: PortId | null = null;

  constructor(snapshot?: RouterSnapshot<PortId>) {
    if (snapshot) this.restore(snapshot);
  }

  selectOutput(
    item: ItemType,
    outputs: readonly SplitterOutput<PortId, ItemType>[],
  ): SplitterDecision<PortId, ItemType> | null {
    assertUniquePorts(outputs);
    const selected = roundRobinOrder(outputs, this.lastSelectedPortId).find((output) => (
      output.connected && !output.blocked && (output.accepts?.(item) ?? true)
    ));
    if (!selected) return null;
    this.lastSelectedPortId = selected.portId;
    return { portId: selected.portId, item };
  }

  snapshot(): RouterSnapshot<PortId> {
    return { lastSelectedPortId: this.lastSelectedPortId };
  }

  restore(snapshot: RouterSnapshot<PortId>) {
    this.lastSelectedPortId = snapshot.lastSelectedPortId;
  }
}

/** Deterministic fair merger policy; each call approves at most one item. */
export class MergerRouter<ItemType, PortId extends string = string> {
  private lastSelectedPortId: PortId | null = null;

  constructor(snapshot?: RouterSnapshot<PortId>) {
    if (snapshot) this.restore(snapshot);
  }

  selectInput(
    inputs: readonly MergerInput<PortId, ItemType>[],
  ): MergerDecision<PortId, ItemType> | null {
    assertUniquePorts(inputs);
    const selected = roundRobinOrder(inputs, this.lastSelectedPortId).find((input) => (
      input.connected && input.item !== null
    ));
    if (!selected || selected.item === null) return null;
    this.lastSelectedPortId = selected.portId;
    return { portId: selected.portId, item: selected.item };
  }

  snapshot(): RouterSnapshot<PortId> {
    return { lastSelectedPortId: this.lastSelectedPortId };
  }

  restore(snapshot: RouterSnapshot<PortId>) {
    this.lastSelectedPortId = snapshot.lastSelectedPortId;
  }
}

