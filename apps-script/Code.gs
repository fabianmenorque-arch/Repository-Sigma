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
 * PARADAS / OBJETIVOS (Dashboard "Sigma Análisis")
 * Pestañas del Sheet con estos encabezados EXACTOS en la fila 1:
 *
 *   Pestaña "Paradas":
 *     Fecha | Hora_Parada | Codigo | Causa | Descripcion | Fecha_Arranque | Hora_Arranque | Duracion_Min | Clave_Unica
 *
 *   Pestaña "Objetivos":
 *     Mes | Metrica | Valor | Unidad
 *
 * REPUESTOS CRÍTICOS (repuestos.html) — nuevo en esta versión
 *   - Equipos: se agrega sola la columna "Criticidad" (A/B/C/X).
 *   - Repuestos: columnas Codigo_Equipo | Nombre | Marca | Designacion | Codigo_Repuesto | Cant.
 *   - Precios: se crea sola al guardar el primer costo
 *     (Clave_Repuesto | Codigo_Repuesto | Nombre | Designacion | Costo_Unitario | Plazo_Dias).
 */

// Cambiá este texto cada vez que edites el script — sirve para confirmar
// desde el navegador (abriendo la URL /exec) qué versión quedó publicada.
const VERSION_SCRIPT = "2026-10-20-v19-inspecciones-bombas";

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
  OBJETIVOS: "Objetivos",
  PRECIOS: "Precios",
  OBSERVACIONES: "Observaciones",
  CAMPANIAS: "Campanias",
  CATALOGO_SAP: "Catalogo_SAP",
  SAP_DESCARTADOS: "SAP_Descartados",
  INSPECCIONES: "Inspecciones"
};

/* ============================================================
   ENTRADA — doPost / doGet
   ------------------------------------------------------------
   Toda petición (salvo "login") exige un token de sesión válido.
   El token se valida en el servidor en CADA llamada: firma, vencimiento,
   usuario activo y sesión vigente. El rol sale de la hoja Usuarios,
   nunca del navegador.
   ============================================================ */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const accion = body.action;

    // Login: sin sesión previa y sin lock (no escribe datos de negocio).
    if (accion === "login") return ok_(login_(body));

    const usuario = autenticar_(body.token);
    delete body.token;
    // OJO: nunca se registra el cuerpo completo (trae contraseñas e imágenes).
    Logger.log("doPost — action: " + accion + " | usuario: " + usuario.Usuario + " (" + usuario.Rol + ")");

    // Lecturas: sin lock, filtradas por rol.
    if (accion === "leer") return ok_(leerTablas_(usuario, body));
    // Lectura de una campaña ya archivada (para comparar años): solo Administrador y Jefe.
    if (accion === "leer_campania") return ok_(leerCampania_(usuario, body));

    // Escrituras y administración de usuarios: una a la vez (dos operarios simultáneos).
    return withLock_(() => ok_(despachar_(usuario, accion, body)));
  } catch (err) {
    Logger.log("ERROR en doPost: " + err.message + " | stack: " + err.stack);
    return error_(err.message, err.codigo);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: true, mensaje: "SIGMA Apps Script activo", version: VERSION_SCRIPT, autenticacion: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Enruta una acción ya autenticada: cuenta propia, usuarios (admin) o escrituras de negocio. */
function despachar_(usuario, accion, body) {
  switch (accion) {
    case "cambiar_clave":
      return cambiarClave_(usuario, body);
    case "listar_usuarios":
      exigirAdmin_(usuario);
      return listarUsuarios_();
    case "crear_usuario":
      exigirAdmin_(usuario);
      return crearUsuario_(body);
    case "actualizar_usuario":
      exigirAdmin_(usuario);
      return actualizarUsuario_(usuario, body);
    case "resetear_clave":
      exigirAdmin_(usuario);
      return resetearClave_(body);
    case "asignar_equipos":
      exigirAdmin_(usuario);
      return asignarEquipos_(body);
    // Campañas: solo el Administrador puede ver la vista previa, cerrar o editar la campaña activa.
    case "vista_previa_cierre":
      exigirAdmin_(usuario, "Solo un Administrador puede cerrar una campaña.");
      return vistaPreviaCierre_();
    case "cerrar_campania":
      exigirAdmin_(usuario, "Solo un Administrador puede cerrar una campaña.");
      return cerrarCampania_(usuario, body);
    case "actualizar_campania_activa":
      exigirAdmin_(usuario, "Solo un Administrador puede modificar la campaña activa.");
      return actualizarCampaniaActiva_(usuario, body);
  }

  if (ACCIONES_ESCRITURA.indexOf(accion) === -1) throw new Error("Acción desconocida: " + accion);
  if (PERMISOS[usuario.Rol].escribir.indexOf(accion) === -1) {
    throw errorPermiso_("Tu rol (" + ROLES[usuario.Rol] + ") no permite realizar esta acción.");
  }

  sanitizarCuerpo_(body);
  if (usuario.Rol === "operario") validarEscrituraOperario_(usuario, accion, body);
  if (ACCIONES_CON_AUTOR.indexOf(accion) !== -1) body.Registrado_Por = usuario.Nombre || usuario.Usuario;
  if (accion === "crear_observacion") { body.Usuario = usuario.Usuario; body.Nombre = usuario.Nombre || usuario.Usuario; }
  return ejecutarEscritura_(accion, body);
}

/** Escrituras de negocio (la lógica original de SIGMA, sin cambios). */
function ejecutarEscritura_(accion, body) {
  switch (accion) {
    case "crear_equipo":
      return crearEquipo_(body);
    case "crear_orden":
      return crearOrden_(body);
    case "actualizar_orden":
      return actualizarOrden_(body);
    case "crear_mantenimiento":
      return crearMantenimiento_(body);
    case "registrar_medicion":
      return registrarMedicion_(body);
    case "subir_imagen":
      return subirImagen_(body);
    case "crear_tarea_gestion":
      return crearTareaGestion_(body);
    case "actualizar_tarea_gestion":
      return actualizarTareaGestion_(body);
    case "crear_avance":
      return crearAvance_(body);
    case "crear_analisis":
      return crearAnalisis_(body);
    case "crear_parada":
      return crearParada_(body);
    case "guardar_objetivo":
      return guardarObjetivo_(body);
    case "actualizar_criticidad":
      return actualizarCriticidad_(body);
    case "guardar_repuesto":
      return guardarRepuesto_(body);
    case "eliminar_repuesto":
      return eliminarRepuesto_(body);
    case "guardar_precio":
      return guardarPrecio_(body);
    case "crear_observacion":
      return crearObservacion_(body);
    case "importar_catalogo_sap":
      return importarCatalogoSap_(body);
    case "aplicar_precios_sap":
      return aplicarPreciosSap_(body);
    case "nombres_sap":
      return nombresSap_(body);
    case "registrar_inspeccion":
      return registrarInspeccion_(body);
    case "actualizar_ambiental":
      return actualizarAmbiental_(body);
    default:
      throw new Error("Acción desconocida: " + accion);
  }
}

/* ============================================================
   ACCIONES
   ============================================================ */

function crearEquipo_(body) {
  const sheet = hoja_(SHEETS.EQUIPOS);
  asegurarColumna_(sheet, "Criticidad");
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
    if (col !== -1) sheet.getRange(fila, col + 1).setValue(seguro_(body[clave]));
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
  asegurarColumna_(sheet, "Registrado_Por");   // para saber quién cargó cada dato
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
const FOTO_MAX_BYTES = 12 * 1024 * 1024;   // 12 MB por foto

/** Detecta el tipo REAL de imagen mirando los primeros bytes (no se confía en lo que diga el navegador). */
function tipoImagen_(bytes) {
  const b = bytes.map(x => x & 0xFF);
  if (b.length > 12 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return {mime: "image/jpeg", ext: "jpg"};
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return {mime: "image/png", ext: "png"};
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return {mime: "image/webp", ext: "webp"};
  return null;
}

function subirImagen_(body) {
  const datos = String(body.DatosBase64 || "");
  if (!datos) throw new Error("No llegó ninguna imagen.");
  if (datos.length > FOTO_MAX_BYTES * 1.4) throw new Error("La foto es demasiado grande (máximo 12 MB). Sacala con menor resolución o recortala.");
  let bytes;
  try { bytes = Utilities.base64Decode(datos); }
  catch (e) { throw new Error("El archivo de la foto está dañado."); }
  if (bytes.length > FOTO_MAX_BYTES) throw new Error("La foto es demasiado grande (máximo 12 MB). Sacala con menor resolución o recortala.");
  const tipo = tipoImagen_(bytes);
  if (!tipo) throw new Error("Solo se aceptan fotos JPG, PNG o WEBP.");

  // El nombre lo genera el servidor: nunca se usa el que manda el navegador.
  const nombre = "sigma_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000) + "." + tipo.ext;
  const carpeta = carpetaImagenesSigma_();
  const blob = Utilities.newBlob(bytes, tipo.mime, nombre);
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
    if (col !== -1) sheet.getRange(fila, col + 1).setValue(seguro_(body[clave]));
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
      if (col !== -1) sheet.getRange(fila, col + 1).setValue(seguro_(body[clave]));
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
      if (col !== -1) sheet.getRange(fila, col + 1).setValue(seguro_(body[clave]));
    });
  }
  return {accion: "guardar_objetivo", Mes: body.Mes, Metrica: body.Metrica, actualizado: fila !== -1};
}

/* ------------------------------------------------------------
   REPUESTOS CRÍTICOS (repuestos.html)
   ------------------------------------------------------------ */

/** body.items = [{Codigo_SIGMA, Criticidad}, ...] — una o muchas a la vez. */
function actualizarCriticidad_(body) {
  const sheet = hoja_(SHEETS.EQUIPOS);
  asegurarColumna_(sheet, "Criticidad");
  const h = encabezados_(sheet);
  const cCod = h.indexOf("Codigo_SIGMA"), cCrit = h.indexOf("Criticidad");
  const n = Math.max(sheet.getLastRow() - 1, 0);
  if (!n) return {accion: "actualizar_criticidad", actualizados: 0};

  const mapa = {};
  (body.items || []).forEach(it => mapa[String(it.Codigo_SIGMA).trim()] = it.Criticidad);
  const codigos = sheet.getRange(2, cCod + 1, n, 1).getValues();
  const rango = sheet.getRange(2, cCrit + 1, n, 1);
  const vals = rango.getValues();
  let cambios = 0;
  for (let i = 0; i < n; i++) {
    const cod = String(codigos[i][0]).trim();
    if (mapa.hasOwnProperty(cod)) { vals[i][0] = seguro_(mapa[cod]); cambios++; }
  }
  rango.setValues(vals);
  return {accion: "actualizar_criticidad", actualizados: cambios};
}

/**
 * Repuestos de un equipo. Se identifica una fila por Codigo_Equipo +
 * Nombre + Designacion (los "S/C" se repiten, por eso no alcanza el código).
 * body.nuevo = true agrega siempre; si no, actualiza la fila original
 * (Orig_Nombre / Orig_Designacion) o agrega si no la encuentra.
 */
