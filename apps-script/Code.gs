/**
 * SIGMA — Ingenio Bella Vista
 * Web App de Apps Script: recibe todas las escrituras del sistema desde
 * las páginas HTML (fetch con mode:'no-cors', action + payload en JSON).
 *
 * INSTALACIÓN
 * 1. En tu Google Sheet: Extensiones → Apps Script.
 * 2. Reemplazá el contenido de Code.gs por este archivo.
 * 3. Ajustá SHEETS más abajo si tus pestañas tienen otros nombres.
 * 4. Implementar → Nueva implementación → tipo "Aplicación web".
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier usuario
 * 5. Copiá la URL del web app resultante en SIGMA_CONFIG.APPS_SCRIPT_URL
 *    dentro de sigma-utils.js.
 * 6. Cada vez que edites este script, tenés que generar una NUEVA versión
 *    DE LA IMPLEMENTACIÓN QUE YA ESTÁ PUBLICADA — no crear una implementación
 *    nueva (eso generaría otra URL distinta a la que usa tu sitio):
 *    Implementar → Administrar implementaciones → ✏️ (lápiz de la
 *    implementación existente) → Versión: "Nueva versión" → Implementar.
 *
 * NUEVO EN ESTA VERSIÓN (Paradas / Objetivos — Dashboard "Sigma Análisis")
 * Antes de publicar, creá en el Sheet dos pestañas nuevas con estos
 * encabezados EXACTOS en la fila 1 (mismo orden no importa, los nombres sí):
 *
 *   Pestaña "Paradas":
 *     Fecha | Hora_Parada | Codigo | Causa | Descripcion | Fecha_Arranque | Hora_Arranque | Duracion_Min | Clave_Unica
 *
 *   Pestaña "Objetivos":
 *     Mes | Metrica | Valor | Unidad
 *
 * Después, en cada pestaña: click en la pestaña → "Ver gid" en la URL
 * (#gid=XXXXXX) → copiar ese número en SIGMA_CONFIG.GIDS.Paradas y
 * SIGMA_CONFIG.GIDS.Objetivos dentro de sigma-utils.js.
 */

// Cambiá este texto cada vez que edites el script — sirve para confirmar
// desde el navegador (abriendo la URL /exec) qué versión quedó publicada.
const VERSION_SCRIPT = "2026-08-27-v10-paradas-objetivos-novedades";

// Nombre exacto de cada pestaña en el Sheet
const SHEETS = {
  EQUIPOS: "Equipos",
  ORDENES: "Ordenes_de_Trabajo",
  MANTENIMIENTOS: "Mantenimientos",
  MEDICIONES: "Mediciones",
  REPUESTOS: "Repuestos",
  IMAGENES: "Imagenes",
  GESTION_TAREAS: "Gestion_Tareas",
  ANALISIS: "Analisis_Sector",
  AVANCES: "Avances_Orden",
  PARADAS: "Paradas",
  OBJETIVOS: "Objetivos"
};

/* ============================================================
   ENTRADA — doPost / doGet
   ============================================================ */

function doPost(e) {
  return withLock_(() => {
    try {
      const body = JSON.parse(e.postData.contents);
      const accion = body.action;
      Logger.log("doPost recibido — action: " + accion + " | payload: " + JSON.stringify(body));

      switch (accion) {
        case "crear_equipo":
          return ok_(crearEquipo_(body));
        case "crear_orden":
          return ok_(crearOrden_(body));
        case "actualizar_orden":
          return ok_(actualizarOrden_(body));
        case "crear_mantenimiento":
          return ok_(crearMantenimiento_(body));
        case "registrar_medicion":
          return ok_(registrarMedicion_(body));
        case "subir_imagen":
          return ok_(subirImagen_(body));
        case "crear_tarea_gestion":
          return ok_(crearTareaGestion_(body));
        case "actualizar_tarea_gestion":
          return ok_(actualizarTareaGestion_(body));
        case "crear_avance":
          return ok_(crearAvance_(body));
        case "crear_analisis":
          return ok_(crearAnalisis_(body));
        case "crear_parada":
          return ok_(crearParada_(body));
        case "guardar_objetivo":
          return ok_(guardarObjetivo_(body));
        default:
          Logger.log("Acción desconocida: " + accion);
          return error_("Acción desconocida: " + accion);
      }
    } catch (err) {
      Logger.log("ERROR en doPost: " + err.message + " | stack: " + err.stack);
      return error_(err.message);
    }
  });
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: true, mensaje: "SIGMA Apps Script activo", version: VERSION_SCRIPT}))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   ACCIONES
   ============================================================ */

