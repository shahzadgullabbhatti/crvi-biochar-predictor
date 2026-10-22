# Cr(VI) Removal Predictor

A responsive research tool for model-guided screening of chromium removal by biochar. The trained Bayesian CatBoost model runs in the browser, including the original fitted preprocessing. GitHub Pages can host the entire application; no Python server, paid inference service, API key, or package installation is needed by visitors.

## Run locally

Requires Node.js 22 or later. Runtime hosting has no npm dependencies; the test suite uses jsdom as a development dependency.

```sh
npm ci
npm test
npm start
```

Open the printed local URL. Serve the files over HTTP rather than double-clicking `index.html`, because the app fetches its JSON model.

On Windows PowerShell with script execution restricted, use `npm.cmd` in place of `npm`; no execution-policy changes are needed.

## Publish on GitHub Pages

Publish only this directory, not the surrounding research workspace. Its contents intentionally exclude the manuscript, raw workbook, Python pickles and earlier model artifacts.

1. Create or choose a GitHub repository, and upload this directory's contents at the repository root.
2. In **Settings > Pages > Build and deployment**, select **GitHub Actions**.
3. Push to `main`, or run **Test and deploy predictor** from the Actions tab.
4. Use the verified Pages URL displayed by the successful deployment. Do not assume deployment completed merely because a push succeeded.

The workflow tests the browser inference engine before publishing `site/`. Assets use relative paths so project sites under `/<repository>/` work.

## Model provenance

This is the publication's Bayesian-optimized **CatBoost** model, not the legacy serialized weighted-voting ensemble. Exact parameters are embedded in `site/model.json`: depth 4, 417 trees, learning rate 0.14958065961617342, L2 leaf regularization 2.9341970343946673, seed 42. The exporter refits the pipeline to the 98 supplied records after reproducing its pooled shuffled five-fold results:

| Internal metric | Value |
| --- | --- |
| Pooled out-of-fold R2 | 0.9123579456 |
| RMSE | 7.538281871 percentage points |
| MAE | 5.033967735 percentage points |

Eleven raw features generate nine deterministic descriptors. Fitted median imputation, training-fold skewness-selected log transformations, IQR clipping, scaling, and one-hot encoding produce 23 model columns. The JSON export contains only fitted inference state and aggregate domain statistics, not source rows or experimental target values. The JS evaluator uses float32 at tree splits, matching CatBoost. Tests compare 269 synthetic requests against Python predictions and domain distances at an absolute tolerance of 1e-8.

The private research workspace's `scripts/export_browser_predictor.py` produces the export and tests from the checked dataset and recorded publication hyperparameters. The public app does not recreate training without access to those source records.

## Scientific limitations

- Research screening only, not an experimental recipe or safety/regulatory recommendation.
- Dosage retains the workbook's **mg/L** header. Original experimental units require verification; no g/L conversion has been assumed.
- The adsorption-model category may be outcome-informed or unavailable before a new experiment. Selecting Langmuir is an input assumption, not measured characterization.
- The scores above are internal development-data results, not independent external validation. Tuning and evaluation reuse the development observations.
- The 95th-percentile applicability-domain cutoff is a standardized distance heuristic, not a confidence interval or proof of reliable extrapolation.
- Predictions are never clipped to 0-100%; range and domain warnings are explicit.
- Browser inputs never leave the device. Loading a hosted site still makes ordinary requests to its hosting provider; there are no app analytics or prediction API calls.

## Included interactions

Named category selectors, observed-range hints, strict invalid-input handling, predictor reset, stale-result invalidation, domain screening, result JSON download, and fail-closed model-load handling. The charcoal artwork is an original illustrative SVG, not a micrograph or material characterization.

## Distribution

The fitted model is downloadable by visitors because inference is browser-local. Repository visibility, redistribution permissions, and data/model ownership should be confirmed by the project authors before publication. No blanket open-source license has been applied on their behalf.
