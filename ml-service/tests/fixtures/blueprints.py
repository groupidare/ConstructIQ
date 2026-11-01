"""Self-made blueprint fixtures with KNOWN answers: a tiny hand-written
vector-PDF writer (no extra dependency) and DXFs built with ezdxf.

Plan used throughout, at 1:50 (1 m real = 20 mm paper = 56.693 pt):
    OFFICE  5 m × 4 m = 20 m²   |  STORAGE 3 m × 4 m = 12 m²
    walls on centre lines, a 0.9 m door between the rooms (with a swing arc),
    gross footprint 8 m × 4 m = 32 m² ("TOTAL AREA : 32.00 SQM." on the sheet).
"""
from __future__ import annotations

from pathlib import Path

PT_PER_M_AT_50 = 1000 / 50 / 25.4 * 72   # 56.6929…
A3 = (1190.0, 842.0)
_K = 0.5523  # quarter-circle bezier constant


class PdfPage:
    def __init__(self, size=A3):
        self.width, self.height = size
        self.ops: list[str] = []

    def line(self, x0, y0, x1, y1, width=1.0, rgb=(0, 0, 0)):
        self.ops.append(f"{width} w {rgb[0]} {rgb[1]} {rgb[2]} RG {x0:.3f} {y0:.3f} m {x1:.3f} {y1:.3f} l S")

    def arc(self, cx, cy, r, width=0.3):
        """Quarter circle (door swing) from (cx+r, cy) to (cx, cy+r)."""
        self.ops.append(f"{width} w 0 0 0 RG {cx + r:.3f} {cy:.3f} m {cx + r:.3f} {cy + _K * r:.3f} "
                        f"{cx + _K * r:.3f} {cy + r:.3f} {cx:.3f} {cy + r:.3f} c S")

    def text(self, x, y, size, s, rotate=False):
        s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        m = f"0 1 -1 0 {x:.3f} {y:.3f}" if rotate else f"1 0 0 1 {x:.3f} {y:.3f}"
        self.ops.append(f"BT /F1 {size} Tf {m} Tm ({s}) Tj ET")


def write_pdf(path: Path, pages: list[PdfPage]) -> Path:
    objects: list[bytes] = []
    kids = []
    font_id = 3
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"")  # pages, filled below
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for page in pages:
        content = "\n".join(page.ops).encode("latin-1")
        objects.append(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        content_id = len(objects)
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page.width} {page.height}] "
                       f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode())
        kids.append(len(objects))
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))
    return path


def draw_two_room_plan(page: PdfPage, ox: float, oy: float, scale: int = 50, wall_width=2.0,
                       rotated_storage_label=False, door_arc=True, hatch=False):
    """The OFFICE/STORAGE plan with its bottom-left corner at (ox, oy) pt."""
    u = 1000 / scale / 25.4 * 72  # pt per real metre
    X = lambda m: ox + m * u
    Y = lambda m: oy + m * u
    for x0, y0, x1, y1 in [(0, 0, 8, 0), (8, 0, 8, 4), (8, 4, 0, 4), (0, 4, 0, 0)]:
        page.line(X(x0), Y(y0), X(x1), Y(y1), wall_width)
    # partition at x=5 with a 0.9 m door opening from y=1.5 to y=2.4
    page.line(X(5), Y(0), X(5), Y(1.5), wall_width)
    page.line(X(5), Y(2.4), X(5), Y(4), wall_width)
    if door_arc:
        page.arc(X(5), Y(1.5), 0.9 * u)
    if hatch:  # 45° floor hatch in the office, thin pen — must be ignored
        for i in range(260):
            d = 0.03 * i
            page.line(X(0.1 + d * 0.5), Y(0.1), X(0.1 + d * 0.5 + 0.2), Y(0.3), 0.2, (0.5, 0.6, 1))
    page.text(X(2.1), Y(2.0), 10, "OFFICE")
    if rotated_storage_label:
        page.text(X(6.6), Y(1.4), 10, "STORAGE", rotate=True)
    else:
        page.text(X(5.9), Y(2.0), 10, "STORAGE")
    page.text(X(3.8), Y(-0.4), 6, "8000")
    page.text(X(-0.5), Y(1.9), 6, "4000")


