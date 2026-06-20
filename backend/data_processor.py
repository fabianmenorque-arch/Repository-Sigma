"""
SIGMA - Data Processor

Responsabilidad:
    Procesar el DataFrame antes de construir el catálogo.

Actualmente realiza:

- Validación de datos.

En futuros commits podrá incorporar limpieza y normalización
sin modificar la interfaz pública.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import pandas as pd


class Severity(Enum):

    ERROR = "ERROR"

    WARNING = "WARNING"

    INFO = "INFO"


@dataclass(slots=True)
class ProcessingIssue:

    fila: int

    campo: str

    severidad: Severity

    mensaje: str


@dataclass(slots=True)
class ProcessingResult:

    dataframe: pd.DataFrame

    issues: list[ProcessingIssue]

    @property
    def errors(self):

        return [

            issue

            for issue in self.issues

            if issue.severidad is Severity.ERROR

        ]

    @property
    def warnings(self):

        return [

            issue

            for issue in self.issues

            if issue.severidad is Severity.WARNING

        ]

    @property
    def is_valid(self):

        return len(self.errors) == 0


class DataProcessor:

    def process(

        self,

        dataframe: pd.DataFrame,

    ) -> ProcessingResult:

        issues: list[ProcessingIssue] = []

        return ProcessingResult(

            dataframe=dataframe,

            issues=issues,

        )
