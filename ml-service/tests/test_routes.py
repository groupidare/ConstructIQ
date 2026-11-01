"""The new ML routes over HTTP (FastAPI TestClient), including the API-key
guard. Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from tests.fixtures import blueprints


class NewRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = blueprints.sheet_with_two_drawings(Path(cls.tmp.name) / "plans.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_parse_blueprint_upload(self):
        with open(self.pdf, "rb") as f:
            r = self.client.post("/documents/parse-blueprint", files={"file": ("plans.pdf", f, "application/pdf")},
                                 data={"drawing_id": "A-1:A"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["selected_drawing"], "A-1:A")
        self.assertEqual({room["name"] for room in body["rooms"]}, {"OFFICE", "STORAGE"})

    def test_corrupt_file_is_an_error_not_a_500(self):
        r = self.client.post("/documents/parse-blueprint", files={"file": ("broken.pdf", b"not a pdf", "application/pdf")})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["errors"])

    def test_templates_generate_and_baseline(self):
        templates = self.client.get("/boq/templates").json()["templates"]
        self.assertIn("floor_tile_600", {t["key"] for t in templates})

        r = self.client.post("/boq/generate", json={
            "measurements": [{"room": "Office", "floor_area_sqm": 20, "perimeter_m": 18, "height_m": 2.7}],
            "finishes": [{"room": "Office", "floor": "vinyl_floor"}],
            "materials": [{"id": 9, "name": "Vinyl Tile (2mm thick)", "unit": "sq.m"}],
            "source": "A-1:A",
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["rows"][0]["material_id"], 9)

        r = self.client.post("/estimation/baseline", json={"items": [{
            "material": {"unit": "pcs", "calculation_type": "Length", "unit_length_m": 6}, "boq_unit": "l.m", "boq_quantity": 204}]})
        self.assertEqual(r.json()["results"][0]["baseline_quantity"], 34)

    def test_api_key_is_enforced_when_configured(self):
        # auth.py reads ML_API_KEY once at import time.
        with patch("app.utils.auth._EXPECTED_KEY", "secret"):
            self.assertIn(self.client.get("/boq/templates").status_code, (401, 403))
            self.assertEqual(self.client.get("/boq/templates", headers={"X-API-Key": "secret"}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
