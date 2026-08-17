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
    ├── index.html            ← Índice buscable de los 194 equipos
    ├── qr_codigos.html       ← Generador de QR imprimibles por equipo
    ├── _template.html         ← Plantilla única — NO se linkea directo, se clona
    ├── generar_equipos.py     ← Genera un .html por cada fila del CSV, repartido en lotes
    ├── equipos.csv            ← Lista maestra (misma fuente que Equipos en Sheets)
    ├── equipo-carpetas.js     ← Mapa código→carpeta (autogenerado, embebido también en sigma-utils.js)
    ├── lote1/  BV-....html    ← ~65 equipos
    ├── lote2/  BV-....html    ← ~65 equipos
    └── lote3/  BV-....html    ← ~64 equipos
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
| `Repuestos`               | Codigo_Equipo, Nombre, Marca, Designacion, Codigo_Repuesto, Stock |
| `Imagenes`                | Codigo_Equipo, Nro_Orden, Momento, URL, URL_Miniatura, Fecha_Hora, Nro_Avance (opcional, fotos de un avance puntual) |
| `Gestion_Tareas`          | Nro_Tarea, Codigo_Equipo, Nro_Orden, Tipo, Descripcion, Responsable, Estado, Fecha_Creacion, Fecha_Resolucion |
| `Avances_Orden`           | Nro_Avance, Nro_Orden, Codigo_Equipo, Responsable, Tareas_Realizadas, Accion, Valor_Solicitado, Fecha_Hora |
| `Analisis_Sector`         | Fecha, Metrica, Valor, Unidad, Fuente_Archivo, Fecha_Carga |
| `Variables`               | Codigo_Equipo, Variable, Unidad — **catálogo**: qué variables se pueden medir en cada equipo y con qué unidad. Sin filas acá, la ficha del equipo no deja cargar mediciones. |
| `Mediciones`              | Codigo_Equipo, Variable, Unidad, Valor, Fecha_Hora — las lecturas cargadas |

Cada pestaña tiene que estar publicada como CSV (Archivo → Compartir →
Publicar en la web, o simplemente que el enlace de exportación `export?format=csv`
sea accesible).

## 3. Esquema de códigos de equipo

`Codigo_SIGMA` sigue el formato **`BV-{sector}-{tipo}{correlativo}`**, por ejemplo `BV-CA-B001`:

- `BV` — planta (Bella Vista, fija).
- **Sector** (2 letras): `CA`=Caldera, `CN`=Canchón, `EF`=Efluente, `FA`=Fábrica, `GE`=General, `TL`=Taller, `TR`=Trapiche, `US`=Usina.
- **Tipo de máquina** (1-2 letras): `B`=Bomba, `BV`=Bomba de vacío, `R`=Reductor, `CF`=Centrífuga, `TU`=Turbina/Turbo, `CP`=Compresor, `CT`=Cinta transportadora, `AG`=Agitador, `EL`=Elevador, `FL`=Filtro, `GU`=Gusano, y ~20 códigos puntuales más (ver la lista `REGLAS_TIPO` en `equipos/generar_equipos.py` y en `alta_nuevo_equipo.html` si necesitás agregar un tipo nuevo — mantenerlas sincronizadas).
- **Correlativo** (3 dígitos) — por combinación de sector+tipo, no global.

El código es solo un identificador corto — la descripción la aporta siempre el **nombre** (columna `Maquina`), que es lo que se muestra en pantalla. Si agregás un equipo de un tipo que no está en la lista, avisá para sumar su abreviatura.

## 4. Generar las páginas de equipos

Las páginas de equipo se reparten en 3 subcarpetas (`equipos/lote1/`,
`lote2/`, `lote3/`) de tamaño parejo, para que cada una se pueda subir a
GitHub sin pasar el límite de archivos del drag-and-drop web. El resto del
sitio arma los links correctos solo (vía `sigmaRutaEquipo()` en
`sigma-utils.js`), así que no hace falta saber a mano en qué lote vive
cada equipo.

1. Actualizá `equipos/equipos.csv` con la lista completa (columna clave:
   `Codigo_SIGMA`).
2. Corré:
   ```
   cd equipos
   python3 generar_equipos.py equipos.csv
   ```
3. Esto borra los `.html` de una corrida anterior, genera los nuevos
   repartidos en los 3 lotes, y actualiza tanto `equipo-carpetas.js` como
   el mapa embebido en `../sigma-utils.js` — no hace falta tocar nada a
   mano. Si cambia el diseño más adelante, se edita solo `_template.html`
   y se vuelve a correr el script.
4. Al subir a GitHub, subí cada carpeta (`lote1/`, `lote2/`, `lote3/`) por
   separado si usás el drag-and-drop web; si subís por `git push` o
   GitHub Desktop no hay ese límite y podés subir todo junto.

