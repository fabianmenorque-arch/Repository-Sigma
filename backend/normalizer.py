"""
Funciones de normalización utilizadas por todo el proyecto SIGMA.
"""

from __future__ import annotations

import math
import re
import unicodedata


# ------------------------------------------------------------------
# Texto
# ------------------------------------------------------------------

def clean_string(value) -> str:
    """
    Convierte cualquier valor en texto limpio.
    """

    if value is None:
        return ""

    if isinstance(value, float):

        if math.isnan(value):
            return ""

    text = str(value)

    text = text.strip()

    text = re.sub(r"\s+", " ", text)

    return text


def normalize_text(value) -> str:
    """
    Convierte un texto en mayúsculas, sin acentos y sin espacios dobles.
    """

    text = clean_string(value)

    text = unicodedata.normalize("NFKD", text)

    text = text.encode("ascii", "ignore").decode("utf-8")

    return text.upper()


# ------------------------------------------------------------------
# Sectores
# ------------------------------------------------------------------

_AREA_MAP = {
    "CANCHON": "CAN",
    "TRAPICHE": "TRA",
    "FABRICA": "FAB",
    "CALDERA": "CAL",
    "USINA": "GEN",
}


def normalize_sector(value: str) -> str:
    """
    Devuelve el código SIGMA del sector.
    """

    key = normalize_text(value)

    if key not in _AREA_MAP:

        raise ValueError(
            f"Sector desconocido: {value}"
        )

    return _AREA_MAP[key]


# ------------------------------------------------------------------
# Números
# ------------------------------------------------------------------

def safe_float(value) -> float:

    if value is None:
        return 0.0

    try:

        if math.isnan(value):

            return 0.0

    except TypeError:

        pass

    try:

        return float(value)

    except Exception:

        return 0.0


# ------------------------------------------------------------------
# ActivoKey
# ------------------------------------------------------------------

def generate_asset_key(
    sector,
    ubicacion,
    maquina,
    modelo,
) -> str:
    """
    Genera una clave única para un activo.
    """

    return "|".join(

        (
            normalize_text(sector),
            normalize_text(ubicacion),
            normalize_text(maquina),
            normalize_text(modelo),
        )

    )