function guardarRepuesto_(body) {
  const sheet = hoja_(SHEETS.REPUESTOS);
  const datos = {};
  ["Codigo_Equipo", "Nombre", "Marca", "Designacion", "Codigo_Repuesto", "Cant."].forEach(k => datos[k] = body[k] !== undefined ? body[k] : "");
  let fila = -1;
  if (!body.nuevo) {
    fila = buscarFilaMulti_(sheet, {
      Codigo_Equipo: body.Codigo_Equipo,
      Nombre: body.Orig_Nombre !== undefined ? body.Orig_Nombre : body.Nombre,
      Designacion: body.Orig_Designacion !== undefined ? body.Orig_Designacion : body.Designacion
    });
  }
  if (fila === -1) agregarFilaPorEncabezados_(sheet, datos);
  else actualizarFila_(sheet, fila, datos);
  return {accion: "guardar_repuesto", Codigo_Equipo: body.Codigo_Equipo, actualizado: fila !== -1};
}

function eliminarRepuesto_(body) {
  const sheet = hoja_(SHEETS.REPUESTOS);
  const fila = buscarFilaMulti_(sheet, {
    Codigo_Equipo: body.Codigo_Equipo, Nombre: body.Nombre, Designacion: body.Designacion
  });
  if (fila === -1) throw new Error("No se encontró ese repuesto.");
  sheet.deleteRow(fila);
  return {accion: "eliminar_repuesto", Codigo_Equipo: body.Codigo_Equipo};
}

/** Costo y plazo por repuesto. Upsert por Clave_Repuesto (la pestaña se crea sola). */
function guardarPrecio_(body) {
  const sheet = hojaOCrear_(SHEETS.PRECIOS,
    ["Clave_Repuesto", "Codigo_Repuesto", "Nombre", "Designacion", "Costo_Unitario", "Plazo_Dias"]);
  if (!body.Clave_Repuesto) throw new Error("Falta Clave_Repuesto.");
  const fila = buscarFila_(sheet, "Clave_Repuesto", body.Clave_Repuesto);
  if (fila === -1) agregarFilaPorEncabezados_(sheet, body);
  else actualizarFila_(sheet, fila, body);
  return {accion: "guardar_precio", Clave_Repuesto: body.Clave_Repuesto, actualizado: fila !== -1};
}

function carpetaImagenesSigma_() {
  const nombre = "SIGMA - Fotos de mantenimiento";
  const carpetas = DriveApp.getFoldersByName(nombre);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(nombre);
}

/* ============================================================
   USUARIOS, ROLES Y SESIONES
   ------------------------------------------------------------
   Hoja "Usuarios" (se crea sola): Usuario | Nombre | Rol | Clave_Hash |
   Salt | Activo | Debe_Cambiar | Sesion | Fecha_Creacion | Ultimo_Acceso
   Las contraseñas NUNCA se guardan en claro: se guarda un hash con sal
   y "pimienta" (secreto del script, guardado en Propiedades del script).

   >>> PARA CAMBIAR QUÉ PUEDE HACER CADA ROL, EDITÁ SOLO "PERMISOS" <<<
   ============================================================ */

const HOJA_USUARIOS = "Usuarios";
const COLUMNAS_USUARIOS = ["Usuario", "Nombre", "Rol", "Clave_Hash", "Salt", "Activo", "Debe_Cambiar", "Sesion", "Fecha_Creacion", "Ultimo_Acceso", "Equipos"];

const DURACION_SESION_HORAS = 12;   // un turno; después hay que volver a ingresar
const MAX_INTENTOS = 5;             // intentos fallidos antes de bloquear
const BLOQUEO_SEGUNDOS = 600;       // 10 minutos
const ITERACIONES_HASH = 1000;
const CLAVE_MINIMA = 8;

// Usuario del primer administrador (lo crea crearAdministradorInicial)
const ADMIN_INICIAL_USUARIO = "fabian";
const ADMIN_INICIAL_NOMBRE = "Fabian";

const ROLES = {
  admin: "Administrador",
  jefe: "Jefe / Supervisor",
  tecnico: "Técnico",
  operario: "Operario",
  lectura: "Solo lectura"
};

// Pestañas de datos del sistema (la hoja "Usuarios" NO está en ninguna lista: nadie puede leerla desde la web)
const PESTANAS_OPERATIVAS = ["Equipos", "Mantenimientos", "Ordenes_de_Trabajo", "Imagenes", "Variables",
  "Mediciones", "Avances_Orden", "Repuestos", "Reparaciones_Programadas", "Paradas", "Observaciones", "Campanias", "Inspecciones"];
const PESTANAS_TODAS = PESTANAS_OPERATIVAS.concat(["Analisis_Sector", "Objetivos", "Gestion_Tareas", "Precios", "Catalogo_SAP", "SAP_Descartados"]);

const ACCIONES_ESCRITURA = ["crear_equipo", "crear_orden", "actualizar_orden", "crear_mantenimiento",
  "registrar_medicion", "subir_imagen", "crear_tarea_gestion", "actualizar_tarea_gestion", "crear_avance",
  "crear_analisis", "crear_parada", "guardar_objetivo", "actualizar_criticidad", "guardar_repuesto",
  "eliminar_repuesto", "guardar_precio", "crear_observacion", "importar_catalogo_sap", "aplicar_precios_sap", "nombres_sap",
  "registrar_inspeccion", "actualizar_ambiental"];

// Acciones que dejan registrado quién cargó el dato (si la pestaña tiene una columna "Registrado_Por")
const ACCIONES_CON_AUTOR = ["crear_observacion", "crear_equipo", "crear_orden", "crear_mantenimiento", "registrar_medicion",
  "subir_imagen", "crear_tarea_gestion", "crear_avance", "crear_analisis", "crear_parada", "registrar_inspeccion"];

const PAGINAS_BASE = ["dashboard", "novedades", "equipos", "qr", "ordenes", "informes", "repuestos", "bombas", "observaciones", "inspecciones"];

const PERMISOS = {
  admin: {
    leer: PESTANAS_TODAS,
    escribir: ACCIONES_ESCRITURA,
    paginas: PAGINAS_BASE.concat(["analisis", "alta", "gestion", "usuarios", "campanias"]),
    inicio: "dashboard.html"
  },
  jefe: {
    leer: PESTANAS_TODAS,
    escribir: ACCIONES_ESCRITURA,
    paginas: PAGINAS_BASE.concat(["analisis", "alta", "gestion", "campanias"]),
    inicio: "dashboard.html"
  },
  tecnico: {
    leer: PESTANAS_OPERATIVAS,
    escribir: ["crear_orden", "actualizar_orden", "registrar_medicion", "subir_imagen", "crear_avance", "crear_observacion", "registrar_inspeccion"],
    paginas: PAGINAS_BASE,
    inicio: "dashboard.html"
  },
  // Operario: SOLO los equipos que el Administrador le asigna, y una única pantalla ("Mis equipos").
  // Puede cargar un dato (de las variables configuradas del equipo) y una observación con su hora.
  operario: {
    leer: ["Equipos", "Variables", "Mediciones", "Observaciones"],
    escribir: ["registrar_medicion", "crear_observacion"],
    paginas: ["mis_equipos"],
    inicio: "mis_equipos.html",
    soloEquiposAsignados: true
  },
  lectura: {
    leer: PESTANAS_OPERATIVAS.concat(["Analisis_Sector", "Objetivos"]),
    escribir: [],
    paginas: PAGINAS_BASE.concat(["analisis"]),
    inicio: "dashboard.html"
  }
};

/* ---------------- Errores ---------------- */

function errorPermiso_(mensaje) {
  const e = new Error(mensaje || "No tenés permiso para realizar esta acción.");
  e.codigo = "PERMISO";
  return e;
}

function errorSesion_(mensaje) {
  const e = new Error(mensaje || "Tu sesión venció. Volvé a ingresar.");
  e.codigo = "SESION";
  return e;
}

function exigirAdmin_(usuario, mensaje) {
  if (usuario.Rol !== "admin") throw errorPermiso_(mensaje || "Solo un Administrador puede gestionar usuarios.");
}

/* ---------------- Criptografía ---------------- */

/** Secreto del script (firma de tokens + pimienta de contraseñas). Se genera una vez. */
function secreto_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("SIGMA_SECRETO");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("SIGMA_SECRETO", s);
  }
  return s;
}

function firmar_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secreto_()));
}

function igualesSeguro_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hashClave_(clave, salt, iteraciones) {
  const iter = iteraciones || ITERACIONES_HASH;
  const llave = secreto_() + salt;
  let h = salt + "|" + clave;
  for (let i = 0; i < iter; i++) {
    h = Utilities.base64Encode(Utilities.computeHmacSha256Signature(h, llave));
  }
  return "v1$" + iter + "$" + h;
}

function claveCorrecta_(clave, salt, hashGuardado) {
  const partes = String(hashGuardado).split("$");
  const iter = parseInt(partes[1], 10) || ITERACIONES_HASH;
  return igualesSeguro_(hashClave_(clave, salt, iter), hashGuardado);
}

function validarClaveNueva_(clave) {
  if (String(clave || "").length < CLAVE_MINIMA) {
    throw new Error("La contraseña debe tener al menos " + CLAVE_MINIMA + " caracteres.");
  }
}

/* ---------------- Tokens de sesión ---------------- */

function emitirToken_(u) {
  const carga = {u: u.Usuario, s: u.Sesion, e: Date.now() + DURACION_SESION_HORAS * 3600000};
  const p = Utilities.base64EncodeWebSafe(JSON.stringify(carga), Utilities.Charset.UTF_8);
  return p + "." + firmar_(p);
}

/** Valida el token y devuelve el usuario ACTUAL según la hoja (rol, estado y sesión vigentes). */
function autenticar_(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) throw errorSesion_("Iniciá sesión para continuar.");
  const partes = token.split(".");
  if (partes.length !== 2 || !igualesSeguro_(firmar_(partes[0]), partes[1])) throw errorSesion_();

  let carga;
  try {
    carga = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString("UTF-8"));
  } catch (e) {
    throw errorSesion_();
  }
  if (!carga || !carga.e || Date.now() > carga.e) throw errorSesion_();

  const u = mapaUsuarios_()[carga.u];
  if (!u || u.Activo !== "SI" || !carga.s || u.Sesion !== carga.s) throw errorSesion_();
  return u;
}

/** Datos de sesión que recibe el navegador (los permisos salen de PERMISOS: única fuente de verdad). */
function respuestaSesion_(u) {
  const p = PERMISOS[u.Rol];
  return {
    token: emitirToken_(u),
    usuario: u.Usuario,
    nombre: u.Nombre,
    rol: u.Rol,
    rolNombre: ROLES[u.Rol],
    debeCambiar: u.Debe_Cambiar === "SI",
    expira: Date.now() + DURACION_SESION_HORAS * 3600000,
    inicio: p.inicio,
    permisos: {leer: p.leer, escribir: p.escribir, paginas: p.paginas}
  };
}

/* ---------------- Hoja de usuarios ---------------- */

