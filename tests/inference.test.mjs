import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { predict, engineer, transform, validateInput } from "../site/inference.mjs";

const model = JSON.parse(await readFile(new URL("../site/model.json", import.meta.url)));
const fixtures = JSON.parse(await readFile(new URL("./synthetic-fixtures.json", import.meta.url)));
const defaults = Object.fromEntries(model.schema.map(field => [field.key, field.default]));

test("browser predictions and AD distances match Python on all synthetic cases", () => {
  let maxPredictionError = 0;
  let maxDistanceError = 0;
  for (const example of fixtures) {
    const vector = transform(engineer(example.input, model), example.input, model);
    vector.forEach((value, i) => assert.ok(Math.abs(value - example.processed[i]) < 1e-10, `Processed column ${i} differs from Python`));
    const actual = predict(example.input, model);
    maxPredictionError = Math.max(maxPredictionError, Math.abs(actual.prediction - example.prediction));
    maxDistanceError = Math.max(maxDistanceError, Math.abs(actual.distance - example.distance));
    assert.ok(Math.abs(actual.prediction - example.prediction) < 1e-8);
    assert.ok(Math.abs(actual.distance - example.distance) < 1e-8);
  }
  console.log(JSON.stringify({ syntheticCases: fixtures.length, maxPredictionError, maxDistanceError }));
});
test("publication model, not a legacy ensemble", () => {
  assert.equal(model.name, "Bayesian-optimized CatBoost");
  assert.equal(model.trees.length, 417);
  assert.equal(model.samples, 98);
  assert.ok(Math.abs(model.metrics.r2 - 0.9123579456040808) < 1e-9);
});
test("11 raw inputs create 20 descriptors and 23 processed columns", () => {
  const row = engineer(defaults, model);
  assert.equal(model.schema.length, 11);
  assert.equal(Object.keys(row).length, 20);
  assert.equal(transform(row, defaults, model).length, 23);
});
test("changing dose recalculates products, ratio and log", () => {
  const input = { ...defaults, dosage: 4 };
  const row = engineer(input, model);
  assert.equal(row.dosage_x_time, 480);
  assert.equal(row.initial_concentration_per_dose, 12.5);
  assert.equal(row.log_adsorbent_dosage, Math.log1p(4));
});
test("reject missing, non-finite, negative, zero-dose and invalid categories", () => {
  for (const field of model.schema) {
    const input = { ...defaults };
    delete input[field.key];
    assert.throws(() => predict(input, model));
  }
  for (const dosage of [0, -1, NaN, Infinity, "2", null]) {
    assert.throws(() => predict({ ...defaults, dosage }, model));
  }
  assert.throws(() => predict({ ...defaults, ph: 15 }, model));
  assert.throws(() => predict({ ...defaults, gas: "1" }, model));
  assert.throws(() => predict({ ...defaults, adsorptionModel: "2" }, model));
  assert.throws(() => predict({ ...defaults, temperature: Number.MAX_VALUE }, model));
});
test("out-of-range inputs warn but are not silently rejected or clamped", () => {
  const input = { ...defaults, temperature: 2000 };
  const result = predict(input, model);
  assert.ok(result.warnings.some(w => w.includes("observed range")));
  assert.equal(engineer(input, model)[model.schema[0].column], 2000);
});
test("all named categorical options are accepted", () => {
  for (const field of model.schema.filter(f => f.type === "category")) {
    for (const value of field.options) {
      assert.equal(validateInput({ ...defaults, [field.key]: value }, model).errors.length, 0);
    }
  }
});
test("the unbounded model result is never clipped to 0-100", () => {
  const synthetic = { ...model, trees: [], bias: 105, scale: 1 };
  const result = predict(defaults, synthetic);
  assert.equal(result.prediction, 105);
  assert.ok(result.warnings.some(w => w.includes("outside 0-100")));
});
test("adverse input combinations trigger independent domain screening", () => {
  const result = predict({ ...defaults, temperature: 3000, time: 50000, dosage: 1000 }, model);
  assert.equal(result.withinDomain, false);
  assert.ok(result.warnings.some(w => w.includes("applicability-domain cutoff")));
});
test("fixtures contain synthetic requests, not experimental targets", () => {
  assert.ok(fixtures.length >= 250);
  assert.ok(fixtures.every(row => !Object.hasOwn(row, "actual") && !Object.hasOwn(row, "target")));
});
