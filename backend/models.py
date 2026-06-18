from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(slots=True)
class Repuesto:
    """
    Representa un repuesto perteneciente a un activo.
    """

    descripcion: str
    marca: Optional[str] = None
    designacion: Optional[str] = None
    cantidad_equipo: float = 0.0
    cantidad_compra: float = 0.0


@dataclass(slots=True)
class Activo:
    """
    Representa un activo físico del ingenio.
    """

    uuid: str
    codigo_sigma: str
    activo_key: str

    sector: str
    ubicacion: str
    maquina: str
    modelo: str

    repuestos: list[Repuesto] = field(default_factory=list)

    @property
    def cantidad_repuestos(self) -> int:
        return len(self.repuestos)

    def agregar_repuesto(self, repuesto: Repuesto) -> None:
        self.repuestos.append(repuesto)


@dataclass(slots=True)
class Catalogo:
    """
    Contenedor principal del catálogo de activos.
    """

    activos: dict[str, Activo] = field(default_factory=dict)

    indice_codigo: dict[str, str] = field(default_factory=dict)
    indice_maquina: dict[str, str] = field(default_factory=dict)
    indice_sector: dict[str, list[str]] = field(default_factory=dict)

    def agregar(self, activo: Activo) -> None:

        self.activos[activo.uuid] = activo

        self.indice_codigo[activo.codigo_sigma] = activo.uuid

        self.indice_maquina[
            activo.maquina.upper()
        ] = activo.uuid

        self.indice_sector.setdefault(
            activo.sector.upper(),
            []
        ).append(activo.uuid)

    def buscar_codigo(
        self,
        codigo: str
    ) -> Optional[Activo]:

        uuid = self.indice_codigo.get(codigo)

        if uuid is None:
            return None

        return self.activos[uuid]

    def buscar_maquina(
        self,
        maquina: str
    ) -> Optional[Activo]:

        uuid = self.indice_maquina.get(
            maquina.upper()
        )

        if uuid is None:
            return None

        return self.activos[uuid]

    def buscar_sector(
        self,
        sector: str
    ) -> list[Activo]:

        uuids = self.indice_sector.get(
            sector.upper(),
            []
        )

        return [
            self.activos[uuid]
            for uuid in uuids
        ]

    @property
    def cantidad_activos(self) -> int:

        return len(self.activos)

    @property
    def cantidad_repuestos(self) -> int:

        return sum(
            activo.cantidad_repuestos
            for activo in self.activos.values()
        )
