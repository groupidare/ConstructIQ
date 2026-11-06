"""BOQ generation: template expansion per basis, aggregation across rooms,
catalog matching by name, and baselines on generated rows.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import unittest
from unittest import mock

from app.services import boq_generator_service as gen
from app.services import finish_history

CATALOG = [
    {"id": 1, "name": "Homogeneous Tile (600mm x 600mm, 10mm thick)", "unit": "sq.m",
     "calculation_type": "UnitArea", "length_mm": 600, "width_mm": 600, "pieces_per_package": 4, "purchase_unit": "box"},
    {"id": 2, "name": "Tile Adhesive", "unit": "bag", "calculation_type": "CoverageRate", "coverage_per_unit": 4},
    {"id": 3, "name": "Tile Grout", "unit": "bag", "calculation_type": "CoverageRate", "coverage_per_unit": 5},
    {"id": 4, "name": "Paint - Flatwall Latex", "unit": "can", "calculation_type": "CoverageRate", "coverage_per_unit": 25, "coats": 2},
    {"id": 5, "name": "Latex Paint, 2 coats + primer", "unit": "sq.m"},
    {"id": 6, "name": "Gypsum Board (12mm thick) on metal furring", "unit": "sq.m", "calculation_type": "UnitArea",
     "length_mm": 2400, "width_mm": 1200, "purchase_unit": "sheet"},
    {"id": 7, "name": "900 x 2100mm flush/solid core door", "unit": "pc", "calculation_type": "Count"},
]

ROOMS = [
    {"room": "Sales Area", "floor_area_sqm": 50.0, "perimeter_m": 30.0, "height_m": 3.0, "openings_sqm": 6.0},
    {"room": "Fitting Room", "floor_area_sqm": 2.4, "perimeter_m": 6.2, "height_m": 2.6, "openings_sqm": 1.89},
]


def by_spec(result, surface=None):
    """Rows by specification — only one surface's, when given (every room
    gets all three surfaces: the ones not passed in are resolved)."""
    return {r["specification"]: r for r in result["rows"] if surface is None or r["source"]["surface"] == surface}


def setUpModule():
    # No database in tests: no historical projects unless a test gives some.
    patcher = mock.patch.object(finish_history, "load", return_value=finish_history.History())
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


class TemplateExpansion(unittest.TestCase):
    def test_floor_rows_use_floor_area_and_aggregate_across_rooms(self):
        finishes = [{"room": "Sales Area", "floor": "floor_tile_600"}, {"room": "Fitting Room", "floor": "floor_tile_600"}]
        rows = by_spec(gen.generate(ROOMS, finishes, CATALOG, source="A-2:A"))

        tile = rows["Floor tile 600×600"]
        self.assertEqual(tile["material_id"], 1)
        self.assertEqual(tile["boq_quantity"], 52.4)
        self.assertEqual(tile["boq_unit"], "sq.m")
        self.assertEqual(tile["sub_category"], "Floor Finish")
        self.assertEqual(tile["source_note"], "From blueprint A-2:A · Sales Area, Fitting Room")
        self.assertEqual(tile["baseline"]["purchase_unit"], "box")
        self.assertEqual(tile["baseline"]["purchase_quantity"], 37)  # 52.4 ÷ 0.36 ÷ 4 = 36.4 → 37
        self.assertEqual(rows["Tile adhesive"]["material_id"], 2)
        self.assertEqual(rows["Tile grout"]["material_id"], 3)

    def test_wall_net_area_is_perimeter_times_height_less_openings(self):
        rows = by_spec(gen.generate(ROOMS[:1], [{"room": "Sales Area", "wall": "painted_gypsum"}], CATALOG), "wall")
        self.assertEqual(rows["Gypsum board"]["boq_quantity"], 84.0)  # 30 × 3 − 6
        # paint with properties beats the sq.m assembly row of the same name
        self.assertEqual(rows["Paint"]["material_id"], 4)

    def test_partition_counts_both_faces(self):
        catalog = CATALOG + [{"id": 8, "name": "Fiber Cement Board", "unit": "sq.m"}]
        rows = by_spec(gen.generate(ROOMS[:1], [{"room": "Sales Area", "wall": "fiber_cement_partition"}], catalog), "wall")
        self.assertEqual(rows["Fiber cement board"]["boq_quantity"], 168.0)

    def test_ceiling_and_door_count(self):
        result = gen.generate(ROOMS[:1], [{"room": "Sales Area", "ceiling": "gypsum_ceiling"}], CATALOG,
                              openings=[{"type": "door", "count": 2}])
        rows = by_spec(result, "ceiling")
        self.assertEqual(rows["Gypsum board"]["boq_quantity"], 50.0)
        rows = by_spec(result, "openings")
        self.assertEqual(rows["Door"]["boq_quantity"], 2)
        self.assertEqual(rows["Door"]["material_id"], 7)

    def test_missing_height_skips_wall_rows_with_a_warning(self):
        room = dict(ROOMS[0], height_m=None)
        result = gen.generate([room], [{"room": "Sales Area", "wall": "painted_gypsum"}], CATALOG)
        self.assertEqual([r for r in result["rows"] if r["source"]["surface"] == "wall"], [])
        self.assertTrue(any("No ceiling height" in w for w in result["warnings"]))

    def test_unmatched_material_is_kept_and_flagged(self):
        result = gen.generate(ROOMS[:1], [{"room": "Sales Area", "floor": "vinyl_floor"}], CATALOG)
        row = by_spec(result)["Vinyl tile"]
        self.assertIsNone(row["material_id"])
        self.assertEqual(row["baseline"]["reason"], "no material")
        self.assertTrue(any("Vinyl tile" in w for w in result["warnings"]))


class PerRoomFloorRows(unittest.TestCase):
    def test_floor_finish_is_one_row_per_room_and_adhesive_is_shared(self):
        finishes = [{"room": "Sales Area", "floor": "floor_tile_600"}, {"room": "Fitting Room", "floor": "floor_tile_300"}]
        catalog = CATALOG + [{"id": 9, "name": "Ceramic Tile (300 x 300mm, 8mm thick)", "unit": "sq.m"}]
        rows = gen.generate(ROOMS, finishes, catalog, per_room_floor=True)["rows"]

        floor = {r["sub_category"]: r for r in rows if r["specification"].startswith("Floor tile")}
        self.assertEqual(floor["Sales Area"]["boq_quantity"], 50.0)
        self.assertEqual(floor["Fitting Room"]["boq_quantity"], 2.4)
        self.assertEqual(floor["Fitting Room"]["material_id"], 9)
        adhesive = [r for r in rows if r["sub_category"] == "Floor Adhesive"]
        self.assertEqual(len(adhesive), 1)
        self.assertEqual(adhesive[0]["boq_quantity"], 52.4)


def note(text, page=2):
    return {"text": text, "page": page, "box": [0, 0, 10, 10]}


class FinishResolution(unittest.TestCase):
    """Where each room's finish comes from: picked, the drawing, past projects, a default."""

    def generate(self, rooms, plan_notes=(), finishes=(), history=None):
        return gen.generate(rooms, list(finishes), CATALOG, per_room_floor=True, plan_notes=list(plan_notes),
                            history=history or finish_history.History())

    def source(self, result, surface, room):
        """The source of the first row of `surface` covering `room`, with that room's own finish."""
        for r in result["rows"]:
            mine = next((x for x in r["source"]["rooms"] if x["room"] == room), None)
            if r["source"]["surface"] == surface and mine:
                return dict(r["source"], kind=mine["kind"], template=mine["template"], reason=mine["reason"])
        raise AssertionError(f"no {surface} row for {room}")

    def test_the_room_note_on_the_ceiling_plan_names_its_ceiling(self):
        rooms = [dict(ROOMS[0], ceiling_notes=[note("L-01 SLAB SOFFIT:H=4745mm OPEN-UTILITIES CEILING PAINTED IN BLACK", 3)],
                      has_ceiling_plan=True),
                 dict(ROOMS[1], ceiling_notes=[note("CH=3000mm", 3)], has_ceiling_plan=True)]
        result = self.generate(rooms)
        sales = self.source(result, "ceiling", "Sales Area")
        self.assertEqual((sales["kind"], sales["template"]), ("drawing", "exposed_painted"))
        self.assertEqual(sales["notes"][0]["page"], 3)
        # A ceiling plan with no finish for the room says nothing about it: a default, not a plan-wide note.
        fitting = self.source(result, "ceiling", "Fitting Room")
        self.assertEqual(fitting["kind"], "default")
        self.assertIn("ceiling plan has no finish note", fitting["reason"])
        # The slab paint is named in the drawing's words, and kept apart from the board ceiling's paint.
        paint = [r for r in result["rows"] if r["source"]["surface"] == "ceiling" and r["material_id"] == 4]
        self.assertEqual(len(paint), 2)
        worded = next(r for r in paint if r["specification_from_drawing"])
        self.assertEqual(worded["specification"], "Open-utilities Ceiling Painted in Black")
        self.assertEqual(worded["rooms"], ["Sales Area"])

    def test_the_finish_most_notes_name_wins(self):
        notes = [note("MATTE BLACK WALL PAINT FINISH", 3), note("DECATHLON BLUE WALL PAINT FINISH", 4),
                 note("GYPSUM WALL IN PAINTED FINISH", 5), note("600x600mm FLOOR TILES (RAL 7035 LIGHT GREY QUARTZ)")]
        result = self.generate(ROOMS[:1], notes)
        wall = self.source(result, "wall", "Sales Area")
        self.assertEqual((wall["kind"], wall["template"]), ("drawing", "painted_wall"))
        floor = next(r for r in result["rows"] if r["source"]["surface"] == "floor" and r["sub_category"] == "Sales Area")
        self.assertEqual(floor["specification"], "600x600mm Floor Tiles (RAL 7035 Light Grey Quartz)")
        self.assertEqual(floor["material_id"], 1)  # the catalog material is still matched by keywords

    def test_past_projects_fill_in_what_the_drawing_leaves_out(self):
        history = finish_history.History(finishes={"ceiling": {"gypsum_ceiling": 7, "acoustic_panel": 2}},
                                         projects={"ceiling": 10})
        src = self.source(self.generate(ROOMS[:1], history=history), "ceiling", "Sales Area")
        self.assertEqual((src["kind"], src["template"], src["projects"], src["of"]), ("history", "gypsum_ceiling", 7, 10))
        self.assertIn("7 of 10", src["reason"])
        src = self.source(self.generate(ROOMS[:1]), "ceiling", "Sales Area")
        self.assertEqual((src["kind"], src["template"]), ("default", "fiber_cement_ceiling"))

    def test_wet_rooms_get_the_noted_small_tile_or_the_wet_default(self):
        rooms = [ROOMS[0], dict(ROOMS[1], room="Toilet")]
        result = self.generate(rooms, [note("600x600mm FLOOR TILES")])
        self.assertEqual(self.source(result, "floor", "Sales Area")["template"], "floor_tile_600")
        toilet = self.source(result, "floor", "Toilet")
        self.assertEqual((toilet["kind"], toilet["template"]), ("default", "floor_tile_300"))
        result = self.generate(rooms, [note("600x600mm FLOOR TILES"), note("300x300mm NON-SLIP FLOOR TILES")])
        self.assertEqual(self.source(result, "floor", "Toilet")["template"], "floor_tile_300")
        self.assertEqual(self.source(result, "floor", "Sales Area")["template"], "floor_tile_600")

    def test_an_open_plan_room_is_only_wet_if_all_of_it_is(self):
        for name, wet in (("Kitchen", True), ("Toilet / Bath", True), ("Common T&B", True), ("Common / Toilet", True), ("Second Floor · Common / Toilet", True), ("Common", False), ("Balcony", True), ("Ground Floor · Laundry Area", True),
                          ("KITCHEN / DINING AREA / LIVING ROOM", False), ("Kitchen / Living / Dining / Toilet", False), ("Bedroom", False)):
            self.assertEqual(gen.is_wet_room(name), wet, name)

    def test_a_row_partly_picked_says_so_room_by_room(self):
        result = self.generate(ROOMS, [note("MATTE BLACK WALL PAINT FINISH")],
                               finishes=[{"room": "Fitting Room", "wall": "painted_wall"}])
        primer = next(r["source"] for r in result["rows"] if r["specification"] == "Primer")
        self.assertEqual(primer["kind"], "chosen")  # drawing + chosen → the weaker one
        self.assertEqual({x["room"]: x["kind"] for x in primer["rooms"]}, {"Sales Area": "drawing", "Fitting Room": "chosen"})
        # The paint named by the drawing stays its own row.
        self.assertEqual(self.source(result, "wall", "Sales Area")["kind"], "drawing")

    def test_past_projects_pick_between_matching_catalog_materials(self):
        history = finish_history.History(materials={5: 3})
        rows = self.generate(ROOMS[:1], [note("MATTE BLACK WALL PAINT FINISH")], history=history)["rows"]
        paint = next(r for r in rows if r["source"]["surface"] == "wall" and r["specification_from_drawing"])
        self.assertEqual(paint["material_id"], 5)
        self.assertEqual(paint["source"]["material_reason"], "Catalog material used in 3 past projects")

    def test_spec_from_note(self):
        self.assertEqual(gen.spec_from_note("600mmx600mm ACOUSTIC CEILING PANEL IN WHITE CH=2600mm"),
                         "600mmx600mm Acoustic Ceiling Panel in White")
        self.assertEqual(gen.spec_from_note('MDF FACADE ARCHITRAVE "DECATHLON BLUE" WALL PAINT FINISH'),
                         'MDF Facade Architrave "Decathlon Blue" Wall Paint Finish')


