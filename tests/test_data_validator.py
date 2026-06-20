import pandas as pd
import pytest

from backend.data_validator import DataValidator


def dataframe_base():

    return pd.DataFrame(
        [
            {
                "Sector": "Trapiche",
                "Ubicación": "Nivel 1",
                "Maquina": "Molino 1",
                "Modelo": "Fulton",
                "Repuesto": "Rodamiento",
                "Marca": "SKF",
                "Designacion": "6312",
                "Cant. Unit.": 2,
                "Cant. Compra": 4,
            }
        ]
    )


def test_dataframe_valido():

    validator = DataValidator()

    issues = validator.validate(dataframe_base())

    assert issues == []


def test_sector_desconocido():

    dataframe = dataframe_base()

    dataframe.loc[0, "Sector"] = "Sector Inventado"

    validator = DataValidator()

    issues = validator.validate(dataframe)

    assert len(issues) == 1

    assert issues[0].campo == "Sector"


def test_campo_obligatorio_vacio():

    dataframe = dataframe_base()

    dataframe.loc[0, "Maquina"] = ""

    validator = DataValidator()

    issues = validator.validate(dataframe)

    assert len(issues) == 1

    assert issues[0].campo == "Maquina"


def test_cantidad_negativa():

    dataframe = dataframe_base()

    dataframe.loc[0, "Cant. Unit."] = -3

    validator = DataValidator()

    issues = validator.validate(dataframe)

    assert len(issues) == 1

    assert issues[0].campo == "Cant. Unit."


def test_fila_duplicada():

    dataframe = pd.concat(
        [
            dataframe_base(),
            dataframe_base()
        ],
        ignore_index=True
    )

    validator = DataValidator()

    issues = validator.validate(dataframe)

    assert len(issues) == 1

    assert issues[0].campo == "Fila"
