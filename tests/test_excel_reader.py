from pathlib import Path

import pandas as pd
import pytest

from backend.excel_reader import (
    ExcelReader,
    REQUIRED_COLUMNS,
)


def test_file_exists():

    reader = ExcelReader()

    assert reader.excel_file.exists()


def test_read_dataframe():

    reader = ExcelReader()

    dataframe = reader.read()

    assert isinstance(dataframe, pd.DataFrame)


def test_required_columns():

    reader = ExcelReader()

    dataframe = reader.read()

    for column in REQUIRED_COLUMNS:

        assert column in dataframe.columns


def test_dataframe_not_empty():

    reader = ExcelReader()

    dataframe = reader.read()

    assert len(dataframe) > 0


def test_invalid_file():

    reader = ExcelReader(
        Path("archivo_inexistente.xlsx")
    )

    with pytest.raises(FileNotFoundError):

        reader.read()
