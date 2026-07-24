# SIGMA — Sistema de Gestión del Mantenimiento
Ingenio Bella Vista / Arca Continental

## Estructura

```
Repository-Sigma/
├── sigma-styles.css          ← CSS compartido por todas las páginas
├── sigma-utils.js            ← Config, acceso a Sheets/Apps Script, cálculo de KPIs, UI
├── dashboard.html            ← Página de inicio: KPIs, gráficos, mediciones en vivo
├── ordenes.html              ← Alta y gestión de órdenes de trabajo
├── alta_nuevo_equipo.html    ← Alta de equipos nuevos
├── gestion_hojas.html        ← Estado de las pestañas de Sheets + exportar CSV
└── equipos/
    ├── index.html            ← Índice buscable de los 215 equipos
    ├── _template.html         ← Plantilla única — NO se linkea directo, se clona
    ├── generar_equipos.py     ← Genera un .html por cada fila del CSV
    ├── equipos.ejemplo.csv    ← Ejemplo de formato del CSV de entrada
    └── BV-....html            ← Los 215 archivos generados (uno por equipo)
```

## 1. Completar la configuración (una sola vez)

Abrí `sigma-utils.js` y completá, arriba del todo, en `SIGMA_CONFIG`:

- `SHEET_ID`: el ID de tu Google Sheet (la parte de la URL entre `/d/` y `/edit`).
- `GIDS`: el gid de cada pestaña. Se ve al final de la URL cuando abrís esa
  pestaña puntual en el navegador (`...#gid=123456789`).
- `APPS_SCRIPT_URL`: la URL del Web App de Apps Script publicado, que recibe
  las escrituras (altas de equipo, altas de orden, cambios de estado).

Este archivo es el único lugar donde se configuran esos valores — todas las
páginas lo comparten.

## 2. Pestañas esperadas en Google Sheets

| Pestaña                  | Columnas mínimas |
|---------------------------|-------------------|
| `Equipos`                 | Codigo_SIGMA, Sector, Ubicacion, Maquina, Modelo, Fabricante, Anio |
| `Mantenimientos`          | Codigo_Equipo, Tipo, Fecha_Inicio, Fecha_Fin (o Duracion_Horas), Descripcion |
| `Ordenes_de_Trabajo`      | Nro_Orden, Codigo_Equipo, Descripcion, Tipo, Prioridad, Estado, Responsable, Fecha_Creacion, Fecha_Est_Cierre, Fecha_Cierre_Real, Observaciones |
| `Repuestos`               | Codigo_Equipo, Nombre, Codigo_Repuesto, Stock |
| `Imagenes`                | Codigo_Equipo, URL, URL_Miniatura |
| `Variables` / `Mediciones`| Codigo_Equipo, Variable, Valor, Fecha_Hora |

Cada pestaña tiene que estar publicada como CSV (Archivo → Compartir →
Publicar en la web, o simplemente que el enlace de exportación `export?format=csv`
sea accesible).

## 3. Generar las 215 páginas de equipos

1. Exportá o armá un CSV con **todos** los equipos, con al menos la columna
   `Codigo_SIGMA` (mirá `equipos.ejemplo.csv` como referencia de formato).
2. Corré:
   ```
   cd equipos
   python3 generar_equipos.py equipos.csv
   ```
3. Esto crea (o sobreescribe) un `.html` por cada fila — no hace falta tocar
   nada a mano. Si cambia el diseño más adelante, se edita solo
   `_template.html` y se vuelve a correr el script.

> Nota: cada página de equipo NO tiene los datos incrustados — los trae en
> vivo desde Sheets filtrando por su código. Por eso regenerar los 215
> archivos es instantáneo y no requiere resubir datos.

## 4. Apps Script — acciones que debe soportar el Web App

El `doPost` del Apps Script debe interpretar el campo `action` del body
JSON recibido:

- `crear_equipo` → agrega fila a `Equipos`
- `crear_orden` → agrega fila a `Ordenes_de_Trabajo`
- `actualizar_orden` → busca por `Nro_Orden` y actualiza `Estado` /
  `Fecha_Cierre_Real`

## Pendiente para dejarlo 100% operativo

- [ ] Completar `SIGMA_CONFIG` en `sigma-utils.js` con el Sheet ID real, los
      gids de cada pestaña, y la URL del Apps Script.
- [ ] Confirmar que el Apps Script ya soporta las tres acciones de arriba
      (si no, decime y armamos el `Code.gs`).
- [ ] Pasarme el CSV real con los 215 equipos para generar sus páginas
      definitivas (o decime dónde está en el Sheet y lo genero desde ahí).
