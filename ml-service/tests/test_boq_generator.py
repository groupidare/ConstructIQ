"""BOQ generation: template expansion per basis, aggregation across rooms,
catalog matching by name, and baselines on generated rows.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import unittest

from app.services import boq_generator_service as gen

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


def by_spec(result):
    return {r["specification"]: r for r in result["rows"]}


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
        rows = by_spec(gen.generate(ROOMS[:1], [{"room": "Sales Area", "wall": "painted_gypsum"}], CATALOG))
        self.assertEqual(rows["Gypsum board"]["boq_quantity"], 84.0)  # 30 × 3 − 6
        # paint with properties beats the sq.m assembly row of the same name
        self.assertEqual(rows["Paint"]["material_id"], 4)

    def test_partition_counts_both_faces(self):
        catalog = CATALOG + [{"id": 8, "name": "Fiber Cement Board", "unit": "sq.m"}]
        rows = by_spec(gen.generate(ROOMS[:1], [{"room": "Sales Area", "wall": "fiber_cement_partition"}], catalog))
        self.assertEqual(rows["Fiber cement board"]["boq_quantity"], 168.0)

    def test_ceiling_and_door_count(self):
        result = gen.generate(ROOMS[:1], [{"room": "Sales Area", "ceiling": "gypsum_ceiling"}], CATALOG,
                              openings=[{"type": "door", "count": 2}])
        rows = by_spec(result)
        self.assertEqual(rows["Gypsum board"]["boq_quantity"], 50.0)
        self.assertEqual(rows["Door"]["boq_quantity"], 2)
        self.assertEqual(rows["Door"]["material_id"], 7)

    def test_missing_height_skips_wall_rows_with_a_warning(self):
        room = dict(ROOMS[0], height_m=None)
        result = gen.generate([room], [{"room": "Sales Area", "wall": "painted_gypsum"}], CATALOG)
        self.assertEqual(result["rows"], [])
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


class FinishNoteSuggestions(unittest.TestCase):
    def test_notes_preselect_templates(self):
        self.assertEqual(gen.suggest_finishes(["600x600mm FLOOR TILES", "GYPSUM BOARD CEILING"]),
                         {"floor": "floor_tile_600", "ceiling": "gypsum_ceiling"})


if __name__ == "__main__":
    unittest.main()
