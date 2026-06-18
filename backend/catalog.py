"""
SIGMA - Catalog Builder

Construye el catálogo de activos a partir del DataFrame leído desde Excel.
"""

from __future__ import annotations

import pandas as pd

from backend.asset_registry import AssetRegistry
from backend.models import Activo, Catalogo, Repuesto
from backend.normalizer import (
    generate_asset_key,
    normalize_sector,
    safe_float,
)


class CatalogBuilder:

    def __init__(self, registry: AssetRegistry):

        self.registry = registry

    def build(self, dataframe: pd.DataFrame) -> Catalogo:

        catalogo = Catalogo()

        activos = {}

        for _, row in dataframe.iterrows():

            asset_key = generate_asset_key(
                row["Sector"],
                row["Ubicación"],
                row["Maquina"],
                row["Modelo"],
            )

            if asset_key not in activos:

                identity = self.registry.register(
                    asset_key,
                    normalize_sector(row["Sector"]),
                )

                activos[asset_key] = Activo(
                    uuid=identity.uuid,
                    codigo_sigma=identity.codigo_sigma,
                    activo_key=asset_key,
                    sector=row["Sector"],
                    ubicacion=row["Ubicación"],
                    maquina=row["Maquina"],
                    modelo=row["Modelo"],
                )

            repuesto = Repuesto(
                descripcion=row["Repuesto"],
                marca=row["Marca"],
                designacion=row["Designacion"],
                cantidad_equipo=safe_float(row["Cant. Unit."]),
                cantidad_compra=safe_float(row["Cant. Compra"]),
            )

            activos[asset_key].agregar_repuesto(repuesto)

        for activo in activos.values():

            catalogo.agregar(activo)

        self.registry.save()

        return catalogo