class WallArea(unittest.TestCase):
    ROOM = {"room": "Sales", "floor_area_sqm": 50.0, "perimeter_m": 32.0, "height_m": 4.0}
    PAINTED = [{"room": "Sales", "wall": "painted_wall"}]

    def wall(self, room, openings=None):
        rows = gen.generate([room], self.PAINTED, CATALOG, openings=openings, history=finish_history.History())["rows"]
        return next(r for r in rows if r["source"]["surface"] == "wall")

    def test_glass_is_left_out_and_says_so(self):
        row = self.wall(dict(self.ROOM, glass_length_m=9.0))
        self.assertEqual(row["boq_quantity"], 92.0)  # (32 − 9) × 4
        self.assertIn("9 m of glass wall left out", row["source"]["rooms"][0]["wall_note"])

    def test_the_height_note_is_passed_along(self):
        row = self.wall(dict(self.ROOM, height_note="painted up to the 4 m ceiling line"))
        self.assertIn("4 m ceiling line", row["source"]["rooms"][0]["wall_note"])

    def test_doors_and_windows_come_off_at_their_size_or_a_standard_one(self):
        row = self.wall(self.ROOM, [{"type": "door", "count": 2, "width_m": None, "height_m": None},
                                    {"type": "window", "count": 1, "width_m": 2.0, "height_m": 1.5}])
        self.assertEqual(row["boq_quantity"], 128 - (2 * 0.9 * 2.1 + 3.0))
        self.assertIn("6.78 sq.m of doors and windows", row["source"]["rooms"][0]["wall_note"])

    def test_openings_are_shared_between_rooms_by_wall_area(self):
        rooms = [self.ROOM, {"room": "Back", "floor_area_sqm": 10.0, "perimeter_m": 8.0, "height_m": 4.0}]
        finishes = [{"room": r["room"], "wall": "painted_gypsum"} for r in rooms]
        rows = gen.generate(rooms, finishes, CATALOG, openings=[{"type": "door", "count": 1, "width_m": 1.0, "height_m": 2.0}],
                            history=finish_history.History())["rows"]
        board = next(r for r in rows if r["specification"] == "Gypsum board")
        self.assertEqual(board["boq_quantity"], 158.0)  # 128 + 32 − 2, whichever room it's in
        self.assertAlmostEqual(gen._opening_shares(rooms, [{"type": "door", "count": 1, "width_m": 1.0, "height_m": 2.0}])["Back"], 0.4)

    def test_a_room_given_its_own_openings_keeps_them(self):
        row = self.wall(dict(self.ROOM, openings_sqm=6.0), [{"type": "door", "count": 5}])
        self.assertEqual(row["boq_quantity"], 122.0)


