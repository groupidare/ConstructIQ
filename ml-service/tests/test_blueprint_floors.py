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
from app.services.blueprint_geometry import Label, RoomResult, best_rooms, refine_rooms
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

    def test_small_pocket_at_a_rooms_edge_is_floor_of_the_room(self):
        # 4 m × 3 m room with a 0.6 m × 0.4 m built-in desk against one wall
        walls = [(0, 0, 4, 0), (4, 0, 4, 3), (4, 3, 0, 3), (0, 3, 0, 0),
                 (1, 3, 1, 2.6), (1, 2.6, 1.6, 2.6), (1.6, 2.6, 1.6, 3)]
        room = best_rooms([walls], [Label("STORAGE", 2, 1)], None).rooms[0]
        self.assertAlmostEqual(room.area_sqm, 12.0, delta=0.3)

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


class ShortRoomWords(unittest.TestCase):
    def test_tb_under_common_is_part_of_the_name(self):
        lines = [bp.TextLine("COMMON", 100, 100, 140, 110, 10.0), bp.TextLine("T&B", 110, 112, 130, 122, 10.0),
                 bp.TextLine("BEDROOM", 300, 100, 350, 110, 10.0), bp.TextLine("D2", 400, 100, 410, 110, 10.0)]
        self.assertEqual([l.text for l, _ in bp._labels_from(lines, [])], ["COMMON T&B", "BEDROOM"])


class WallObjects(unittest.TestCase):
    def test_callout_box_around_its_text_is_not_a_wall_and_a_room_outline_is(self):
        m_per_pt = bp.PT_TO_M * 50
        text = bp.TextLine("CURTAIN COVE", 100, 100, 130, 104, 4.0)
        rect = lambda x0, top, x1, bottom: {"object_type": "rect", "x0": x0, "top": top, "x1": x1, "bottom": bottom}
        callout = rect(98, 98, 132, 106)             # tight around the text
        room = rect(60, 60, 170, 140)                # 2 m × 1.4 m, the text inside it
        kept = bp._wall_objects([callout, room], [text], m_per_pt)
        self.assertEqual(kept, [room])

    def test_leader_ending_in_an_arrowhead_is_not_a_wall_and_an_extension_line_is_kept(self):
        m_per_pt = bp.PT_TO_M * 50
        line = lambda x0, y0, x1, y1: {"object_type": "line", "x0": min(x0, x1), "x1": max(x0, x1), "top": min(y0, y1),
                                       "bottom": max(y0, y1), "pts": [(x0, y0), (x1, y1)]}
        head = lambda x0, top, x1, bottom: {"object_type": "curve", "fill": True, "x0": x0, "x1": x1, "top": top, "bottom": bottom}
        # Decathlon's "SHELVES – WORKTOP" leader: down into the storage room, the arrow running on below its end
        # (its arrowhead is drawn as two filled halves, as in the PDF)
        leader, halves = line(313.4, 167.3, 313.4, 207.3), [head(310.1, 207.5, 313.4, 211.1), head(313.4, 207.5, 316.6, 211.1)]
        # an extension line meeting a horizontal dimension's arrowhead side-on
        extension, dimension_head = line(100, 150, 100, 200), head(100.2, 148.5, 103.8, 151.5)
        kept = bp._wall_objects([leader, *halves, extension, dimension_head], [], m_per_pt)
        self.assertIn(extension, kept)
        self.assertNotIn(leader, kept)


