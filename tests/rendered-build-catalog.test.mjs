import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

async function loadCatalog() {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    plugins: [react()],
    server: { middlewareMode: true },
  });
  try {
    return await vite.ssrLoadModule("/app/components/BuildCatalog.tsx");
  } finally {
    await vite.close();
  }
}

test("renders the full buildable registry as an accessible categorized catalog", async () => {
  const catalogModule = await loadCatalog();
  const BuildCatalog = catalogModule.default;
  const entries = catalogModule.getBuildCatalogEntries(["start"]);
  assert.ok(entries.length > 20);
  assert.ok(entries.every(({ building }) => building.placementMode === "buildable"));
  assert.ok(!entries.some(({ building }) => building.id === "project_dock" || building.id === "field_power_core"));

  const html = renderToStaticMarkup(React.createElement(BuildCatalog, {
    unlockedIds: ["start"],
    selectedBuildingId: "vein_miner",
    onSelect() {},
  }));
  assert.match(html, /건설 카탈로그/);
  assert.match(html, /type="search"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-label="건설 설비 카테고리"/);
  assert.match(html, />생산</);
  assert.match(html, />물류</);
  assert.match(html, />유체</);
  assert.match(html, />전력</);
  assert.match(html, /광맥 채굴기, 건설 가능/);
  assert.match(html, /합금로, 1단계 완료 필요/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /철판/);
  assert.doesNotMatch(html, /개척 프로젝트 도크|현장 전력 코어/);
});

test("catalog derivation supports category, unlock, and Korean cost search", async () => {
  const { getBuildCatalogEntries } = await loadCatalog();
  const power = getBuildCatalogEntries(["start", "phase_1_complete"], "power");
  assert.ok(power.some(({ building }) => building.id === "solid_fuel_generator"));
  assert.ok(power.every(({ category }) => category === "power"));
  assert.equal(power.find(({ building }) => building.id === "solid_fuel_generator")?.unlocked, true);
  assert.equal(power.find(({ building }) => building.id === "industrial_accumulator")?.unlocked, false);

  const costMatches = getBuildCatalogEntries(["start"], "production", "건축 블록");
  assert.ok(costMatches.length > 0);
  assert.ok(costMatches.every(({ searchableText }) => searchableText.includes("건축 블록")));
});

test("dialog exposes modal close controls and current credits without changing the catalog contract", async () => {
  const catalogModule = await loadCatalog();
  const html = renderToStaticMarkup(React.createElement(catalogModule.BuildCatalogDialog, {
    open: true,
    credits: 1_200,
    unlockedIds: ["start"],
    inventoryByItemId: { iron_plate: 20, iron_rod: 20, fastener_pack: 20 },
    onSelect() {},
    onClose() {},
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="건설 카탈로그 닫기"/);
  assert.match(html, /CR 1,200/);
  assert.match(html, /보유 20/);
});
