# Radious ONNX stat-scaler flow

Import `flow.json` in WHMM's node editor. Keep `radious_stat_scaler.pack` available in WHMM; the ONNX node selects that pack by name rather than a machine-specific path.

The flow reads effective `main_units_tables` rows from all enabled mods and vanilla, runs the packed models, and feeds the result to Save Changes. It applies to all selected units, including vanilla units. It does not filter to units missing from Radious.

## Running it

1. Enable the mods whose units should supply the input data, and open the node editor.
2. Load `flow.json`. Check that the ONNX node finds `radious_stat_scaler.pack`.
3. Use **Stat change strength** to control the predicted deltas: `0` leaves values unchanged; `1` applies the full predictions.
4. Run the flow. Save Changes creates `whmm_radious_stat_scaler_output.pack` in the game's data folder for a manual run. The original model pack is not modified.

Do not include a previously generated output pack among the enabled input mods when regenerating it: that would apply predictions to already scaled values.

For automatic launch-time execution, save this flow into the model pack as `whmmflows/radious_stat_scaler.json` using WHMM's flow editor. Launch-time outputs use WHMM's normal flow output folder and loading behavior.

## Explicit mapping choices

- `main_units` uses the selected root row.
- `land_units` follows `main_units.land_unit`.
- `battle_entities` follows `land_units.man_entity`, rather than the mount or engine entity.
- `melee_weapons` follows `land_units.primary_melee_weapon`.
- `projectiles` follows `land_units.primary_missile_weapon` and then `missile_weapons.default_projectile`.
- `is_ranged` is `1` when `land_units.primary_missile_weapon` is populated, otherwise `0`. It does not require a weapon or projectile row to resolve.
- `main_units__barrier_health` and `main_units__is_renown` read the actual columns from WH3's version-7 main-units table. Barrier prediction is enabled.
- Missing numeric column values are passed as `NaN`, allowing the packed preprocessor to perform its own imputation. Missing categorical values use `__MISSING__`.
- File-backed model predictions are rounded with JavaScript `Math.round` before strength is applied and the delta is added to the original value. Constants retain their manifest values.

These mappings follow `predict.ts` and `clean_data.ipynb` / `feature_engineering.ipynb` in the companion predictor project. The ranged flag describes a populated primary missile-weapon reference, including for units with ability-based attacks only when that reference is populated.

All 65 input bindings are supplied, and all 37 model outputs are enabled. Missing linked output rows are skipped. Linked outputs are cloned per root, with references redirected; root unit keys stay unchanged.

The mappings and reference paths were checked against the installed vanilla DB table versions, rather than the largest version numbers in the bundled schema. This example flow has not been run over a complete enabled-mod load order; inspect the generated tables before using it in a campaign.