class CeilingPlanNotes(unittest.TestCase):
    # The Decathlon reflected ceiling plan's notes, as read off the sheet
    def test_finish_notes_and_heights_are_kept_and_fixtures_are_not(self):
        t = lambda text, x0, top: bp.TextLine(text, x0, top, x0 + 100, top + 8, 7.1)
        blocks = bp._note_blocks([t("600mmx600mm ACOUSTIC", 221, 166), t("CEILING PANEL IN WHITE", 221, 175),
                                  t("LED FLAT PANEL LIGHT", 233, 138), t("CH=2600mm", 459, 241),
                                  t("OPEN-UTILITIES CEILING PAINTED IN BLACK", 624, 449), t("BEAMSOFFIT:H=4190mm", 838, 548)])
        self.assertEqual([b.text for b in blocks],
                         ["600mmx600mm ACOUSTIC CEILING PANEL IN WHITE", "CH=2600mm", "OPEN-UTILITIES CEILING PAINTED IN BLACK"])

    def test_room_height_from_ch_or_slab_soffit(self):
        self.assertEqual(bp._room_height(["CH=2600mm"]), 2.6)
        self.assertEqual(bp._room_height(["SLAB SOFFIT:H=4745mm OPEN-UTILITIES CEILING PAINTED IN BLACK"]), 4.745)
        self.assertIsNone(bp._room_height(["600mmx600mm ACOUSTIC CEILING PANEL"]))

    def test_bent_leader_drawn_as_one_polyline_is_followed_to_its_arrow(self):
        # From the acoustic-panel note across and down into the storage room
        leader = {"object_type": "curve", "path": [("m",), ("l",), ("l",)], "pts": [(317.7, 169.5), (434.9, 169.5), (460.4, 270.2)],
                  "x0": 317.7, "x1": 460.4, "top": 169.5, "bottom": 270.2}
        head = {"object_type": "curve", "fill": True, "x0": 459.0, "x1": 462.5, "top": 270.0, "bottom": 274.0}
        _, lines = bp._leader_lines([leader, head], bp.PT_TO_M * 50)
        self.assertEqual([(tip, tail) for _, tip, tail in lines], [((460.4, 270.2), (317.7, 169.5))])


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


class WallArea(unittest.TestCase):
    """What's painted: not a glass side, and not above an open ceiling's finish line."""

    def rooms(self, *polygons):
        from shapely import Polygon
        from app.services.blueprint_geometry import Room
        return RoomResult([Room(f"R{i}", Polygon(p), [f"R{i}"]) for i, p in enumerate(polygons)], None, 0.6, [])

    def label(self, text, x, y):
        # 1 PDF point is 1 m here (m_per_pt=1), so the label's place reads in metres.
        return bp.TextLine(text, x - 1, y - 0.2, x + 1, y + 0.2, 0.4)

    def test_a_glass_label_takes_only_the_edge_it_runs_along(self):
        result = self.rooms([(0, 0), (10, 0), (10, 6), (0, 6)])
        lines = [self.label("PERIMETER GLASS WALL", 3, 7), self.label("PERIMETER GLASS WALL", 7, 7)]
        self.assertEqual(bp._glass_lengths(result, lines, 1.0), {0: 10})  # the same side, counted once

    def test_a_label_far_from_any_wall_or_about_something_else_counts_nothing(self):
        result = self.rooms([(0, 0), (10, 0), (10, 6), (0, 6)])
        self.assertEqual(bp._glass_lengths(result, [self.label("PERIMETER GLASS WALL", 5, 12)], 1.0), {})
        self.assertEqual(bp._glass_lengths(result, [self.label("TEMPERED GLASS PANEL", 5, 7)], 1.0), {})

    def test_most_of_a_room_marked_glass_is_treated_as_a_misread(self):
        result = self.rooms([(0, 0), (10, 0), (10, 1), (0, 1)])  # the long sides are 20 of its 22 m
        lines = [self.label("GLASS WALL", 5, 2), self.label("GLASS WALL", 5, -1)]
        self.assertEqual(bp._glass_lengths(result, lines, 1.0), {})

    def test_finish_heights_are_only_those_marked_as_a_ceiling_line(self):
        t = lambda text, top, size=10.0: bp.TextLine(text, 100, top, 180, top + size, size)
        sheet = bp.Sheet("A-3", "A", "ELEV", 2, [t("+4000mm", 100), t("MALL FINISH CEILING LINE", 113, 8.0),
                                                 t("+2600mm", 300), t("FINISH CEILING LINE", 313, 8.0),
                                                 t("+7500mm", 500), t("ROOF DECK", 513, 8.0)], [])
        self.assertEqual(bp._finish_ceiling_heights([sheet]), [2.6, 4.0])

    def test_an_open_ceiling_stops_at_the_highest_finish_line_below_the_slab(self):
        soffit = ["L-01 SLAB SOFFIT:H=4745mm OPEN-UTILITIES CEILING PAINTED IN BLACK"]
        self.assertEqual(bp._wall_height(soffit, [2.6, 3.0, 4.0]), 4.0)
        self.assertEqual(bp._wall_height(soffit, []), 4.745)  # no line to go by: as noted
        self.assertEqual(bp._wall_height(soffit, [5.0]), 4.745)
        self.assertEqual(bp._wall_height(["CH=2600mm"], [4.0]), 2.6)  # a real ceiling is its own height
        self.assertIsNone(bp._wall_height(["ACOUSTIC CEILING PANEL"], [4.0]))


