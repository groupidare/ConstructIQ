"""Phase 3: reference quantity, demand-factor target, clipping, registry
refusal, and the leave-one-project-out baseline-vs-AI metrics.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.ml import demand_factor, material_ratios, model_registry
from app.ml.feature_engineering import FEATURE_COLS
from app.services import training_service

BOARD = {  # 1200 x 2400 sheet → 2.88 sq.m per sheet
    "calculation_type": 0, "length_mm": 2400, "width_mm": 1200, "baseline_purchase_unit": "sheet", "material_unit": "sq.m",
}


def row(project_id, material_id, boq_quantity, purchase_unit="sheet", props=None, boq_unit="sq.m", **extra):
    r = {
        "boq_item_id": project_id * 100 + material_id, "project_id": project_id, "is_historical": True,
        "material_id": material_id, "material_name": f"M{material_id}", "unit": boq_unit, "boq_unit": boq_unit,
        "purchase_unit": purchase_unit, "boq_quantity": boq_quantity, "current_stock": 0, "excess_quantity": 0,
        "wasted_quantity": 0, "primary_section": "Architectural Works", "coverage_area": boq_quantity,
        "project_type_encoded": 1, "days_into_phase": 30, "phase_duration_days": 30, "progress_percent": 100,
        "supplier_lead_time_days": 7,
    }
    r.update(props or {})
    r.update(extra)
    return r


class ReferenceQuantity(unittest.TestCase):
    def test_baseline_is_the_reference_when_available_in_the_row_unit(self):
        r = row(1, 1, 708.5, props=BOARD, material_ratio=0.5)
        demand_factor.attach_reference([r])

        self.assertEqual(r["reference_source"], "baseline")
        self.assertEqual(r["has_baseline"], 1)
        self.assertAlmostEqual(r["reference_quantity"], 246.0069)
        self.assertEqual(r["calculation_type_encoded"], 1)  # UnitArea

    def test_falls_back_to_ratio_estimate_without_properties(self):
        r = row(1, 2, 100, material_ratio=0.4)
        demand_factor.attach_reference([r])

        self.assertEqual(r["reference_source"], "historical_ratio")
        self.assertEqual(r["has_baseline"], 0)
        self.assertIsNone(r["baseline_quantity"])
        self.assertAlmostEqual(r["reference_quantity"], 40.0)

    def test_falls_back_when_baseline_unit_differs_from_purchase_unit(self):
        r = row(1, 1, 708.5, purchase_unit="pcs", props=BOARD, material_ratio=0.3)
        demand_factor.attach_reference([r])

        self.assertEqual(r["reference_source"], "historical_ratio")
        self.assertAlmostEqual(r["reference_quantity"], 212.55)

    def test_sht_and_sheet_count_as_the_same_unit(self):
        r = row(1, 1, 708.5, purchase_unit="sht", props=BOARD, material_ratio=1.0)
        demand_factor.attach_reference([r])
        self.assertEqual(r["reference_source"], "baseline")


class FactorTargetAndInverse(unittest.TestCase):
    def test_factor_round_trips_to_the_quantity(self):
        records = [{"reference_quantity": 246.0}, {"reference_quantity": 40.0}]
        targets = [270.6, 44.0]

        factors = demand_factor.to_factors(records, targets)
        quantities, clipped, flags = demand_factor.to_quantities(records, factors)

        self.assertAlmostEqual(factors[0], 1.1)
        for q, t in zip(quantities, targets):
            self.assertAlmostEqual(q, t)
        self.assertEqual(flags, [None, None])

    def test_out_of_range_factor_is_clipped_and_flagged(self):
        records = [{"reference_quantity": 100.0}] * 3
        quantities, clipped, flags = demand_factor.to_quantities(records, [5.0, 0.1, 1.2])

        self.assertEqual(clipped, [demand_factor.FACTOR_MAX, demand_factor.FACTOR_MIN, 1.2])
        self.assertEqual(quantities[0], 100.0 * demand_factor.FACTOR_MAX)
        self.assertEqual(flags, [demand_factor.FLAG_OUT_OF_RANGE, demand_factor.FLAG_OUT_OF_RANGE, None])

    def test_zero_reference_rows_are_not_usable(self):
        records = [{"reference_quantity": 0.0}, {"reference_quantity": 5.0}]
        kept, targets = demand_factor.usable(records, [1.0, 2.0])
        self.assertEqual(targets, [2.0])


class RegistryRefusesOldFeatureSet(unittest.TestCase):
    def test_model_trained_before_the_new_features_must_be_retrained(self):
        old_cols = [c for c in FEATURE_COLS if c not in ("reference_quantity", "has_baseline", "calculation_type_encoded")]
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / model_registry.MANIFEST_NAME).write_text(json.dumps({"version": "v-old", "feature_cols": old_cols}))
            with patch.object(model_registry, "MODELS_DIR", Path(tmp)):
                active, problem = model_registry.load_active()

        self.assertIsNone(active)
        self.assertIn("retrain", problem)


class TrainingOutliers(unittest.TestCase):
    def test_rows_more_than_three_times_off_are_skipped(self):
        # 288 sq.m of board = 100 sheets; 110 is real demand, 458 (a pcs
        # count) and 20 are encoding errors.
        records = [row(1, 1, 288, props=BOARD, boq_item_id=i) for i in range(3)]
        records, targets = training_service._prepare(records, [110, 458, 20])

        self.assertEqual(targets, [110])
        self.assertEqual(len(records), 1)


class LeaveOneProjectOutMetrics(unittest.TestCase):
    def test_reports_ai_reference_and_baseline_only_comparison(self):
        # 4 projects; material 1 (board, has a baseline) and material 2 (no
        # properties) — real demand is ~10% over the baseline.
        records, targets = [], []
        for p in range(1, 5):
            for m, (boq, props) in {1: (300 + 50 * p, BOARD), 2: (100 + 10 * p, None)}.items():
                for k in range(3):
                    r = row(p, m, boq + k, props=props, boq_item_id=p * 1000 + m * 10 + k)
                    records.append(r)
                    baseline = (boq + k) / 2.88
                    targets.append(baseline * 1.1 if props else (boq + k) * 0.4)

        material_ratios.attach_out_of_project(records, targets)
        records, targets = training_service._prepare(records, targets)
        with patch.object(training_service, "fetch_records", return_value=[]):
            evaluations, skipped, holdout = training_service._leave_one_project_out(None, records, targets, min_rows=10)

        self.assertEqual(skipped, [])
        comparison = holdout["baseline_comparison"]
        self.assertEqual(comparison["rows"], 12)
        self.assertIsNotNone(holdout["ai"]["mae"])
        self.assertIsNotNone(holdout["reference"]["mae"])
        # The baseline alone misses the real 10% overage; the AI learns it.
        self.assertLess(comparison["ai"]["mae"], comparison["baseline_only"]["mae"])


if __name__ == "__main__":
    unittest.main()