function hojaUsuarios_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(HOJA_USUARIOS);
  if (!s) {
    s = ss.insertSheet(HOJA_USUARIOS);
    s.appendRow(COLUMNAS_USUARIOS);
    // Todo como texto: evita que Sheets convierta fechas/hashes y deje valores inesperados.
    s.getRange(1, 1, s.getMaxRows(), COLUMNAS_USUARIOS.length).setNumberFormat("@");
    s.setFrozenRows(1);
  } else {
    COLUMNAS_USUARIOS.forEach(c => asegurarColumna_(s, c));
  }
  return s;
}

/** Todos los usuarios como objetos (con número de fila). Usa texto tal cual se ve en la hoja. */
function usuariosDeHoja_() {
  const s = hojaUsuarios_();
  const ult = s.getLastRow();
  if (ult < 2) return [];
  const h = encabezados_(s).map(x => String(x).trim());
  const vals = s.getRange(2, 1, ult - 1, h.length).getDisplayValues();
  const salida = [];
  vals.forEach((fila, i) => {
    const o = {_fila: i + 2};
    h.forEach((nombre, j) => o[nombre] = String(fila[j]).trim());
    if (o.Usuario) salida.push(o);
  });
  return salida;
}

/** {usuario: datos} con caché corta (se invalida en cada cambio de usuarios). */
function mapaUsuarios_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("SIGMA_USUARIOS");
  if (guardado) return JSON.parse(guardado);
  const mapa = {};
  usuariosDeHoja_().forEach(u => {
    mapa[u.Usuario] = {Usuario: u.Usuario, Nombre: u.Nombre, Rol: u.Rol, Activo: u.Activo, Debe_Cambiar: u.Debe_Cambiar, Sesion: u.Sesion, Equipos: u.Equipos || ""};
  });
  cache.put("SIGMA_USUARIOS", JSON.stringify(mapa), 60);
  return mapa;
}

function invalidarCacheUsuarios_() {
  CacheService.getScriptCache().remove("SIGMA_USUARIOS");
}

function normalizarUsuario_(u) {
  return String(u || "").trim().toLowerCase();
}

function buscarUsuario_(id) {
  const lista = usuariosDeHoja_();
  for (let i = 0; i < lista.length; i++) if (lista[i].Usuario === id) return lista[i];
  return null;
}

function guardarCamposUsuario_(fila, campos) {
  const s = hojaUsuarios_();
  const h = encabezados_(s).map(x => String(x).trim());
  Object.keys(campos).forEach(k => {
    const c = h.indexOf(k);
    if (c !== -1) s.getRange(fila, c + 1).setValue(seguro_(campos[k]));
  });
  invalidarCacheUsuarios_();
}

function nuevaSesion_() {
  return Utilities.getUuid();
}

function ahoraISO_() {
  return new Date().toISOString();
}

/* ---------------- Login ---------------- */

function login_(body) {
  const id = normalizarUsuario_(body.Usuario);
  const clave = String(body.Clave || "");
  if (!id || !clave) throw new Error("Ingresá tu usuario y tu contraseña.");

  const cache = CacheService.getScriptCache();
  const kFallos = "SIGMA_FALLOS_" + id;
  const fallos = parseInt(cache.get(kFallos) || "0", 10);
  if (fallos >= MAX_INTENTOS) {
    throw new Error("Demasiados intentos fallidos. Esperá 10 minutos y volvé a intentar.");
  }

  const u = buscarUsuario_(id);
  // Si el usuario no existe se calcula igual un hash, para no delatar qué usuarios existen por el tiempo de respuesta.
  const correcta = u ? claveCorrecta_(clave, u.Salt, u.Clave_Hash) : (hashClave_(clave, "sin-usuario"), false);
  if (!correcta) {
    cache.put(kFallos, String(fallos + 1), BLOQUEO_SEGUNDOS);
    throw new Error("Usuario o contraseña incorrectos.");
  }
  if (u.Activo !== "SI") throw new Error("Tu usuario está desactivado. Consultá con el Administrador.");
  if (!ROLES[u.Rol]) throw new Error("Tu usuario no tiene un rol válido. Consultá con el Administrador.");

  cache.remove(kFallos);
  guardarCamposUsuario_(u._fila, {Ultimo_Acceso: ahoraISO_()});
  return respuestaSesion_(u);
}

/* ---------------- Cuenta propia ---------------- */

function cambiarClave_(usuarioSesion, body) {
  const u = buscarUsuario_(usuarioSesion.Usuario);
  if (!u) throw errorSesion_();

  const cache = CacheService.getScriptCache();
  const kFallos = "SIGMA_FALLOS_" + u.Usuario;
  const fallos = parseInt(cache.get(kFallos) || "0", 10);
  if (fallos >= MAX_INTENTOS) throw new Error("Demasiados intentos fallidos. Esperá 10 minutos y volvé a intentar.");

  if (!claveCorrecta_(String(body.ClaveActual || ""), u.Salt, u.Clave_Hash)) {
    cache.put(kFallos, String(fallos + 1), BLOQUEO_SEGUNDOS);
    throw new Error("La contraseña actual no es correcta.");
  }
  validarClaveNueva_(body.ClaveNueva);
  if (String(body.ClaveNueva) === String(body.ClaveActual)) throw new Error("La contraseña nueva tiene que ser distinta de la actual.");

  const salt = Utilities.getUuid();
  const sesion = nuevaSesion_();   // cierra las demás sesiones abiertas con la clave vieja
  guardarCamposUsuario_(u._fila, {Salt: salt, Clave_Hash: hashClave_(String(body.ClaveNueva), salt), Debe_Cambiar: "NO", Sesion: sesion});
  cache.remove(kFallos);
  return respuestaSesion_({Usuario: u.Usuario, Nombre: u.Nombre, Rol: u.Rol, Debe_Cambiar: "NO", Sesion: sesion});
}

/* ---------------- Administración de usuarios (solo Administrador) ---------------- */

function listarUsuarios_() {
  const roles = {};
  Object.keys(ROLES).forEach(r => {
    roles[r] = {nombre: ROLES[r], leer: PERMISOS[r].leer, escribir: PERMISOS[r].escribir, paginas: PERMISOS[r].paginas, soloEquiposAsignados: !!PERMISOS[r].soloEquiposAsignados};
  });
  return {
    usuarios: usuariosDeHoja_().map(u => ({
      Usuario: u.Usuario, Nombre: u.Nombre, Rol: u.Rol, Activo: u.Activo === "SI",
      Debe_Cambiar: u.Debe_Cambiar === "SI", Fecha_Creacion: u.Fecha_Creacion, Ultimo_Acceso: u.Ultimo_Acceso,
      Equipos: listaEquipos_(u.Equipos)
    })),
    roles: roles
  };
}

function crearUsuario_(body) {
  const id = normalizarUsuario_(body.Usuario);
  if (!/^[a-z0-9._-]{3,30}$/.test(id)) {
    throw new Error("El usuario debe tener entre 3 y 30 caracteres: letras sin tildes, números, punto, guion o guion bajo.");
  }
  const nombre = String(body.Nombre || "").trim();
  if (!nombre || nombre.length > 80) throw new Error("Ingresá el nombre completo (hasta 80 caracteres).");
  if (!ROLES[body.Rol]) throw new Error("Elegí un rol válido.");
  validarClaveNueva_(body.Clave);
  if (buscarUsuario_(id)) throw new Error("Ya existe un usuario '" + id + "'.");

  const salt = Utilities.getUuid();
  const s = hojaUsuarios_();
  agregarFilaPorEncabezados_(s, {
    Usuario: id, Nombre: nombre.replace(/[<>]/g, ""), Rol: body.Rol,
    Clave_Hash: hashClave_(String(body.Clave), salt), Salt: salt,
    Activo: "SI", Debe_Cambiar: "SI", Sesion: nuevaSesion_(),
    Fecha_Creacion: ahoraISO_(), Ultimo_Acceso: ""
  });
  invalidarCacheUsuarios_();
  return {accion: "crear_usuario", Usuario: id};
}

function administradoresActivos_() {
  return usuariosDeHoja_().filter(u => u.Rol === "admin" && u.Activo === "SI");
}

function actualizarUsuario_(actor, body) {
  const id = normalizarUsuario_(body.Usuario);
  const u = buscarUsuario_(id);
  if (!u) throw new Error("No existe el usuario '" + id + "'.");

  const cambios = {};
  let cierraSesion = false;

  if (body.Nombre !== undefined) {
    const n = String(body.Nombre).trim().replace(/[<>]/g, "");
    if (!n || n.length > 80) throw new Error("Ingresá el nombre completo (hasta 80 caracteres).");
    cambios.Nombre = n;
  }
  if (body.Rol !== undefined && body.Rol !== u.Rol) {
    if (!ROLES[body.Rol]) throw new Error("Elegí un rol válido.");
    cambios.Rol = body.Rol;
    cierraSesion = true;
  }
  if (body.Activo !== undefined) {
    const nuevoActivo = body.Activo ? "SI" : "NO";
    if (nuevoActivo !== u.Activo) { cambios.Activo = nuevoActivo; cierraSesion = true; }
  }

  // Protecciones: no quedarse sin administradores ni auto-degradarse.
  const dejaDeSerAdminActivo = u.Rol === "admin" && u.Activo === "SI" &&
    ((cambios.Rol && cambios.Rol !== "admin") || cambios.Activo === "NO");
  if (dejaDeSerAdminActivo) {
    if (u.Usuario === actor.Usuario) throw new Error("No podés quitarte a vos mismo el rol de Administrador ni desactivarte.");
    if (administradoresActivos_().length <= 1) throw new Error("Tiene que quedar al menos un Administrador activo.");
  }
  if (u.Usuario === actor.Usuario && cambios.Activo === "NO") throw new Error("No podés desactivarte a vos mismo.");

  if (cierraSesion) cambios.Sesion = nuevaSesion_();   // las sesiones abiertas dejan de valer al instante
  if (!Object.keys(cambios).length) return {accion: "actualizar_usuario", Usuario: id, sinCambios: true};
  guardarCamposUsuario_(u._fila, cambios);
  return {accion: "actualizar_usuario", Usuario: id};
}

function resetearClave_(body) {
  const id = normalizarUsuario_(body.Usuario);
  const u = buscarUsuario_(id);
  if (!u) throw new Error("No existe el usuario '" + id + "'.");
  validarClaveNueva_(body.Clave);
  const salt = Utilities.getUuid();
  guardarCamposUsuario_(u._fila, {Salt: salt, Clave_Hash: hashClave_(String(body.Clave), salt), Debe_Cambiar: "SI", Sesion: nuevaSesion_()});
  CacheService.getScriptCache().remove("SIGMA_FALLOS_" + id);
  return {accion: "resetear_clave", Usuario: id};
}

/* ---------------- Lectura de datos filtrada por rol ---------------- */

