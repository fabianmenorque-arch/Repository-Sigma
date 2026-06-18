"""
SIGMA - Asset Registry

Registro maestro de identidad de activos.

Este módulo es el único responsable de asignar y mantener:

- UUID permanente
- Código SIGMA
- Estado del activo
- Fechas de creación y última detección

No conoce Excel.
No conoce pandas.
No conoce el catálogo.
"""

from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from backend.config import REGISTRY_FILE


REGISTRY_VERSION = 1


# ---------------------------------------------------------------------
# Modelo
# ---------------------------------------------------------------------


@dataclass(slots=True)
class AssetIdentity:

    uuid: str

    codigo_sigma: str

    status: str

    created_at: str

    last_seen: str


# ---------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------


class AssetRegistry:

    def __init__(self):

        self._registry: dict = {}

        self._load()

    # -------------------------------------------------------------

    def _empty_registry(self) -> dict:

        return {

            "version": REGISTRY_VERSION,

            "last_update": "",

            "counters": {},

            "assets": {},

            "codigo_index": {}

        }

    # -------------------------------------------------------------

    def _load(self) -> None:

        if not REGISTRY_FILE.exists():

            self._registry = self._empty_registry()

            self.save()

            return

        with open(

            REGISTRY_FILE,

            "r",

            encoding="utf8"

        ) as fp:

            self._registry = json.load(fp)

    # -------------------------------------------------------------

    def save(self) -> None:

        REGISTRY_FILE.parent.mkdir(

            parents=True,

            exist_ok=True

        )

        if REGISTRY_FILE.exists():

            backup = REGISTRY_FILE.with_suffix(".bak")

            shutil.copy2(

                REGISTRY_FILE,

                backup

            )

        self._registry["last_update"] = (

            datetime.utcnow().isoformat()

        )

        with open(

            REGISTRY_FILE,

            "w",

            encoding="utf8"

        ) as fp:

            json.dump(

                self._registry,

                fp,

                indent=4,

                ensure_ascii=False

            )

    # -------------------------------------------------------------

    def exists(

        self,

        asset_key: str

    ) -> bool:

        return asset_key in self._registry["assets"]

    # -------------------------------------------------------------

    def find_by_key(

        self,

        asset_key: str

    ) -> Optional[AssetIdentity]:

        record = self._registry["assets"].get(asset_key)

        if record is None:

            return None

        return AssetIdentity(**record)

    # -------------------------------------------------------------

    def find_by_code(

        self,

        codigo: str

    ) -> Optional[AssetIdentity]:

        key = self._registry["codigo_index"].get(codigo)

        if key is None:

            return None

        return self.find_by_key(key)

    # -------------------------------------------------------------

    def register(

        self,

        asset_key: str,

        area_code: str

    ) -> AssetIdentity:

        existing = self.find_by_key(asset_key)

        if existing is not None:

            self.mark_seen(asset_key)

            return self.find_by_key(asset_key)

        counters = self._registry["counters"]

        next_number = counters.get(area_code, 0) + 1

        counters[area_code] = next_number

        codigo = f"{area_code}-{next_number:04d}"

        now = datetime.utcnow().isoformat()

        identity = AssetIdentity(

            uuid=str(uuid.uuid4()),

            codigo_sigma=codigo,

            status="ACTIVE",

            created_at=now,

            last_seen=now

        )

        self._registry["assets"][asset_key] = asdict(identity)

        self._registry["codigo_index"][codigo] = asset_key

        return identity

    # -------------------------------------------------------------

    def mark_seen(

        self,

        asset_key: str

    ) -> None:

        if asset_key not in self._registry["assets"]:

            return

        self._registry["assets"][asset_key]["last_seen"] = (

            datetime.utcnow().isoformat()

        )

    # -------------------------------------------------------------

    def retire(

        self,

        asset_key: str

    ) -> None:

        if asset_key not in self._registry["assets"]:

            return

        self._registry["assets"][asset_key]["status"] = "RETIRED"

    # -------------------------------------------------------------

    def stats(self) -> Dict[str, int]:

        return {

            "assets": len(

                self._registry["assets"]

            ),

            "codes": len(

                self._registry["codigo_index"]

            )

        }
