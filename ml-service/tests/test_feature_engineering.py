"""
Primary section encoding: a scanned BOQ's own label must encode the same as
the plan's section name, so showing the label doesn't change a forecast.
"""
import pytest

from app.ml.feature_engineering import build_feature_vector


def encoded(section):
    return build_feature_vector({"primary_section": section})["primary_section_encoded"]


@pytest.mark.parametrize("label, name", [
    ("1. ARCHITECTURAL WORKS", "Architectural Works"),
    ("5. ELECTRICAL WORKS", "Electrical Works"),
    ("III. ELECTRICAL WORKS", "Electrical Works"),
    ("6. MECHANICAL WORKS", "Mechanical Works"),
    ("8. FIRE PROTECTION WORKS", "Fire Protection Works"),
    ("9. FIRE DETECTION AND ALARM SYSTEM", "Fire Detection & Alarm System Works"),
])
def test_boq_label_encodes_like_the_section_name(label, name):
    assert encoded(label) == encoded(name) > 0


def test_every_section_name_keeps_its_own_code():
    names = ["Architectural Works", "Electrical Works", "Fire Detection & Alarm System Works",
             "Mechanical Works", "Fire Protection Works", "Special Fabrication Works", "Others"]
    assert [encoded(n) for n in names] == [1, 2, 3, 4, 5, 6, 7]


@pytest.mark.parametrize("section", ["2. STRUCTURAL WORKS", "", None])
def test_other_sections_stay_unrecognized(section):
    assert encoded(section) == 0