/** Reemplaza al CSV público: devuelve las pestañas pedidas que el rol puede ver. */
function leerTablas_(usuario, body) {
  const nombres = Array.isArray(body.tablas) ? body.tablas : [body.tabla];
  const permitidas = PERMISOS[usuario.Rol].leer;
  const salida = {};
  nombres.slice(0, 20).forEach(n => {
    try {
      if (permitidas.indexOf(n) === -1) throw errorPermiso_("Tu rol no tiene acceso a '" + n + "'.");
      let filas = filasDeHoja_(n);
      if (PERMISOS[usuario.Rol].soloEquiposAsignados) filas = filtrarPorEquipos_(n, filas, usuario);
      salida[n] = {ok: true, filas: filas};
    } catch (err) {
      salida[n] = {ok: false, error: err.message, codigo: err.codigo || ""};
    }
  });
  return salida;
}

/** Filas de una pestaña como objetos {columna: texto}, igual que el viejo parser de CSV. */
function filasDeHoja_(nombre, ss) {
  // Con "ss" (un Sheet distinto del activo) se lee de una campaña archivada.
  let sheet;
  if (ss) {
    sheet = ss.getSheetByName(nombre);
    if (!sheet) throw new Error("La campaña archivada no tiene la pestaña '" + nombre + "'.");
  } else {
    sheet = nombre === SHEETS.OBSERVACIONES ? hojaObservaciones_()
          : nombre === SHEETS.INSPECCIONES ? hojaInspecciones_()
          : hoja_(nombre);
  }
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return [];
  const vals = sheet.getDataRange().getDisplayValues();
  const h = vals.shift().map(x => String(x).trim());
  const filas = [];
  vals.forEach(r => {
    if (!r.some(v => String(v) !== "")) return;
    const o = {};
    h.forEach((nombreCol, j) => { if (nombreCol) o[nombreCol] = String(r[j] === undefined ? "" : r[j]).trim(); });
    filas.push(o);
  });
  return filas;
}

/** Evita HTML inyectado en los datos (un usuario de menor rol no debe poder atacar a un Administrador). */
/** Evita la "inyección de fórmulas": si un texto empieza con = + @ (o - que no sea un número),
 *  Sheets lo interpretaría como fórmula (falsear datos o enviar información hacia afuera).
 *  Se antepone un apóstrofe, que Sheets usa como marca de "texto" y no muestra. Los números no se tocan. */
function seguro_(v) {
  if (typeof v !== "string" || !v) return v;
  if (/^[=+@\t\r]/.test(v) || (v.charAt(0) === "-" && !/^-\s?[\d.,]+\s*$/.test(v))) return "'" + v;
  return v;
}

function sanitizarCuerpo_(obj) {
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (typeof v === "string") {
      if (k !== "DatosBase64") obj[k] = v.replace(/</g, "＜").replace(/>/g, "＞");
    } else if (Array.isArray(v)) {
      v.forEach(it => { if (it && typeof it === "object") sanitizarCuerpo_(it); });
    } else if (v && typeof v === "object") {
      sanitizarCuerpo_(v);
    }
  });
}

/* ============================================================
   INSPECCIONES DE BOMBAS — control ambiental
   ------------------------------------------------------------
   Procedimiento de inspección de bombas (niveles 1 a 4). Cada inspección
   queda en la pestaña "Inspecciones"; el servidor CLASIFICA el resultado
   (Normal / Alerta / Crítico / Riesgo para personas) con los criterios del
   procedimiento — nunca confía en la clase que diga el navegador — y, si no
   es Normal, crea una orden de trabajo (o reutiliza la que ya está abierta
   para ese equipo).
   Los puntos de verificación de ITEMS_INSPECCION deben coincidir con los de
   inspecciones.html (mismos "id").
   ============================================================ */

const COLUMNAS_INSPECCIONES = ["Nro_Inspeccion", "Codigo_Equipo", "Nivel", "Fecha_Hora", "Inspector", "Estado_Bomba", "Clase",
  "Hallazgos", "Temp_Rodamiento_C", "Fuga_Sello", "Nivel_Aceite", "Ruido", "Derrame_Ambiente", "Riesgo_Personas",
  "Observaciones", "Detalle", "Nro_Orden", "Registrado_Por", "Fecha_Registro"];

const CLASES_INSPECCION = ["Normal", "Alerta", "Crítico", "Riesgo para personas"];
const OPCIONES_FUGA_SELLO = ["Ninguna visible", "Gota ocasional", "Goteo continuo o chorro"];
const OPCIONES_NIVEL_ACEITE = ["En el visor, aceite claro", "Bajo o turbio", "Vacío o con agua"];
const OPCIONES_RUIDO = ["Uniforme", "Zumbido o roce leve", "Golpeteo, chirrido o cavitación"];
const TEMP_RODAMIENTO_ALERTA_C = 70;    // más de 70 °C: Alerta
const TEMP_RODAMIENTO_CRITICA_C = 90;   // más de 90 °C: Crítico
const PRIORIDADES_AMBIENTALES = ["", "Alta", "Media", "Baja"];

// nivel = primer nivel de inspección en que se revisa el punto (los niveles son acumulativos).
const ITEMS_INSPECCION = [
  {id: "m1", nivel: 1, texto: "Ruido: sin golpeteo, chirridos ni sonido de grava (cavitación)"},
  {id: "m2", nivel: 1, texto: "Vibración: sin aumento perceptible frente a la ronda anterior"},
  {id: "m3", nivel: 2, texto: "Presión de succión y descarga estables y dentro del rango de operación"},
  {id: "m4", nivel: 3, texto: "Corriente del motor dentro del valor de placa y sin oscilaciones"},
  {id: "m5", nivel: 1, texto: "Temperatura de rodamientos y carcasa del motor sin elevación anormal"},
  {id: "m6", nivel: 1, texto: "Sellado: sin goteo excesivo en sello mecánico (o goteo normal en empaquetadura)"},
  {id: "m7", nivel: 2, texto: "Instrumentos locales (manómetros, termómetros) legibles y operativos"},
  {id: "g1", nivel: 1, texto: "Sin fugas en bridas, juntas, drenajes ni conexiones"},
  {id: "g2", nivel: 2, texto: "Tornillos de base, carcasa y acople completos y ajustados"},
  {id: "g3", nivel: 1, texto: "Guarda del acople colocada y en buen estado"},
  {id: "g4", nivel: 2, texto: "Nivel y color del aceite correctos; respiradero limpio; grasa según plan"},
  {id: "g5", nivel: 2, texto: "Tuberías y soportes sin tensiones ni vibración; sin deformación de la base"},
  {id: "g6", nivel: 2, texto: "Corrosión, pintura y orden y limpieza del entorno"},
  {id: "g7", nivel: 2, texto: "Ventilación del motor libre, sin acumulación de bagazo, polvo o producto"},
  {id: "a1", nivel: 1, texto: "Contención (bandeja, muro o cubeto) íntegra, limpia y sin líquido acumulado"},
  {id: "a2", nivel: 2, texto: "Drenaje de la contención cerrado y sin conexión directa a canal o desagüe"},
  {id: "a3", nivel: 1, texto: "Sin manchas, charcos, goteos ni humedad en el suelo alrededor de la bomba"},
  {id: "a4", nivel: 1, texto: "Sin rastros de producto en canaletas, zanjas o alcantarillas cercanas"},
  {id: "a5", nivel: 1, texto: "Sello, bridas y válvulas sin fuga; goteras de purga recogidas y no al piso"},
  {id: "a6", nivel: 2, texto: "Alarmas de nivel o de fuga operativas, si la bomba las tiene"},
  {id: "a7", nivel: 2, texto: "Kit antiderrame completo y señalizado cerca del equipo"},
  {id: "a8", nivel: 1, texto: "Olores o espuma anormales avisados al área ambiental"},
  {id: "d1", nivel: 4, texto: "Alineación y estado del acople (elemento flexible, huelgas)"},
  {id: "d2", nivel: 4, texto: "Juego axial y radial del eje; giro libre a mano"},
  {id: "d3", nivel: 4, texto: "Estado de sello o empaquetadura y camisas del eje"},
  {id: "d4", nivel: 4, texto: "Desgaste visible de rodete, anillos de desgaste y carcasa si se abre"},
  {id: "d5", nivel: 4, texto: "Pata coja y estado de la bancada"}
];

function hojaInspecciones_() {
  return hojaOCrear_(SHEETS.INSPECCIONES, COLUMNAS_INSPECCIONES);
}

/** Opción elegida (índice 0, 1 o 2) o -1 si no se eligió; error si no es una opción válida. */
function indiceOpcion_(valor, opciones, etiqueta) {
  const v = String(valor === undefined || valor === null ? "" : valor).trim();
  if (!v) return -1;
  const i = opciones.indexOf(v);
  if (i === -1) throw new Error("Valor no válido en '" + etiqueta + "'.");
  return i;
}

function verdadero_(v) { return v === true || v === "true" || v === "TRUE" || v === "Sí"; }

/**
 * Aplica los criterios del procedimiento. Devuelve {rango, clase, hallazgos}.
 * rango: 0 Normal · 1 Alerta · 2 Crítico · 3 Riesgo para personas.
 */
function clasificarInspeccion_(nivel, respuestas, med, banderas) {
  let rango = 0;
  const hallazgos = [];
  const sube = (r, texto) => { if (r > rango) rango = r; if (texto) hallazgos.push(texto); };

  ITEMS_INSPECCION.forEach(it => {
    if (it.nivel <= nivel && respuestas[it.id] === "falla") sube(1, it.texto);
  });

  if (med.temp !== null) {
    if (med.temp > TEMP_RODAMIENTO_CRITICA_C) sube(2, "Temperatura de rodamiento " + med.temp + " °C (más de " + TEMP_RODAMIENTO_CRITICA_C + ")");
    else if (med.temp > TEMP_RODAMIENTO_ALERTA_C) sube(1, "Temperatura de rodamiento " + med.temp + " °C (más de " + TEMP_RODAMIENTO_ALERTA_C + ")");
  }
  if (med.fuga > 0) sube(med.fuga, "Fuga del sello mecánico: " + OPCIONES_FUGA_SELLO[med.fuga]);
  if (med.aceite > 0) sube(med.aceite, "Nivel de aceite: " + OPCIONES_NIVEL_ACEITE[med.aceite]);
  if (med.ruido > 0) sube(med.ruido, "Ruido: " + OPCIONES_RUIDO[med.ruido]);
  if (banderas.derrame) sube(2, "Derrame o fuga al ambiente");
  if (banderas.riesgo) sube(3, "Riesgo para las personas");

  return {rango: rango, clase: CLASES_INSPECCION[rango], hallazgos: hallazgos};
}

/** Orden abierta, generada por una inspección, para ese equipo (si la hay). */
function ordenAbiertaDeInspeccion_(codigo) {
  const abiertas = filasDeHoja_(SHEETS.ORDENES).filter(o =>
    o.Codigo_Equipo === codigo && o.Estado !== "Completada" && String(o.Observaciones || "").indexOf("Generada por inspección") === 0);
  return abiertas.length ? abiertas[abiertas.length - 1] : null;
}

/**
 * body: { Codigo_Equipo, Nivel (1-4), Fecha_Hora, Estado_Bomba, Respuestas {id: "ok"|"falla"|"na"},
 *         Temp_Rodamiento_C, Fuga_Sello, Nivel_Aceite, Ruido, Derrame_Ambiente, Riesgo_Personas, Observaciones }
 */
