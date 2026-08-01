import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

async function loadLineage() {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    plugins: [react()],
    server: { middlewareMode: true },
  });
  try {
    return await vite.ssrLoadModule("/app/components/ProductionLineageOverlay.tsx");
  } finally {
    await vite.close();
  }
}

const graph = {
  title: "테스트 공장",
  nodes: [
    { id: "core", label: "현장 전력 코어", kind: "building", column: 0 },
    { id: "miner", label: "광맥 채굴기", kind: "building", column: 1, instanceLabel: "설비 #1" },
    { id: "ore", label: "철광석", kind: "resource", column: 2 },
    { id: "isolated", label: "실제 고립 저장고", kind: "storage", column: 3 },
  ],
  edges: [
    { id: "power-core-miner", from: "core", to: "miner", itemName: "24 MW 전력", medium: "power", connected: true },
    { id: "solid-miner-ore", from: "miner", to: "ore", itemName: "철광석", medium: "solid", connected: true, beltCount: 3 },
  ],
};

const live = {
  nodeStates: {
    core: { status: "working" },
    miner: { status: "working", actualRatePerMinute: 30, progress: 0.5 },
    ore: { status: "storing", stock: 12, capacity: 100 },
    isolated: { status: "disconnected", stock: 4, capacity: 400 },
  },
  updatedAt: 1_000,
};

test("renders the three-mode shell, filters, and keyboard-selectable actual nodes", async () => {
  const lineageModule = await loadLineage();
  const html = renderToStaticMarkup(React.createElement(lineageModule.default, {
    open: true,
    onClose() {},
    graph,
    live,
  }));
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-label="생산 계보 보기 모드"/);
  assert.match(html, />계보</);
  assert.match(html, />공장 현황</);
  assert.match(html, />전력망</);
  assert.match(html, /노드명 또는 ID 검색/);
  assert.match(html, />전체 상태</);
  assert.match(html, />전체 단계</);
  assert.match(html, /role="button"[^>]*tabindex="0"/);
  assert.match(html, /노드를 선택하세요/);
});

test("mode derivation uses only supplied edge endpoints and never creates facilities", async () => {
  const { graphForLineageMode } = await loadLineage();
  const lineage = graphForLineageMode(graph, "lineage");
  assert.deepEqual(lineage.edges.map(({ id }) => id), ["solid-miner-ore"]);
  assert.deepEqual(lineage.nodes.map(({ id }) => id), ["miner", "ore"]);

  const power = graphForLineageMode(graph, "power");
  assert.deepEqual(power.edges.map(({ id }) => id), ["power-core-miner"]);
  assert.deepEqual(power.nodes.map(({ id }) => id), ["core", "miner"]);
  assert.equal(power.nodes.some(({ id }) => id === "isolated"), false);
});

test("power mode renders only actual power nodes and labels power links correctly", async () => {
  const lineageModule = await loadLineage();
  const html = renderToStaticMarkup(React.createElement(lineageModule.default, {
    open: true,
    initialMode: "power",
    onClose() {},
    graph,
    live,
  }));
  assert.match(html, /전력망 · 테스트 공장/);
  assert.match(html, /현장 전력 코어/);
  assert.match(html, /광맥 채굴기/);
  assert.match(html, /전력 연결/);
  assert.doesNotMatch(html, /실제 고립 저장고|철광석<\/h3>/);
});