class HistoricalFinishes(unittest.TestCase):
    def test_projects_are_counted_once_and_a_board_beats_its_paint(self):
        rows = [
            {"project_id": 1, "work_item": "Ceiling", "material_id": 6, "material_name": "Gypsum Board 12mm"},
            {"project_id": 1, "work_item": "Ceiling", "material_id": 4, "material_name": "Paint - Flatwall Latex"},
            {"project_id": 1, "work_item": "Ceiling", "material_id": 6, "material_name": "Gypsum Board 12mm"},
            {"project_id": 2, "work_item": "Ceiling Works", "material_id": 4, "material_name": "Paint - Flatwall Latex"},
            {"project_id": 2, "work_item": "Floor Finish", "material_id": 1, "material_name": "Homogeneous Tile 600 x 600"},
        ]
        h = finish_history.build(rows, gen.load_templates())
        self.assertEqual(h.finishes["ceiling"], {"gypsum_ceiling": 1, "exposed_painted": 1})
        self.assertEqual(h.projects["ceiling"], 2)
        self.assertEqual(h.finishes["floor"], {"floor_tile_600": 1})
        self.assertEqual(h.materials, {6: 1, 4: 2, 1: 1})
        self.assertEqual(h.best_finish("ceiling")[1:], (1, 2))


class FinishNoteSuggestions(unittest.TestCase):
    def test_notes_preselect_templates(self):
        self.assertEqual(gen.suggest_finishes(["600x600mm FLOOR TILES", "GYPSUM BOARD CEILING"]),
                         {"floor": "floor_tile_600", "ceiling": "gypsum_ceiling"})


if __name__ == "__main__":
    unittest.main()
