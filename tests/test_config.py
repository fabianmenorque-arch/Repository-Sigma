from pathlib import Path

from backend.config import (
    DATABASE_DIR,
    DATA_DIR,
    DOCS_DIR,
    EXCEL_FILE,
    LOG_DIR,
    PROJECT_NAME,
    REGISTRY_FILE,
    ROOT_DIR,
    VERSION,
)


def test_project_name():

    assert PROJECT_NAME == "SIGMA"


def test_version():

    assert VERSION == "0.1.0-alpha"


def test_root_exists():

    assert ROOT_DIR.exists()


def test_directories_are_paths():

    assert isinstance(DATABASE_DIR, Path)

    assert isinstance(DATA_DIR, Path)

    assert isinstance(LOG_DIR, Path)

    assert isinstance(DOCS_DIR, Path)


def test_file_names():

    assert EXCEL_FILE.name == "Base de datos, Máquinas.xlsx"

    assert REGISTRY_FILE.name == "asset_registry.json"
