#!/usr/bin/env python3
"""
generar_equipos.py
-------------------
Genera un archivo HTML por cada equipo listado en equipos.csv, repartidos
en 3 subcarpetas (lote1/, lote2/, lote3/) de tamaño parejo, para que cada
una se pueda subir a GitHub sin pasar el límite de ~100 archivos por vez
del drag-and-drop web. (Si subís por git/GitHub Desktop este límite no
existe, pero la carpeta queda dividida igual por consistencia.)

Correr este script cada vez que se agregan, renombran o dan de baja
equipos — NO hace falta tocar los archivos HTML a mano.

Uso:
    python3 generar_equipos.py equipos.csv

equipos.csv debe tener (al menos) la columna Codigo_SIGMA.
"""
import csv
import sys
import pathlib
import json

BASE_DIR = pathlib.Path(__file__).parent
TEMPLATE_PATH = BASE_DIR / "_template.html"
N_LOTES = 3


def main():
    if len(sys.argv) != 2:
        print("Uso: python3 generar_equipos.py equipos.csv")
        sys.exit(1)

    csv_path = pathlib.Path(sys.argv[1])
    if not csv_path.exists():
        print(f"No se encontró el archivo: {csv_path}")
        sys.exit(1)

    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if "Codigo_SIGMA" not in reader.fieldnames:
            print('El CSV debe tener una columna "Codigo_SIGMA".')
            sys.exit(1)
        codigos = [(fila.get("Codigo_SIGMA") or "").strip() for fila in reader]
        codigos = [c for c in codigos if c]

    codigos.sort()  # orden determinístico — el mismo reparto siempre para el mismo set de códigos

    # Borrar carpetas de lotes viejas para no dejar archivos huérfanos de una corrida anterior
    for i in range(1, N_LOTES + 1):
        carpeta = BASE_DIR / f"lote{i}"
        if carpeta.exists():
            for viejo in carpeta.glob("*.html"):
                viejo.unlink()
        carpeta.mkdir(exist_ok=True)

    tam_lote = -(-len(codigos) // N_LOTES)  # redondeo hacia arriba
    mapa_carpeta = {}

    for idx, codigo in enumerate(codigos):
        n_lote = min(idx // tam_lote + 1, N_LOTES)
        carpeta = f"lote{n_lote}"
        mapa_carpeta[codigo] = carpeta

        contenido = template.replace("{{CODIGO_EQUIPO}}", codigo)
        destino = BASE_DIR / carpeta / f"{codigo}.html"
        destino.write_text(contenido, encoding="utf-8")

    # Mapa código -> carpeta, para que el resto del sitio arme los links correctos
    mapa_js_valor = "const SIGMA_EQUIPO_CARPETA = " + json.dumps(mapa_carpeta, ensure_ascii=False, indent=2) + ";"
    (BASE_DIR / "equipo-carpetas.js").write_text(mapa_js_valor + "\n", encoding="utf-8")

    # Actualizar también el bloque embebido en sigma-utils.js (mismo contenido,
    # para que todas las páginas ya lo tengan disponible sin un <script> extra)
    utils_path = BASE_DIR.parent / "sigma-utils.js"
    if utils_path.exists():
        utils = utils_path.read_text(encoding="utf-8")
        inicio = "/* === INICIO_MAPA_EQUIPO_CARPETA (autogenerado por equipos/generar_equipos.py — no editar a mano) === */"
        fin = "/* === FIN_MAPA_EQUIPO_CARPETA === */"
        i, j = utils.find(inicio), utils.find(fin)
        if i != -1 and j != -1:
            utils = utils[:i] + inicio + "\n" + mapa_js_valor + "\n" + utils[j:]
            utils_path.write_text(utils, encoding="utf-8")
            print("Actualizado el mapa embebido en ../sigma-utils.js")
        else:
            print("AVISO: no encontré los marcadores en sigma-utils.js — actualizalo a mano.")

    print(f"Listo: {len(codigos)} archivos generados en {N_LOTES} carpetas (~{tam_lote} c/u).")
    print("Actualizado equipos/equipo-carpetas.js con el mapa código→carpeta.")


if __name__ == "__main__":
    main()