def sheet_with_two_drawings(path: Path, missing_scale=False) -> Path:
    page = PdfPage()
    # Each drawing's region runs to the midpoint between neighbouring titles,
    # so the 453 pt-wide 1:50 plan sits left of x≈565.
    draw_two_room_plan(page, 40, 420, hatch=True, rotated_storage_label=True)
    page.text(250, 380, 18, "GROUND FLOOR PLAN")
    if not missing_scale:
        page.text(252, 362, 7, "SCALE 1:50")
    # second drawing: the same rooms at 1:100, to the right
    draw_two_room_plan(page, 610, 520, scale=100, door_arc=False)
    page.text(650, 380, 18, "REFLECTED CEILING PLAN")
    page.text(652, 362, 7, "SCALE 1:100")
    page.text(640, 560, 7, "CH = 2700mm")
    page.text(640, 548, 7, "600x600mm FLOOR TILES")
    # title block
    page.text(1000, 200, 8, "TOTAL AREA : 32.00 SQM.")
    page.text(1010, 120, 14, "AS-BUILT PLANS")
    page.text(1030, 70, 30, "A-1")
    # an MEP sheet that must be skipped
    mep = PdfPage()
    for i in range(60):
        mep.line(100 + i * 5, 100, 100 + i * 5, 300)
    mep.text(200, 380, 18, "LIGHTING LAYOUT")
    mep.text(1030, 70, 30, "E-1")
    return write_pdf(path, [page, mep])


def scanned_pdf(path: Path) -> Path:
    page = PdfPage()
    page.text(100, 400, 18, "GROUND FLOOR PLAN")  # text only, no vectors
    page.text(1030, 70, 30, "A-1")
    return write_pdf(path, [page])


def dxf_two_rooms(path: Path, room_outlines=False) -> Path:
    import ezdxf

    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()
    for name in ("A-WALL", "A-DOOR", "A-ROOM-TAG", "A-AREA", "A-ANNO"):
        doc.layers.add(name)
    mm = lambda pts: [(x * 1000, y * 1000) for x, y in pts]
    for a, b in [((0, 0), (8, 0)), ((8, 0), (8, 4)), ((8, 4), (0, 4)), ((0, 4), (0, 0)),
                 ((5, 0), (5, 1.5)), ((5, 2.4), (5, 4))]:
        msp.add_line(*mm([a, b]), dxfattribs={"layer": "A-WALL"})
    door = doc.blocks.new("DOOR-900")
    door.add_line((0, 0), (900, 0))
    door.add_arc((0, 0), 900, 0, 90)
    msp.add_blockref("DOOR-900", (5000, 1500), dxfattribs={"layer": "A-DOOR"})
    msp.add_text("OFFICE", height=250, dxfattribs={"layer": "A-ROOM-TAG", "insert": (2100, 2000)})
    msp.add_text("STORAGE", height=250, dxfattribs={"layer": "A-ROOM-TAG", "insert": (5900, 2000)})
    msp.add_text("TOTAL AREA : 32.00 SQM.", height=150, dxfattribs={"layer": "A-ANNO", "insert": (9000, 0)})
    msp.add_text("CH = 2700mm", height=150, dxfattribs={"layer": "A-ANNO", "insert": (9000, 500)})
    if room_outlines:
        msp.add_lwpolyline(mm([(0, 0), (5, 0), (5, 4), (0, 4)]), close=True, dxfattribs={"layer": "A-AREA"})
        msp.add_lwpolyline(mm([(5, 0), (8, 0), (8, 4), (5, 4)]), close=True, dxfattribs={"layer": "A-AREA"})
    doc.saveas(path)
    return path
