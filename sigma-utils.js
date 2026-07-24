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
    Equipos: "1296755573"
  },

  // URL del Web App de Google Apps Script (para escrituras: altas, cambios de estado, mediciones)
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyJYyEwRAuD7aBcWmyYpU6_4AXOBjorLiHCBdKjkj2rNkSR1Ucclu545t1o-E5yyKRJ/exec",

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

/** Barra de navegación compartida. activePage: "dashboard"|"ordenes"|"equipos"|"alta"|"gestion" */
function sigmaRenderNav(activePage, basePath = ""){
  const links = [
    {id:"dashboard", href:`${basePath}dashboard.html`, label:"Dashboard"},
    {id:"equipos", href:`${basePath}equipos/index.html`, label:"Equipos"},
    {id:"ordenes", href:`${basePath}ordenes.html`, label:"Órdenes de trabajo"},
    {id:"alta", href:`${basePath}alta_nuevo_equipo.html`, label:"Alta de equipo"},
    {id:"gestion", href:`${basePath}gestion_hojas.html`, label:"Gestión"}
  ];
  const linksHtml = links.map(l =>
    `<a class="nav-link${l.id===activePage?" active":""}" href="${l.href}">${l.label}</a>`
  ).join("");

  return `
  <nav class="sigma-nav">
    <div class="brand">SIGMA <small>Ingenio Bella Vista</small></div>
    <div class="links">${linksHtml}</div>
  </nav>`;
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

function sigmaDebounce(fn, wait = 250){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
