"""Blueprint extraction on self-made PDF/DXF fixtures with known answers
(see tests/fixtures/blueprints.py): OFFICE 20 m², STORAGE 12 m², gross 32 m².

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import tempfile
import unittest
from pathlib import Path

from app.services.blueprint_parser_service import SCANNED_PLAN_ERROR, parse_blueprint
from tests.fixtures import blueprints


def rooms_by_name(result):
    return {r["name"]: r for r in result["rooms"]}


class PdfExtraction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.sheet = blueprints.sheet_with_two_drawings(d / "plans.pdf")
        cls.no_scale = blueprints.sheet_with_two_drawings(d / "no-scale.pdf", missing_scale=True)
        cls.scanned = blueprints.scanned_pdf(d / "scan.pdf")
        cls.result = parse_blueprint(str(cls.sheet), "plans.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_sheets_and_drawings_are_listed_and_mep_skipped(self):
        r = self.result
        self.assertEqual([s["id"] for s in r["sheets"]], ["A-1"])
        drawings = r["sheets"][0]["drawings"]
        self.assertEqual([(d["title"], d["scale"]) for d in drawings],
                         [("GROUND FLOOR PLAN", "1:50"), ("REFLECTED CEILING PLAN", "1:100")])
        self.assertTrue(any("E-1" in w for w in r["warnings"]))

    def test_floor_plan_is_selected_by_default(self):
        self.assertEqual(self.result["selected_drawing"], "A-1:A")

    def test_room_areas_and_perimeters(self):
        rooms = rooms_by_name(self.result)
        self.assertAlmostEqual(rooms["OFFICE"]["floor_area_sqm"], 20.0, delta=0.2)
        self.assertAlmostEqual(rooms["OFFICE"]["perimeter_m"], 18.0, delta=0.2)
        self.assertAlmostEqual(rooms["STORAGE"]["floor_area_sqm"], 12.0, delta=0.2)
        self.assertGreaterEqual(rooms["OFFICE"]["confidence"], 0.8)

    def test_rotated_room_label_is_read(self):
        self.assertIn("STORAGE", rooms_by_name(self.result))

    def test_schedule_check_against_the_plans_total(self):
        check = self.result["schedule_check"]
        self.assertEqual(check["plan_total_sqm"], 32.0)
        self.assertAlmostEqual(check["extracted_total_sqm"], 32.0, delta=0.3)
        self.assertLess(check["difference_pct"], 1.0)

    def test_door_swing_counted(self):
        doors = [o for o in self.result["openings"] if o["type"] == "door"]
        self.assertEqual(sum(o["count"] for o in doors), 1)
        self.assertAlmostEqual(doors[0]["width_m"], 0.9, delta=0.05)

    def test_heights_and_finish_notes(self):
        self.assertEqual(self.result["ceiling_heights_m"], [2.7])
        self.assertIn("600x600mm FLOOR TILES", self.result["finish_notes"])

    def test_choosing_the_other_drawing_uses_its_own_scale(self):
        r = parse_blueprint(str(self.sheet), "plans.pdf", drawing_id="A-1:B")
        rooms = rooms_by_name(r)
        self.assertEqual(r["selected_drawing"], "A-1:B")
        self.assertAlmostEqual(rooms["OFFICE"]["floor_area_sqm"], 20.0, delta=0.4)

    def test_missing_scale_is_an_error_until_entered(self):
        r = parse_blueprint(str(self.no_scale), "no-scale.pdf")
        self.assertEqual(r["rooms"], [])
        self.assertTrue(any("No scale found" in e for e in r["errors"]))

        r = parse_blueprint(str(self.no_scale), "no-scale.pdf", scale_override="1:50")
        self.assertEqual(r["errors"], [])
        self.assertAlmostEqual(rooms_by_name(r)["OFFICE"]["floor_area_sqm"], 20.0, delta=0.2)

    def test_scanned_plan_is_rejected(self):
        r = parse_blueprint(str(self.scanned), "scan.pdf")
        self.assertEqual(r["errors"], [SCANNED_PLAN_ERROR])

    def test_unsupported_file_type(self):
        r = parse_blueprint(str(self.sheet), "plans.dwg")
        self.assertTrue(r["errors"])


class DxfExtraction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.walls = blueprints.dxf_two_rooms(d / "walls.dxf")
        cls.outlines = blueprints.dxf_two_rooms(d / "outlines.dxf", room_outlines=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_rooms_traced_from_wall_layer(self):
        r = parse_blueprint(str(self.walls), "walls.dxf")
        rooms = rooms_by_name(r)
        self.assertAlmostEqual(rooms["OFFICE"]["floor_area_sqm"], 20.0, delta=0.2)
        self.assertAlmostEqual(rooms["STORAGE"]["floor_area_sqm"], 12.0, delta=0.2)
        self.assertLess(r["schedule_check"]["difference_pct"], 1.0)
        self.assertEqual(r["ceiling_heights_m"], [2.7])

    def test_door_block_counted_with_its_width(self):
        r = parse_blueprint(str(self.walls), "walls.dxf")
        doors = [o for o in r["openings"] if o["type"] == "door"]
        self.assertEqual(doors, [{"type": "door", "count": 1, "width_m": 0.9, "height_m": 2.1, "assumed_height": True}])

    def test_closed_room_outlines_are_used_directly(self):
        r = parse_blueprint(str(self.outlines), "outlines.dxf")
        rooms = rooms_by_name(r)
        self.assertEqual(rooms["OFFICE"]["floor_area_sqm"], 20.0)
        self.assertEqual(rooms["STORAGE"]["floor_area_sqm"], 12.0)
        self.assertEqual(rooms["OFFICE"]["confidence"], 0.95)


if __name__ == "__main__":
    unittest.main()
