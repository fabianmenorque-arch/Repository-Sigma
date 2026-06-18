import pandas as pd

from backend.asset_registry import AssetRegistry
from backend.catalog import CatalogBuilder


def test_catalog_builder(tmp_path, monkeypatch):

    monkeypatch.setattr(
        "backend.asset_registry.REGISTRY_FILE",
        tmp_path / "registry.json",
    )

    dataframe = pd.DataFrame(
        [
            {
                "Sector": "Trapiche",
                "Ubicación": "Molinos",
                "Maquina": "Molino 1",
                "Modelo": "FCB",
                "Repuesto": "Rodamiento",
                "Marca": "SKF",
                "Designacion": "22220",
                "Cant. Unit.": 2,
                "Cant. Compra": 4,
            },
            {
                "Sector": "Trapiche",
                "Ubicación": "Molinos",
                "Maquina": "Molino 1",
                "Modelo": "FCB",
                "Repuesto": "Retén",
                "Marca": "SKF",
                "Designacion": "R-20",
                "Cant. Unit.": 1,
                "Cant. Compra": 2,
            },
        ]
    )

    registry = AssetRegistry()

    builder = CatalogBuilder(registry)

    catalogo = builder.build(dataframe)

    assert catalogo.cantidad_activos == 1

    activo = catalogo.buscar_codigo("TRA-0001")

    assert activo is not None

    assert activo.cantidad_repuestos == 2
