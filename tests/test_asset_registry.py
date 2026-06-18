from pathlib import Path

import pytest

from backend.asset_registry import AssetRegistry


@pytest.fixture
def temp_registry(tmp_path, monkeypatch):

    registry_file = tmp_path / "asset_registry.json"

    monkeypatch.setattr(
        "backend.asset_registry.REGISTRY_FILE",
        registry_file
    )

    return AssetRegistry()


def test_create_new_asset(temp_registry):

    identity = temp_registry.register(

        asset_key="TRAPICHE|MOLINOS|MOLINO 1|FCB",

        area_code="TRA"

    )

    assert identity.codigo_sigma == "TRA-0001"

    assert identity.status == "ACTIVE"

    assert identity.uuid is not None


def test_same_asset_not_duplicated(temp_registry):

    first = temp_registry.register(

        "TRAPICHE|MOLINOS|MOLINO 1|FCB",

        "TRA"

    )

    second = temp_registry.register(

        "TRAPICHE|MOLINOS|MOLINO 1|FCB",

        "TRA"

    )

    assert first.uuid == second.uuid

    assert first.codigo_sigma == second.codigo_sigma

    assert temp_registry.stats()["assets"] == 1


def test_find_by_key(temp_registry):

    temp_registry.register(

        "KEY",

        "TRA"

    )

    identity = temp_registry.find_by_key("KEY")

    assert identity is not None

    assert identity.codigo_sigma == "TRA-0001"


def test_find_by_code(temp_registry):

    created = temp_registry.register(

        "KEY",

        "TRA"

    )

    identity = temp_registry.find_by_code(

        created.codigo_sigma

    )

    assert identity is not None

    assert identity.uuid == created.uuid


def test_retire_asset(temp_registry):

    temp_registry.register(

        "KEY",

        "TRA"

    )

    temp_registry.retire("KEY")

    identity = temp_registry.find_by_key("KEY")

    assert identity.status == "RETIRED"


def test_save_and_reload(temp_registry):

    created = temp_registry.register(

        "KEY",

        "TRA"

    )

    temp_registry.save()

    new_registry = AssetRegistry()

    loaded = new_registry.find_by_key("KEY")

    assert loaded is not None

    assert loaded.uuid == created.uuid

    assert loaded.codigo_sigma == created.codigo_sigma


def test_stats(temp_registry):

    temp_registry.register(

        "A",

        "TRA"

    )

    temp_registry.register(

        "B",

        "CAL"

    )

    stats = temp_registry.stats()

    assert stats["assets"] == 2

    assert stats["codes"] == 2