function crearEquipo_(body) {
  const sheet = hoja_(SHEETS.EQUIPOS);
  if (existeValor_(sheet, "Codigo_SIGMA", body.Codigo_SIGMA)) {
    throw new Error("El código " + body.Codigo_SIGMA + " ya existe.");
  }
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_equipo", Codigo_SIGMA: body.Codigo_SIGMA};
}

function crearOrden_(body) {
  const sheet = hoja_(SHEETS.ORDENES);
  if (!body.Nro_Orden) body.Nro_Orden = "OT-" + new Date().getTime();
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_orden", Nro_Orden: body.Nro_Orden};
}

function actualizarOrden_(body) {
  const sheet = hoja_(SHEETS.ORDENES);
  const fila = buscarFila_(sheet, "Nro_Orden", body.Nro_Orden);
  if (fila === -1) throw new Error("No se encontró la orden " + body.Nro_Orden);

  const headers = encabezados_(sheet);
  const valoresActuales = sheet.getRange(fila, 1, 1, headers.length).getValues()[0];
  const ordenActual = {};
  headers.forEach((h, i) => ordenActual[h] = valoresActuales[i]);
  const estadoAnterior = ordenActual.Estado;

  Object.keys(body).forEach(clave => {
    if (clave === "Nro_Orden") return;
    const col = headers.indexOf(clave);
    if (col !== -1) sheet.getRange(fila, col + 1).setValue(body[clave]);
  });

  const nuevoEstado = body.Estado || estadoAnterior;
  const fechaInicio = body.Fecha_Inicio || ordenActual.Fecha_Inicio;

  // Si la orden pasa a "Completada" (y no lo estaba ya), se genera
  // automáticamente el registro correspondiente en Mantenimientos, usando
  // las fechas de Inicio/Fin reales que se hayan cargado a mano (no la
  // fecha de creación de la orden, que puede ser muy anterior).
  let mantenimientoGenerado = false;
  if (nuevoEstado === "Completada" && estadoAnterior !== "Completada") {
    const fechaCierre = body.Fecha_Cierre_Real || ordenActual.Fecha_Cierre_Real || new Date().toISOString();
    crearMantenimiento_({
      Codigo_Equipo: ordenActual.Codigo_Equipo,
      Tipo: ordenActual.Tipo,
      Descripcion: ordenActual.Descripcion,
      Fecha_Inicio: fechaInicio || ordenActual.Fecha_Creacion,
      Fecha_Fin: fechaCierre,
      Nro_Orden: ordenActual.Nro_Orden
    });
    mantenimientoGenerado = true;
  }

  return {accion: "actualizar_orden", Nro_Orden: body.Nro_Orden, mantenimiento_generado: mantenimientoGenerado};
}

function crearMantenimiento_(body) {
  const sheet = hoja_(SHEETS.MANTENIMIENTOS);
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_mantenimiento", Codigo_Equipo: body.Codigo_Equipo};
}

function registrarMedicion_(body) {
  const sheet = hoja_(SHEETS.MEDICIONES);
  if (!body.Fecha_Hora) body.Fecha_Hora = new Date().toISOString();
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "registrar_medicion", Codigo_Equipo: body.Codigo_Equipo};
}

/**
 * Guarda una imagen (recibida en base64) en una carpeta de Drive y agrega
 * la fila correspondiente a la pestaña Imagenes. Se usa tanto para las
 * fotos de antes/después de un informe como para la galería general del
 * equipo (Nro_Orden y Momento quedan vacíos en ese caso).
 * body: { Codigo_Equipo, Nro_Orden, Momento, NombreArchivo, MimeType, DatosBase64 }
 */
function subirImagen_(body) {
  const carpeta = carpetaImagenesSigma_();
  const bytes = Utilities.base64Decode(body.DatosBase64);
  const blob = Utilities.newBlob(bytes, body.MimeType || "image/jpeg", body.NombreArchivo || ("sigma_" + new Date().getTime() + ".jpg"));
  const archivo = carpeta.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = "https://drive.google.com/uc?export=view&id=" + archivo.getId();

  const sheet = hoja_(SHEETS.IMAGENES);
  agregarFilaPorEncabezados_(sheet, {
    Codigo_Equipo: body.Codigo_Equipo || "",
    Nro_Orden: body.Nro_Orden || "",
    Momento: body.Momento || "",
    URL: url,
    URL_Miniatura: url,
    Fecha_Hora: new Date().toISOString()
  });

  return {accion: "subir_imagen", url: url};
}

