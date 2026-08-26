/* ============================================================
   SIGMA — sigma-utils.js
   Funciones compartidas: acceso a datos, KPIs, UI helpers.
   Incluir este archivo en TODAS las páginas HTML del sistema.
   ============================================================ */

/* ---------------------------------------------------------------
   1. CONFIGURACIÓN
   Completar estos valores una sola vez. Todas las páginas los usan.
   --------------------------------------------------------------- */
const SIGMA_CONFIG = {
  // ID de la hoja de cálculo de Google Sheets (parte de la URL entre /d/ y /edit)
  SHEET_ID: "1dF9de0nLwpeNO6PojRYns_CA_Jig8r8mtCu-3EtfIOo",

  // gid de cada pestaña (se ve al final de la URL cuando abrís esa pestaña: #gid=XXXXXX)
  GIDS: {
    Mantenimientos: "0",
    Reparaciones_Programadas: "628447192",
    Imagenes: "661946164",
    Repuestos: "1311935837",
    Variables: "1551728370",
    Mediciones: "1051972276",
    Ordenes_de_Trabajo: "825527361",
    Equipos: "1296755573",
    Gestion_Tareas: "1475821035",
    Avances_Orden: "1691834187",
    Analisis_Sector: "925874317"
  },

  // URL del Web App de Google Apps Script (para escrituras: altas, cambios de estado, mediciones)
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxVMhCTV6aOiaHkE6au3cP2bzo_wt9iv15o8UwnEHra1tq8XPDEfxb1VlnZz4czHrH7/exec",

  // Refresco automático del panel de mediciones en tiempo real (ms)
  MEDICIONES_REFRESH_MS: 30000
};

/* ---------------------------------------------------------------
   2. LECTURA DE DATOS — Google Sheets como CSV público
   --------------------------------------------------------------- */

function sigmaCsvUrl(tabName){
  const gid = SIGMA_CONFIG.GIDS[tabName];
  return `https://docs.google.com/spreadsheets/d/${SIGMA_CONFIG.SHEET_ID}/export?format=csv&gid=${gid}`;
}

/** Parser CSV simple, soporta comillas y comas dentro de campos */
function sigmaParseCSV(text){
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i], next = text[i+1];
    if(inQuotes){
      if(c === '"' && next === '"'){ field+='"'; i++; }
      else if(c === '"'){ inQuotes = false; }
      else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=""; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=""; }
      else if(c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }

  const headers = (rows.shift() || []).map(h => h.trim());
  return rows
    .filter(r => r.some(v => v !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h,idx) => obj[h] = (r[idx] ?? "").trim());
      return obj;
    });
}

/** Trae y parsea una pestaña completa. Devuelve array de objetos {columna: valor}. */
async function sigmaFetchTab(tabName){
  const res = await fetch(sigmaCsvUrl(tabName), {cache:"no-store"});
  if(!res.ok) throw new Error(`No se pudo leer la pestaña ${tabName} (HTTP ${res.status})`);
  const text = await res.text();
  return sigmaParseCSV(text);
}

/* ---------------------------------------------------------------
   3. ESCRITURA DE DATOS — Google Apps Script Web App (no-cors)
   El modo no-cors no permite leer la respuesta: se asume éxito si
   fetch no lanza excepción, y la UI se actualiza de forma optimista.
   --------------------------------------------------------------- */
async function sigmaPost(action, payload){
  await fetch(SIGMA_CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify({action, ...payload})
  });
  return true;
}

/* ---------------------------------------------------------------
   4. CÁLCULO DE KPIs — MTTR / MTBF / Disponibilidad
   Espera registros de Mantenimientos con estas columnas:
   Codigo_Equipo, Tipo (preventivo/predictivo/correctivo),
   Fecha_Inicio, Fecha_Fin (o Duracion_Horas), Estado
   --------------------------------------------------------------- */

