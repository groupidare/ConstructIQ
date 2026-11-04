"""Reading several floors and the fixes that came out of the Mariane House
plan set (2 storeys, labels drawn as lines): a bedroom leaking through its
doorway into an open-plan space, garbled OCR room names, door tags stuck to
room names, a name written down a balcony one letter per line, and the
floor list — one drawing per floor, never the same floor twice.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import tempfile
import unittest
from pathlib import Path

from app.services import blueprint_ocr
from app.services import blueprint_parser_service as bp
from app.services.blueprint_geometry import Label, best_rooms
from app.services.blueprint_parser_service import parse_blueprint
from tests.fixtures import blueprints


def walls_with_gaps():
    """8 m × 5 m (metres, y down), the Mariane ground floor in miniature:
    a 1 m deep laundry strip along the top (0.5 m doorway), an open-plan
    kitchen / living / dining 5 m × 4 m, and a 3 m × 4 m bedroom whose
    0.9 m doorway is wider than the 0.6 m bridge."""
    return [
        (0, 0, 8, 0), (8, 0, 8, 5), (8, 5, 0, 5), (0, 5, 0, 0),   # outer walls
        (0, 1, 1, 1), (1.5, 1, 8, 1),                              # laundry wall, 0.5 m doorway
        (5, 1, 5, 2), (5, 2.9, 5, 5),                              # bedroom wall, 0.9 m doorway
    ]


def by_name(result):
    return {r.name: r for r in result.rooms}


class MergedRoomsAreSplit(unittest.TestCase):
    labels = [Label("LAUNDRY", 4, 0.5), Label("KITCHEN", 1, 2), Label("LIVING", 3.5, 2.5),
              Label("DINING", 2, 4.5), Label("BEDROOM", 6.5, 3)]

    def test_bedroom_leaking_through_its_doorway_is_split_off(self):
        rooms = by_name(best_rooms([walls_with_gaps()], self.labels, None))
        self.assertIn("BEDROOM", rooms)
        self.assertAlmostEqual(rooms["BEDROOM"].area_sqm, 12.0, delta=0.6)

    def test_open_plan_labels_with_no_wall_between_stay_one_room(self):
        rooms = by_name(best_rooms([walls_with_gaps()], self.labels, None))
        self.assertAlmostEqual(rooms["KITCHEN / LIVING / DINING"].area_sqm, 20.0, delta=0.6)

    def test_narrow_room_the_wider_bridge_would_close_is_kept(self):
        rooms = by_name(best_rooms([walls_with_gaps()], self.labels, None))
        self.assertAlmostEqual(rooms["LAUNDRY"].area_sqm, 8.0, delta=0.4)

    def test_split_keeps_the_total_area(self):
        result = best_rooms([walls_with_gaps()], self.labels, None)
        self.assertAlmostEqual(sum(r.area_sqm for r in result.rooms), 40.0, delta=0.8)

    def test_minor_label_names_a_room_of_its_own(self):
        walls = [(0, 0, 4, 0), (4, 0, 4, 3), (4, 3, 0, 3), (0, 3, 0, 0), (2.5, 0, 2.5, 3)]
        result = best_rooms([walls], [Label("BEDROOM", 1, 1.5), Label("TOILET", 3.2, 1.5, minor=True)], None)
        self.assertEqual(sorted(r.name for r in result.rooms), ["BEDROOM", "TOILET"])


class OcrRoomWords(unittest.TestCase):
    def test_garbled_room_words_are_read_as_the_room_word(self):
        for garbled in ("TOLET", "TOILE", "TORET", "NCTOILE"):
            self.assertEqual(blueprint_ocr.room_word(garbled), "TOILET", garbled)
        self.assertEqual(blueprint_ocr.room_word("BAC0NY"), "BALCONY")

    def test_other_words_are_left_alone(self):
        for other in ("STORM", "PROPERTY", "LINE", "3000", "UP", "PLAN"):
            self.assertIsNone(blueprint_ocr.room_word(other), other)

    def test_low_confidence_room_word_is_kept_and_other_words_are_not(self):
        self.assertTrue(blueprint_ocr._confident("TORET", 0.58))
        self.assertFalse(blueprint_ocr._confident("X", 0.58))

    def test_door_tag_number_does_not_join_the_room_name_beside_it(self):
        word = lambda text, x0, top, w, h=6: {"text": text, "x0": x0, "top": top, "x1": x0 + w, "bottom": top + h,
                                                "size": h / blueprint_ocr.CAP_HEIGHT}
        # "COMMON" with the "PD" over "2" tag of the toilet door right after it
        lines = blueprint_ocr._lines([word("COMMON", 744, 313, 31), word("PD", 781, 306, 8), word("2", 781, 312, 8)])
        self.assertIn("COMMON", [l[0] for l in lines])
        self.assertNotIn("COMMON 2", [l[0] for l in lines])


class StackedLetters(unittest.TestCase):
    def test_name_written_one_letter_per_line_is_one_label(self):
        # Azure's reading of the Mariane balcony: the L is missed, the O read as 0
        letters = [("B", 412), ("A", 419), ("C", 432), ("0", 441), ("N", 450), ("Y", 457)]
        lines = [bp.TextLine(t, 1035, top, 1040, top + 6, 8.0, ocr=True) for t, top in letters]
        lines += [bp.TextLine("BEDROOM", 900, 430, 930, 436, 8.0, ocr=True)]
        labels = [l.text for l, _ in bp._labels_from(lines, [])]
        self.assertIn("BALCONY", labels)

    def test_small_room_word_is_a_minor_label_and_other_small_text_is_not(self):
        lines = [bp.TextLine("BEDROOM", 100, 100, 130, 106, 10.0), bp.TextLine("GUESTROOM", 200, 100, 240, 106, 10.0),
                 bp.TextLine("TOILET", 300, 100, 320, 104, 6.0), bp.TextLine("FLOOR DRAIN", 400, 100, 430, 104, 6.0)]
        labels = {l.text: minor for l, minor in bp._labels_from(lines, [])}
        self.assertEqual(labels, {"BEDROOM": False, "GUESTROOM": False, "TOILET": True})


def sheet(sid, *drawings):
    page = []
    for i, (title, scale) in enumerate(drawings):
        page.append(bp.Drawing(f"{sid}:{chr(65 + i)}", bp.TextLine(title, 0, 0, 10, 10, 12.0), scale, (0, 0, 10, 10)))
    return bp.Sheet(sid, None, sid, 0, [], page)


class FloorList(unittest.TestCase):
    def test_one_drawing_per_floor_and_other_trades_skipped(self):
        # The Mariane House plan set
        sheets = [sheet("P1", ("LOT PLAN", None)),
                  sheet("P2", ("GROUND FLOOR PLAN", 60), ("SECOND FLOOR PLAN", 60)),
                  sheet("P3", ("FRONT ELEVATION", 60)),
                  sheet("P4", ("SITE DEVELOPMENT PLAN", 75), ("REFLECTED CEILING PLAN", 75), ("REFLECTED CEILING PLAN", 75)),
                  sheet("PC-2", ("FLOOR FRAMING PLAN", 50)),
                  sheet("PP-10", ("POWER SYSTEM LAYOUT", 50), ("POWER SYSTEM LAYOUT", 50))]
        floors, skipped = bp._floor_plans(sheets)
        self.assertEqual([(f["floor"], f["drawing_id"], f["confirm"]) for f in floors],
                         [("Ground Floor", "P2:A", False), ("Second Floor", "P2:B", False)])
        self.assertEqual(set(skipped), {"P1:A", "P4:A", "P4:B", "P4:C", "PC-2:A", "PP-10:A", "PP-10:B"})

    def test_same_floor_name_twice_comes_back_unticked(self):
        # Talia: the second floor's drawing is also titled GROUND FLOOR PLAN
        floors, _ = bp._floor_plans([sheet("AR-02", ("GROUND FLOOR PLAN", 50), ("GROUND FLOOR PLAN", 50))])
        self.assertEqual([(f["floor"], f["confirm"]) for f in floors], [("Ground Floor", False), ("Ground Floor (2)", True)])
        self.assertIn("different floor", floors[1]["note"])

    def test_unnamed_floor_plan_with_its_other_plan_views_as_alternatives(self):
        # Decathlon: one storey, the floor plan beside its dimensional and finishing plans
        sheets = [sheet("A-1", ("KEY PLAN", None)),
                  sheet("A-2", ("AS-BUILT FLOOR PLAN", 50), ("DIMENSIONAL PLAN", 50), ("WALL FINISHING PLAN", 50)),
                  sheet("A-5", ("FITTING ROOM MIRROR DETAILS", 15))]
        floors, _ = bp._floor_plans(sheets)
        self.assertEqual(len(floors), 1)
        self.assertEqual(floors[0]["drawing_id"], "A-2:A")
        self.assertEqual(floors[0]["alternatives"][:2], ["A-2:B", "A-2:C"])

    def test_enlarged_floor_plan_details_are_not_floors(self):
        floors, _ = bp._floor_plans([sheet("A-2", ("GROUND FLOOR PLAN", 100)), sheet("WF-1", ("FLOOR PLAN", 25))])
        self.assertEqual([f["drawing_id"] for f in floors], ["A-2:A"])

    def test_roof_deck_is_a_floor_and_roof_plan_is_not(self):
        floors, _ = bp._floor_plans([sheet("A-2", ("GROUND FLOOR PLAN", 100), ("ROOF DECK PLAN", 100), ("ROOF PLAN", 100))])
        self.assertEqual([f["floor"] for f in floors], ["Ground Floor", "Roof Deck"])


class Preview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.pdf = parse_blueprint(str(blueprints.sheet_with_two_drawings(d / "plans.pdf")), "plans.pdf")
        cls.dxf = parse_blueprint(str(blueprints.dxf_two_rooms(d / "walls.dxf")), "walls.dxf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_drawing_image_with_room_outlines_on_it(self):
        for r in (self.pdf, self.dxf):
            preview = r["preview"]
            self.assertTrue(preview["image"].startswith("data:image/png;base64,"))
            for room in r["rooms"]:
                self.assertGreaterEqual(len(room["outline"]), 4)
                for x, y in room["outline"]:
                    self.assertTrue(-2 <= x <= preview["width"] + 2 and -2 <= y <= preview["height"] + 2)

    def test_floor_list_and_scale_used(self):
        self.assertEqual([f["drawing_id"] for f in self.pdf["floor_plans"]], ["A-1:A"])
        self.assertEqual(self.pdf["scale_used"], "1:50")
        self.assertEqual(self.dxf["floor_plans"][0]["drawing_id"], "DXF:A")


if __name__ == "__main__":
    unittest.main()
