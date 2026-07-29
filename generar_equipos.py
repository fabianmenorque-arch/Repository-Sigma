#!/usr/bin/env python3
"""
generar_equipos.py
-------------------
Genera un archivo HTML por cada equipo listado en equipos.csv, a partir de
la plantilla _template.html. Correr este script cada vez que se agregan o
renombran equipos — NO hace falta tocar los 215 archivos a mano.

Uso:
    python3 generar_equipos.py equipos.csv

equipos.csv debe tener (al menos) esta columna:
    Codigo_SIGMA

Columnas opcionales que también podés incluir (no se usan en el archivo
generado, ya que la página los trae en vivo desde la pestaña "Equipos" de
Google Sheets, pero sirven como referencia / documentación del CSV):
    Sector, Ubicacion, Maquina, Modelo, Fabricante, Anio
"""
import csv
import sys
import pathlib

BASE_DIR = pathlib.Path(__file__).parent
TEMPLATE_PATH = BASE_DIR / "_template.html"
OUTPUT_DIR = BASE_DIR  # los .html de equipos van junto a este script (equipos/)


def main():
    if len(sys.argv) != 2:
        print("Uso: python3 generar_equipos.py equipos.csv")
        sys.exit(1)

    csv_path = pathlib.Path(sys.argv[1])
    if not csv_path.exists():
        print(f"No se encontró el archivo: {csv_path}")
        sys.exit(1)

    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    creados, vacios = 0, 0
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if "Codigo_SIGMA" not in reader.fieldnames:
            print('El CSV debe tener una columna "Codigo_SIGMA".')
            sys.exit(1)

        for fila in reader:
            codigo = (fila.get("Codigo_SIGMA") or "").strip()
            if not codigo:
                vacios += 1
                continue

            contenido = template.replace("{{CODIGO_EQUIPO}}", codigo)
            destino = OUTPUT_DIR / f"{codigo}.html"
            destino.write_text(contenido, encoding="utf-8")
            creados += 1

    print(f"Listo: {creados} archivos generados en {OUTPUT_DIR}")
    if vacios:
        print(f"Aviso: {vacios} filas sin Codigo_SIGMA fueron omitidas.")


if __name__ == "__main__":
    main()