function registrarInspeccion_(body) {
  const codigo = String(body.Codigo_Equipo || "").trim();
  if (!codigo || !existeValor_(hoja_(SHEETS.EQUIPOS), "Codigo_SIGMA", codigo)) {
    throw new Error("No existe el equipo " + codigo + ".");
  }
  const nivel = parseInt(body.Nivel, 10);
  if ([1, 2, 3, 4].indexOf(nivel) === -1) throw new Error("El nivel de inspección tiene que ser 1, 2, 3 o 4.");
  const estadoBomba = body.Estado_Bomba === "Detenida" ? "Detenida" : "En marcha";
  const fechaHora = validarFechaHora_(body.Fecha_Hora);

  const resp = (body.Respuestas && typeof body.Respuestas === "object") ? body.Respuestas : {};
  const respuestas = {};
  ITEMS_INSPECCION.forEach(it => {
    if (it.nivel > nivel) return;
    const r = resp[it.id];
    if (r !== "ok" && r !== "falla" && r !== "na") throw new Error("Falta responder: " + it.texto);
    respuestas[it.id] = r;
  });

  let temp = null;
  const tTxt = String(body.Temp_Rodamiento_C === undefined ? "" : body.Temp_Rodamiento_C).replace(",", ".").trim();
  if (tTxt) {
    temp = Number(tTxt);
    if (!isFinite(temp) || temp < -20 || temp > 400) throw new Error("La temperatura del rodamiento no es válida.");
  }
  const med = {
    temp: temp,
    fuga: Math.max(indiceOpcion_(body.Fuga_Sello, OPCIONES_FUGA_SELLO, "Fuga del sello"), 0),
    aceite: Math.max(indiceOpcion_(body.Nivel_Aceite, OPCIONES_NIVEL_ACEITE, "Nivel de aceite"), 0),
    ruido: Math.max(indiceOpcion_(body.Ruido, OPCIONES_RUIDO, "Ruido"), 0)
  };
  const banderas = {derrame: verdadero_(body.Derrame_Ambiente), riesgo: verdadero_(body.Riesgo_Personas)};
  const obs = String(body.Observaciones || "").trim();
  if (obs.length > 1000) throw new Error("La observación es muy larga (máximo 1000 caracteres).");

  const cl = clasificarInspeccion_(nivel, respuestas, med, banderas);

  // Orden de trabajo ante Alerta, Crítico o Riesgo para personas.
  let nroOrden = "", ordenNueva = false, ordenEscalada = false;
  const nroInspeccion = "INS-" + new Date().getTime();
  if (cl.rango > 0) {
    const plazo = cl.rango === 1 ? "antes de 7 días" : (cl.rango === 2 ? "inmediato o en la primera ventana" : "en el acto");
    const existente = ordenAbiertaDeInspeccion_(codigo);
    if (existente) {
      nroOrden = existente.Nro_Orden;
      if (cl.rango >= 2 && (existente.Prioridad !== "Alta" || existente.Tipo !== "Correctivo")) {
        actualizarOrden_({Nro_Orden: nroOrden, Prioridad: "Alta", Tipo: "Correctivo"});
        ordenEscalada = true;
      }
    } else {
      nroOrden = "OT-" + new Date().getTime();
      const descripcion = ("Inspección nivel " + nivel + " (" + cl.clase + "): " + cl.hallazgos.join("; ") +
        ". Plazo: " + plazo + "." + (obs ? " Obs.: " + obs : "")).slice(0, 900);
      crearOrden_({
        Nro_Orden: nroOrden,
        Codigo_Equipo: codigo,
        Descripcion: descripcion,
        Tipo: cl.rango === 1 ? "Predictivo" : "Correctivo",
        Prioridad: cl.rango === 1 ? "Media" : "Alta",
        Estado: "Pendiente",
        Responsable: "",
        Fecha_Creacion: ahoraISO_(),
        Fecha_Inicio: "",
        Fecha_Cierre_Real: "",
        Observaciones: "Generada por inspección " + nroInspeccion
      });
      ordenNueva = true;
    }
  }

  agregarFilaPorEncabezados_(hojaInspecciones_(), {
    Nro_Inspeccion: nroInspeccion,
    Codigo_Equipo: codigo,
    Nivel: nivel,
    Fecha_Hora: fechaHora,
    Inspector: body.Registrado_Por || "",
    Estado_Bomba: estadoBomba,
    Clase: cl.clase,
    Hallazgos: cl.hallazgos.join("; "),
    Temp_Rodamiento_C: temp === null ? "" : temp,
    Fuga_Sello: body.Fuga_Sello || "",
    Nivel_Aceite: body.Nivel_Aceite || "",
    Ruido: body.Ruido || "",
    Derrame_Ambiente: banderas.derrame ? "Sí" : "",
    Riesgo_Personas: banderas.riesgo ? "Sí" : "",
    Observaciones: obs,
    Detalle: JSON.stringify(respuestas),
    Nro_Orden: nroOrden,
    Registrado_Por: body.Registrado_Por || "",
    Fecha_Registro: ahoraISO_()
  });

  return {accion: "registrar_inspeccion", Nro_Inspeccion: nroInspeccion, Clase: cl.clase, Hallazgos: cl.hallazgos,
    Nro_Orden: nroOrden, orden_nueva: ordenNueva, orden_escalada: ordenEscalada};
}

/**
 * Jefe/Administrador: marca qué bombas entran en el control ambiental.
 * body.items = [{Codigo_SIGMA, Prioridad_Ambiental ("", Alta, Media, Baja), Servicio_Ambiental}]
 */
function actualizarAmbiental_(body) {
  const sheet = hoja_(SHEETS.EQUIPOS);
  asegurarColumna_(sheet, "Prioridad_Ambiental");
  asegurarColumna_(sheet, "Servicio_Ambiental");
  const h = encabezados_(sheet);
  const cCod = h.indexOf("Codigo_SIGMA"), cPri = h.indexOf("Prioridad_Ambiental"), cSrv = h.indexOf("Servicio_Ambiental");
  const n = Math.max(sheet.getLastRow() - 1, 0);
  if (!n) return {accion: "actualizar_ambiental", actualizados: 0};

  const mapa = {};
  (body.items || []).forEach(it => {
    const pri = String(it.Prioridad_Ambiental || "").trim();
    if (PRIORIDADES_AMBIENTALES.indexOf(pri) === -1) throw new Error("Prioridad no válida: " + pri);
    mapa[String(it.Codigo_SIGMA).trim()] = {pri: pri, srv: String(it.Servicio_Ambiental || "").trim().slice(0, 120)};
  });
  const codigos = sheet.getRange(2, cCod + 1, n, 1).getValues();
  const rPri = sheet.getRange(2, cPri + 1, n, 1), rSrv = sheet.getRange(2, cSrv + 1, n, 1);
  const vPri = rPri.getValues(), vSrv = rSrv.getValues();
  let cambios = 0;
  for (let i = 0; i < n; i++) {
    const cod = String(codigos[i][0]).trim();
    if (mapa.hasOwnProperty(cod)) { vPri[i][0] = mapa[cod].pri; vSrv[i][0] = seguro_(mapa[cod].srv); cambios++; }
  }
  rPri.setValues(vPri);
  rSrv.setValues(vSrv);
  return {accion: "actualizar_ambiental", actualizados: cambios};
}

/* ---------------- Operario: equipos asignados, datos y observaciones ---------------- */

const COLUMNAS_OBSERVACIONES = ["Fecha_Hora", "Codigo_Equipo", "Usuario", "Nombre", "Observacion", "Fecha_Registro"];

function hojaObservaciones_() {
  return hojaOCrear_(SHEETS.OBSERVACIONES, COLUMNAS_OBSERVACIONES);
}

/** "BV-CA-B001, BV-CA-B002" → ["BV-CA-B001","BV-CA-B002"] */
function listaEquipos_(texto) {
  return String(texto || "").split(",").map(x => x.trim()).filter(Boolean);
}

/** Deja solo las filas de los equipos asignados al operario (y como máximo las 300 más recientes de Mediciones/Observaciones). */
function filtrarPorEquipos_(pestana, filas, usuario) {
  const mios = {};
  listaEquipos_(usuario.Equipos).forEach(c => mios[c] = true);
  const col = pestana === "Equipos" ? "Codigo_SIGMA" : "Codigo_Equipo";
  let r = filas.filter(f => mios[f[col]]);
  if (pestana === "Mediciones" || pestana === "Observaciones") r = r.slice(-300);
  return r;
}

function exigirEquipoAsignado_(usuario, codigo) {
  if (!codigo || listaEquipos_(usuario.Equipos).indexOf(String(codigo)) === -1) {
    throw errorPermiso_("Ese equipo no está asignado a tu usuario.");
  }
}

/** Hora indicada por quien carga el dato (se carga a fin de turno): no futura y como máximo 72 h atrás. */
function validarFechaHora_(valor) {
  if (!valor) return ahoraISO_();
  const t = new Date(valor).getTime();
  if (isNaN(t)) throw new Error("La fecha y hora indicadas no son válidas.");
  const ahora = Date.now();
  if (t > ahora + 5 * 60000) throw new Error("La fecha y hora no pueden ser futuras.");
  if (t < ahora - 72 * 3600000) throw new Error("La fecha y hora son demasiado antiguas (máximo 72 horas atrás).");
  return new Date(t).toISOString();
}

/** Reglas extra para el operario: solo sus equipos, solo variables configuradas, valor numérico. */
function validarEscrituraOperario_(usuario, accion, body) {
  exigirEquipoAsignado_(usuario, body.Codigo_Equipo);
  body.Fecha_Hora = validarFechaHora_(body.Fecha_Hora);

  if (accion === "registrar_medicion") {
    const variable = String(body.Variable || "").trim();
    const conf = filasDeHoja_("Variables").filter(v => v.Codigo_Equipo === body.Codigo_Equipo && v.Variable === variable)[0];
    if (!conf) throw new Error("Ese dato no está configurado para este equipo.");
    const texto = String(body.Valor === undefined ? "" : body.Valor).replace(",", ".").trim();
    if (!texto || !isFinite(Number(texto))) throw new Error("El valor tiene que ser un número.");
    body.Variable = variable;
    body.Unidad = conf.Unidad || "";   // la unidad sale de la configuración, no del navegador
    body.Valor = Number(texto);
  }
}

function crearObservacion_(body) {
  const texto = String(body.Observacion || "").trim();
  if (!texto) throw new Error("Escribí la observación.");
  if (texto.length > 1000) throw new Error("La observación es muy larga (máximo 1000 caracteres).");
  if (!body.Codigo_Equipo || !existeValor_(hoja_(SHEETS.EQUIPOS), "Codigo_SIGMA", body.Codigo_Equipo)) {
    throw new Error("No existe el equipo " + body.Codigo_Equipo + ".");
  }
  agregarFilaPorEncabezados_(hojaObservaciones_(), {
    Fecha_Hora: validarFechaHora_(body.Fecha_Hora),
    Codigo_Equipo: body.Codigo_Equipo,
    Usuario: body.Usuario,
    Nombre: body.Nombre,
    Observacion: texto,
    Fecha_Registro: ahoraISO_()
  });
  return {accion: "crear_observacion", Codigo_Equipo: body.Codigo_Equipo};
}

