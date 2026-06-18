from backend.normalizer import (
    clean_string,
    generate_asset_key,
    normalize_sector,
    normalize_text,
    safe_float,
)


def test_clean_string():

    assert clean_string("  Molino   1 ") == "Molino 1"


def test_normalize_text():

    assert normalize_text(" Fábrica ") == "FABRICA"


def test_sector():

    assert normalize_sector("Usina") == "GEN"


def test_float():

    assert safe_float(None) == 0.0

    assert safe_float("15") == 15.0


def test_asset_key():

    key = generate_asset_key(

        "Trapiche",

        "Molinos",

        "Molino 1",

        "FCB"

    )

    assert key == "TRAPICHE|MOLINOS|MOLINO 1|FCB"