function sigmaParseDate(v){
  if(!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function sigmaHorasEntre(inicio, fin){
  const a = sigmaParseDate(inicio), b = sigmaParseDate(fin);
  if(!a || !b) return null;
  return Math.max(0, (b - a) / 36e5);
}

/** Formatea una fecha (ISO o simple) a "dd/mm/aa hh:mm" en es-AR. Devuelve "—" si está vacía. */
function sigmaFmtFechaHora(valor){
  if(!valor) return "—";
  const d = new Date(valor);
  if(isNaN(d)) return valor; // por si ya viene como fecha simple (datos viejos)
  return d.toLocaleString("es-AR", {day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit"});
}

/**
 * Calcula MTTR, MTBF y Disponibilidad por equipo a partir del historial
 * de mantenimientos. horizonHoras = ventana de tiempo total considerada
 * (por defecto 720h = 30 días) para el cálculo de disponibilidad.
 */
function sigmaCalcularKPIs(mantenimientos, horizonHoras = 720){
  const porEquipo = {};

  mantenimientos.forEach(m => {
    const cod = m.Codigo_Equipo;
    if(!cod) return;
    if(!porEquipo[cod]) porEquipo[cod] = {correctivos:[], todos:[]};

    const horas = m.Duracion_Horas ? parseFloat(m.Duracion_Horas) : sigmaHorasEntre(m.Fecha_Inicio, m.Fecha_Fin);
    const registro = {...m, horas: (horas != null && !isNaN(horas)) ? horas : 0};

    porEquipo[cod].todos.push(registro);
    if((m.Tipo || "").toLowerCase().startsWith("correc")){
      porEquipo[cod].correctivos.push(registro);
    }
  });

  const resultado = {};
  Object.entries(porEquipo).forEach(([cod, datos]) => {
    const correctivos = datos.correctivos;
    const nFallas = correctivos.length;
    const horasParoTotal = correctivos.reduce((s,r) => s + r.horas, 0);

    const mttr = nFallas ? horasParoTotal / nFallas : 0;
    const mtbf = nFallas ? Math.max(0, (horizonHoras - horasParoTotal)) / nFallas : horizonHoras;
    const disponibilidad = horizonHoras ? Math.max(0, Math.min(100, 100 * (horizonHoras - horasParoTotal) / horizonHoras)) : 100;

    resultado[cod] = {
      codigo: cod,
      intervenciones: datos.todos.length,
      fallas: nFallas,
      mttr: +mttr.toFixed(2),
      mtbf: +mtbf.toFixed(2),
      disponibilidad: +disponibilidad.toFixed(1)
    };
  });
  return resultado;
}

function sigmaConteoPorTipo(mantenimientos){
  const conteo = {preventivo:0, predictivo:0, correctivo:0, otro:0};
  mantenimientos.forEach(m => {
    const t = (m.Tipo || "").toLowerCase();
    if(t.startsWith("prev")) conteo.preventivo++;
    else if(t.startsWith("pred")) conteo.predictivo++;
    else if(t.startsWith("correc")) conteo.correctivo++;
    else conteo.otro++;
  });
  return conteo;
}

/** Top N equipos por cantidad de intervenciones, con % acumulado (Pareto) */
function sigmaPareto(kpisPorEquipo, topN = 10){
  const arr = Object.values(kpisPorEquipo)
    .sort((a,b) => b.intervenciones - a.intervenciones)
    .slice(0, topN);
  const total = Object.values(kpisPorEquipo).reduce((s,k) => s + k.intervenciones, 0) || 1;
  let acumulado = 0;
  return arr.map(k => {
    acumulado += k.intervenciones;
    return {...k, pctAcumulado: +(100 * acumulado / total).toFixed(1)};
  });
}

/* ---------------------------------------------------------------
   5. UI HELPERS
   --------------------------------------------------------------- */

function sigmaBadge(tipo, valor){
  if(!valor) return "";
  const clase = valor.toLowerCase().replace(/\s+/g,"-").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  return `<span class="badge badge-${clase}">${valor}</span>`;
}

function sigmaToast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Barra de navegación compartida (sidebar). activePage: "dashboard"|"ordenes"|"equipos"|"qr"|"informes"|"alta"|"gestion" */
function sigmaRenderNav(activePage, basePath = ""){
  sigmaSetFavicon(basePath);

  const iconos = {
    dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    equipos: '<svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v9"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14v3M14 19h3M18 18h3v3h-3z"/></svg>',
    ordenes: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3M8 11h8M8 15h5"/></svg>',
    informes: '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
    analisis: '<svg viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/><circle cx="4" cy="7" r="1.6"/><circle cx="12" cy="1.6" r="1.6"/><circle cx="20" cy="10" r="1.6"/></svg>',
    alta: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/></svg>',
    gestion: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };

  const links = [
    {id:"dashboard", href:`${basePath}dashboard.html`, label:"Dashboard"},
    {id:"equipos", href:`${basePath}equipos/index.html`, label:"Equipos"},
    {id:"qr", href:`${basePath}equipos/qr_codigos.html`, label:"Códigos QR"},
    {id:"ordenes", href:`${basePath}ordenes.html`, label:"Órdenes de trabajo"},
    {id:"informes", href:`${basePath}informes.html`, label:"Informes"},
    {id:"analisis", href:`${basePath}analisis.html`, label:"Análisis"},
    {id:"alta", href:`${basePath}alta_nuevo_equipo.html`, label:"Alta de equipo"},
    {id:"gestion", href:`${basePath}gestion_hojas.html`, label:"Gestión"}
  ];
  const linksHtml = links.map(l =>
    `<a class="nav-link${l.id===activePage?" active":""}" href="${l.href}">${iconos[l.id]}${l.label}</a>`
  ).join("");

  return `
  <nav class="sigma-nav">
    <div class="brand">
      <img src="${basePath}assets/isotipo-v3.svg" alt="" width="30" height="30">
      Sigma
    </div>
    <div class="links">${linksHtml}</div>
  </nav>`;
}

/** Inserta el favicon (una sola vez) usando el isotipo, respetando la profundidad de carpeta de cada página. */
function sigmaSetFavicon(basePath = ""){
  if(document.querySelector('link[rel="icon"]')) return;
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = `${basePath}assets/isotipo-v3.svg`;
  document.head.appendChild(link);
}

/** Convierte una grilla de <img> en galería: click abre la imagen a tamaño completo en nueva pestaña */
function sigmaInitGallery(containerSelector){
  document.querySelectorAll(`${containerSelector} img`).forEach(img => {
    img.addEventListener("click", () => {
      const full = img.dataset.full || img.src;
      window.open(full, "_blank", "noopener");
    });
  });
}

/**
 * Sube una imagen a Drive vía Apps Script (acción "subir_imagen") y agrega
 * su fila a la pestaña Imagenes. Como la escritura usa no-cors, no se puede
 * leer la URL definitiva de Drive en el momento — por eso esta función
 * devuelve además una URL local (object URL) para mostrar la foto al
 * instante; la URL real de Drive queda guardada en la pestaña Imagenes y
 * aparece la próxima vez que se recarguen los datos.
 */
async function sigmaSubirImagen(file, campos = {}){
  const base64 = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result.split(",")[1]);
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(file);
  });

  await sigmaPost("subir_imagen", {
    ...campos,
    NombreArchivo: file.name,
    MimeType: file.type || "image/jpeg",
    DatosBase64: base64
  });

  return URL.createObjectURL(file); // vista previa local inmediata
}

function sigmaDebounce(fn, wait = 250){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* === INICIO_MAPA_EQUIPO_CARPETA (autogenerado por equipos/generar_equipos.py — no editar a mano) === */
const SIGMA_EQUIPO_CARPETA = {
  "BV-CA-B001": "lote1",
  "BV-CA-B002": "lote1",
  "BV-CA-B003": "lote1",
  "BV-CA-B004": "lote1",
  "BV-CA-B005": "lote1",
  "BV-CA-B006": "lote1",
  "BV-CA-B007": "lote1",
  "BV-CA-B008": "lote1",
  "BV-CA-B009": "lote1",
  "BV-CA-B010": "lote1",
  "BV-CA-B011": "lote1",
  "BV-CA-B012": "lote1",
  "BV-CA-B013": "lote1",
  "BV-CA-B014": "lote1",
  "BV-CA-B015": "lote1",
  "BV-CA-B016": "lote1",
  "BV-CA-B017": "lote1",
  "BV-CA-B018": "lote1",
  "BV-CA-B019": "lote1",
  "BV-CA-B020": "lote1",
  "BV-CA-B021": "lote1",
  "BV-CA-B022": "lote1",
  "BV-CA-B023": "lote1",
  "BV-CA-B024": "lote1",
  "BV-CA-CP001": "lote1",
  "BV-CA-GU001": "lote1",
  "BV-CA-TU001": "lote1",
  "BV-CA-TU002": "lote1",
  "BV-CA-TU003": "lote1",
  "BV-CA-TU004": "lote1",
  "BV-CN-B001": "lote1",
  "BV-CN-CU001": "lote1",
  "BV-CN-R001": "lote1",
  "BV-CN-RO001": "lote1",
  "BV-CN-RO002": "lote1",
  "BV-CN-TC001": "lote1",
  "BV-CN-TC002": "lote1",
  "BV-CN-TU001": "lote1",
  "BV-CN-TU002": "lote1",
  "BV-CN-TU003": "lote1",
  "BV-EF-CP001": "lote1",
  "BV-FA-AC001": "lote1",
  "BV-FA-AD001": "lote1",
  "BV-FA-AG001": "lote1",
  "BV-FA-AG002": "lote1",
  "BV-FA-B001": "lote1",
  "BV-FA-B002": "lote1",
  "BV-FA-B003": "lote1",
  "BV-FA-B004": "lote1",
  "BV-FA-B005": "lote1",
  "BV-FA-B006": "lote1",
  "BV-FA-B007": "lote1",
  "BV-FA-B008": "lote1",
  "BV-FA-B009": "lote1",
  "BV-FA-B010": "lote1",
  "BV-FA-B011": "lote1",
  "BV-FA-B012": "lote1",
  "BV-FA-B013": "lote1",
  "BV-FA-B014": "lote1",
  "BV-FA-B015": "lote1",
  "BV-FA-B016": "lote1",
  "BV-FA-B017": "lote1",
  "BV-FA-B018": "lote1",
  "BV-FA-B019": "lote1",
  "BV-FA-B020": "lote1",
  "BV-FA-B021": "lote2",
  "BV-FA-B022": "lote2",
  "BV-FA-B023": "lote2",
  "BV-FA-B024": "lote2",
  "BV-FA-B025": "lote2",
  "BV-FA-B026": "lote2",
  "BV-FA-B032": "lote2",
  "BV-FA-B033": "lote2",
  "BV-FA-B034": "lote2",
  "BV-FA-B035": "lote2",
  "BV-FA-B036": "lote2",
  "BV-FA-B037": "lote2",
  "BV-FA-B038": "lote2",
  "BV-FA-B039": "lote2",
  "BV-FA-B040": "lote2",
  "BV-FA-B041": "lote2",
  "BV-FA-B042": "lote2",
  "BV-FA-B043": "lote2",
  "BV-FA-B044": "lote2",
  "BV-FA-B045": "lote2",
  "BV-FA-B046": "lote2",
  "BV-FA-B047": "lote2",
  "BV-FA-B048": "lote2",
  "BV-FA-B049": "lote2",
  "BV-FA-B050": "lote2",
  "BV-FA-B051": "lote2",
  "BV-FA-B052": "lote2",
  "BV-FA-B053": "lote2",
  "BV-FA-B054": "lote2",
  "BV-FA-B055": "lote2",
  "BV-FA-B056": "lote2",
  "BV-FA-B057": "lote2",
  "BV-FA-B058": "lote2",
  "BV-FA-B059": "lote2",
  "BV-FA-B060": "lote2",
  "BV-FA-B061": "lote2",
  "BV-FA-B062": "lote2",
  "BV-FA-B063": "lote2",
  "BV-FA-B064": "lote2",
  "BV-FA-B065": "lote2",
  "BV-FA-B066": "lote2",
  "BV-FA-B067": "lote2",
  "BV-FA-B068": "lote2",
  "BV-FA-B069": "lote2",
  "BV-FA-B070": "lote2",
  "BV-FA-B071": "lote2",
  "BV-FA-BV001": "lote2",
  "BV-FA-BV002": "lote2",
  "BV-FA-BV003": "lote2",
  "BV-FA-BV004": "lote2",
  "BV-FA-BV005": "lote2",
  "BV-FA-BV006": "lote2",
  "BV-FA-BV007": "lote2",
  "BV-FA-CF001": "lote2",
  "BV-FA-CF002": "lote2",
  "BV-FA-CF003": "lote2",
  "BV-FA-CF004": "lote2",
  "BV-FA-CF005": "lote2",
  "BV-FA-CF006": "lote2",
  "BV-FA-CF007": "lote2",
  "BV-FA-CF008": "lote2",
  "BV-FA-CF009": "lote2",
  "BV-FA-CF010": "lote2",
  "BV-FA-CF011": "lote2",
  "BV-FA-CF012": "lote2",
  "BV-FA-CP001": "lote3",
  "BV-FA-CP002": "lote3",
  "BV-FA-CP003": "lote3",
  "BV-FA-CP004": "lote3",
  "BV-FA-CP005": "lote3",
  "BV-FA-CT001": "lote3",
  "BV-FA-CZ001": "lote3",
  "BV-FA-EC001": "lote3",
  "BV-FA-EL001": "lote3",
  "BV-FA-EL002": "lote3",
  "BV-FA-EL003": "lote3",
  "BV-FA-FL001": "lote3",
  "BV-FA-FL002": "lote3",
  "BV-FA-GB001": "lote3",
  "BV-FA-GU001": "lote3",
  "BV-FA-HO001": "lote3",
  "BV-FA-MV001": "lote3",
  "BV-FA-MX001": "lote3",
  "BV-FA-MZ001": "lote3",
  "BV-FA-PA001": "lote3",
  "BV-FA-R001": "lote3",
  "BV-FA-R002": "lote3",
  "BV-FA-SC001": "lote3",
  "BV-FA-SM001": "lote3",
  "BV-GE-AE001": "lote3",
  "BV-GE-HR001": "lote3",
  "BV-GE-VR001": "lote3",
  "BV-TL-AM001": "lote3",
  "BV-TL-AM002": "lote3",
  "BV-TL-SI001": "lote3",
  "BV-TR-B001": "lote3",
  "BV-TR-B002": "lote3",
  "BV-TR-B003": "lote3",
  "BV-TR-B004": "lote3",
  "BV-TR-B005": "lote3",
  "BV-TR-B006": "lote3",
  "BV-TR-B007": "lote3",
  "BV-TR-B008": "lote3",
  "BV-TR-B009": "lote3",
  "BV-TR-B010": "lote3",
  "BV-TR-BL001": "lote3",
  "BV-TR-BL002": "lote3",
  "BV-TR-CL001": "lote3",
  "BV-TR-R001": "lote3",
  "BV-TR-R002": "lote3",
  "BV-TR-R003": "lote3",
  "BV-TR-R004": "lote3",
  "BV-TR-R005": "lote3",
  "BV-TR-R006": "lote3",
  "BV-TR-R007": "lote3",
  "BV-TR-R008": "lote3",
  "BV-TR-R009": "lote3",
  "BV-TR-RG001": "lote3",
  "BV-TR-RG002": "lote3",
  "BV-TR-TU001": "lote3",
  "BV-TR-TU002": "lote3",
  "BV-TR-TU003": "lote3",
  "BV-TR-TU004": "lote3",
  "BV-TR-TU005": "lote3",
  "BV-US-B001": "lote3",
  "BV-US-B002": "lote3",
  "BV-US-TU001": "lote3",
  "BV-US-TU002": "lote3",
  "BV-US-TU003": "lote3"
};
/* === FIN_MAPA_EQUIPO_CARPETA === */

/**
 * Devuelve la ruta de la ficha de un equipo RELATIVA a la carpeta equipos/
 * (ej: "lote2/BV-CA-B001.html"). Las 194+ páginas de equipo están repartidas
 * en subcarpetas (lote1/lote2/lote3) para no pasar el límite de archivos
 * por subida de GitHub — este helper evita tener que saber a mano en qué
 * carpeta vive cada una.
 */
function sigmaRutaEquipo(codigo){
  const carpeta = SIGMA_EQUIPO_CARPETA[codigo];
  return carpeta ? `${carpeta}/${codigo}.html` : `${codigo}.html`;
}