/** Administrador: define qué equipos puede ver y cargar un operario. */
function asignarEquipos_(body) {
  const id = normalizarUsuario_(body.Usuario);
  const u = buscarUsuario_(id);
  if (!u) throw new Error("No existe el usuario '" + id + "'.");
  if (u.Rol !== "operario") throw new Error("Solo se asignan equipos a usuarios con rol Operario.");
  const pedidos = Array.isArray(body.Equipos) ? body.Equipos.map(c => String(c).trim()).filter(Boolean) : [];
  const unicos = pedidos.filter((c, i) => pedidos.indexOf(c) === i);
  const hojaEq = hoja_(SHEETS.EQUIPOS);
  const existentes = {};
  filasDeHoja_("Equipos").forEach(e => existentes[e.Codigo_SIGMA] = true);
  const inexistentes = unicos.filter(c => !existentes[c]);
  if (inexistentes.length) throw new Error("No existen estos equipos: " + inexistentes.slice(0, 5).join(", "));
  guardarCamposUsuario_(u._fila, {Equipos: unicos.join(",")});
  return {accion: "asignar_equipos", Usuario: id, cantidad: unicos.length};
}

/* ---------------- Puesta en marcha (se corren a mano desde el editor) ---------------- */

function claveTemporalAleatoria_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

/**
 * Corré esta función UNA VEZ desde el editor (▶ Ejecutar). Crea la hoja
 * "Usuarios" y el primer Administrador con una contraseña temporal que
 * aparece en Ver → Registros. Al primer ingreso el sistema te obliga a
 * cambiarla. Si ya hay usuarios, no hace nada.
 */
function crearAdministradorInicial() {
  hojaUsuarios_();
  if (usuariosDeHoja_().length) {
    Logger.log("Ya existen usuarios en la hoja 'Usuarios'. No se creó nada. Si olvidaste la clave del administrador, corré resetearClaveAdministrador().");
    return;
  }
  const clave = claveTemporalAleatoria_();
  crearUsuario_({Usuario: ADMIN_INICIAL_USUARIO, Nombre: ADMIN_INICIAL_NOMBRE, Rol: "admin", Clave: clave});
  Logger.log("ADMINISTRADOR CREADO\nUsuario: " + ADMIN_INICIAL_USUARIO + "\nClave temporal: " + clave + "\n(el sistema te pedirá cambiarla al ingresar)");
}

/**
 * Rescate: si te quedás sin acceso de Administrador, corré esta función desde
 * el editor. Genera una clave temporal nueva para ADMIN_INICIAL_USUARIO y
 * lo reactiva. Solo se puede correr desde el editor de Apps Script.
 */
function resetearClaveAdministrador() {
  const u = buscarUsuario_(ADMIN_INICIAL_USUARIO);
  if (!u) { Logger.log("No existe el usuario '" + ADMIN_INICIAL_USUARIO + "'. Corré crearAdministradorInicial()."); return; }
  const clave = claveTemporalAleatoria_();
  const salt = Utilities.getUuid();
  guardarCamposUsuario_(u._fila, {Salt: salt, Clave_Hash: hashClave_(clave, salt), Debe_Cambiar: "SI", Sesion: nuevaSesion_(), Activo: "SI", Rol: "admin"});
  CacheService.getScriptCache().remove("SIGMA_FALLOS_" + ADMIN_INICIAL_USUARIO);
  Logger.log("CLAVE RESTABLECIDA\nUsuario: " + ADMIN_INICIAL_USUARIO + "\nClave temporal: " + clave);
}

/* ============================================================
   CAMPAÑAS — cierre de campaña, archivo en Drive y consulta de años anteriores
   ------------------------------------------------------------
   Pestaña "Campanias" (se crea sola al usarla por primera vez):
     Campania_Id | Nombre | Fecha_Inicio | Dias_Previstos | Estado | Fecha_Cierre |
     Archivo_Id | Archivo_URL | Cerrada_Por | Observaciones
   Estado: "Activa" (una sola) o "Cerrada". Fechas en texto AAAA-MM-DD.

   CIERRE (solo Administrador), en este orden:
     1. Copia completa del Sheet en la carpeta de Drive "SIGMA - Campañas archivadas".
        La copia NO incluye la pestaña "Usuarios" (contraseñas y sesiones).
     2. Verifica que la copia tenga las mismas filas que el original, pestaña por pestaña.
        Si algo no coincide, borra la copia y SE CANCELA el cierre sin tocar ningún dato.
     3. Registra la campaña como "Cerrada" y crea la nueva como "Activa".
     4. Vacía las pestañas operativas (se conservan los encabezados y el formato).
   NO se tocan: Equipos, Repuestos, Variables, Precios, Reparaciones_Programadas,
   Usuarios ni Campanias. Las fotos siguen en Drive (solo se vacía su listado).
   ============================================================ */

const COLUMNAS_CAMPANIAS = ["Campania_Id", "Nombre", "Fecha_Inicio", "Dias_Previstos", "Estado",
  "Fecha_Cierre", "Archivo_Id", "Archivo_URL", "Cerrada_Por", "Observaciones"];

// Pestañas que se archivan y se vacían al cerrar la campaña.
const PESTANAS_CIERRE = ["Ordenes_de_Trabajo", "Mantenimientos", "Mediciones", "Paradas", "Analisis_Sector",
  "Objetivos", "Gestion_Tareas", "Avances_Orden", "Observaciones", "Imagenes"];

// Pestañas que se pueden consultar de una campaña archivada (comparación entre años).
const PESTANAS_COMPARABLES = ["Paradas", "Analisis_Sector", "Objetivos", "Ordenes_de_Trabajo", "Mantenimientos"];

const FRASE_CIERRE = "CERRAR CAMPAÑA";
const CARPETA_CAMPANIAS = "SIGMA - Campañas archivadas";

/** Pestaña "Campanias"; si no existe se crea con las columnas en formato TEXTO
 *  (así Sheets no convierte "2026-05-30" en una fecha con otro formato). */
function hojaCampanias_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SHEETS.CAMPANIAS);
  if (!s) {
    s = ss.insertSheet(SHEETS.CAMPANIAS);
    s.getRange(1, 1, s.getMaxRows(), COLUMNAS_CAMPANIAS.length).setNumberFormat("@");
    s.appendRow(COLUMNAS_CAMPANIAS);
    s.setFrozenRows(1);
  }
  return s;
}

function campaniasDeHoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEETS.CAMPANIAS) ? filasDeHoja_(SHEETS.CAMPANIAS) : [];
}

function fechaISO_(valor, etiqueta) {
  const s = String(valor || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  if (!m || d.getMonth() !== +m[2] - 1) {
    throw new Error("Fecha no válida en " + etiqueta + ". Usá el formato AAAA-MM-DD (ej: 2026-10-13).");
  }
  return s;
}

function textoRequerido_(valor, etiqueta, max) {
  const s = String(valor || "").trim();
  if (!s) throw new Error("Falta completar: " + etiqueta + ".");
  if (s.length > (max || 80)) throw new Error(etiqueta + " es demasiado largo (máximo " + (max || 80) + " caracteres).");
  return s;
}

function diasPrevistos_(valor) {
  const n = Math.round(Number(valor));
  if (!isFinite(n) || n < 1 || n > 400) throw new Error("Los días previstos de la campaña deben ser un número entre 1 y 400.");
  return n;
}

/** Cantidad de filas de datos (sin encabezado) de cada pestaña que se archivaría y vaciaría. */
function contarPestanasCierre_(ss) {
  return PESTANAS_CIERRE.map(n => {
    const s = ss.getSheetByName(n);
    return {pestana: n, existe: !!s, filas: s ? Math.max(s.getLastRow() - 1, 0) : 0};
  });
}

/** Solo lectura: qué se va a archivar y vaciar. No modifica nada. */
function vistaPreviaCierre_() {
  const detalle = contarPestanasCierre_(SpreadsheetApp.getActiveSpreadsheet());
  return {
    detalle: detalle,
    total_filas: detalle.reduce((s, d) => s + d.filas, 0),
    se_conserva: ["Equipos", "Repuestos", "Variables", "Precios", "Reparaciones_Programadas", "Usuarios", "Campanias"],
    frase_confirmacion: FRASE_CIERRE
  };
}

function carpetaCampaniasSigma_() {
  const carpetas = DriveApp.getFoldersByName(CARPETA_CAMPANIAS);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(CARPETA_CAMPANIAS);
}

/** Vacía una pestaña conservando encabezados, formato y validaciones. Devuelve las filas borradas. */
function vaciarPestana_(sheet) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return 0;
  sheet.getRange(2, 1, n, Math.max(sheet.getLastColumn(), 1)).clearContent();
  return n;
}

