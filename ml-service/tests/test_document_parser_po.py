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


# A scanned PO as OCR reads it: "Stock Number _ Description" is one cell on
# the header but two on the items, so every column after it is shifted.
_SCANNED_TABLE = [
    ["Name", ": Sample Supply Corp.", "PO No.", "2", "0002011"],
    ["Project", ": Sample Project", "Date", ":", "03/07/2025"],
    ["Qty", "UM", "Stock Number _ Description", "Unit Cost", "Disct", "VAT", "Cost", "Total"],
    ["5.00", "bag", "00556", "Skimcoat White", "550.00", "0.00", "0.00", "2,750.00", "2,750.00"],
    ["5.00", "bags", "03685", "Boral White", "758.00", "0.00", "0.06", "3,730.06", "3,730.00"],
    ["10.00", "Pes", "00012", "Roller #7", "70.00", "0.00", "0.00", "700.00", "700.00"],
    ["6.00", "sheet", "03686", "Marine Plywood 3/4 Local", "1,300.00", "0.00", "0.00", "7,800.00", "7,800.00"],
]
_SCANNED_TEXT = (
    "Name : Sample Supply Corp. PO No. 2 0002011\n"
    "Project : Sample Project Date : 03/07/2025\n"
)


class ScannedPoTests(unittest.TestCase):
    def setUp(self):
        self.items = _parse(_SCANNED_TABLE, _SCANNED_TEXT).items

    def test_shifted_columns_are_read_from_the_item_rows(self):
        self.assertEqual([i.material_name for i in self.items],
                         ["Skimcoat White", "Boral White", "Roller #7", "Marine Plywood 3/4 Local"])
        self.assertEqual([i.unit_price for i in self.items], [550, 758, 70, 1300])
        self.assertEqual(self.items[0].actual_quantity_ordered, 5)

    def test_ocr_unit_misread_is_fixed(self):
        self.assertEqual(self.items[2].unit, "pcs")

    def test_po_number_and_plain_date_are_read(self):
        self.assertEqual(self.items[0].po_number, "0002011")
        self.assertEqual(self.items[0].order_date, "2025-03-07")

    def test_line_whose_total_doesnt_match_is_flagged(self):
        self.assertEqual([i.total_mismatch for i in self.items], [False, True, False, False])

    def test_delivery_date_is_not_taken_as_the_po_date(self):
        items = _parse(_SCANNED_TABLE, "Delivery date: 04/01/2025\n").items
        self.assertIsNone(items[0].order_date)


class SupplierLineTests(unittest.TestCase):
    _TABLE = [
        ["Qty", "UM", "Description", "Unit Cost", "Total"],
        ["3,000.00", "pcs", "Hardiflex Screw 1 1/2", "0.38", "1,140.00"],
    ]

    def test_supplier_on_its_own_line_is_read(self):
        text = "PO No. : 0002009\nName : Sample Marketing Corporation\nProject : Sample Project\n"
        self.assertEqual(_parse(self._TABLE, text).items[0].supplier_name, "Sample Marketing Corporation")

    def test_supplier_label_and_value_on_separate_lines(self):
        text = "Name\n: Sample Marketing Corporation\nProject : Sample Project\n"
        self.assertEqual(_parse(self._TABLE, text).items[0].supplier_name, "Sample Marketing Corporation")

    def test_supplier_followed_by_po_number_on_the_same_line(self):
        text = "Name : Sample Supply Corp. PO No. : 0002011\n"
        self.assertEqual(_parse(self._TABLE, text).items[0].supplier_name, "Sample Supply Corp.")