/**
 * Tareas de gestión: seguimiento de trámites/pendientes ligados a una
 * reparación (pedir cotización, comprar equipo nuevo, solicitar repuestos,
 * consultar estado de una reparación externa, etc.) — no son trabajo de
 * mantenimiento en sí, sino gestión administrativa alrededor de él.
 */
function crearTareaGestion_(body) {
  const sheet = hoja_(SHEETS.GESTION_TAREAS);
  if (!body.Nro_Tarea) body.Nro_Tarea = "GT-" + new Date().getTime();
  if (!body.Estado) body.Estado = "Pendiente";
  if (!body.Fecha_Creacion) body.Fecha_Creacion = new Date().toISOString();
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_tarea_gestion", Nro_Tarea: body.Nro_Tarea};
}

function actualizarTareaGestion_(body) {
  const sheet = hoja_(SHEETS.GESTION_TAREAS);
  const fila = buscarFila_(sheet, "Nro_Tarea", body.Nro_Tarea);
  if (fila === -1) throw new Error("No se encontró la tarea " + body.Nro_Tarea);

  const headers = encabezados_(sheet);
  if (body.Estado === "Resuelta" && !body.Fecha_Resolucion) {
    body.Fecha_Resolucion = new Date().toISOString();
  }
  Object.keys(body).forEach(clave => {
    if (clave === "Nro_Tarea") return;
    const col = headers.indexOf(clave);
    if (col !== -1) sheet.getRange(fila, col + 1).setValue(body[clave]);
  });

  return {accion: "actualizar_tarea_gestion", Nro_Tarea: body.Nro_Tarea};
}

/**
 * Avances de una orden: para reparaciones grandes que no se resuelven de
 * una sola vez y pasan por varios responsables/tramos (desmontaje, taller,
 * armado, etc.). Cada avance queda como un registro propio con su fecha,
 * responsable y descripción — las fotos de cada avance se suben aparte
 * (acción subir_imagen) taggeadas con el mismo Nro_Avance.
 */
function crearAvance_(body) {
  const sheet = hoja_(SHEETS.AVANCES);
  if (!body.Nro_Avance) body.Nro_Avance = "AV-" + new Date().getTime();
  if (!body.Fecha_Hora) body.Fecha_Hora = new Date().toISOString();
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_avance", Nro_Avance: body.Nro_Avance};
}

/**
 * SIGMA Análisis: datos de interés para el sector extraídos de los PDF de
 * parte diario de fábrica (molienda, bagazo, etc.), cargados uno por uno
 * desde analisis.html después de que el usuario revisa y confirma los
 * valores extraídos.
 */
function crearAnalisis_(body) {
  const sheet = hoja_(SHEETS.ANALISIS);
  if (!body.Fecha_Carga) body.Fecha_Carga = new Date().toISOString();
  agregarFilaPorEncabezados_(sheet, body);
  return {accion: "crear_analisis", Metrica: body.Metrica};
}

/**
 * Paradas de proceso (Análisis → lengüeta Paradas → "Guardar en el
 * sistema"). Se sube una fila por cada parada del Excel. Como el mismo
 * Excel se puede volver a cargar/guardar más de una vez (por ejemplo tras
 * corregir un dato), se hace UPSERT por "Clave_Unica" (Fecha+Hora+Causa+
 * Descripcion+Duracion, generada en el navegador) en vez de duplicar la
 * fila: si ya existe esa clave, se sobrescribe; si no, se agrega.
 */
function crearParada_(body) {
  const sheet = hoja_(SHEETS.PARADAS);
  Logger.log("crearParada_ — pestaña resuelta: '" + sheet.getName() + "', encabezados: " + JSON.stringify(encabezados_(sheet)));
  if (!body.Clave_Unica) throw new Error("Falta Clave_Unica en el registro de parada.");

  const fila = buscarFila_(sheet, "Clave_Unica", body.Clave_Unica);
  if (fila === -1) {
    agregarFilaPorEncabezados_(sheet, body);
    Logger.log("crearParada_ — fila agregada.");
  } else {
    const headers = encabezados_(sheet);
    Object.keys(body).forEach(clave => {
      const col = headers.indexOf(clave);
      if (col !== -1) sheet.getRange(fila, col + 1).setValue(body[clave]);
    });
    Logger.log("crearParada_ — fila " + fila + " actualizada.");
  }
  return {accion: "crear_parada", Clave_Unica: body.Clave_Unica, actualizado: fila !== -1};
}

