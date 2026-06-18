"""
SIGMA
Sistema Integral de Gestión de Mantenimiento de Activos

Punto de entrada de la aplicación.
"""

from backend.asset_registry import AssetRegistry
from backend.catalog import CatalogBuilder
from backend.config import PROJECT_NAME, VERSION
from backend.excel_reader import ExcelReader


def print_header() -> None:

    print("=" * 60)
    print(f"{PROJECT_NAME} {VERSION}")
    print("Sistema Integral de Gestión de Mantenimiento")
    print("=" * 60)


def print_summary(catalogo) -> None:

    print()
    print("=" * 60)
    print("RESUMEN")
    print("=" * 60)

    print(f"Activos registrados : {catalogo.cantidad_activos}")
    print(f"Repuestos cargados  : {catalogo.cantidad_repuestos}")

    print("=" * 60)


def main():

    print_header()

    print("\nLeyendo base de datos...")

    reader = ExcelReader()

    dataframe = reader.read()

    print(f"OK - {len(dataframe)} filas encontradas.")

    print("\nActualizando Asset Registry...")

    registry = AssetRegistry()

    print("Construyendo catálogo...")

    builder = CatalogBuilder(registry)

    catalogo = builder.build(dataframe)

    print_summary(catalogo)

    print("Proceso finalizado correctamente.")


if __name__ == "__main__":

    main()
