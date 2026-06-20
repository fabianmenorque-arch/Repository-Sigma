"""
SIGMA - Catalog Service

Capa de servicios para consultar el catálogo de activos.
"""

from __future__ import annotations

from backend.models import Activo, Catalogo


class CatalogService:

    def __init__(self, catalogo: Catalogo):

        self._catalogo = catalogo

    def buscar_por_codigo(self, codigo: str) -> Activo | None:

        return self._catalogo.buscar_codigo(codigo)

    def buscar_por_maquina(self, maquina: str) -> Activo | None:

        return self._catalogo.buscar_maquina(maquina)

    def buscar_por_sector(self, sector: str) -> list[Activo]:

        return self._catalogo.buscar_sector(sector)

    @property
    def cantidad_activos(self) -> int:

        return self._catalogo.cantidad_activos

    @property
    def cantidad_repuestos(self) -> int:

        return self._catalogo.cantidad_repuestos
