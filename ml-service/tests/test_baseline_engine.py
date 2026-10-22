"""Shared baseline cases (also run by the C# BaselineCalculatorTests).

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import json
import unittest
from pathlib import Path

from app.ml import baseline_engine

CASES = json.loads((Path(__file__).parent / "fixtures" / "baseline_cases.json").read_text(encoding="utf-8"))["cases"]


class SharedBaselineCases(unittest.TestCase):
    def test_every_shared_case(self):
        for case in CASES:
            with self.subTest(case["name"]):
                result = baseline_engine.compute(case["material"], case["boq_unit"], case["boq_quantity"])
                expected = case["expected"]
                self.assertEqual(result.baseline_quantity, expected["baseline_quantity"])
                self.assertEqual(result.purchase_quantity, expected["purchase_quantity"])
                self.assertEqual(result.purchase_unit, expected["purchase_unit"])
                self.assertEqual(result.formula_text, expected["formula_text"])
                self.assertEqual(result.reason, expected["reason"])


class CalculationTypeNames(unittest.TestCase):
    def test_accepts_stored_int_and_name(self):
        self.assertEqual(baseline_engine.calculation_type_name(4), "Length")
        self.assertEqual(baseline_engine.calculation_type_name("unitarea"), "UnitArea")
        self.assertIsNone(baseline_engine.calculation_type_name(None))
        self.assertIsNone(baseline_engine.calculation_type_name(9))


if __name__ == "__main__":
    unittest.main()