/**
 * Objetivos mensuales (Análisis → lengüeta Laboratorio → "Objetivos del
 * mes"). Un objetivo se identifica por la combinación Mes + Metrica —
 * si ya existe uno para ese mes y esa métrica, se actualiza el valor en
 * vez de agregar una fila nueva.
 */
function guardarObjetivo_(body) {
  const sheet = hoja_(SHEETS.OBJETIVOS);
  if (!body.Mes || !body.Metrica) throw new Error("Faltan Mes y/o Metrica en el objetivo.");

  const fila = buscarFilaDoble_(sheet, "Mes", body.Mes, "Metrica", body.Metrica);
  if (fila === -1) {
    agregarFilaPorEncabezados_(sheet, body);
  } else {
    const headers = encabezados_(sheet);
    Object.keys(body).forEach(clave => {
      const col = headers.indexOf(clave);
      if (col !== -1) sheet.getRange(fila, col + 1).setValue(body[clave]);
    });
  }
  return {accion: "guardar_objetivo", Mes: body.Mes, Metrica: body.Metrica, actualizado: fila !== -1};
}

function carpetaImagenesSigma_() {
  const nombre = "SIGMA - Fotos de mantenimiento";
  const carpetas = DriveApp.getFoldersByName(nombre);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(nombre);
}

/* ============================================================
   HELPERS DE HOJA
   ============================================================ */

function hoja_(nombre) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sheet) throw new Error("No existe la pestaña '" + nombre + "' en este Sheet.");
  return sheet;
}

function encabezados_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** Agrega una fila nueva respetando el orden de columnas existente en la hoja. */
function agregarFilaPorEncabezados_(sheet, datos) {
  const headers = encabezados_(sheet);
  const fila = headers.map(h => (datos[h] !== undefined ? datos[h] : ""));
  sheet.appendRow(fila);
}

/** Devuelve el número de fila (1-indexed) donde columna=valor, o -1 si no existe. */
function buscarFila_(sheet, columna, valor) {
  const headers = encabezados_(sheet);
  const col = headers.indexOf(columna);
  if (col === -1) throw new Error("La pestaña no tiene columna '" + columna + "'.");
  const valores = sheet.getRange(2, col + 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < valores.length; i++) {
    if (String(valores[i][0]) === String(valor)) return i + 2; // +2: offset de header y de índice 0
  }
  return -1;
}

/** Igual que buscarFila_ pero exige coincidencia simultánea en dos columnas
 *  (usado para Objetivos: Mes + Metrica). */
function buscarFilaDoble_(sheet, columna1, valor1, columna2, valor2) {
  const headers = encabezados_(sheet);
  const col1 = headers.indexOf(columna1);
  const col2 = headers.indexOf(columna2);
  if (col1 === -1 || col2 === -1) {
    throw new Error("La pestaña no tiene las columnas '" + columna1 + "'/'" + columna2 + "'.");
  }
  const totalFilas = Math.max(sheet.getLastRow() - 1, 0);
  if (totalFilas === 0) return -1;
  const valores = sheet.getRange(2, 1, totalFilas, headers.length).getValues();
  for (let i = 0; i < valores.length; i++) {
    if (String(valores[i][col1]) === String(valor1) && String(valores[i][col2]) === String(valor2)) {
      return i + 2;
    }
  }
  return -1;
}

function existeValor_(sheet, columna, valor) {
  return buscarFila_(sheet, columna, valor) !== -1;
}

/* ============================================================
   RESPUESTAS Y CONCURRENCIA
   ============================================================ */

function ok_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: true, data}))
    .setMimeType(ContentService.MimeType.JSON);
}