> Nota: cada página de equipo NO tiene los datos incrustados — los trae en
> vivo desde Sheets filtrando por su código. Por eso regenerar las páginas
> es instantáneo y no requiere resubir datos.

## 5. Apps Script — `apps-script/Code.gs`

Ya armado. Soporta estas acciones vía `doPost` (todas reciben `action` +
los campos de la fila en JSON):

- `crear_equipo` → agrega fila a `Equipos` (valida que el código no exista)
- `crear_orden` → agrega fila a `Ordenes_de_Trabajo` (genera `Nro_Orden` si falta). `Fecha_Creacion` se completa sola al crear; `Fecha_Inicio` y `Fecha_Cierre_Real` quedan vacías.
- `actualizar_orden` → busca por `Nro_Orden` y actualiza los campos recibidos. Al pasar a **"En Proceso"** por primera vez, completa sola `Fecha_Inicio`; al pasar a **"Completada"**, completa `Fecha_Cierre_Real` y genera el mantenimiento correspondiente usando el inicio real del trabajo (no la fecha de creación de la orden).
- `subir_imagen` → recibe una foto en base64 (desde `informes.html`, botones "Subir foto" antes/después, o desde un avance), la guarda en una carpeta de Google Drive llamada **"SIGMA - Fotos de mantenimiento"** (la crea sola la primera vez), la hace pública para lectura, y agrega la fila correspondiente a `Imagenes` con `Nro_Orden` y `Momento` ("Antes"/"Después"), o `Nro_Avance` si es de un avance puntual.
- `crear_avance` → agrega un tramo de trabajo a `Avances_Orden` (responsable, tareas realizadas, acción/próximo paso, valor solicitado), para reparaciones grandes que pasan por varios responsables antes de cerrarse — cada avance puede tener sus propias fotos Antes/Después (vía `subir_imagen` con `Nro_Avance` + `Momento`). El botón "Finalizar orden" del informe usa `actualizar_orden` (mismo mecanismo que el selector de estado) para marcarla "Completada" al final.
- `crear_analisis` → guarda un dato del sector (`analisis.html`, ver abajo) en `Analisis_Sector`.

### SIGMA Análisis (`analisis.html`)

Lee los PDF del "Parte diario de fábrica" (Hoja 1 y Hoja 2) **en el navegador**,
con [pdf.js](https://mozilla.github.io/pdf.js/) — no sube el archivo a ningún
lado, solo extrae texto localmente. Como los PDF son tablas complejas, la
extracción no busca "la palabra más cercana al número": agrupa el texto por
posición (fila/columna reales del PDF) para no confundir columnas. Funciona
solo con PDF de **texto real** (no escaneos/fotos).

Datos que extrae hoy: `Molienda Bruta/Día`, `Bagazo Kgs` (Hoja 1), `Bagazo -
Pol` y `Bagazo - Humedad` (Hoja 2, tabla "ANÁLISIS" Brix/Pol/Hdad./Fibra) —
y calcula `Azúcar Perdida = Bagazo Kgs × (Bagazo - Pol / 100)`. Antes de
guardar, se muestra una tabla de revisión donde se puede tildar/destildar
cada dato y corregir el valor a mano si hace falta.

Si el formato del parte diario cambia, o hay que sumar un dato nuevo, la
lista de métricas y los patrones de búsqueda están todos juntos al principio
del `<script>` de `analisis.html` (`METRICAS`, `procesarHoja1`,
`procesarHoja2`) — avisame y lo ajusto.
- `crear_tarea_gestion` / `actualizar_tarea_gestion` → seguimiento de trámites administrativos ligados a una reparación (cotización, compra de equipo, repuestos, consultas de estado, etc.), cargados desde `informes.html` y gestionados en conjunto desde `gestion_hojas.html`.
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

- [ ] Crear la pestaña `Avances_Orden` (columnas en la sección 2) y
      completar su gid en `SIGMA_CONFIG.GIDS`.
- [ ] Si querés que las fotos de un avance queden asociadas a él, agregale
      a `Imagenes` la columna `Nro_Avance` (opcional).

- [ ] **Re-importar la lista de equipos** (cambiaron códigos y hubo bajas):
      reemplazá la pestaña `Equipos` por `equipos_para_sheets.csv` y la
      pestaña `Repuestos` por `repuestos_para_sheets.csv`.
- [ ] Crear la pestaña `Gestion_Tareas` (columnas en la sección 2) y
      completar su gid en `SIGMA_CONFIG.GIDS` (`sigma-utils.js`).
- [ ] Confirmar que `autorizarDrive` ya corrió alguna vez manualmente desde
      el editor de Apps Script (▶ Ejecutar) — si nunca pediste el permiso
      de Drive por ahí, las fotos de los informes no se van a guardar aunque
      parezca que subieron bien.
