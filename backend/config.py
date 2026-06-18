"""
Configuración central del proyecto SIGMA.

Este módulo concentra todas las rutas y constantes globales del sistema.
Ningún otro módulo debe declarar rutas absolutas o nombres de archivos.
"""

from pathlib import Path

# ---------------------------------------------------------------------
# Información del proyecto
# ---------------------------------------------------------------------

PROJECT_NAME = "SIGMA"

VERSION = "0.1.0-alpha"

AUTHOR = "Fabián Menorque"

# ---------------------------------------------------------------------
# Directorio raíz
# ---------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------
# Carpetas
# ---------------------------------------------------------------------

DATABASE_DIR = ROOT_DIR / "database"

DATA_DIR = ROOT_DIR / "data"

LOG_DIR = ROOT_DIR / "logs"

DOCS_DIR = ROOT_DIR / "docs"

TESTS_DIR = ROOT_DIR / "tests"

# ---------------------------------------------------------------------
# Archivos
# ---------------------------------------------------------------------

EXCEL_FILE = DATABASE_DIR / "Base de datos, Máquinas.xlsx"

REGISTRY_FILE = DATA_DIR / "asset_registry.json"

# ---------------------------------------------------------------------
# Crear carpetas necesarias
# ---------------------------------------------------------------------

for directory in (
    DATABASE_DIR,
    DATA_DIR,
    LOG_DIR,
    DOCS_DIR,
):

    directory.mkdir(
        parents=True,
        exist_ok=True
    ) 
