import assert from "node:assert/strict";
import test from "node:test";

import {
  MergerRouter,
  SplitterRouter,
  type MergerInput,
  type SplitterOutput,
} from "../../app/game/sim/junction.ts";

type Item = "iron" | "copper";
type OutputId = "left" | "center" | "right";
type InputId = "a" | "b" | "c";

const output = (
  portId: OutputId,
  overrides: Partial<SplitterOutput<OutputId, Item>> = {},
): SplitterOutput<OutputId, Item> => ({ portId, connected: true, blocked: false, ...overrides });

const input = (
  portId: InputId,
  item: Item | null,
  connected = true,
): MergerInput<InputId, Item> => ({ portId, connected, item });

test("splitter distributes successful transfers in stable round-robin order", () => {
  const router = new SplitterRouter<Item, OutputId>();
  const outputs = [output("left"), output("center"), output("right")];
  const selected = Array.from({ length: 7 }, () => router.selectOutput("iron", outputs)?.portId);
  assert.deepEqual(selected, ["left", "center", "right", "left", "center", "right", "left"]);
});

test("splitter skips blocked and disconnected outputs without losing order", () => {
  const router = new SplitterRouter<Item, OutputId>();
  assert.equal(router.selectOutput("iron", [output("left"), output("center"), output("right")])?.portId, "left");
  const constrained = [
    output("left", { connected: false }),
    output("center", { blocked: true }),
    output("right"),
  ];
  assert.equal(router.selectOutput("iron", constrained)?.portId, "right");
  assert.equal(router.selectOutput("iron", constrained)?.portId, "right");
});

test("splitter resumes the original port order after reconnection", () => {
  const router = new SplitterRouter<Item, OutputId>();
  assert.equal(router.selectOutput("iron", [output("left"), output("center"), output("right")])?.portId, "left");
  assert.equal(router.selectOutput("iron", [output("left"), output("center", { connected: false }), output("right")])?.portId, "right");
  assert.equal(router.selectOutput("iron", [output("left"), output("center"), output("right")])?.portId, "left");
  assert.equal(router.selectOutput("iron", [output("left"), output("center"), output("right")])?.portId, "center");
});

test("splitter keeps its cursor when no output accepts the generic item", () => {
  const router = new SplitterRouter<Item, OutputId>();
  const copperOnly = (item: Item) => item === "copper";
  assert.equal(router.selectOutput("iron", [output("left", { accepts: copperOnly })]), null);
  assert.deepEqual(router.snapshot(), { lastSelectedPortId: null });
  assert.equal(router.selectOutput("copper", [output("left", { accepts: copperOnly })])?.item, "copper");
});

test("merger fairly alternates ready inputs and approves one item per call", () => {
  const router = new MergerRouter<Item, InputId>();
  const inputs = [input("a", "iron"), input("b", "copper"), input("c", "iron")];
  const decisions = Array.from({ length: 6 }, () => router.selectInput(inputs));
  assert.deepEqual(decisions.map((decision) => decision?.portId), ["a", "b", "c", "a", "b", "c"]);
  assert.ok(decisions.every((decision) => decision && typeof decision.item === "string"));
});

test("merger skips empty inputs and immediately uses the only ready side", () => {
  const router = new MergerRouter<Item, InputId>();
  const onlyB = [input("a", null), input("b", "copper"), input("c", null, false)];
  assert.equal(router.selectInput(onlyB)?.portId, "b");
  assert.equal(router.selectInput(onlyB)?.portId, "b");
});

test("splitter and merger snapshots preserve their cursors", () => {
  const splitter = new SplitterRouter<Item, OutputId>();
  const outputs = [output("left"), output("center"), output("right")];
  splitter.selectOutput("iron", outputs);
  splitter.selectOutput("iron", outputs);
  const restoredSplitter = new SplitterRouter<Item, OutputId>(structuredClone(splitter.snapshot()));
  assert.equal(restoredSplitter.selectOutput("iron", outputs)?.portId, "right");

  const merger = new MergerRouter<Item, InputId>();
  const inputs = [input("a", "iron"), input("b", "copper"), input("c", "iron")];
  merger.selectInput(inputs);
  const restoredMerger = new MergerRouter<Item, InputId>();
  restoredMerger.restore(structuredClone(merger.snapshot()));
  assert.equal(restoredMerger.selectInput(inputs)?.portId, "b");
});

