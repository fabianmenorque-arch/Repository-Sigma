from unittest.mock import MagicMock, patch

import main


@patch("main.CatalogBuilder")
@patch("main.AssetRegistry")
@patch("main.ExcelReader")
def test_main(
    mock_reader,
    mock_registry,
    mock_builder,
):

    dataframe = MagicMock()

    dataframe.__len__.return_value = 10

    mock_reader.return_value.read.return_value = dataframe

    catalogo = MagicMock()

    catalogo.cantidad_activos = 5

    catalogo.cantidad_repuestos = 20

    mock_builder.return_value.build.return_value = catalogo

    main.main()

    mock_reader.return_value.read.assert_called_once()

    mock_builder.return_value.build.assert_called_once()