class ThinnerPens(unittest.TestCase):
    """A thinner pen corrects a room only where the plan gives a reason."""

    @staticmethod
    def result(*rooms):
        from shapely import Polygon
        from app.services.blueprint_geometry import Room
        return RoomResult([Room("/".join(n), Polygon(p), list(n), 0.9, ids) for p, n, ids in rooms], None, 0.6, [])

    BIG = [(0, 0), (10, 0), (10, 5), (0, 5)]
    PART = [(0, 0), (6, 0), (6, 5), (0, 5)]

    def test_a_room_that_leaked_through_a_wide_door_takes_the_thin_outline(self):
        labels = [Label("BEDROOM", 3, 2)]
        heavy = self.result((self.BIG, ["BEDROOM"], [0]))
        thin = self.result((self.PART, ["BEDROOM"], [0]))
        rooms = refine_rooms(heavy, labels, [(8, 2)], None, thin).rooms  # RD tag in the part that leaked
        self.assertEqual(sorted(round(r.area_sqm) for r in rooms), [20, 30])
        self.assertEqual(rooms[0].name, "BEDROOM")
        self.assertEqual(rooms[1].name, "Unlabelled room 1")

    def test_no_door_tag_where_the_outlines_differ_changes_nothing(self):
        labels = [Label("BEDROOM", 3, 2)]
        heavy = self.result((self.BIG, ["BEDROOM"], [0]))
        thin = self.result((self.PART, ["BEDROOM"], [0]))
        self.assertIs(refine_rooms(heavy, labels, [], None, thin), heavy)
        self.assertIs(refine_rooms(heavy, labels, [(3, 2)], None, thin), heavy)  # the tag is inside the thin outline

    def test_a_thin_pen_that_chops_the_room_up_is_not_believed(self):
        labels = [Label("LAUNDRY", 1, 1)]
        heavy = self.result((self.BIG, ["LAUNDRY"], [0]))
        thin = self.result(([(0, 0), (3, 0), (3, 5), (0, 5)], ["LAUNDRY"], [0]))  # 30% of it: a grid line cut it
        self.assertIs(refine_rooms(heavy, labels, [(8, 2)], None, thin), heavy)

    def test_a_toilet_merged_into_a_room_is_cut_out_with_its_label(self):
        labels = [Label("KITCHEN", 3, 2), Label("TOILET", 8, 2)]
        heavy = self.result((self.BIG, ["KITCHEN", "TOILET"], [0, 1]))
        mid = self.result((self.PART, ["KITCHEN"], [0]))
        rooms = refine_rooms(heavy, labels, [], mid, None).rooms
        self.assertEqual({r.name: round(r.area_sqm) for r in rooms}, {"KITCHEN": 30, "TOILET": 20})

    def test_a_room_with_only_toilet_labels_is_left_alone(self):
        labels = [Label("TOILET", 3, 2), Label("T&B", 8, 2)]
        heavy = self.result((self.BIG, ["TOILET", "T&B"], [0, 1]))
        self.assertIs(refine_rooms(heavy, labels, [], self.result((self.PART, ["TOILET"], [0])), None), heavy)


class PlanNotes(unittest.TestCase):
    def test_finish_notes_of_every_sheet_with_their_page_floor_sheet_first(self):
        t = lambda text, top, size=7.0: bp.TextLine(text, 100, top, 220, top + size, size)
        elevations = bp.Sheet("A-5", "A", "ELEVATIONS", 4, [t("GYPSUM WALL IN", 100), t("PAINTED FINISH", 108), t("ELEVATION A", 300)], [])
        floor = bp.Sheet("A-2", "A", "FLOOR PLAN", 1, [t("600x600mm", 50), t("FLOOR TILES", 58), t("SALES AREA", 200, 12.0)], [])
        notes = bp._plan_notes([elevations, floor], floor)
        self.assertEqual([(n["text"], n["page"]) for n in notes],
                         [("600x600mm FLOOR TILES", 2), ("GYPSUM WALL IN PAINTED FINISH", 5)])
        self.assertEqual(notes[0]["box"], [100, 50, 220, 65])


if __name__ == "__main__":
    unittest.main()
