"""Azure Document Intelligence client against a fake Azure (httpx
MockTransport) — never the real service, so tests cost no pages: the
submit-then-poll flow, the disk cache, the monthly page cap, the fallback
when unconfigured, and turning results into tables and plan words.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx
from PIL import Image

from app.services import azure_document as az
from app.services import blueprint_ocr

REAL_CLIENT = httpx.Client  # kept before tests patch httpx.Client
ENV = {"AZURE_DI_ENDPOINT": "https://fake.cognitiveservices.azure.com/", "AZURE_DI_KEY": "test-key"}
RESULT = {"pages": [{"width": 100, "height": 50, "lines": [{"content": "TOTAL"}], "words": []}],
          "tables": [{"rowCount": 2, "columnCount": 3, "cells": [
              {"rowIndex": 0, "columnIndex": 0, "content": "DESCRIPTION"},
              {"rowIndex": 0, "columnIndex": 1, "content": "UNIT"},
              {"rowIndex": 0, "columnIndex": 2, "content": "QTY"},
              {"rowIndex": 1, "columnIndex": 0, "columnSpan": 2, "content": "CHB 4\""},
              {"rowIndex": 1, "columnIndex": 2, "content": "120"}]}]}


class FakeAzure:
    def __init__(self, polls_before_done=1):
        self.posts = 0
        self.polls_left = polls_before_done

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Ocp-Apim-Subscription-Key"] == "test-key"
        if request.method == "POST":
            self.posts += 1
            return httpx.Response(202, headers={"Operation-Location": "https://fake/op/1", "Retry-After": "0"})
        if self.polls_left:
            self.polls_left -= 1
            return httpx.Response(200, json={"status": "running"}, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"status": "succeeded", "analyzeResult": RESULT})

    def client(self, **kwargs):
        return REAL_CLIENT(transport=httpx.MockTransport(self.handler))


class AzureClient(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(az, "_CACHE_DIR", Path(self.tmp.name)), mock.patch.dict("os.environ", ENV)]
        for p in self.patches:
            p.start()
        self.fake = FakeAzure()
        self.patches.append(mock.patch.object(az.httpx, "Client", self.fake.client))
        self.patches[-1].start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_submits_polls_and_caches(self):
        self.assertEqual(az.analyze_image(b"page-1"), RESULT)
        self.assertEqual(az.analyze_image(b"page-1"), RESULT)  # from the disk cache
        self.assertEqual(self.fake.posts, 1)
        self.assertEqual(az.pages_used_this_month(), 1)

    def test_monthly_cap_stops_calls(self):
        with mock.patch.dict("os.environ", {"AZURE_MAX_PAGES_PER_MONTH": "1"}):
            az.analyze_image(b"page-1")
            with self.assertRaises(az.AzureUnavailable):
                az.analyze_image(b"page-2")
        self.assertEqual(self.fake.posts, 1)

    def test_refused_request_is_unavailable_not_a_crash(self):
        with mock.patch.object(az.httpx, "Client", lambda **k: REAL_CLIENT(
                transport=httpx.MockTransport(lambda r: httpx.Response(401)))):
            with self.assertRaises(az.AzureUnavailable):
                az.analyze_image(b"page-9")
        self.assertEqual(az.pages_used_this_month(), 0)  # refused pages aren't counted


class NotConfigured(unittest.TestCase):
    def test_off_without_settings(self):
        with mock.patch.dict("os.environ", {"AZURE_DI_ENDPOINT": "", "AZURE_DI_KEY": ""}):
            self.assertFalse(az.enabled())
            with self.assertRaises(az.AzureUnavailable):
                az.analyze_image(b"x")


class Conversions(unittest.TestCase):
    def test_merged_cell_text_stays_in_its_first_cell(self):
        self.assertEqual(az.tables_from(RESULT), [[["DESCRIPTION", "UNIT", "QTY"], ['CHB 4"', None, "120"]]])
        self.assertEqual(az.page_text(RESULT), "TOTAL")

    def test_plan_words_scaled_back_to_points_and_vertical_text_dropped(self):
        image = Image.new("L", (200, 100), 255)
        # Azure saw a half-size image (shrunk to fit) — its pixels are 2 of ours.
        result = {"pages": [{"width": 100, "height": 50, "words": [
            {"content": "BEDROOM", "confidence": 0.99, "polygon": [10, 10, 30, 10, 30, 13, 10, 13]},
            {"content": "4850", "confidence": 0.99, "polygon": [50, 40, 50, 20, 53, 20, 53, 40]}]}]}
        with mock.patch.object(az, "analyze_image", return_value=result):
            words = blueprint_ocr._azure_words(image, 0.5, [])
        self.assertEqual([w["text"] for w in words], ["BEDROOM"])
        self.assertEqual((words[0]["x0"], words[0]["x1"], words[0]["top"]), (10.0, 30.0, 10.0))


if __name__ == "__main__":
    unittest.main()