function error_(mensaje) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: false, error: mensaje}))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Evita que dos escrituras simultáneas (dos operarios a la vez) choquen entre sí. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   MIGRACIÓN DE CÓDIGOS DE EQUIPO (uso único, manual)
   ------------------------------------------------------------
   Se corre UNA sola vez desde el editor de Apps Script (NO es una
   acción del sitio web), después de:

   1. Reemplazar la pestaña "Equipos" por el equipos_para_sheets.csv
      nuevo (ya trae los códigos cortos).
   2. Crear una pestaña llamada "Migracion_Codigos" y pegar ahí el
      contenido de migracion_codigos.csv (dos columnas:
      Codigo_Anterior, Codigo_Nuevo).
   3. En el editor de Apps Script, elegir esta función
      ("migrarCodigosEquipo") en el desplegable de funciones (al
      lado del botón Ejecutar/▶) y correrla una vez.
   4. Revisar el log (Ver → Registros) para confirmar cuántas celdas
      se actualizaron en cada pestaña.
   5. Borrar la pestaña "Migracion_Codigos" — ya cumplió su función.

   Actualiza la columna Codigo_Equipo en todas las pestañas que
   dependen del código del equipo (Equipos usa Codigo_SIGMA y ya se
   reemplazó en el paso 1, así que no se toca acá).
   ============================================================ */
/**
 * Corré esta función UNA VEZ manualmente desde el editor (▶ Ejecutar)
 * para que Google te pida el permiso de Google Drive (necesario para
 * guardar las fotos de los informes). Si ya está autorizado, simplemente
 * confirma que la carpeta existe y no hace falta nada más.
 *
 * Los permisos de Drive NO se activan solos cuando el sitio web llama al
 * Apps Script — hay que autorizarlos una vez corriendo cualquier función
 * que use Drive desde ACÁ, en el editor.
 */
function autorizarDrive() {
  const carpeta = carpetaImagenesSigma_();
  Logger.log("OK — carpeta de fotos lista: " + carpeta.getUrl());
  return carpeta.getUrl();
}

function migrarCodigosEquipo() {
  const PESTAÑAS_A_MIGRAR = [
    {nombre: "Mantenimientos", columna: "Codigo_Equipo"},
    {nombre: "Ordenes_de_Trabajo", columna: "Codigo_Equipo"},
    {nombre: "Repuestos", columna: "Codigo_Equipo"},
    {nombre: "Imagenes", columna: "Codigo_Equipo"},
    {nombre: "Mediciones", columna: "Codigo_Equipo"},
    {nombre: "Variables", columna: "Codigo_Equipo"}
  ];

  const hojaMigracion = hoja_("Migracion_Codigos");
  const filasMigracion = hojaMigracion.getDataRange().getValues();
  const encabezadosMigracion = filasMigracion[0];
  const colAnterior = encabezadosMigracion.indexOf("Codigo_Anterior");
  const colNuevo = encabezadosMigracion.indexOf("Codigo_Nuevo");
  if (colAnterior === -1 || colNuevo === -1) {
    throw new Error('La pestaña Migracion_Codigos necesita las columnas "Codigo_Anterior" y "Codigo_Nuevo".');
  }

  const mapa = {};
  for (let i = 1; i < filasMigracion.length; i++) {
    mapa[String(filasMigracion[i][colAnterior]).trim()] = filasMigracion[i][colNuevo];
  }

  const resumen = [];
  PESTAÑAS_A_MIGRAR.forEach(({nombre, columna}) => {
    let sheet;
    try {
      sheet = hoja_(nombre);
    } catch (e) {
      resumen.push(`${nombre}: pestaña no encontrada, se saltea`);
      return;
    }

    const headers = encabezados_(sheet);
    const col = headers.indexOf(columna);
    if (col === -1) {
      resumen.push(`${nombre}: no tiene columna "${columna}", se saltea`);
      return;
    }

    const totalFilas = sheet.getLastRow() - 1;
    if (totalFilas <= 0) {
      resumen.push(`${nombre}: sin filas de datos`);
      return;
    }

    const rango = sheet.getRange(2, col + 1, totalFilas, 1);
    const valores = rango.getValues();
    let actualizadas = 0;

    for (let i = 0; i < valores.length; i++) {
      const actual = String(valores[i][0]).trim();
      if (mapa.hasOwnProperty(actual)) {
        valores[i][0] = mapa[actual];
        actualizadas++;
      }
    }

    rango.setValues(valores);
    resumen.push(`${nombre}: ${actualizadas} de ${totalFilas} filas actualizadas`);
  });

  Logger.log(resumen.join("\n"));
  return resumen;
}
