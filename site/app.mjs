import { predict, validateInput } from "./inference.mjs";

const $ = id => document.getElementById(id);
let model;
let lastResult;
const sections = {
  temperature: "preparation", residence: "preparation", dosage: "preparation", adsorptionModel: "preparation",
  heating: "adsorption", concentration: "adsorption", time: "adsorption", surface: "adsorption",
  gas: "material", adsorptionTemperature: "material", ph: "material",
};

function createFields() {
  for (const container of document.querySelectorAll(".fields")) container.replaceChildren();
  $("input-ranges").replaceChildren();
  for (const field of model.schema) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.htmlFor = field.key;
    label.append(document.createTextNode(field.label));
    if (field.unit) {
      const unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = field.unit;
      label.append(unit);
    }
    const control = document.createElement(field.type === "category" ? "select" : "input");
    control.id = field.key;
    control.name = field.key;
    control.required = true;
    if (field.type === "number") {
      control.type = "number";
      control.step = "any";
      control.min = field.minimum;
      if (field.maximum !== null) control.max = field.maximum;
      control.inputMode = "decimal";
    } else {
      for (const name of field.options) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        control.append(option);
      }
    }
    control.value = field.default;
    wrapper.append(label, control);
    if (field.observed) {
      const range = document.createElement("p");
      range.id = `${field.key}-range`;
      range.className = "field-range";
      range.textContent = `Observed: ${field.observed[0].toLocaleString()}–${field.observed[1].toLocaleString()}`;
      control.setAttribute("aria-describedby", range.id);
      control.title = `${field.label}: ${range.textContent} ${field.unit}`;
      wrapper.append(range);
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = field.label;
      description.textContent = `${field.observed[0]}–${field.observed[1]} ${field.unit}`;
      $("input-ranges").append(term, description);
    }
    $(`${sections[field.key]}-fields`).append(wrapper);
  }
}

async function loadModel() {
  $("predict").disabled = true;
  $("retry").hidden = true;
  $("load-status").hidden = false;
  $("load-status").textContent = "Loading the trained model…";
  try {
    const response = await fetch(new URL("./model.json", import.meta.url), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
    const data = await response.json();
    if (data.version !== 1 || data.schema?.length !== 11 || data.trees?.length !== 417) {
      throw new Error("Unsupported or incomplete model export.");
    }
    model = data;
    createFields();
    $("load-status").hidden = true;
    $("predict").disabled = false;
    $("metric-description").textContent = `Pooled five-fold CV R² = ${model.metrics.r2.toFixed(3)}, RMSE = ${model.metrics.rmse.toFixed(2)} percentage points, and MAE = ${model.metrics.mae.toFixed(2)} percentage points. Random seed: 42.`;
  } catch (error) {
    model = undefined;
    $("load-status").textContent = "The trained model could not be loaded. Check your connection and retry. No prediction has been substituted.";
    $("retry").hidden = false;
    console.error("Model load failed:", error.message);
  }
}

function inputs() {
  return Object.fromEntries(model.schema.map(field => [field.key,
    field.type === "number" ? ($(field.key).value.trim() ? Number($(field.key).value) : NaN) : $(field.key).value,
  ]));
}

function clearErrors() {
  $("form-errors").replaceChildren();
  $("form-errors").hidden = true;
  for (const control of document.querySelectorAll("[aria-invalid]")) control.removeAttribute("aria-invalid");
}

function showErrors(errors) {
  const list = document.createElement("ul");
  for (const error of errors) {
    const li = document.createElement("li");
    li.textContent = error;
    list.append(li);
  }
  $("form-errors").append(list);
  $("form-errors").hidden = false;
}

function invalidate() {
  clearErrors();
  if (!lastResult) return;
  lastResult = undefined;
  $("download").disabled = true;
  $("result-card").classList.add("stale");
  $("prediction-value").textContent = "—";
  $("prediction-status").textContent = "Inputs changed. Run a new prediction.";
  $("domain-status").textContent = "Not evaluated";
  $("domain-details").textContent = "Run a new prediction to update domain screening.";
  $("domain-marker").hidden = true;
  $("prediction-warnings").hidden = true;
}

$("prediction-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!model) return;
  clearErrors();
  const input = inputs();
  const { errors } = validateInput(input, model);
  if (errors.length) {
    showErrors(errors);
    const invalid = model.schema.find(field => validateInput({ ...input, [field.key]: input[field.key] }, { schema: [field] }).errors.length);
    if (invalid) {
      $(invalid.key).setAttribute("aria-invalid", "true");
      $(invalid.key).focus();
    }
    return;
  }
  try {
    const result = predict(input, model);
    lastResult = { input, ...result };
    $("result-card").classList.remove("stale");
    $("prediction-value").textContent = result.prediction.toFixed(2);
    $("prediction-status").textContent = "CatBoost estimate, not a measurement.";
    $("domain-status").textContent = result.withinDomain ? "Inside heuristic cutoff" : "Outside heuristic cutoff";
    $("domain-status").style.color = result.withinDomain ? "var(--green)" : "var(--amber)";
    $("domain-details").textContent = `Distance ${result.distance.toFixed(2)} / cutoff ${result.cutoff.toFixed(2)} (95th percentile). Not a confidence interval.`;
    $("domain-marker").style.left = `${Math.min(99, result.distance / result.cutoff * 65)}%`;
    $("domain-marker").hidden = false;
    $("prediction-warnings").replaceChildren();
    for (const warning of result.warnings) {
      const p = document.createElement("p");
      p.textContent = warning;
      $("prediction-warnings").append(p);
    }
    $("prediction-warnings").hidden = !result.warnings.length;
    $("download").disabled = false;
  } catch (error) {
    showErrors([error.message]);
  }
});
$("prediction-form").addEventListener("input", invalidate);
$("prediction-form").addEventListener("change", invalidate);
$("reset").addEventListener("click", () => {
  if (!model) return;
  invalidate();
  for (const field of model.schema) $(field.key).value = field.default;
  clearErrors();
});
$("retry").addEventListener("click", loadModel);
$("download").addEventListener("click", () => {
  if (!lastResult) return;
  const report = {
    timestamp: new Date().toISOString(), model: model.name,
    inputs: Object.fromEntries(model.schema.map(field => [field.label, { value: lastResult.input[field.key], unit: field.unit }])),
    predictedRemovalPercent: lastResult.prediction,
    applicabilityDomain: { distance: lastResult.distance, cutoff: lastResult.cutoff, withinCutoff: lastResult.withinDomain },
    warnings: lastResult.warnings,
    limitations: ["Research screening only; not independent experimental validation.", "Dosage units retain the workbook label and require source verification.", "Adsorption-model category may not be known prospectively.", "Domain distance is not predictive uncertainty."],
    internalValidation: { ...model.metrics, description: model.validation },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "crvi-prediction.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
loadModel();
