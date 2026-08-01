import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

async function loadProjectPanel() {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    plugins: [react()],
    server: { middlewareMode: true },
  });
  try {
    return await vite.ssrLoadModule("/app/components/ProjectProgressPanel.tsx");
  } finally {
    await vite.close();
  }
}

const partialPhaseOne = {
  version: 1,
  stages: [{
    stageId: "phase_1_settlement_package",
    delivered: [
      { portId: "phase1_plate_in", itemId: "iron_plate", amount: 60 },
      { portId: "phase1_block_in", itemId: "construction_block", amount: 20 },
      { portId: "phase1_fastener_in", itemId: "fastener_pack", amount: 0 },
    ],
  }],
};

const completedStages = (count) => ({
  version: 1,
  stages: [
    {
      stageId: "phase_1_settlement_package",
      delivered: [
        { portId: "phase1_plate_in", itemId: "iron_plate", amount: 120 },
        { portId: "phase1_block_in", itemId: "construction_block", amount: 80 },
        { portId: "phase1_fastener_in", itemId: "fastener_pack", amount: 40 },
      ],
    },
    ...(count > 1 ? [{
      stageId: "phase_2_industrial_power_node",
      delivered: [
        { portId: "phase1_plate_in", itemId: "steel_billet", amount: 160 },
        { portId: "phase1_block_in", itemId: "copper_wire", amount: 200 },
        { portId: "phase1_fastener_in", itemId: "electromagnetic_coil", amount: 80 },
        { portId: "reserved_solid_in_1", itemId: "industrial_frame", amount: 20 },
      ],
    }] : []),
  ],
});

test("derives all six registered contracts and partial delivery state from a campaign snapshot", async () => {
  const { buildProjectProgressView } = await loadProjectPanel();
  const view = buildProjectProgressView(partialPhaseOne);

  assert.equal(view.stages.length, 6);
  assert.equal(view.currentStageId, "phase_1_settlement_package");
  assert.equal(view.completedCount, 0);
  assert.equal(view.stages[0].deliveries[0].delivered, 60);
  assert.equal(view.stages[0].deliveries[0].remaining, 60);
  assert.equal(view.stages[0].power.mode, "manual");
  assert.equal(view.stages[1].status, "locked");
  assert.ok(view.stages[0].rewards.some((reward) => reward.startsWith("설비 · ")));
});

test("renders an accessible keyboard-oriented contract rail and selected details", async () => {
  const { default: ProjectProgressPanel } = await loadProjectPanel();
  const html = renderToStaticMarkup(React.createElement(ProjectProgressPanel, { snapshot: partialPhaseOne }));

  assert.match(html, /프로젝트 진행 상황/);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 6);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /철판/);
  assert.match(html, /60개/);
  assert.match(html, /수동 잠금 · 전력 불필요/);
  assert.match(html, /완료 보상/);
  assert.match(html, /다음 해금 · 산업 생산 체계/);
});

test("reports powered-stage readiness against the 32 MW requirement", async () => {
  const panelModule = await loadProjectPanel();
  const snapshot = completedStages(2);
  const view = panelModule.buildProjectProgressView(snapshot, 20);
  assert.equal(view.currentStageId, "phase_3_automation_core");
  assert.equal(view.stages[2].power.requiredMW, 32);
  assert.equal(view.stages[2].power.satisfied, false);

  const underpowered = renderToStaticMarkup(React.createElement(panelModule.default, {
    snapshot,
    suppliedPowerMW: 20,
    initialStageId: "phase_3_automation_core",
  }));
  assert.match(underpowered, /32 MW 필요/);
  assert.match(underpowered, /20 MW 공급 · 전력 부족/);

  const ready = panelModule.buildProjectProgressView(snapshot, 32);
  assert.equal(ready.stages[2].power.satisfied, true);
});

test("keeps campaign snapshot validation strict", async () => {
  const { buildProjectProgressView } = await loadProjectPanel();
  assert.throws(() => buildProjectProgressView({
    version: 1,
    stages: [{ stageId: "unknown_contract", delivered: [] }],
  }), /unknown campaign stage snapshot/);
});
