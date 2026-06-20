"""
SIGMA - Data Validator

Valida la calidad de los datos antes de construir el catálogo.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from backend.normalizer import clean_string, normalize_sector


# ---------------------------------------------------------------------
# Modelo
# ---------------------------------------------------------------------

@dataclass(slots=True)
class ValidationIssue:

    fila: int

    campo: str

    severidad: str

    mensaje: str


# ---------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------

class DataValidator:

    REQUIRED_FIELDS = (

        "Sector",

        "Ubicación",

        "Maquina",

        "Modelo",

        "Repuesto",

    )

    def validate(
        self,
        dataframe: pd.DataFrame,
    ) -> list[ValidationIssue]:

        issues: list[ValidationIssue] = []

        issues.extend(
            self._validate_required_fields(dataframe)
        )

        issues.extend(
            self._validate_sectors(dataframe)
        )

        issues.extend(
            self._validate_quantities(dataframe)
        )

        issues.extend(
            self._validate_duplicates(dataframe)
        )

        return issues

    # ---------------------------------------------------------

    def _validate_required_fields(
        self,
        dataframe: pd.DataFrame,
    ) -> list[ValidationIssue]:

        issues = []

        for index, row in dataframe.iterrows():

            for field in self.REQUIRED_FIELDS:

                if clean_string(row[field]) == "":

                    issues.append(
                        ValidationIssue(
                            fila=index + 2,
                            campo=field,
                            severidad="ERROR",
                            mensaje=f'El campo "{field}" está vacío.',
                        )
                    )

        return issues

    # ---------------------------------------------------------

    def _validate_sectors(
        self,
        dataframe: pd.DataFrame,
    ) -> list[ValidationIssue]:

        issues = []

        for index, row in dataframe.iterrows():

            try:

                normalize_sector(row["Sector"])

            except ValueError:

                issues.append(
                    ValidationIssue(
                        fila=index + 2,
                        campo="Sector",
                        severidad="ERROR",
                        mensaje=f'Sector desconocido: "{row["Sector"]}".',
                    )
                )

        return issues

    # ---------------------------------------------------------

    def _validate_quantities(
        self,
        dataframe: pd.DataFrame,
    ) -> list[ValidationIssue]:

        issues = []

        for index, row in dataframe.iterrows():

            for field in ("Cant. Unit.", "Cant. Compra"):

                value = row[field]

                if value < 0:

                    issues.append(
                        ValidationIssue(
                            fila=index + 2,
                            campo=field,
                            severidad="ERROR",
                            mensaje="La cantidad no puede ser negativa.",
                        )
                    )

        return issues

    # ---------------------------------------------------------

    def _validate_duplicates(
        self,
        dataframe: pd.DataFrame,
    ) -> list[ValidationIssue]:

        issues = []

        duplicated = dataframe.duplicated()

        for index, is_duplicate in duplicated.items():

            if is_duplicate:

                issues.append(
                    ValidationIssue(
                        fila=index + 2,
                        campo="Fila",
                        severidad="WARNING",
                        mensaje="Fila duplicada.",
                    )
                )

        return issues
