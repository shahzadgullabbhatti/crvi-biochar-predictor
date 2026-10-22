import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const model = JSON.parse(await readFile(new URL("../site/model.json", import.meta.url), "utf8"));
const dom = new JSDOM(html, { url: "http://localhost/repository/" });
globalThis.document = dom.window.document;
const $ = id => document.getElementById(id);
globalThis.fetch = async () => ({ ok: true, json: async () => model });
await import("../site/app.mjs");
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();
const submit = () => $("prediction-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
const edit = (id, value) => {
  $(id).value = value;
  $(id).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

test("form and result interactions in a DOM test environment", async t => {
  await t.test("loads the model and creates 11 labelled required controls", () => {
    assert.equal($("predict").disabled, false);
    assert.equal(document.querySelectorAll("input,select").length, 11);
    for (const field of model.schema) {
      assert.ok(document.querySelector(`label[for="${field.key}"]`));
      assert.equal($(field.key).required, true);
    }
    assert.ok($("load-status").hidden);
  });
  await t.test("no invented prediction appears before submission", () => {
    assert.equal($("prediction-value").textContent, "—");
    assert.equal($("download").disabled, true);
  });
  await t.test("named categorical selectors and Unicode units", () => {
    assert.equal($("gas").tagName, "SELECT");
    assert.equal($("adsorptionModel").tagName, "SELECT");
    assert.equal($("gas").value, "Nitrogen");
    assert.ok(document.body.textContent.includes("m² g⁻¹"));
  });
  await t.test("valid default predicts the actual CatBoost value", () => {
    submit();
    assert.equal($("prediction-value").textContent, "90.44");
    assert.equal($("form-errors").hidden, true);
    assert.equal($("download").disabled, false);
    assert.ok($("domain-details").textContent.includes("7.45"));
  });
  await t.test("editing invalidates both prediction and download", () => {
    edit("dosage", "3");
    assert.equal($("prediction-value").textContent, "—");
    assert.equal($("download").disabled, true);
    assert.equal($("domain-status").textContent, "Not evaluated");
    assert.equal($("domain-marker").hidden, true);
  });
  await t.test("empty values show an error and focus their field", () => {
    edit("dosage", "");
    submit();
    assert.equal($("form-errors").hidden, false);
    assert.equal(document.activeElement.id, "dosage");
    assert.equal($("dosage").getAttribute("aria-invalid"), "true");
    assert.equal($("prediction-value").textContent, "—");
  });
  await t.test("zero dose is rejected", () => {
    edit("dosage", "0");
    submit();
    assert.equal($("form-errors").hidden, false);
    assert.ok($("form-errors").textContent.includes("Adsorbent dosage"));
  });
  await t.test("reset restores every default and clears errors", () => {
    $("reset").click();
    for (const field of model.schema) assert.equal($(field.key).value, String(field.default));
    assert.equal($("form-errors").hidden, true);
  });
  await t.test("large out-of-range values generate visible warnings", () => {
    edit("temperature", "3000");
    submit();
    assert.equal($("prediction-warnings").hidden, false);
    assert.ok($("prediction-warnings").textContent.includes("observed range"));
    assert.equal($("domain-status").textContent, "Outside heuristic cutoff");
  });
  await t.test("download includes actual prediction, inputs and limitations", async () => {
    let blob;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = value => { blob = value; return "blob:fixture"; };
    URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () {};
    $("download").click();
    const result = JSON.parse(await blob.text());
    assert.equal(result.model, model.name);
    assert.equal(result.inputs["Biochar temperature"].value, 3000);
    assert.equal(result.applicabilityDomain.withinCutoff, false);
    assert.ok(result.limitations.length >= 4);
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  });
  await t.test("metrics are R2 and error in percentage points, not percent R2", () => {
    assert.ok($("metric-description").textContent.includes("R² = 0.912"));
    assert.ok($("metric-description").textContent.includes("percentage points"));
    assert.ok(document.body.textContent.includes("units remain unverified"));
  });
  await t.test("a model-load failure disables prediction, with a working retry", async () => {
    const error = console.error;
    console.error = () => {};
    globalThis.fetch = async () => { throw new Error("offline"); };
    await import("../site/app.mjs?load-failure-test");
    await settle();
    assert.equal($("predict").disabled, true);
    assert.equal($("retry").hidden, false);
    globalThis.fetch = async () => ({ ok: true, json: async () => model });
    $("retry").click();
    await settle();
    assert.equal($("predict").disabled, false);
    assert.equal($("retry").hidden, true);
    console.error = error;
  });
});