function cerrarCampania_(usuario, body) {
  sanitizarCuerpo_(body);
  if (String(body.Confirmacion || "").trim() !== FRASE_CIERRE) {
    throw new Error("Falta la confirmación escrita. Escribí exactamente: " + FRASE_CIERRE);
  }

  // --- Validar TODO antes de tocar nada ---
  const nombre = textoRequerido_(body.Nombre, "el nombre de la campaña que se cierra");
  const inicio = fechaISO_(body.Fecha_Inicio, "el inicio de la campaña que se cierra");
  const cierre = fechaISO_(body.Fecha_Cierre, "la fecha de cierre");
  if (cierre < inicio) throw new Error("La fecha de cierre no puede ser anterior al inicio de la campaña.");
  const dias = diasPrevistos_(body.Dias_Previstos);
  const nuevoNombre = textoRequerido_(body.Nuevo_Nombre, "el nombre de la nueva campaña");
  const nuevoInicio = fechaISO_(body.Nuevo_Inicio, "el inicio de la nueva campaña");
  if (nuevoInicio < cierre) throw new Error("La nueva campaña no puede empezar antes de la fecha de cierre.");
  const nuevosDias = diasPrevistos_(body.Nuevos_Dias);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const autor = usuario.Nombre || usuario.Usuario;
  SpreadsheetApp.flush();
  const antes = contarPestanasCierre_(ss);

  // --- 1) Copia completa en Drive ---
  const nombreArchivo = "SIGMA — " + nombre + " (cerrada el " + cierre + ")";
  const copia = DriveApp.getFileById(ss.getId()).makeCopy(nombreArchivo, carpetaCampaniasSigma_());
  let copiaSs;
  try {
    copiaSs = SpreadsheetApp.openById(copia.getId());

    // La copia no debe llevar contraseñas ni sesiones.
    const hojaUsr = copiaSs.getSheetByName(HOJA_USUARIOS);
    if (hojaUsr && copiaSs.getSheets().length > 1) copiaSs.deleteSheet(hojaUsr);
    SpreadsheetApp.flush();

    // --- 2) Verificar que la copia coincide con el original ---
    const distintas = [];
    antes.forEach(d => {
      if (!d.existe) return;
      const c = copiaSs.getSheetByName(d.pestana);
      const filasCopia = c ? Math.max(c.getLastRow() - 1, 0) : -1;
      if (filasCopia !== d.filas) distintas.push(d.pestana + " (original " + d.filas + ", copia " + filasCopia + ")");
    });
    if (distintas.length) throw new Error("La copia de seguridad no coincide con los datos: " + distintas.join("; "));
    if (copiaSs.getSheetByName(HOJA_USUARIOS)) throw new Error("La copia todavía contiene la pestaña de usuarios.");
  } catch (err) {
    copia.setTrashed(true);
    throw new Error("Se canceló el cierre y NO se borró ningún dato. Motivo: " + err.message);
  }

  // --- 3) Registrar la campaña cerrada y crear la nueva activa ---
  const hojaC = hojaCampanias_();
  const cerrada = {
    Nombre: nombre, Fecha_Inicio: inicio, Dias_Previstos: String(dias), Estado: "Cerrada", Fecha_Cierre: cierre,
    Archivo_Id: copia.getId(), Archivo_URL: copia.getUrl(), Cerrada_Por: autor,
    Observaciones: String(body.Observaciones || "").trim()
  };
  const filaActiva = buscarFila_(hojaC, "Estado", "Activa");
  if (filaActiva === -1) {
    cerrada.Campania_Id = "CAMP-" + new Date().getTime();
    agregarFilaPorEncabezados_(hojaC, cerrada);
  } else {
    actualizarFila_(hojaC, filaActiva, cerrada);
  }
  const nueva = {
    Campania_Id: "CAMP-" + (new Date().getTime() + 1), Nombre: nuevoNombre, Fecha_Inicio: nuevoInicio,
    Dias_Previstos: String(nuevosDias), Estado: "Activa", Fecha_Cierre: "", Archivo_Id: "", Archivo_URL: "",
    Cerrada_Por: "", Observaciones: ""
  };
  agregarFilaPorEncabezados_(hojaC, nueva);

  // --- 4) Vaciar las pestañas operativas (una falla no frena a las demás) ---
  const vaciadas = {}, errores = [];
  PESTANAS_CIERRE.forEach(n => {
    const s = ss.getSheetByName(n);
    if (!s) return;
    try { vaciadas[n] = vaciarPestana_(s); }
    catch (e) { errores.push(n + ": " + e.message); }
  });
  SpreadsheetApp.flush();
  Logger.log("cerrarCampania_ — " + nombre + " cerrada por " + autor + " | archivo: " + copia.getUrl() +
    " | vaciadas: " + JSON.stringify(vaciadas) + " | errores: " + JSON.stringify(errores));

  return {
    accion: "cerrar_campania", archivo_url: copia.getUrl(), archivo_nombre: nombreArchivo,
    carpeta: CARPETA_CAMPANIAS, vaciadas: vaciadas, errores: errores,
    campania_nueva: {Nombre: nuevoNombre, Fecha_Inicio: nuevoInicio, Dias_Previstos: nuevosDias}
  };
}

/** Cambia nombre, inicio y duración de la campaña activa (la crea si todavía no existe). */
function actualizarCampaniaActiva_(usuario, body) {
  sanitizarCuerpo_(body);
  const datos = {
    Nombre: textoRequerido_(body.Nombre, "el nombre de la campaña"),
    Fecha_Inicio: fechaISO_(body.Fecha_Inicio, "el inicio de la campaña"),
    Dias_Previstos: String(diasPrevistos_(body.Dias_Previstos))
  };
  const hojaC = hojaCampanias_();
  const fila = buscarFila_(hojaC, "Estado", "Activa");
  if (fila === -1) {
    datos.Campania_Id = "CAMP-" + new Date().getTime();
    datos.Estado = "Activa";
    agregarFilaPorEncabezados_(hojaC, datos);
  } else {
    actualizarFila_(hojaC, fila, datos);
  }
  return {accion: "actualizar_campania_activa", creada: fila === -1};
}

/** Lee pestañas de una campaña archivada. Solo Administrador y Jefe; solo pestañas permitidas;
 *  el archivo se busca por Campania_Id en la pestaña "Campanias" (nunca por un ID enviado desde el navegador). */
function leerCampania_(usuario, body) {
  if (usuario.Rol !== "admin" && usuario.Rol !== "jefe") {
    throw errorPermiso_("Tu rol no puede consultar campañas anteriores.");
  }
  const id = String(body.Campania_Id || "").trim();
  const fila = campaniasDeHoja_().filter(c => c.Campania_Id === id && c.Estado === "Cerrada")[0];
  if (!fila || !fila.Archivo_Id) throw new Error("No se encontró esa campaña archivada.");

  let ss;
  try { ss = SpreadsheetApp.openById(fila.Archivo_Id); }
  catch (e) { throw new Error("No se pudo abrir el archivo de la campaña '" + fila.Nombre + "'. ¿Fue movido o eliminado de Drive?"); }

  const salida = {};
  (Array.isArray(body.tablas) ? body.tablas : []).slice(0, 10).forEach(n => {
    try {
      if (PESTANAS_COMPARABLES.indexOf(n) === -1) throw errorPermiso_("La pestaña '" + n + "' no se puede consultar.");
      salida[n] = {ok: true, filas: filasDeHoja_(n, ss)};
    } catch (err) {
      salida[n] = {ok: false, error: err.message};
    }
  });
  return salida;
}

/* ============================================================
   CATÁLOGO SAP
   ------------------------------------------------------------
   El listado que se descarga de SAP (código, descripción, precio...) se guarda en dos pestañas:
     Catalogo_SAP     → artículos de mecánica ("Mecanico") y dudosos ("Revisar"), con precio e historial
     SAP_Descartados  → artículos sin incidencia mecánica (limpieza, librería, laboratorio...). Se guardan
                        para recordar la decisión y no volver a preguntar en la próxima carga.
   Los precios se pasan a "Precios" con aplicarPreciosSap_, que es lo que usa el presupuesto de Repuestos.
   Estas pestañas NO se vacían al cerrar una campaña (son datos de referencia, como Equipos o Repuestos).
   ============================================================ */

const COL_CATALOGO_SAP = ["Codigo_SAP", "Descripcion", "Unidad", "Grupo_Articulos", "Precio", "Precio_Anterior", "Fecha_Precio", "Estado", "Motivo", "Fecha_Carga"];
const COL_SAP_DESCARTADOS = ["Codigo_SAP", "Descripcion", "Unidad", "Grupo_Articulos", "Precio", "Motivo", "Fecha_Carga"];
const MAX_FILAS_SAP = 40000;
const ESTADOS_SAP = ["Mecanico", "Revisar", "Descartado"];

/** Clave para comparar códigos de SAP: sin espacios y sin ceros a la izquierda ("000123" = "123"). */
function claveSap_(codigo) {
  return String(codigo == null ? "" : codigo).trim().toUpperCase().replace(/\s+/g, "").replace(/^0+(?=.)/, "");
}

/** Crea la pestaña si no existe. Las columnas de código y fechas van en formato TEXTO
 *  (si no, Sheets borra los ceros a la izquierda y convierte las fechas). */
function hojaSap_(nombre, columnas, colTexto) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(nombre);
  if (!s) {
    s = ss.insertSheet(nombre);
    colTexto.forEach(c => s.getRange(1, c, s.getMaxRows(), 1).setNumberFormat("@"));
    s.appendRow(columnas);
    s.setFrozenRows(1);
  }
  return s;
}

function leerHojaSap_(sheet, nCols) {
  const n = sheet.getLastRow() - 1;
  return n < 1 ? [] : sheet.getRange(2, 1, n, nCols).getValues();
}

function escribirHojaSap_(sheet, filas, nCols, colTexto) {
  const previas = sheet.getLastRow() - 1;
  if (previas >= 1) sheet.getRange(2, 1, previas, Math.max(sheet.getLastColumn(), nCols)).clearContent();
  if (!filas.length) return;
  colTexto.forEach(c => sheet.getRange(2, c, filas.length, 1).setNumberFormat("@"));
  sheet.getRange(2, 1, filas.length, nCols).setValues(filas);
}

function precioSap_(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : "";
}

/**
 * body.filas = [{Codigo_SAP, Descripcion, Unidad, Grupo_Articulos, Precio, Estado, Motivo}]
 * Estado: Mecanico | Revisar | Descartado (lo decide la persona en la pantalla de revisión).
 * Un artículo que cambia de estado se mueve de una pestaña a la otra. Si el precio cambia se
 * guarda el anterior. Los artículos que no vienen en este archivo no se tocan.
 */
function importarCatalogoSap_(body) {
  const entrada = Array.isArray(body.filas) ? body.filas : [];
  if (!entrada.length) throw new Error("No llegó ningún artículo para importar.");
  if (entrada.length > MAX_FILAS_SAP) throw new Error("El archivo tiene demasiados artículos (máximo " + MAX_FILAS_SAP + "). Dividilo en partes.");

  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const hojaC = hojaSap_(SHEETS.CATALOGO_SAP, COL_CATALOGO_SAP, [1, 7, 10]);
  const hojaD = hojaSap_(SHEETS.SAP_DESCARTADOS, COL_SAP_DESCARTADOS, [1, 7]);
  const cat = new Map(), desc = new Map();
  leerHojaSap_(hojaC, COL_CATALOGO_SAP.length).forEach(f => cat.set(claveSap_(f[0]), f));
  leerHojaSap_(hojaD, COL_SAP_DESCARTADOS.length).forEach(f => desc.set(claveSap_(f[0]), f));

  const r = {nuevos: 0, actualizados: 0, precios_cambiados: 0, descartados_nuevos: 0, movidos: 0, omitidos: 0};
  entrada.forEach(it => {
    const codigo = String(it.Codigo_SAP == null ? "" : it.Codigo_SAP).trim();
    const k = claveSap_(codigo);
    if (!k || codigo.length > 40) { r.omitidos++; return; }
    const estado = ESTADOS_SAP.indexOf(it.Estado) !== -1 ? it.Estado : "Revisar";
    const descripcion = seguro_(String(it.Descripcion || "").trim().slice(0, 200));
    const unidad = seguro_(String(it.Unidad || "").trim().slice(0, 20));
    const grupo = seguro_(String(it.Grupo_Articulos || "").trim().slice(0, 80));
    const motivo = seguro_(String(it.Motivo || "").trim().slice(0, 80));
    const precio = precioSap_(it.Precio);

    if (estado === "Descartado") {
      if (cat.has(k)) { cat.delete(k); r.movidos++; }
      else if (!desc.has(k)) r.descartados_nuevos++;
      const previo = desc.get(k);
      desc.set(k, [codigo, descripcion, unidad, grupo, precio === "" && previo ? previo[4] : precio, motivo, hoy]);
      return;
    }
    let previoD = null;
    if (desc.has(k)) { previoD = desc.get(k); desc.delete(k); r.movidos++; }
    const previo = cat.get(k);
    if (!previo) {
      cat.set(k, [codigo, descripcion, unidad, grupo, precio === "" && previoD ? previoD[4] : precio, "", precio === "" ? "" : hoy, estado, motivo, hoy]);
      if (!previoD) r.nuevos++;
      return;
    }
    let anterior = previo[5], fechaPrecio = previo[6], vigente = previo[4];
    if (precio !== "" && Number(precio) !== Number(previo[4])) {
      if (previo[4] !== "" && previo[4] != null) { anterior = previo[4]; r.precios_cambiados++; }
      vigente = precio; fechaPrecio = hoy;
    }
    cat.set(k, [codigo, descripcion, unidad, grupo, vigente, anterior, fechaPrecio, estado, motivo, hoy]);
    r.actualizados++;
  });

  escribirHojaSap_(hojaC, Array.from(cat.values()), COL_CATALOGO_SAP.length, [1, 7, 10]);
  escribirHojaSap_(hojaD, Array.from(desc.values()), COL_SAP_DESCARTADOS.length, [1, 7]);
  r.total_catalogo = cat.size;
  r.total_descartados = desc.size;
  r.accion = "importar_catalogo_sap";
  return r;
}

