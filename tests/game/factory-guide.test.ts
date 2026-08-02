import assert from "node:assert/strict";
import test from "node:test";
import { deriveFactoryGuide, type FactoryGuideFacts } from "../../app/game/presentation/factoryGuide.ts";

const facts = (completed: readonly (keyof FactoryGuideFacts)[] = []): FactoryGuideFacts => ({
  inspectedPowerCore: completed.includes("inspectedPowerCore"),
  hasDistributionPole: completed.includes("hasDistributionPole"),
  hasCoreCable: completed.includes("hasCoreCable"),
  hasExtractor: completed.includes("hasExtractor"),
  hasProcessor: completed.includes("hasProcessor"),
  hasProductionConnection: completed.includes("hasProductionConnection"),
  hasFirstProduct: completed.includes("hasFirstProduct"),
});

test("factory guide starts by teaching the preplaced power core", () => {
  const guide = deriveFactoryGuide(facts());
  assert.equal(guide.id, "inspect_power_core");
  assert.equal(guide.step, 1);
  assert.equal(guide.total, 7);
  assert.match(guide.instruction, /전력 코어/);
});

test("factory guide advances from physical power into extraction and logistics", () => {
  assert.equal(deriveFactoryGuide(facts(["inspectedPowerCore"])).id, "build_distribution");
  assert.equal(deriveFactoryGuide(facts(["inspectedPowerCore", "hasDistributionPole"])).id, "connect_power");
  assert.equal(deriveFactoryGuide(facts([
    "inspectedPowerCore",
    "hasDistributionPole",
    "hasCoreCable",
    "hasExtractor",
    "hasProcessor",
  ])).id, "connect_logistics");
});

test("factory guide completes only after a real first product exists", () => {
  const complete = deriveFactoryGuide(facts([
    "inspectedPowerCore",
    "hasDistributionPole",
    "hasCoreCable",
    "hasExtractor",
    "hasProcessor",
    "hasProductionConnection",
    "hasFirstProduct",
  ]));
  assert.equal(complete.id, "complete");
  assert.equal(complete.completed, true);
  assert.equal(complete.step, complete.total);
});
