# SIGMA — Sistema de Gestión del Mantenimiento
Ingenio Bella Vista / Arca Continental

## Estructura

```
Repository-Sigma/
├── sigma-styles.css          ← CSS compartido por todas las páginas
├── sigma-utils.js            ← Config, acceso a Sheets/Apps Script, cálculo de KPIs, UI
├── dashboard.html            ← Página de inicio: KPIs, gráficos, mediciones en vivo
├── ordenes.html              ← Alta y gestión de órdenes de trabajo
├── informes.html             ← Informe imprimible por orden: línea de tiempo + fotos antes/después
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
| `Ordenes_de_Trabajo`      | Nro_Orden, Codigo_Equipo, Descripcion, Tipo, Prioridad, Estado, Responsable, Fecha_Creacion, Fecha_Inicio, Fecha_Cierre_Real, Observaciones |
| `Repuestos`               | Codigo_Equipo, Nombre, Codigo_Repuesto, Stock |
| `Imagenes`                | Codigo_Equipo, Nro_Orden, Momento, URL, URL_Miniatura, Fecha_Hora |
| `Variables`               | Codigo_Equipo, Variable, Unidad — **catálogo**: qué variables se pueden medir en cada equipo y con qué unidad. Sin filas acá, la ficha del equipo no deja cargar mediciones. |
| `Mediciones`              | Codigo_Equipo, Variable, Unidad, Valor, Fecha_Hora — las lecturas cargadas |

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

## 4. Apps Script — `apps-script/Code.gs`

Ya armado. Soporta estas acciones vía `doPost` (todas reciben `action` +
los campos de la fila en JSON):

- `crear_equipo` → agrega fila a `Equipos` (valida que el código no exista)
- `crear_orden` → agrega fila a `Ordenes_de_Trabajo` (genera `Nro_Orden` si falta). `Fecha_Creacion` se completa sola al crear; `Fecha_Inicio` y `Fecha_Cierre_Real` quedan vacías.
- `actualizar_orden` → busca por `Nro_Orden` y actualiza los campos recibidos. Al pasar a **"En Proceso"** por primera vez, completa sola `Fecha_Inicio`; al pasar a **"Completada"**, completa `Fecha_Cierre_Real` y genera el mantenimiento correspondiente usando el inicio real del trabajo (no la fecha de creación de la orden).
- `subir_imagen` → recibe una foto en base64 (desde `informes.html`, botones "Subir foto" antes/después), la guarda en una carpeta de Google Drive llamada **"SIGMA - Fotos de mantenimiento"** (la crea sola la primera vez), la hace pública para lectura, y agrega la fila correspondiente a `Imagenes` con `Nro_Orden` y `Momento` ("Antes"/"Después") para que el informe la encuentre.
- `crear_mantenimiento` → agrega fila a `Mantenimientos` (para cuando se cierre una orden y quede registrado el historial)
- `registrar_medicion` → agrega fila a `Mediciones` (para lecturas en tiempo real desde sensores o carga manual)

**Instalación:**
1. En el Google Sheet: `Extensiones → Apps Script`.
2. Pegá el contenido de `apps-script/Code.gs`.
3. Revisá que los nombres en el objeto `SHEETS` (arriba del archivo)
   coincidan exactamente con el nombre de tus pestañas.
4. `Implementar → Nueva implementación → tipo "Aplicación web"`.
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier usuario**
5. Copiá la URL generada en `SIGMA_CONFIG.APPS_SCRIPT_URL` (en `sigma-utils.js`).
6. Cada vez que edites `Code.gs`, hay que generar una **nueva versión** de
   la implementación (`Administrar implementaciones → lápiz → Nueva versión`)
   para que el cambio se refleje en la misma URL.

El script usa `LockService` para que dos escrituras simultáneas (dos
operarios cargando al mismo tiempo) no se pisen entre sí.

## Pendiente para dejarlo 100% operativo

- [ ] Completar `SIGMA_CONFIG` en `sigma-utils.js` con el Sheet ID real, los
      gids de cada pestaña, y la URL del Apps Script ya implementado.
- [ ] Importar `equipos_para_sheets.csv` y `repuestos_para_sheets.csv` como
      las pestañas `Equipos` y `Repuestos`.
- [ ] Crear la pestaña `Ordenes_de_Trabajo` con las columnas indicadas arriba
      (aunque esté vacía, tiene que existir con los encabezados correctos).
- [ ] Si `Imagenes` ya existía de antes, agregarle las columnas `Nro_Orden` y
      `Momento` (además de las que ya tenía) para que funcionen las fotos
      antes/después del informe.
