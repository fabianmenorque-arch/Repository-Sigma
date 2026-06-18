"""
SIGMA - Excel Reader

Responsabilidad:
    Leer la base de datos de activos desde Excel y devolver un
    DataFrame listo para ser normalizado.

Este módulo NO modifica datos.
NO genera activos.
NO conoce el Asset Registry.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from backend.config import EXCEL_FILE


REQUIRED_COLUMNS = [
    "Sector",
    "Ubicación",
    "Maquina",
    "Modelo",
    "Repuesto",
    "Marca",
    "Designacion",
    "Cant. Unit.",
    "Cant. Compra",
]


class ExcelReader:

    SHEET_NAME = "Base de Datos, Máquinas"

    HEADER_ROW = 5  # fila 6 del Excel

    def __init__(self, excel_file: Path | None = None):

        self.excel_file = excel_file or EXCEL_FILE

    def read(self) -> pd.DataFrame:

        self._validate_file()

        dataframe = pd.read_excel(
            self.excel_file,
            sheet_name=self.SHEET_NAME,
            header=self.HEADER_ROW,
            engine="openpyxl",
        )

        dataframe = self._remove_empty_rows(dataframe)

        self._validate_columns(dataframe)

        dataframe.reset_index(drop=True, inplace=True)

        return dataframe

    def _validate_file(self) -> None:

        if not self.excel_file.exists():

            raise FileNotFoundError(
                f"No se encontró el archivo:\n{self.excel_file}"
            )

    @staticmethod
    def _remove_empty_rows(dataframe: pd.DataFrame) -> pd.DataFrame:

        return dataframe.dropna(how="all")

    @staticmethod
    def _validate_columns(dataframe: pd.DataFrame) -> None:

        missing = [
            column
            for column in REQUIRED_COLUMNS
            if column not in dataframe.columns
        ]

        if missing:

            raise ValueError(
                "Faltan columnas obligatorias:\n"
                + "\n".join(missing)
            )
