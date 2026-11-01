"""Combined BOQ+PO report scanning: UNIT COST capture.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import unittest
from unittest.mock import patch

from app.models.schemas import DocumentParseRequest
from app.services import document_parser_service as parser

COMBINED_HEADER = [
    "PRIMARY SECTION", "SUB PRIMARY SECTION", "MATERIAL SPECIFICATION", "Area unit", "Total Area",
    "PO NUMBER", "PO DATE", "MATERIAL NAME (SUPPLIER)", "Material Unit", "Material Quantity",
    "SUPPLIER", "UNIT COST", "TOTAL COST",
]


def _parse(table):
    with patch.object(parser, "extract_text", return_value=([""], 1)), \
         patch.object(parser, "extract_tables", return_value=[table]):
        return parser.parse_boq_document(DocumentParseRequest(file_path="unused.xlsx", project_id=1))


class CombinedReportUnitCostTests(unittest.TestCase):
    def test_unit_cost_is_captured_per_po_line(self):
        table = [
            COMBINED_HEADER,
            ["Structural", "Columns", "Deformed Bar 12mm", "sq.m", "120",
             "PO-001", "2024-03-01", "Deformed Bar 12mm x 6m", "pcs", "40", "Steel Co", "1,250.50", "50,020"],
            [None, None, None, None, None,
             None, None, "Tie Wire #16", "kg", "5", "Steel Co", "95", "475"],
        ]

        result = _parse(table)

        self.assertEqual(len(result.items), 1)
        supply = result.items[0].historical_supply
        self.assertEqual(len(supply), 2)
        self.assertEqual(supply[0].unit_cost, 1250.50)
        self.assertEqual(supply[1].unit_cost, 95)

    def test_unit_cost_column_is_not_taken_as_the_unit_column(self):
        table = [
            COMBINED_HEADER,
            ["Structural", "Columns", "Deformed Bar 12mm", "sq.m", "120",
             "PO-001", "2024-03-01", "Deformed Bar 12mm x 6m", "pcs", "40", "Steel Co", "1250", "50000"],
        ]

        line = _parse(table).items[0].historical_supply[0]

        self.assertEqual(line.unit, "pcs")
        self.assertEqual(line.quantity, 40)
        self.assertEqual(line.supplier_name, "Steel Co")
        self.assertEqual(line.po_number, "PO-001")

    def test_combined_report_without_cost_column_leaves_unit_cost_empty(self):
        header = [h for h in COMBINED_HEADER if h not in ("UNIT COST", "TOTAL COST")]
        table = [
            header,
            ["Structural", "Columns", "Deformed Bar 12mm", "sq.m", "120",
             "PO-001", "2024-03-01", "Deformed Bar 12mm x 6m", "pcs", "40", "Steel Co"],
        ]

        line = _parse(table).items[0].historical_supply[0]

        self.assertIsNone(line.unit_cost)
        self.assertEqual(line.unit, "pcs")
        self.assertEqual(line.quantity, 40)

    def test_plain_boq_is_unchanged(self):
        table = [
            ["Primary Section", "Material Specification", "Unit", "Quantity"],
            ["Structural", "Deformed Bar 12mm", "pcs", "40"],
        ]

        items = _parse(table).items

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].unit, "pcs")
        self.assertEqual(items[0].estimated_quantity, 40)
        self.assertEqual(items[0].historical_supply, [])


if __name__ == "__main__":
    unittest.main()