function normTexto_(v) { return String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, " "); }

/** Misma clave que arma repuestos.html (clave()) para identificar un repuesto en la pestaña Precios. */
function clavePrecio_(codigo, designacion, nombre) {
  const c = normTexto_(codigo), ok = c && c !== "S/C";
  return (ok ? c : "S/C") + "|" + normTexto_(designacion) + (ok ? "" : "|" + normTexto_(nombre));
}

/**
 * Pasa los precios del catálogo SAP a la pestaña Precios, para los repuestos de los equipos cuyo
 * código coincide. body.modo: "vacios" (solo completa los que no tienen costo; no pisa lo cargado a mano)
 * o "todos" (actualiza también los que ya tienen costo).
 */
function aplicarPreciosSap_(body) {
  const modo = body.modo === "todos" ? "todos" : "vacios";
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const ssC = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CATALOGO_SAP);
  if (!ssC || ssC.getLastRow() < 2) throw new Error("Todavía no hay un catálogo de SAP cargado.");
  const precios = new Map();
  leerHojaSap_(ssC, COL_CATALOGO_SAP.length).forEach(f => {
    const p = precioSap_(f[4]);
    if (p !== "" && p > 0 && f[7] !== "Descartado") precios.set(claveSap_(f[0]), p);
  });

  const sheetP = hojaOCrear_(SHEETS.PRECIOS, ["Clave_Repuesto", "Codigo_Repuesto", "Nombre", "Designacion", "Costo_Unitario", "Plazo_Dias"]);
  asegurarColumna_(sheetP, "Fuente");
  asegurarColumna_(sheetP, "Fecha_Precio");
  const h = encabezados_(sheetP);
  const col = n => h.indexOf(n);
  const nP = sheetP.getLastRow() - 1;
  const valoresP = nP >= 1 ? sheetP.getRange(2, 1, nP, h.length).getValues() : [];
  const filaDe = new Map();
  valoresP.forEach((f, i) => filaDe.set(String(f[col("Clave_Repuesto")]), i));

  const r = {nuevos: 0, actualizados: 0, conservados: 0, sin_codigo: 0, no_estan_en_sap: 0, cambios: [], faltan: []};
  const vistos = new Set();
  const nuevasFilas = [];
  filasDeHoja_(SHEETS.REPUESTOS).forEach(rep => {
    const k = clavePrecio_(rep.Codigo_Repuesto, rep.Designacion, rep.Nombre);
    if (vistos.has(k)) return;
    vistos.add(k);
    const codigo = normTexto_(rep.Codigo_Repuesto);
    if (!codigo || codigo === "S/C") { r.sin_codigo++; return; }
    const precio = precios.get(claveSap_(codigo));
    if (precio === undefined) {
      r.no_estan_en_sap++;
      if (r.faltan.length < 100) r.faltan.push({Codigo: codigo, Nombre: rep.Nombre});
      return;
    }
    const i = filaDe.get(k);
    if (i === undefined) {
      const fila = h.map(() => "");
      fila[col("Clave_Repuesto")] = k; fila[col("Codigo_Repuesto")] = codigo; fila[col("Nombre")] = seguro_(rep.Nombre || "");
      fila[col("Designacion")] = seguro_(rep.Designacion || ""); fila[col("Costo_Unitario")] = precio;
      fila[col("Fuente")] = "SAP"; fila[col("Fecha_Precio")] = hoy;
      nuevasFilas.push(fila); r.nuevos++;
      return;
    }
    const actual = valoresP[i][col("Costo_Unitario")];
    const tiene = actual !== "" && actual != null && Number(actual) > 0;
    if (tiene && modo === "vacios") { r.conservados++; return; }
    if (tiene && Number(actual) === precio) { r.conservados++; return; }
    if (r.cambios.length < 200) r.cambios.push({Codigo: codigo, Nombre: rep.Nombre, Antes: tiene ? Number(actual) : "", Despues: precio});
    sheetP.getRange(i + 2, col("Costo_Unitario") + 1).setValue(precio);
    sheetP.getRange(i + 2, col("Fuente") + 1).setValue("SAP");
    sheetP.getRange(i + 2, col("Fecha_Precio") + 1).setValue(hoy);
    r.actualizados++;
  });
  if (nuevasFilas.length) sheetP.getRange(sheetP.getLastRow() + 1, 1, nuevasFilas.length, h.length).setValues(nuevasFilas);
  r.accion = "aplicar_precios_sap";
  return r;
}


/**
 * Usa el nombre de SAP en la pestaña Repuestos (el código manda: mismo código = mismo nombre).
 * body.modo: "simular" (solo cuenta y lista los cambios) | "aplicar" | "restaurar".
 * El nombre anterior se guarda en la columna "Nombre_Original" (solo la primera vez), así se puede volver atrás.
 * Los repuestos "S/C" o con un código que no está en SAP no se tocan.
 */
function nombresSap_(body) {
  const modo = ["aplicar", "restaurar"].indexOf(body.modo) >= 0 ? body.modo : "simular";
  const sheet = hoja_(SHEETS.REPUESTOS);
  const n = sheet.getLastRow() - 1;
  if (n < 1) throw new Error("La pestaña Repuestos no tiene datos.");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombres = new Map();
  [SHEETS.CATALOGO_SAP, SHEETS.SAP_DESCARTADOS].forEach(t => {
    const s = ss.getSheetByName(t);
    if (!s) return;
    leerHojaSap_(s, 2).forEach(f => {
      const d = String(f[1] == null ? "" : f[1]).trim();
      if (d && !nombres.has(claveSap_(f[0]))) nombres.set(claveSap_(f[0]), d);
    });
  });
  if (!nombres.size) throw new Error("Todavía no hay un catálogo de SAP cargado.");

  if (modo !== "simular") asegurarColumna_(sheet, "Nombre_Original");
  const h = encabezados_(sheet);
  const cN = h.indexOf("Nombre"), cC = h.indexOf("Codigo_Repuesto"), cO = h.indexOf("Nombre_Original");
  if (cN < 0 || cC < 0) throw new Error("Faltan las columnas Nombre y Codigo_Repuesto en Repuestos.");
  const vals = sheet.getRange(2, 1, n, h.length).getValues();
  const r = {modo, cambiados: 0, iguales: 0, sin_codigo: 0, no_estan_en_sap: 0, restaurados: 0, cambios: []};
  const outN = [], outO = [];
  vals.forEach(f => {
    let nom = f[cN], orig = cO >= 0 ? f[cO] : "";
    const codigo = normTexto_(f[cC]);
    if (modo === "restaurar") {
      if (orig !== "" && orig != null) { nom = orig; orig = ""; r.restaurados++; }
    } else if (!codigo || codigo === "S/C") {
      r.sin_codigo++;
    } else {
      const sap = nombres.get(claveSap_(codigo));
      if (sap === undefined) r.no_estan_en_sap++;
      else if (String(nom).trim() === sap) r.iguales++;
      else {
        r.cambiados++;
        if (r.cambios.length < 300) r.cambios.push({Codigo: codigo, Antes: String(nom), Despues: sap});
        if (modo === "aplicar") { if (orig === "" || orig == null) orig = nom; nom = seguro_(sap); }
      }
    }
    outN.push([nom]); outO.push([orig]);
  });
  if (modo !== "simular") {
    sheet.getRange(2, cN + 1, n, 1).setValues(outN);
    sheet.getRange(2, cO + 1, n, 1).setNumberFormat("@").setValues(outO);
  }
  r.accion = "nombres_sap";
  return r;
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
  const fila = headers.map(h => (datos[h] !== undefined ? seguro_(datos[h]) : ""));
  sheet.appendRow(fila);
}

/** Crea la columna al final si la hoja todavía no la tiene. */
function asegurarColumna_(sheet, nombre) {
  const h = encabezados_(sheet);
  if (h.indexOf(nombre) === -1) sheet.getRange(1, h.length + 1).setValue(nombre);
}

/** Devuelve la pestaña; si no existe, la crea con esos encabezados. */
function hojaOCrear_(nombre, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(nombre);
  if (!s) { s = ss.insertSheet(nombre); s.appendRow(headers); }
  return s;
}

/** Actualiza en la fila dada solo las columnas presentes en "datos". */
function actualizarFila_(sheet, fila, datos) {
  const h = encabezados_(sheet);
  Object.keys(datos).forEach(k => {
    const c = h.indexOf(k);
    if (c !== -1) sheet.getRange(fila, c + 1).setValue(seguro_(datos[k]));
  });
}

/** Devuelve el número de fila (1-indexed) donde columna=valor, o -1 si no existe. */
function buscarFila_(sheet, columna, valor) {
  const headers = encabezados_(sheet);
  const col = headers.indexOf(columna);
  if (col === -1) throw new Error("La pestaña no tiene columna '" + columna + "'.");
  const total = sheet.getLastRow() - 1;
  if (total < 1) return -1; // solo encabezados: Sheets no acepta rangos de 0 filas
  const valores = sheet.getRange(2, col + 1, total, 1).getValues();
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

/** Fila (1-indexed) donde coinciden TODAS las columnas de "criterios"
 *  ({columna: valor, ...}), o -1. Usado para Repuestos. */
function buscarFilaMulti_(sheet, criterios) {
  const headers = encabezados_(sheet);
  const claves = Object.keys(criterios);
  const idx = claves.map(c => {
    const i = headers.indexOf(c);
    if (i === -1) throw new Error("La pestaña no tiene columna '" + c + "'.");
    return i;
  });
  const n = Math.max(sheet.getLastRow() - 1, 0);
  if (!n) return -1;
  const vals = sheet.getRange(2, 1, n, headers.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (claves.every((c, k) => String(vals[i][idx[k]]).trim() === String(criterios[c]).trim())) return i + 2;
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

function error_(mensaje, codigo) {
  return ContentService
    .createTextOutput(JSON.stringify({ok: false, error: mensaje, codigo: codigo || ""}))
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
        valores[i][0] = seguro_(mapa[actual]);
        actualizadas++;
      }
    }

    rango.setValues(valores);
    resumen.push(`${nombre}: ${actualizadas} de ${totalFilas} filas actualizadas`);
  });

  Logger.log(resumen.join("\n"));
  return resumen;
}
