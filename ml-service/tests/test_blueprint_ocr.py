"""Plans whose text is drawn as lines: OCR word grouping, the scale measured
from dimension strings (plotted-to-fit PDFs), and grid bubbles not counted
as doors. Tesseract itself isn't needed — these cover what is done with its
words.

Run from ml-service/:  python -m unittest discover -s tests -t .
"""
import unittest

from app.services import blueprint_ocr
from app.services import blueprint_parser_service as bp


def word(text, x0, top, width, height=3.0):
    return {"text": text, "x0": x0, "top": top, "x1": x0 + width, "bottom": top + height,
            "size": height / blueprint_ocr.CAP_HEIGHT}


class OcrLines(unittest.TestCase):
    def test_scale_with_dropped_colon_is_rebuilt(self):
        # "60" sits a fraction higher than the "1" — still one line, read left to right
        lines = blueprint_ocr._lines([word("60", 343.2, 659.5, 4.6), word("1", 334.6, 659.8, 0.9)])
        self.assertEqual([l[0] for l in lines], ["1:60"])

    def test_a_one_beside_an_odd_number_is_not_a_scale(self):
        self.assertEqual(blueprint_ocr._normalise("1 3525"), "1 3525")
        self.assertEqual(blueprint_ocr._normalise("SCALE: 1 100"), "1:100")

    def test_words_of_a_title_join_and_distant_words_do_not(self):
        lines = blueprint_ocr._lines([word("GROUND", 236, 647, 40, 7.6), word("FLOOR", 284, 647, 30, 7.6),
                                      word("PLAN", 319, 647, 24, 7.6), word("SECOND", 826, 647, 40, 7.6)])
        self.assertEqual(sorted(l[0] for l in lines), ["GROUND FLOOR PLAN", "SECOND"])


def dimension(value_mm, x0, y, scale):
    """A horizontal dimension: the number above a line with two extension lines."""
    length = value_mm / 1000 / (bp.PT_TO_M * scale)
    cx = x0 + length / 2
    text = bp.TextLine(str(value_mm), cx - 8, y - 6, cx + 8, y - 2, 5.0)
    objs = [{"object_type": "line", "x0": x0 - 3, "x1": x0 + length + 3, "top": y, "bottom": y},
            {"object_type": "line", "x0": x0, "x1": x0, "top": y - 4, "bottom": y + 4},
            {"object_type": "line", "x0": x0 + length, "x1": x0 + length, "top": y - 4, "bottom": y + 4}]
    return text, objs


class ScaleFromDimensions(unittest.TestCase):
    def build(self, dims):
        texts, objs = [], []
        for d in dims:
            t, o = dimension(*d)
            texts.append(t)
            objs += o
        return texts, objs

    def test_measures_between_extension_lines(self):
        texts, objs = self.build([(3000, 50, 100, 96), (11000, 50, 140, 96), (1500, 200, 100, 96)])
        self.assertEqual(bp._scale_from_dimensions(texts, objs), 96.0)

    def test_a_misread_value_is_outvoted(self):
        texts, objs = self.build([(3000, 50, 100, 96), (11000, 50, 140, 96), (1500, 200, 100, 96), (2000, 300, 100, 96)])
        texts[0].text = "5000"  # OCR read 3000 as 5000
        self.assertEqual(bp._scale_from_dimensions(texts, objs), 96.0)

    def test_too_few_dimensions_give_no_scale(self):
        texts, objs = self.build([(3000, 50, 100, 96), (1500, 200, 100, 96)])
        self.assertIsNone(bp._scale_from_dimensions(texts, objs))


class TitlesWithoutSpaces(unittest.TestCase):
    def test_spaces_put_back_in_joined_titles(self):
        self.assertEqual(bp._spaced_title("GROUNDFLOORPLAN"), "GROUND FLOOR PLAN")
        self.assertEqual(bp._spaced_title("RIGHTSIDEELEVATION"), "RIGHT SIDE ELEVATION")
        self.assertEqual(bp._spaced_title("ROOFPLAN"), "ROOF PLAN")
        self.assertEqual(bp._spaced_title("SECOND FLOOR PLAN"), "SECOND FLOOR PLAN")

    def test_joined_title_still_counts_as_a_drawing(self):
        self.assertTrue(bp._DRAWING_WORDS.search("GROUNDFLOORPLAN"))


class RenderLock(unittest.TestCase):
    def test_renders_run_one_at_a_time(self):
        import threading
        from app.utils import pdf_render
        active, peak = [0], [0]

        class Page:
            def to_image(self, resolution):
                active[0] += 1
                peak[0] = max(peak[0], active[0])
                threading.Event().wait(0.02)
                active[0] -= 1
                return type("Img", (), {"original": None})()

        threads = [threading.Thread(target=pdf_render.page_image, args=(Page(), 72)) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(peak[0], 1)


class DoorArcs(unittest.TestCase):
    def test_closed_circle_is_not_a_door(self):
        m_per_pt = bp.PT_TO_M * 50
        side = 0.9 / m_per_pt
        quarter = {"x0": 0, "x1": side, "top": 0, "bottom": side, "pts": [(side, 0), (side * 0.7, side * 0.7), (0, side)]}
        circle = {"x0": 100, "x1": 100 + side, "top": 0, "bottom": side,
                  "pts": [(100 + side, side / 2), (100 + side / 2, 0), (100, side / 2), (100 + side / 2, side), (100 + side, side / 2)]}
        self.assertEqual(bp._doors_from_arcs([quarter, circle], m_per_pt), [0.9])


if __name__ == "__main__":
    unittest.main()
