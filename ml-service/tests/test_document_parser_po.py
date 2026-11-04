"""Purchase Order scanning: unit price and PO number capture.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import unittest
from unittest.mock import patch

from app.models.schemas import DocumentParseRequest
from app.services import document_parser_service as parser


def _parse(table, text=""):
    with patch.object(parser, "extract_text", return_value=([text], 1)), \
         patch.object(parser, "extract_tables", return_value=[table]):
        return parser.parse_po_document(DocumentParseRequest(file_path="unused.pdf", project_id=1))


class PoUnitPriceTests(unittest.TestCase):
    def test_unit_price_is_captured_and_not_taken_as_the_unit(self):
        table = [
            ["ITEM", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE", "AMOUNT"],
            ["1", "Skim coat 20kg", "40", "bag", "₱ 1,250.50", "50,020.00"],
            ["2", "Tile adhesive", "10", "bag", "PHP 480", "4,800.00"],
        ]

        items = _parse(table).items

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].unit, "bag")
        self.assertEqual(items[0].actual_quantity_ordered, 40)
        self.assertEqual(items[0].unit_price, 1250.50)
        self.assertEqual(items[1].unit_price, 480)

    def test_unit_cost_header_before_unit_header_still_finds_both(self):
        table = [
            ["DESCRIPTION", "UNIT COST", "QTY", "UNIT"],
            ["Deformed bar 12mm", "310", "66", "pcs"],
        ]

        item = _parse(table).items[0]

        self.assertEqual(item.unit, "pcs")
        self.assertEqual(item.unit_price, 310)

    def test_no_price_column_leaves_price_empty(self):
        table = [
            ["DESCRIPTION", "QTY", "UNIT"],
            ["Deformed bar 12mm", "66", "pcs"],
        ]

        self.assertIsNone(_parse(table).items[0].unit_price)

    def test_blank_price_cell_is_empty_not_zero(self):
        table = [
            ["DESCRIPTION", "QTY", "UNIT", "UNIT PRICE"],
            ["Deformed bar 12mm", "66", "pcs", ""],
        ]

        self.assertIsNone(_parse(table).items[0].unit_price)


class PoNumberTests(unittest.TestCase):
    TABLE = [
        ["DESCRIPTION", "QTY", "UNIT"],
        ["Deformed bar 12mm", "66", "pcs"],
    ]

    def test_po_number_is_read_from_the_header_text(self):
        for text, expected in [
            ("Supplier: JS Builders\nPO No.: 2024-118\nDate: 2024-03-01", "2024-118"),
            ("P.O. # 0045", "0045"),
            ("Purchase Order Number: JSB-77", "JSB-77"),
        ]:
            with self.subTest(text=text):
                self.assertEqual(_parse(self.TABLE, text).items[0].po_number, expected)

    def test_label_without_a_number_is_ignored(self):
        self.assertIsNone(_parse(self.TABLE, "PO No.: TBA").items[0].po_number)

    def test_po_inside_another_word_is_not_a_po_number(self):
        self.assertIsNone(_parse(self.TABLE, "Depo No. 12").items[0].po_number)


if __name__ == "__main__":
    unittest.main()
