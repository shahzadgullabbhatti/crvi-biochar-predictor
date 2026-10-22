// The exported tree inputs must be cast to float32, as in CatBoost's evaluator.
export function validateInput(input, model) {
  const errors = [];
  const warnings = [];
  for (const field of model.schema) {
    const value = input[field.key];
    if (field.type === "category") {
      if (!field.options.includes(value)) errors.push(`${field.label}: choose a listed category.`);
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field.label}: enter a finite number.`);
    } else if (value < field.minimum || (field.maximum !== null && value > field.maximum)) {
      errors.push(`${field.label}: enter a value ${field.maximum === null ? `of at least ${field.minimum}` : `between ${field.minimum} and ${field.maximum}`}.`);
    } else if (value < field.observed[0] || value > field.observed[1]) {
      warnings.push(`${field.label} is outside the observed range (${field.observed[0]} to ${field.observed[1]} ${field.unit}).`);
    }
  }
  return { errors, warnings };
}

export function engineer(input, model) {
  const row = Object.fromEntries(model.schema.map(field => [field.column, input[field.key]]));
  row.dosage_x_time = input.dosage * input.time;
  row.dosage_x_ph = input.dosage * input.ph;
  row.dosage_x_surface_area = input.dosage * input.surface;
  row.biochar_temp_x_heating_rate = input.temperature * input.heating;
  row.biochar_temp_x_residence_time = input.temperature * input.residence;
  row.initial_concentration_per_dose = input.concentration / input.dosage;
  row.log_initial_concentration = Math.log1p(Math.max(0, input.concentration));
  row.log_adsorption_time = Math.log1p(Math.max(0, input.time));
  row.log_adsorbent_dosage = Math.log1p(Math.max(0, input.dosage));
  return row;
}

export function transform(row, input, model) {
  const n = model.numeric;
  const logged = new Set(n.logColumns);
  const vector = n.columns.map((column, i) => {
    let value = row[column];
    if (value === null || Number.isNaN(value)) value = n.impute[i];
    if (logged.has(column)) {
      const minimum = n.logMinimums[column];
      value = Math.log1p(value + (minimum <= -1 ? Math.abs(minimum) + 1 + n.logOffset : 0));
    }
    value = Math.min(n.upper[i], Math.max(n.lower[i], value));
    return (value - n.mean[i]) / n.scale[i];
  });
  for (const category of model.categorical) {
    category.categories.forEach((name, i) => {
      if (i !== category.drop) vector.push(input[category.key] === name ? 1 : 0);
    });
  }
  if (vector.length !== model.transformedFeatures || vector.some(x => !Number.isFinite(x))) {
    throw new Error("The preprocessing export is invalid for these inputs.");
  }
  return vector;
}

export function predict(input, model) {
  const { errors, warnings } = validateInput(input, model);
  if (errors.length) throw new Error(errors.join(" "));
  const row = engineer(input, model);
  if (model.numeric.columns.some(column => !Number.isFinite(row[column]))) {
    throw new Error("Input magnitudes are too large to calculate finite engineered descriptors.");
  }
  const vector = transform(row, input, model).map(Math.fround);
  let sum = 0;
  for (const tree of model.trees) {
    let leaf = 0;
    tree.splits.forEach(([feature, border], depth) => {
      if (vector[feature] > border) leaf |= 1 << depth;
    });
    sum += tree.leaves[leaf];
  }
  const prediction = sum * model.scale + model.bias;
  if (!Number.isFinite(prediction)) throw new Error("The model returned a non-finite prediction.");
  let squaredDistance = 0;
  model.ad.columns.forEach((column, i) => {
    const value = column.column ? row[column.column] : Number(input[column.key] === column.category);
    const standardized = (value - model.ad.mean[i]) / model.ad.scale[i];
    squaredDistance += (standardized - model.ad.centroid[i]) ** 2;
  });
  const distance = Math.sqrt(squaredDistance);
  if (!Number.isFinite(distance)) throw new Error("Input magnitudes exceed the numerical range of domain screening.");
  const withinDomain = distance <= model.ad.cutoff;
  if (!withinDomain) warnings.push("Outside the heuristic applicability-domain cutoff. This input combination is weakly supported by the development data.");
  if (prediction < 0 || prediction > 100) warnings.push("Prediction is outside 0-100%. The unconstrained model output has not been clipped.");
  return { prediction, distance, cutoff: model.ad.cutoff, withinDomain, warnings };
}
