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
 *    de la implementación (Implementar → Administrar implementaciones →
 *    lápiz → Nueva versión) para que los cambios tomen efecto en la URL.
 */

// Nombre exacto de cada pestaña en el Sheet
const SHEETS = {
  EQUIPOS: "Equipos",
  ORDENES: "Ordenes_de_Trabajo",
  MANTENIMIENTOS: "Mantenimientos",
  MEDICIONES: "Mediciones",
  REPUESTOS: "Repuestos"
};

/* ============================================================
   ENTRADA — doPost / doGet
   ============================================================ */

function doPost(e) {
  return withLock_(() => {
    try {
      const body = JSON.parse(e.postData.contents);
      const accion = body.action;

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
        default:
          return error_("Acción desconocida: " + accion);
      }
    } catch (err) {
      return error_(err.message);
    }
  });
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: true, mensaje: "SIGMA Apps Script activo"}))
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
  Object.keys(body).forEach(clave => {
    if (clave === "Nro_Orden") return;
    const col = headers.indexOf(clave);
    if (col !== -1) sheet.getRange(fila, col + 1).setValue(body[clave]);
  });
  return {accion: "actualizar_orden", Nro_Orden: body.Nro_Orden};
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
