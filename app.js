"use strict";
// Predictor Fútbol 1.0 — interfaz (sin librerías externas: funciona sin internet y en el móvil)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p, d = 1) => (p == null ? "–" : (p * 100).toFixed(d) + "%");
const n1 = (x, d = 1) => (x == null ? "–" : Number(x).toFixed(d));
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };

// v2.3: copas = las europeas (Champions, Europa, Conference) y las nacionales (Copa del Rey, DFB-Pokal, FA Cup...)
const tipoComp = (c) => { const x = ((typeof E !== "undefined" && E.info && E.info.comps) || []).find((y) => y.id === c);
  return x && x.tipo ? x.tipo : (["champions", "europa", "conference"].includes(c) ? "copa" : /^(copa_|dfb_|fa_cup|carabao|coppa_)/.test(c) ? "nacional" : "liga"); };
const esCopa = (c) => tipoComp(c) !== "liga";
const esNacional = (c) => tipoComp(c) === "nacional";
const E = { info: null, comp: leer("comp", "laliga"), vista: "pronosticos", partido: null, ranking: [], vivo: [],
  tarea: null, desde: 0, filtro: leer("filtro", "todos"), timerVivo: null, tareasFondo: [] };

async function api(url, opts) {
  let j;
  if (window.PBCT_WEB) j = await window.apiWeb(url, opts);   // v2.1: la web (GitHub + Supabase), sin servidor
  else { const r = await fetch(url, opts); j = await r.json(); }
  if (j && j.error && !j.partido) { const e = new Error(j.mensaje || j.error + (j.detalle ? "\n" + j.detalle : "")); e.sinDatos = j.sin_datos; throw e; }
  return j;
}

const quitarTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const RUIDO = new Set(["fc", "cf", "ac", "sc", "ss", "afc", "club", "de", "real", "cd", "ud", "sd", "rc", "1.", "fk", "sv", "vfb", "vfl", "tsg", "as", "ogc", "rcd", "the", "city", "united", "utd"]);
const tokens = (s) => quitarTildes(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length > 2 && !RUIDO.has(t));
function mismoEquipo(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return quitarTildes(a) === quitarTildes(b);
  return x.some((t) => y.some((u) => u === t || (t.length >= 5 && u.startsWith(t.slice(0, 5)))));
}
const vivoDe = (p) => E.vivo.find((v) => mismoEquipo(v.home.nombre, p.home) && mismoEquipo(v.away.nombre, p.away));
const nivelCls = (n) => ({ Alta: "ok", Media: "aviso", Baja: "mal" }[n] || "");
const fechaLarga = (f) => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

// ---------------------------------------------------------------- arranque
async function iniciar() {
  const tema = leer("tema", matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "oscuro");
  document.documentElement.dataset.tema = tema;
  $("#btnTema").onclick = () => {
    const t = document.documentElement.dataset.tema === "claro" ? "oscuro" : "claro";
    document.documentElement.dataset.tema = t; guardar("tema", t);
  };
  E.info = await api("/api/info");
  $("#version").textContent = "v" + E.info.version + (E.info.nube ? " · nube" : "");
  if (E.info.nube) {   // v2.0.4: el mismo programa en la nube (PBCT): sin pestaña Móvil y con botón de salir
    const tm = $("#tabMovil"); if (tm) tm.hidden = true;
    const sal = document.createElement("button"); sal.className = "mini"; sal.textContent = `🔒 Salir${E.info.usuario ? " (" + E.info.usuario + ")" : ""}`;
    sal.onclick = async () => { try { await api("/api/salir", { method: "POST" }); } catch (x) {} location.href = window.PBCT_WEB ? "index.html" : "/"; };
    ($("#btnActualizar") || document.body).insertAdjacentElement("afterend", sal);
  }
  if (E.info.web) {   // v2.1: la web completa. Lo que solo hace el PC (asistente con noticias, informe, entrenar, Versus) no se enseña
    document.body.classList.add("modo-web");
    const st = document.createElement("style");
    st.textContent = `.modo-web #btnIa,.modo-web #btnIaPreguntar,.modo-web #iaPregunta,.modo-web #btnInforme,.modo-web #btnOnces,.modo-web #formCuotas,
      .modo-web #btnIaNumEntrenar,.modo-web #selCasa button[data-casa="versus"],.modo-web #tGuardar,.modo-web #qDatos,.modo-web #btnIaGuardar,
      .modo-web #iaProv,.modo-web #iaModelo,.modo-web #lblClave,.modo-web [data-vista="movil"],.modo-web details:has(#qTexto),
      .modo-web .qres,.modo-web #btnKjefes,.modo-web #kjefesNota,.modo-web #v-ajustes > .tarjeta:first-child{display:none!important}
      .modo-web .solo-web{display:block!important}`;
    document.head.appendChild(st);
    const ba = $("#btnActualizar"); if (ba) { ba.textContent = "⟳ Recargar"; ba.title = "Vuelve a leer los datos (GitHub los calcula a las 10, 15 y 20 h)"; }
    if (E.info.actualizado) $("#version").textContent += " · datos " + new Date(E.info.actualizado).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
    // v2.2: si GitHub lleva mucho sin actualizar (fallo o minutos gastados), se avisa: las cuotas y los onces pueden ser viejos.
    // Por la noche no hay actualizaciones (de 20 h a 10 h son 14 horas): solo se avisa a partir de 17 horas.
    const horas = E.info.actualizado ? (Date.now() - new Date(E.info.actualizado)) / 36e5 : 0;
    if (horas > 17) {
      const av = document.createElement("div"); av.className = "aviso-datos";
      av.textContent = `⚠️ Los datos son de hace ${horas > 48 ? Math.round(horas / 24) + " días" : Math.round(horas) + " horas"}: GitHub no ha podido actualizar. ` +
        "Las cuotas, los onces y los resultados pueden estar viejos: compruébalos en Bet365 antes de apostar.";
      ($("#pestanas") || document.body).insertAdjacentElement("afterend", av);
    }
  }
  const disp = E.info.comps.filter((c) => c.disponible);
  if (!disp.find((c) => c.id === E.comp) && disp.length) E.comp = disp[0].id;
  $("#selComp").innerHTML = E.info.comps.map((c, i, l) =>
    (c.tipo === "nacional" && (l[i - 1] || {}).tipo !== "nacional" ? `<span class="sep-comp" title="Copas nacionales">🏆 Copas:</span>` : "") +
    `<button data-comp="${c.id}" class="${c.tipo === "nacional" ? "copa-nac" : ""}" ${c.disponible ? "" : "disabled title='No instalado'"}><span class="bandera">${esc(c.bandera || "")}</span>${esc(c.nombre)}</button>`).join("");
  $$("#selComp button").forEach((b) => (b.onclick = () => cambiarComp(b.dataset.comp)));
  $$("#pestanas button").forEach((b) => (b.onclick = () => cambiarVista(b.dataset.vista)));
  if (E.info.movil) { $("#movilPC").hidden = true; $("#movilTel").hidden = false; $("#ipPC").value = leer("ipPC", ""); }
  $("#btnActivarMovil").onclick = activarMovil;
  $("#btnCopiar").onclick = () => navigator.clipboard?.writeText($("#cmdMovil").textContent);
  $("#btnImportar").onclick = importarPC;
  $("#cerrarInforme").onclick = () => $("#dlgInforme").close();
  $("#selEquipo").onchange = cargarJugadores;
  $("#btnParar").onclick = () => E.verTarea && E.verTarea !== "auto" && fetch(`/api/tarea/${E.verTarea}/parar`, { method: "POST" });
  $("#btnActualizar").onclick = actualizarRapido;
  $("#btnBuscar").onclick = buscarEquipo;
  $("#buscaEquipo").onkeydown = (ev) => ev.key === "Enter" && buscarEquipo();
  $("#buscaEquipo").onchange = () => (E.equipos || []).includes($("#buscaEquipo").value) && buscarEquipo();
  E.casa = E.info.plataforma || "bet365";
  const pintarCasa = () => $$("#selCasa button").forEach((b) => b.classList.toggle("activa", b.dataset.casa === E.casa));
  pintarCasa();
  $$("#selCasa button").forEach((b) => (b.onclick = async () => {
    await api(`/api/plataforma?casa=${b.dataset.casa}`, { method: "POST" });
    E.casa = b.dataset.casa; pintarCasa();
    if (E.vista === "pronosticos") { await cargarPronosticos(); if (E.partido) abrirPartido(E.partido); }
  }));
  $("#progresoVer").onclick = () => { if (E.tarea) E.verTarea = E.tarea; cambiarVista("actualizar"); };
  if (E.info.conexion_movil) mostrarComandoMovil();
  cambiarComp(E.comp);
}

function cambiarComp(c) {
  E.comp = c; guardar("comp", c); E.partido = null; E.vivo = [];
  $$("#selComp button").forEach((b) => b.classList.toggle("activa", b.dataset.comp === c));
  $$("#pestanas [data-solo]").forEach((b) => (b.hidden = b.dataset.solo === "copas" ? !esCopa(c) : !b.dataset.solo.split(",").includes(c)));
  if (E.vista === "datos" && !esCopa(c)) E.vista = "pronosticos";
  $("#analisis").innerHTML = `<div class="vacio grande">Elige un partido para ver la predicción.</div>`;
  $$(".partidos-layout").forEach((l) => l.classList.remove("con-analisis"));
  cargarEstado();
  cargarListaEquipos();
  if (E.vista === "equipo") E.vista = "pronosticos";
  cambiarVista(E.vista, true);
}

async function cargarListaEquipos() {
  $("#buscaEquipo").value = "";
  $("#buscaEquipo").placeholder = `Buscar equipo de ${nombreComp()}…`;
  try { E.equipos = await api(`/api/${E.comp}/equipos`); } catch (e) { E.equipos = []; }
  $("#listaEquipos").innerHTML = (E.equipos || []).map((e) => `<option value="${esc(e)}">`).join("");
}

function buscarEquipo() {
  const t = $("#buscaEquipo").value.trim();
  if (!t) return;
  const l = E.equipos || [];
  const eq = l.find((e) => e.toLowerCase() === t.toLowerCase()) || l.find((e) => quitarTildes(e).includes(quitarTildes(t))) ||
    l.find((e) => mismoEquipo(e, t));
  if (!eq) { $("#buscaEquipo").setCustomValidity("No encontrado"); $("#buscaEquipo").reportValidity(); setTimeout(() => $("#buscaEquipo").setCustomValidity(""), 1500); return; }
  E.equipoSel = eq; cambiarVista("equipo");
}

async function abrirEquipo(nombre) {
  const el = $("#fichaEquipo");
  el.innerHTML = `<div class="vacio grande"><span class="spinner"></span> Cargando ${esc(nombre)}…</div>`;
  let d;
  try { d = await api(`/api/${E.comp}/equipo?nombre=${encodeURIComponent(nombre)}`); } catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; return; }
  const c = d.clasificacion, m = d.medias || {}, h = (d.historial || {}).resumen || {};
  const mcaja = (t, x) => x ? `<div class="tarjeta c4"><h3>${t} · últimos ${x.partidos}</h3><div class="mercados">
      <div class="mercado"><div class="n">V-E-D</div><div class="v">${x.victorias}-${x.empates}-${x.derrotas}</div></div>
      <div class="mercado"><div class="n">Goles a favor / contra</div><div class="v">${n1(x.gf)} / ${n1(x.gc)}</div></div>
      ${x.xg_f != null ? `<div class="mercado"><div class="n">xG a favor / contra</div><div class="v">${n1(x.xg_f)} / ${n1(x.xg_c)}</div></div>` : ""}
      <div class="mercado"><div class="n">Córners a favor / contra</div><div class="v">${n1(x.corners_f)} / ${n1(x.corners_c)}</div></div>
      <div class="mercado"><div class="n">Tarjetas por partido</div><div class="v">${n1(x.tarjetas)}</div></div>
      <div class="mercado"><div class="n">+2.5 · ambos marcan · portería a 0</div><div class="v">${x.mas25} · ${x.ambos} · ${x.porteria_cero}</div></div></div></div>` : "";
  const rk = E.ranking.filter((p) => p.home === nombre || p.away === nombre);
  el.innerHTML = `<div class="tarjeta"><div class="cab-partido"><div class="equipos">${esc(nombre)}</div>
      <div class="chips">${c ? `<span class="chip">${c.pos}º de ${c.total} · ${c.pts} pts · ${c.pj} PJ</span><span class="chip">${c.g}G ${c.e}E ${c.p}P · ${c.gf}:${c.ga ?? c.gc}</span>` : ""}
      ${c && c.ultimos_5 ? `<span class="chip">Racha ${(c.ultimos_5 || "").split("-").map((r) => `<span class="res ${r}">${r}</span>`).join(" ")}</span>` : ""}
      ${d.opta ? `<span class="chip">Opta ${n1(d.opta.rating, 1)} · #${d.opta.rank} mundial</span>` : ""}${d.elo && d.elo.elo ? `<span class="chip">Elo ${Math.round(d.elo.elo)}</span>` : ""}
      ${h.jugados ? `<span class="chip ok">Historial del modelo con este equipo: 🛡️ ${h.segura}/${h.jugados} · ⚡ ${h.arriesgada}/${h.arriesgada_n} · 🎯 ${h.marcador}/${h.jugados}</span>` : ""}</div></div></div>
    <div class="rejilla">
      ${mcaja("En general", m.general)}${mcaja("En casa", m.casa)}${mcaja("Fuera", m.fuera)}
      <div class="tarjeta c6"><h3>Próximos partidos</h3>${(d.proximos || []).length ? `<ul class="lista-simple sin-punto">${d.proximos.map((p) => {
        const r = rk.find((x) => x.id === p.id);
        return `<li><button class="enlace" data-id="${p.id}">${esc(fechaLarga(p.fecha))} ${esc(p.hora || "")} · <b>${esc(p.home)} – ${esc(p.away)}</b></button>
          ${r ? `<br><span class="pk s">🛡️ ${esc(r.segura.mercado)} ${pct(r.segura.prob, 0)}</span> ${r.arriesgada ? `<span class="pk a">⚡ ${esc(r.arriesgada.mercado)} ${pct(r.arriesgada.prob, 0)}</span>` : ""} <span class="pk m">🎯 ${r.marcador.h}-${r.marcador.a}</span>` : ""}</li>`; }).join("")}</ul>` : `<div class="nota">Sin partidos pendientes</div>`}</div>
      <div class="tarjeta c6"><h3>Bajas, sanciones y apercibidos</h3>${(d.disponibilidad || []).length ? `<ul class="lista-simple">${d.disponibilidad.map((x) => `<li><span class="estado-j ${esc(x.estado.split(" ")[0])}">${esc(x.estado)}</span> <b>${esc(x.jugador)}</b> <span class="nota">${esc(x.motivo || "")}</span></li>`).join("")}</ul>` : `<div class="nota">Nadie sancionado ni en duda</div>`}
        ${(d.goleadores || []).length ? `<h3 style="margin-top:12px">Goleadores</h3><div class="nota">${d.goleadores.map((j) => `${esc(j.player)} <b>${j.goals}</b>`).join(" · ")}</div>` : ""}</div>
      <div class="tarjeta c12"><h3>Últimos partidos</h3>${tablaU5(d.ultimos || [], esCopa(E.comp))}</div>
      <div class="tarjeta c12"><h3>Lo que predijo el programa en sus partidos</h3>${tablaHistDias(((d.historial || {}).partidos) || [])}</div>
      <div class="tarjeta c12"><h3>Jugadores</h3><div class="desplaza"><table class="tabla"><tr><th>Jugador</th><th>Pos.</th><th class="d">Min.</th><th class="d">Goles</th><th class="d">Asist.</th><th class="d">🟨</th><th class="d">🟥</th></tr>
        ${(d.jugadores || []).map((j) => `<tr><td>${esc(j.player)}</td><td>${esc(j.position || "")}</td><td class="d">${j.minutes ?? ""}</td><td class="d">${j.goals ?? ""}</td><td class="d">${j.assists ?? ""}</td><td class="d">${j.yellow_cards ?? ""}</td><td class="d">${j.red_cards ?? ""}</td></tr>`).join("")}</table></div></div>
    </div>`;
  $$(".enlace", el).forEach((b) => (b.onclick = () => { cambiarVista("pronosticos"); setTimeout(() => abrirPartido(+b.dataset.id), 400); }));
}

function cambiarVista(v, forzar) {
  E.vista = v;
  clearTimeout(E.timerVivo);
  $$("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.vista === v));
  $$(".vista").forEach((s) => s.classList.toggle("activa", s.id === "v-" + v));
  const carga = { pronosticos: cargarPronosticos, directo: cargarDirecto, historial: cargarHistorial, clasificacion: cargarClasif,
    resultados: cargarResultados, jugadores: cargarEquipos, datos: cargarDiagnostico, actualizar: pintarBotones,
    ajustes: cargarAjustes, quiniela: cargarQuiniela, combinada: () => cargarCombinada(), apuestas: cargarMisApuestas, equipo: () => E.equipoSel && abrirEquipo(E.equipoSel) }[v];
  if (carga) carga(forzar);
}

async function cargarEstado() {
  try {
    const s = await api(`/api/${E.comp}/estado`);
    const ult = s.ultima_sync ? new Date(s.ultima_sync).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "nunca";
    $("#estado").innerHTML = `${s.jugados ?? 0}/${s.partidos ?? 0} jugados · actualizado: ${esc(ult)}`;
  } catch (e) { $("#estado").textContent = e.sinDatos ? "Sin datos todavía" : "Base de datos no disponible"; }
}

// ---------------------------------------------------------------- botón rápido
async function actualizarRapido() {
  if (E.info.web) { window.pbctRecargar(); cambiarVista(E.vista, true); return; }
  const b = $("#btnActualizar");
  b.disabled = true;
  try {
    const r = await api(`/api/${E.comp}/tarea?tipo=${E.info.movil ? "rapido" : "rapido"}`, { method: "POST" });
    E.tarea = r.id; E.desde = 0; E.verTarea = r.id;
    $("#progreso").hidden = false; $("#progresoTxt").textContent = "Actualizando resultados, onces, cuotas y estadísticas…";
    seguirTarea();
  } catch (e) {
    $("#progreso").hidden = false; $("#progresoTxt").textContent = e.message; b.disabled = false;
  }
}

// ---------------------------------------------------------------- pronósticos (ranking)
async function cargarPronosticos() {
  const el = $("#listaPartidos");
  el.innerHTML = `<div class="vacio"><span class="spinner"></span> Calculando todos los partidos…</div>`;
  let r; const comp = E.comp;   // v2.3: si cambias de competición mientras calcula, no se pinta la anterior
  try { r = await api(`/api/${comp}/ranking`); } catch (e) {
    if (comp !== E.comp) return;
    el.innerHTML = `<div class="tarjeta aviso-sync">${esc(e.message)}${e.sinDatos ? `<br><button class="primario mini" id="btnPrimera">Sincronizar todo ahora</button>` : ""}</div>`;
    const bp = $("#btnPrimera"); if (bp) bp.onclick = () => { cambiarVista("actualizar"); lanzarTarea(E.info.movil ? "espn" : "sync"); };
    return;
  }
  if (comp !== E.comp) return;
  E.ranking = r.partidos || [];
  api(`/api/${comp}/vivo`).then((v) => { if (comp !== E.comp) return; E.vivo = v.partidos || []; pintarRanking(); }).catch(() => {});
  pintarRanking();
}

// v2.2: la fecha de HOY en hora de España (antes salía la de Londres/UTC y entre las 0 y la 1-2 h «HOY» era ayer)
const fechaLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const HOY = () => fechaLocal();
const diaTitulo = (f) => {
  const h = new Date(HOY() + "T12:00:00"), d = new Date(f + "T12:00:00"), dif = Math.round((d - h) / 864e5);
  const largo = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return dif === 0 ? `HOY · ${largo}` : dif === 1 ? `MAÑANA · ${largo}` : dif === -1 ? `AYER · ${largo}` : largo;
};

function puestoTxt(puestos, i) {
  const x = puestos && puestos[i];
  return x ? ` <span class="puesto" title="Puesto en la clasificación">${x}º</span>` : "";
}

function bloqueAvisos(d) {
  const inu = d.ia_numeros || {};
  const av = inu.avisos || [];
  const ctx = inu.contexto || {};
  const pu = (s) => (ctx[s] && ctx[s].puesto ? `${ctx[s].puesto}º` : "–");
  const ia = inu.activa
    ? `🧠 <b>IA de números activa</b> (peso ${Math.round((inu.peso || 0) * 100)} %): ${esc(d.partido.home)} ${pct(inu.antes.p1, 0)} → <b>${pct(inu.despues.p1, 0)}</b> · empate ${pct(inu.antes.px, 0)} → <b>${pct(inu.despues.px, 0)}</b> · ${esc(d.partido.away)} ${pct(inu.antes.p2, 0)} → <b>${pct(inu.despues.p2, 0)}</b>`
    : `🧠 IA de números: ${esc(inu.motivo || "apagada")}`;
  if (!av.length && !inu.activa && !inu.motivo) return "";
  return `<div class="explica avisos-ficha">
    ${av.map((a) => `<p class="aviso-${esc(a.tipo)}">${a.icono} <b>${esc(a.texto)}</b></p>`).join("")}
    ${ctx.h ? `<p class="nota">Clasificación: ${esc(d.partido.home)} ${pu("h")} (${ctx.h.pts ?? "–"} pts) · ${esc(d.partido.away)} ${pu("a")} (${ctx.a.pts ?? "–"} pts)${ctx.h.descanso != null ? ` · descanso ${ctx.h.descanso} y ${ctx.a.descanso} días` : ""}</p>` : ""}
    <p class="nota">${ia}</p></div>`;
}

function pintarRanking() {
  const el = $("#listaPartidos");
  let html = "";
  const dias = [...new Set(E.ranking.map((p) => p.fecha))].sort();
  html += `<div class="filtros"><span class="nota">Por días y, dentro de cada día, de más a menos fiable · ${E.casa === "versus" ? "mercados de terminal Versus" : "mercados de Bet365"} · 15.000 simulaciones por partido</span>
    <select id="filtroDia" class="mini-sel"><option value="todos">Todos los días</option>${dias.map((d) => `<option value="${d}" ${E.filtroDia === d ? "selected" : ""}>${esc(diaTitulo(d).split(" · ")[0] === diaTitulo(d) ? fechaLarga(d) : diaTitulo(d).split(" · ")[0] + " (" + fechaLarga(d) + ")")}</option>`).join("")}</select>
    ${["todos", "Alta", "Media", "Baja"].map((f) => `<button class="mini ${E.filtro === f ? "activa" : ""}" data-f="${f}">${f === "todos" ? "Todos" : f}</button>`).join("")}</div>`;
  const lista = E.ranking.filter((p) => (E.filtro === "todos" || p.nivel === E.filtro) && (!E.filtroDia || E.filtroDia === "todos" || p.fecha === E.filtroDia))
    .sort((x, y) => (x.fecha + (x.error ? "1" : "0")).localeCompare(y.fecha + (y.error ? "1" : "0")) || (y.fiabilidad || 0) - (x.fiabilidad || 0));
  if (!E.ranking.length) html += `<div class="vacio">No hay partidos en los próximos días.<br>Pulsa “⟳ Actualizar partidos”.</div>`;
  else if (!lista.length) html += `<div class="vacio">Ningún partido con ese filtro.</div>`;
  let ultimo = "";
  for (const p of lista) {
    if (p.fecha !== ultimo) { ultimo = p.fecha; html += `<div class="fecha-grupo ${p.fecha === HOY() ? "hoy" : ""}">${esc(diaTitulo(p.fecha))}</div>`; }
    if (p.error) { html += `<div class="item">${esc(p.home)} – ${esc(p.away)}<span class="nota">${esc(p.error)}</span></div>`; continue; }
    const v = vivoDe(p), live = v && v.estado.fase === "in", ex = p.examen || {};
    const marc = v && v.estado.fase !== "pre" ? `<span class="vivo ${live ? "en" : ""}">${live ? "● " + esc(v.estado.minuto || v.estado.texto) : "Final"} ${esc(v.home.goles)}-${esc(v.away.goles)}</span>` : "";
    html += `<button class="item pick" data-id="${p.id}">
      <div class="fila1"><span class="eq">${esc(p.home)}${puestoTxt(p.puestos, 0)} – ${esc(p.away)}${puestoTxt(p.puestos, 1)}</span>${marc || `<span class="hora">${esc(p.hora || "")}</span>`}</div>
      <div class="picks">
        <span class="pk s ${ex.segura ? "mala" : ""}" title="${ex.segura ? "❌ El examen la suspende: " + esc(ex.segura) : "Apuesta segura"}">${ex.segura ? "❌" : "🛡️"} ${esc(p.segura.mercado)} <b>${pct(p.segura.prob, 0)}</b></span>
        ${p.arriesgada ? `<span class="pk a ${ex.arriesgada ? "mala" : ""}" title="${ex.arriesgada ? "❌ El examen la suspende: " + esc(ex.arriesgada) : "Apuesta arriesgada (si acierta, también acierta la segura)"}">${ex.arriesgada ? "❌" : "⚡"} ${esc(p.arriesgada.mercado)} <b>${pct(p.arriesgada.prob, 0)}</b></span>` : ""}
        ${p.efecto_nombre ? `<span class="pk a" title="${esc(p.efecto_nombre.texto)}">⚠️ cuota inflada ${esc(p.efecto_nombre.equipo)}</span>` : ""}
        ${(p.b365_valor || []).slice(0, 1).map((v) => `<span class="pk s" title="Bet365 paga ${n1(v.cuota, 2)} y lo justo según ${esc(v.referencia)} es ${n1(v.justa, 2)}. Comprueba que la cuota sigue igual antes de apostar.">💎 ${esc(v.mercado)} @${n1(v.cuota, 2)} <b>+${Math.round(v.ventaja * 100)}%</b></span>`).join("")}
        <span class="pk m" title="Resultado exacto más repetido en las simulaciones">🎯 ${p.marcador.h}-${p.marcador.a}${p.top3 && p.top3.length > 1 ? ` <span class="nota">o ${p.top3.filter((t) => !(t.h === p.marcador.h && t.a === p.marcador.a)).slice(0, 2).map((t) => t.h + "-" + t.a).join(" / ")}</span>` : ""}</span>
        ${p.corners ? `<span class="pk c ${ex.corners ? "mala" : ""}" title="${ex.corners ? "❌ El examen las suspende: " + esc(ex.corners) : "Córners"}">${ex.corners ? "❌" : "🚩"} ${esc(p.corners.mercado.replace(" córners", ""))} <b>${pct(p.corners.prob, 0)}</b></span>` : ""}
        ${p.tarjetas ? `<span class="pk c ${ex.tarjetas ? "mala" : ""}" title="${ex.tarjetas ? "❌ El examen las suspende: " + esc(ex.tarjetas) : "Tarjetas"}">${ex.tarjetas ? "❌" : "🟨"} ${esc(p.tarjetas.mercado.replace(" tarjetas", ""))} <b>${pct(p.tarjetas.prob, 0)}</b></span>` : ""}
      </div>
      ${(p.avisos || []).length ? `<div class="avisos-mini">${p.avisos.map((a) => `<span class="aviso-${esc(a.tipo)}">${a.icono} ${esc(a.texto)}</span>`).join("")}</div>` : ""}
      ${ex.segura ? `<div class="avisos-mini"><span class="aviso-mal">❌ El examen dice que esta segura falla: ${esc(ex.segura)}</span></div>` : ""}
      <div class="fiab"><div class="medidor"><i class="${nivelCls(p.nivel)}" style="width:${p.fiabilidad}%"></i></div>
        <span class="chip ${nivelCls(p.nivel)}">Fiabilidad ${esc(p.nivel)}</span>${p.cuotas ? `<span class="nota">cuotas ${p.cuotas.c.map((x) => n1(x, 2)).join(" · ")}</span>` : `<span class="nota">sin cuotas</span>`}</div>
    </button>`;
  }
  el.innerHTML = html;
  $$(".filtros button", el).forEach((b) => (b.onclick = () => { E.filtro = b.dataset.f; guardar("filtro", E.filtro); pintarRanking(); }));
  $("#filtroDia").onchange = (ev) => { E.filtroDia = ev.target.value; pintarRanking(); };
  $$(".item.pick", el).forEach((b) => (b.onclick = () => abrirPartido(+b.dataset.id)));
  if (E.partido) $$(".item", el).forEach((b) => b.classList.toggle("activo", +b.dataset.id === E.partido));
}

async function abrirPartido(id, cuotas) {
  E.partido = id;
  $$("#listaPartidos .item").forEach((b) => b.classList.toggle("activo", +b.dataset.id === id));
  $("#v-pronosticos .partidos-layout").classList.add("con-analisis");
  const el = $("#analisis");
  el.classList.add("cargando");
  if (!el.querySelector(".cab-partido")) el.innerHTML = `<div class="vacio grande"><span class="spinner"></span> Calculando el modelo…</div>`;
  const c = cuotas ?? leer(`cuotas_${E.comp}_${id}`, "");
  try {
    const d = await api(`/api/${E.comp}/analizar?id=${id}${c && c.trim() ? "&c=" + encodeURIComponent(c) : ""}`);
    if (d.error) throw new Error(d.error);
    pintarAnalisis(d, c);
  } catch (e) {
    el.innerHTML = `<div class="tarjeta"><b>No se pudo calcular</b><pre class="consola">${esc(e.message)}</pre></div>`;
  }
  el.classList.remove("cargando");
}

function barra1x2(p, h, a) {
  const w = (x) => Math.max(x * 100, 0.5).toFixed(1) + "%";
  return `<div class="barra1x2">
    <div style="width:${w(p.p1)};background:var(--local)">${pct(p.p1, 0)}</div>
    <div style="width:${w(p.px)};background:var(--empate)">${pct(p.px, 0)}</div>
    <div style="width:${w(p.p2)};background:var(--visit)">${pct(p.p2, 0)}</div></div>
    <div class="leyenda1x2"><span>1 · ${esc(h)}</span><span>X · Empate</span><span>${esc(a)} · 2</span></div>`;
}

function calor(m) {
  const max = Math.max(...m.flat());
  let h = `<table class="calor"><tr><th></th>${m[0].map((_, j) => `<th>${j}</th>`).join("")}</tr>`;
  m.forEach((fila, i) => {
    h += `<tr><th>${i}</th>${fila.map((v) => `<td style="background:color-mix(in srgb, var(--acento) ${Math.round((v / max) * 85)}%, var(--panel2))" title="${i}-? ${pct(v)}">${(v * 100).toFixed(0)}</td>`).join("")}</tr>`;
  });
  return h + `</table><div class="nota">Filas: goles del local · columnas: goles del visitante (%)</div>`;
}

function tablaU5(filas, mostrarComp) {
  if (!filas || !filas.length) return `<div class="nota">Sin datos</div>`;
  return `<div class="desplaza"><table class="tabla"><tr><th>Fecha</th><th></th><th>Rival</th>${mostrarComp ? "<th>Comp.</th>" : ""}<th></th>
    <th class="d">Res.</th><th class="d">Córners</th><th class="d">Tarjetas</th></tr>${filas.map((f) =>
    `<tr><td>${esc(f.fecha.slice(5))}</td><td title="${esc(f.condicion)}">${f.condicion === "Casa" ? "🏠" : f.condicion === "Fuera" ? "✈️" : "⚖️"}</td>
     <td>${esc(f.rival)}</td>${mostrarComp ? `<td class="nota">${esc((f.competicion || "").slice(0, 14))}</td>` : ""}
     <td><span class="res ${f.resultado}">${f.resultado}</span></td><td class="d">${f.gf}-${f.gc}</td>
     <td class="d">${f.corners_f ?? "?"}-${f.corners_c ?? "?"}</td><td class="d">${f.tarjetas_f ?? "?"}-${f.tarjetas_c ?? "?"}</td></tr>`).join("")}</table></div>`;
}

function previaEquipo(eq, idx, champions) {
  const tipos = [["todas", champions ? "Todas las competiciones" : "Últimos 5"]];
  if (champions) tipos.push(["champions", "En " + nombreComp()]);
  tipos.push(["condicion", idx === 0 ? "En casa" : "Fuera"]);
  const id = `pv${idx}`;
  return `<div><div class="equipo-cab">${esc(eq.nombre)}</div><div class="subpestanas" data-grupo="${id}">
    ${tipos.map(([k, t], i) => `<button class="mini ${i === 0 ? "activa" : ""}" data-k="${k}">${t}</button>`).join("")}</div>
    ${tipos.map(([k], i) => `<div data-panel="${id}-${k}" ${i ? "hidden" : ""}>${tablaU5(eq.previa[k], champions && k !== "champions")}</div>`).join("")}</div>`;
}

function filaComp(et, a, b) { return `<div class="izq">${a ?? "–"}</div><div class="et">${et}</div><div class="der">${b ?? "–"}</div>`; }

function bloqueEquipos(d) {
  const [A, B] = d.equipos, ucl = esCopa(d.competicion);
  let h = `<div class="comparativa"><div class="izq equipo-cab">${esc(A.nombre)}</div><div></div><div class="der equipo-cab">${esc(B.nombre)}</div>`;
  const pos = (e) => e.puesto ? `${e.puesto}º · ${e.pts} pts · ${e.pj} PJ${e.zona ? `<br><span class="nota">${esc(e.zona)}</span>` : ""}` : "–";
  h += filaComp(ucl ? "Fase liga" : "Clasificación", pos(A), pos(B));
  h += filaComp("Racha", esc(A.racha || "–"), esc(B.racha || "–"));
  h += filaComp("Ataque (1 = media)", n1(A.ataque, 2), n1(B.ataque, 2));
  h += filaComp("Defensa (1 = media)", n1(A.defensa, 2), n1(B.defensa, 2));
  if (!ucl && (A.opta || B.opta)) {
    const op = (e) => e.opta ? `<b>${n1(e.opta.rating, 1)}</b> <span class="nota">#${e.opta.rank} mundial</span>` : "–";
    h += filaComp("Opta Power Ranking", op(A), op(B));
  }
  if (ucl) {
    const elo = (e) => e.elo ? `<b>${Math.round(e.elo)}</b><br><span class="nota">${[e.opta ? "Opta " + e.opta + " (#" + e.opta_rank + ")" : "", e.elo_clubelo ? "ClubElo " + Math.round(e.elo_clubelo) : "", e.elo_propio ? "propio " + Math.round(e.elo_propio) : ""].filter(Boolean).join(" · ")}</span>` : "–";
    h += filaComp("Elo", elo(A), elo(B));
    const ln = (e) => { const r = e.liga_nacional; if (!r || !r.pj) return "sin datos";
      return `${esc(r.liga)}: <b>${r.pos ? r.pos + "º" : "puesto ?"}</b>${r.n_equipos ? "/" + r.n_equipos : ""}<br>${r.pj} PJ · ${r.pts} pts (${n1(r.ppg, 2)}/PJ)<br>goles ${n1(r.gf_pg)}–${n1(r.gc_pg)}` +
        (r.corners_f != null ? `<br>córners ${n1(r.corners_f)}–${n1(r.corners_c)} · tarj. ${n1(r.tarjetas)}` : ""); };
    h += filaComp("Liga nacional", ln(A), ln(B));
    const dm = (e) => { const x = e.datos_modelo || {}; const t = (x.champions || 0) + (x.liga || 0);
      return `${x.champions || 0} ${E.comp === "europa" ? "UEL" : E.comp === "conference" ? "UECL" : esNacional(E.comp) ? "copa" : "UCL"} + ${x.liga || 0} liga${t < 10 ? ' <span class="chip aviso">pocos datos</span>' : ""}`; };
    h += filaComp("Datos del modelo", dm(A), dm(B));
  }
  return h + "</div>";
}

function bloqueDisp(d) {
  const lado = (k, nombre) => {
    const l = d.disponibilidad[k] || [];
    return `<div><div class="equipo-cab">${esc(nombre)}</div>${l.length ? `<ul class="lista-simple">${l.map((x) =>
      `<li><span class="estado-j ${esc(x.estado.split(" ")[0])}">${esc(x.estado)}</span> <b>${esc(x.jugador)}</b> <span class="nota">${esc(x.motivo)}</span></li>`).join("")}</ul>`
      : `<div class="nota">Sin sancionados, apercibidos ni dudas</div>`}</div>`;
  };
  return `<div class="rejilla" style="margin-top:0"><div class="c6">${lado("home", d.partido.home)}</div><div class="c6">${lado("away", d.partido.away)}</div></div>
    <p class="nota">Sanciones calculadas con las tarjetas reales. FBref no publica partes médicos: las lesiones son indicios.</p>`;
}

function bloqueOnces(d) {
  const o = d.alineaciones;
  const lado = (x, nombre) => `<div><div class="equipo-cab">${esc(nombre)} ${x.oficial ? '<span class="chip ok">OFICIAL</span>' : x.probable ? '<span class="chip aviso">PROBABLE · prensa</span>' : '<span class="chip">estimada por el programa</span>'}</div>
    <div class="nota">${esc(x.fuente || "")}${x.consultado ? " · " + esc(x.consultado.slice(11, 16)) : ""}</div>
    <ol class="lista-simple">${(x.jugadores || []).map((j) => `<li>${esc(j)}</li>`).join("")}</ol>
    ${(x.bajas_previstas || []).length ? `<div class="nota">🚑 Bajas y dudas: ${x.bajas_previstas.map((b) => `${esc(b.jugador)} (${({ OUT: "baja", QUES: "duda", SUS: "sancionado", GTD: "duda", DOUBT: "duda" })[b.estado] || esc(b.estado)})`).join(", ")}</div>` : ""}</div>`;
  let h = `<div class="rejilla" style="margin-top:0"><div class="c6">${lado(o.home, d.partido.home)}</div><div class="c6">${lado(o.away, d.partido.away)}</div></div>`;
  if (d.ajuste_bajas.home || d.ajuste_bajas.away)
    h += `<p class="nota">Ajuste por bajas → ${esc(d.partido.home)}: ${esc(d.ajuste_bajas.home || "sin cambios")} · ${esc(d.partido.away)}: ${esc(d.ajuste_bajas.away || "sin cambios")}</p>`;
  (d.avisos || []).forEach((a) => (h += `<p class="nota">⚠️ ${esc(a)}</p>`));
  if (o.home.probable || o.away.probable) h += `<p class="nota">El once PROBABLE es la previsión de la prensa (como en Flashscore) y ya ajusta el pronóstico, con menos peso que el oficial. El oficial sale ~1 h antes del partido.</p>`;
  if (!o.home.oficial || !o.away.oficial) h += `<button id="btnOnces">Buscar onces oficiales ahora (ESPN / FBref)</button>`;
  return h;
}

function bloqueCT(t, titulo, icono) {
  if (!t) return `<div class="nota">Sin datos de ${titulo.toLowerCase()} todavía (sincroniza los detalles de partido).</div>`;
  return `<div class="goles"><span>${icono} ${esc(titulo)}</span><span class="xg">${n1(t.total)}</span></div>
    <div class="nota">Local ${n1(t.h)} · Visitante ${n1(t.a)}${t.arbitro ? ` · factor árbitro ×${t.arbitro.factor} (${t.arbitro.partidos} partidos)` : ""}</div>
    <div class="mercados">${t.lineas.map((l) => `<div class="mercado"><div class="n">Más de ${l.linea}</div><div class="v">${pct(l.prob, 0)}</div></div>`).join("")}</div>`;
}

function bloqueEV(ev) {
  if (!ev) return `<div class="nota">Sin cuotas todavía: escribe las de tu casa de apuestas arriba.</div>`;
  if (ev.error) return `<div class="nota">${esc(ev.error)}</div>`;
  return `<div class="nota">Margen de la casa: ${pct(ev.margen)}</div><div class="desplaza"><table class="tabla">
    <tr><th>Mercado</th><th class="d">Cuota</th><th class="d">Probabilidad</th><th class="d">Casa (real)</th><th class="d">EV</th><th class="d">Kelly ¼</th></tr>
    ${ev.filas.map((f) => `<tr class="${f.valor ? "valor" : ""}"><td>${esc(f.mercado)} ${f.valor ? "✨" : ""}</td><td class="d">${n1(f.cuota, 2)}</td>
    <td class="d">${pct(f.prob_modelo)}</td><td class="d">${pct(f.prob_casa)}</td><td class="d">${(f.ev * 100).toFixed(1)}%</td>
    <td class="d">${f.valor ? pct(f.kelly) + " del bank" : "–"}</td></tr>`).join("")}</table></div>
    <p class="nota">Una probabilidad alta NO es valor: solo hay valor si la cuota paga más que 1/probabilidad.</p>`;
}

// ---------------------------------------------------------------- cuotas escritas por el usuario (terminal / app)
const cuotaKey = (clave) => `mc_${E.comp}_${E.partido}_${clave}`;
function valorManual(p) {
  const c = parseFloat(String(leer(cuotaKey(p.clave), "")).replace(",", "."));
  if (!(c > 1)) return null;
  const ev = p.prob * c - 1, justa = 1 / p.prob;
  const veredicto = ev > 0.05 ? "valor" : ev > -0.03 ? "justo" : "sin_valor";
  const texto = veredicto === "valor" ? `Sí merece la pena: pagan ${c.toFixed(2)} y bastaría ${justa.toFixed(2)}`
    : veredicto === "justo" ? `Cuota justa: pagan ${c.toFixed(2)}, lo que vale (${justa.toFixed(2)})`
    : `No merece la pena: pagan ${c.toFixed(2)} y deberían pagar al menos ${justa.toFixed(2)}`;
  return { ev, veredicto, texto, ganancia_100: ev * 100 };
}
function ligarCuotasManuales(el, d) {
  $$("input[data-mercado]", el).forEach((i) => (i.onchange = () => {
    guardar(cuotaKey(i.dataset.mercado), i.value.trim());
    const abiertos = $$("details", el).map((x) => x.open), y = window.scrollY;
    pintarAnalisis(d, leer(`cuotas_${E.comp}_${d.partido.id}`, ""));
    $$("details", $("#analisis")).forEach((x, k) => (x.open = !!abiertos[k]));
    window.scrollTo(0, y);
  }));
}

// ---------------------------------------------------------------- apartado Bet365: cuánto paga cada apuesta
// Bet365 no deja que un programa lea sus cuotas. Las reales llegan de football-data (1, X, 2, más/menos 2.5);
// el resto se estiman con el margen que Bet365 suele cobrar en cada tipo de apuesta, y si escribes la cuota
// que ves en Bet365 se usa la tuya.
function margenB365(clave, m0) {
  if (clave.startsWith("S:")) return 0.18;                      // resultado exacto
  if (clave.includes("&") || clave.includes("-H")) return m0 + 0.06; // combinados (Crear apuesta) y hándicap
  if (/^[CTR][LV]?[<>]/.test(clave) || clave.startsWith("CH") || clave.startsWith("CA")) return m0 + 0.04; // córners/tarjetas (total y de equipo)
  if (["1X", "X2", "12"].includes(clave)) return m0 / 2;
  return m0 + 0.01;
}
function apuestasB365(ap, pk, versus) {
  // Versus no publica sus cuotas: no hay «reales» (salvo las que escribas) y su margen es mayor (~9 % en el 1X2,
  // visto en la terminal: 4,70 · 3,85 · 1,62)
  const cu = ap.cuotas || {}, b = versus ? [] : cu.b365 || [], ou = versus ? [] : cu.b365_ou || [];
  const reales = { "1": b[0], X: b[1], "2": b[2], O25: ou[0], U25: ou[1] };
  const m0 = versus ? 0.09 : b.length === 3 && b.every((x) => x > 1) ? Math.max(0.02, 1 / b[0] + 1 / b[1] + 1 / b[2] - 1) : 0.05;
  const lista = (pk.mercados || []).filter((m) => m.disponible !== false && m.prob > 0.02).map((m) => ({ ...m }));
  (pk.top_simulados || []).forEach((t) => lista.push({ clave: `S:${t.h}-${t.a}`, mercado: `Resultado exacto ${t.h}-${t.a}`, prob: t.prob, veces: t.veces }));
  for (const m of lista) {
    const tuya = parseFloat(String(leer(cuotaKey(m.clave), "")).replace(",", "."));
    if (tuya > 1) { m.cuota = tuya; m.origen = "tuya"; }
    else if (reales[m.clave] > 1) { m.cuota = reales[m.clave]; m.origen = "real"; }
    else { m.cuota = Math.max(1.01, 1 / (m.prob * (1 + margenB365(m.clave, m0)))); m.origen = "estimada"; }
    m.ev = m.prob * m.cuota - 1;
  }
  const conValor = (m) => m.origen !== "estimada" && m.ev > 0.03;
  const segCand = lista.filter((m) => m.prob >= 0.75 && (m.p10 == null || m.p10 >= 0.62) && m.cuota >= 1.12);
  const segura = segCand.sort((a, b) => (conValor(b) - conValor(a)) || (b.cuota - a.cuota))[0] || null;
  const arrCand = lista.filter((m) => m.prob >= 0.36 && m.prob <= 0.62 && m.cuota >= 1.75);
  const arriesgada = arrCand.sort((a, b) => (conValor(b) - conValor(a)) || (b.prob - a.prob))[0] || null;
  const bombaCand = lista.filter((m) => m.prob >= 0.15 && m.prob < 0.36);
  const bomba = bombaCand.sort((a, b) => (conValor(b) - conValor(a)) || (b.cuota - a.cuota))[0] || null;
  return { lista: lista.sort((a, b) => b.cuota - a.cuota), segura, arriesgada, bomba, hayReales: Object.values(reales).some((x) => x > 1) };
}
function cajaB365(tipo, icono, titulo, m, nota) {
  if (!m) return `<div class="pickbox ${tipo} vacia"><div class="t">${icono} ${titulo}</div><div class="m">Ninguna apuesta encaja</div></div>`;
  const casa = E.casa === "versus" ? "Versus" : "Bet365";
  const etiqueta = m.origen === "real" ? `cuota real ${casa}` : m.origen === "tuya" ? "tu cuota" : `cuota ${casa} estimada`;
  return `<div class="pickbox ${tipo}"><div class="t">${icono} ${titulo}</div><div class="m">${esc(m.mercado)}</div>
    <div class="p">@ ${n1(m.cuota, 2)}</div>
    <div class="sim">${etiqueta} · probabilidad ${pct(m.prob, 0)}${m.p10 != null ? ` · peor escenario ${pct(m.p10, 0)}` : ""}</div>
    <div class="cuota">10 € → cobras <b>${n1(10 * m.cuota, 2)} €</b> si aciertas</div>
    ${m.origen !== "estimada" ? `<div class="veredicto ${m.ev > 0.05 ? "valor" : m.ev > -0.03 ? "justo" : "sin_valor"}">${m.ev > 0.05 ? "✅ Paga más de lo que vale" : m.ev > -0.03 ? "➖ Cuota justa" : "❌ Paga menos de lo que vale"} (justa ${n1(1 / m.prob, 2)})</div>`
      : `<label class="mi-cuota">Cuota que ves en ${casa === "Versus" ? "la terminal" : "Bet365"}: <input data-mercado="${esc(m.clave)}" inputmode="decimal" placeholder="${n1(m.cuota, 2)}"></label>`}
    <div class="nota">${nota}</div></div>`;
}
function bloqueB365(ap, pk) {
  const vs = E.casa === "versus", casa = vs ? "Versus" : "Bet365";
  const r = apuestasB365(ap, pk, vs);
  return `<div class="tarjeta b365 ${vs ? "versus" : ""}"><h3>${vs ? "🟩 Apuesta Versus (terminal)" : "🟢 Apuesta Bet365"} · lo que más paga para lo segura que es</h3>
    <div class="resumen3">
      ${cajaB365("s", "🛡️", `${casa} segura`, r.segura, "La que MÁS paga entre las que salen 3 de cada 4 veces o más.")}
      ${cajaB365("a", "⚡", `${casa} arriesgada`, r.arriesgada, "La más probable de las que pagan 1,75 o más.")}
      ${cajaB365("m", "💣", "La que más paga", r.bomba, "La cuota más alta de las que salen al menos 1 de cada 7 veces (15–35 %). Para poco dinero.")}
    </div>
    <p class="nota">${vs ? `La terminal Versus no publica sus cuotas en internet: aquí van <b>estimadas</b> con su margen habitual (algo mayor que Bet365, ~9 % en el 1X2).
      Busca el partido en la terminal (Fútbol España → Primera División → partido → pestañas Ganador, Goles, Handicap, Combinadas, Local/Visit., Corners/Tarjetas o «Crea tu apuesta»)
      y escribe la cuota que veas: te dice al momento si vale la pena.` : `${r.hayReales ? "Las cuotas de 1, X, 2 y más/menos de 2.5 son las reales de Bet365 (football-data). " : "Todavía no hay cuotas reales de Bet365 para este partido (salen unos días antes). "}
      Las demás son <b>estimadas</b> con el margen que suele cobrar Bet365: escribe la que veas en la app y se recalcula al momento.`}</p>
    <details><summary>Todas las apuestas de ${casa} ordenadas por lo que pagan (${r.lista.length})</summary>
      <div class="desplaza"><table class="tabla"><tr><th>Apuesta</th><th class="d">Cuota</th><th>Origen</th><th class="d">Probabilidad</th><th class="d">10 € →</th><th class="d">Tu cuota</th><th>¿Vale la pena?</th></tr>
      ${r.lista.map((m) => `<tr><td>${esc(m.mercado)}</td><td class="d"><b>${n1(m.cuota, 2)}</b></td><td class="nota">${m.origen}</td><td class="d">${pct(m.prob, 0)}</td><td class="d">${n1(10 * m.cuota, 2)} €</td>
        <td class="d"><input class="cuota-mini" data-mercado="${esc(m.clave)}" inputmode="decimal" value="${esc(leer(cuotaKey(m.clave), ""))}"></td>
        <td>${m.origen === "estimada" ? "" : `<span class="veredicto ${m.ev > 0.05 ? "valor" : m.ev > -0.03 ? "justo" : "sin_valor"}">${m.ev > 0.05 ? "✅ Sí" : m.ev > -0.03 ? "➖ Justa" : "❌ No"}</span>`}</td></tr>`).join("")}</table></div></details></div>`;
}


// ---------------------------------------------------------------- cómo juega cada equipo (estadísticas reales)
function bloqueEstilo(d) {
  const es = d.estilo;
  if (!es || es.error || (!es.home.general && !es.away.general)) return "";
  const P = d.partido;
  const col = (x, nombre, lugar) => {
    const g = x.general, c = x.condicion;
    if (!g) return `<div class="c6"><div class="equipo-cab">${esc(nombre)}</div><div class="nota">Sin datos suficientes.</div></div>`;
    const fila = (t, k, dec = 1, suf = "") => (g[k] == null && (!c || c[k] == null)) ? "" : `<tr><td>${t}</td><td class="d">${g[k] == null ? "–" : n1(g[k], dec) + suf}</td><td class="d">${c && c[k] != null ? n1(c[k], dec) + suf : "–"}</td></tr>`;
    const lin = (c && c.lineas_corners) || g.lineas_corners || {};
    return `<div class="c6"><div class="equipo-cab">${esc(nombre)} ${g.formacion ? `<span class="chip">${esc(g.formacion)}</span>` : ""}</div>
      ${(c && c.estilo.length ? c.estilo : g.estilo).length ? `<ul class="lista-simple">${(c && c.estilo.length ? c.estilo : g.estilo).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : `<div class="nota">Sin rasgos muy marcados: equipo de números medios.</div>`}
      <div class="desplaza"><table class="tabla"><tr><th>Últimos ${g.partidos} partidos</th><th class="d">Todos</th><th class="d">${lugar}</th></tr>
        ${fila("Córners a favor", "corners_f")}${fila("Córners en contra", "corners_c")}${fila("Posesión", "posesion_f", 0, "%")}
        ${fila("Tiros a favor", "tiros_f")}${fila("Tiros en contra", "tiros_c")}${fila("Tiros a puerta", "tiros_puerta_f")}
        ${fila("xG a favor", "xg_f", 2)}${fila("xG en contra", "xg_c", 2)}${fila("Goles a favor", "gf")}${fila("Goles en contra", "gc")}
        ${fila("Faltas", "faltas_f")}${fila("Tarjetas", "tarjetas_f")}</table></div>
      ${Object.keys(lin).length ? `<div class="nota">Córners totales en sus partidos (${lugar.toLowerCase()}): ${Object.entries(lin).map(([l, v]) => `más de ${l} en ${v.mas}/${v.de}`).join(" · ")}</div>` : ""}</div>`;
  };
  return `<details class="tarjeta"><summary>🧠 Cómo juega cada equipo (estadísticas reales, no suposiciones)</summary>
    ${es.explicacion_corners ? `<p>🚩 <b>En qué se basa el pronóstico de córners:</b> ${esc(es.explicacion_corners)}</p>` : ""}
    <div class="rejilla" style="margin-top:0">${col(es.home, P.home, "En casa")}${col(es.away, P.away, "Fuera")}</div>
    <p class="nota">Datos de sus últimos 10 partidos guardados (FBref, football-data, ESPN y Understat). Los rasgos solo aparecen si los números los respaldan.</p></details>`;
}


// ---------------------------------------------------------------- para poco dinero: «Crear apuesta» y jugadores
function bloquePocoDinero(d, pk) {
  const ca = pk.crear_apuesta, jp = d.jugadores_prob, vs = E.casa === "versus";
  if (!ca && (!jp || jp.error)) return "";
  const nombreCrear = vs ? "Crea tu apuesta" : "Crear apuesta";
  const caja = (o, titulo, icono, tipo) => !o ? "" : `<div class="pickbox ${tipo}"><div class="t">${icono} ${titulo}</div>
      <ol class="lista-simple">${o.selecciones.map((x) => `<li><b>${esc(x.mercado)}</b> <span class="nota">(${pct(x.prob, 0)})</span></li>`).join("")}</ol>
      <div class="p">${pct(o.prob, 0)}</div>
      <div class="sim">salen las ${o.selecciones.length} a la vez en ${pct(o.prob, 0)} de los 15.000 partidos simulados</div>
      <div class="cuota">Cuota aprox. <b>@ ${n1(o.cuota, 2)}</b>${o.aumento ? ` → con el +25 % de Bet365 <b>@ ${n1(o.cuota_aumento, 2)}</b>` : ""}</div>
      <div class="cuota">Con 2 € cobras <b>${n1(2 * o.cuota_aumento, 2)} €</b> · con 4 € <b>${n1(4 * o.cuota_aumento, 2)} €</b></div>
      <label class="mi-cuota">Cuota que te da ${vs ? "la terminal" : "Bet365"}: <input data-mercado="CREAR_${esc(o.selecciones.map((x) => x.clave).join("+"))}" inputmode="decimal" placeholder="${n1(o.cuota_aumento, 2)}"
        value="${esc(leer(cuotaKey("CREAR_" + o.selecciones.map((x) => x.clave).join("+")), ""))}"></label>
      ${(() => { const c = parseFloat(String(leer(cuotaKey("CREAR_" + o.selecciones.map((x) => x.clave).join("+")), "")).replace(",", ".")); if (!(c > 1)) return "";
        const ev = o.prob * c - 1; return `<div class="veredicto ${ev > 0.03 ? "valor" : ev > -0.04 ? "justo" : "sin_valor"}">${ev > 0.03 ? "✅ Paga más de lo que vale" : ev > -0.04 ? "➖ Cuota justa" : "❌ Paga menos de lo que vale"} (justa ${n1(1 / o.prob, 2)})</div>`; })()}
      ${btnJugada(o.selecciones.map((x) => ({ ...E.ficha, clave: x.clave, mercado: x.mercado, prob: x.prob })), leer(cuotaKey("CREAR_" + o.selecciones.map((x) => x.clave).join("+")), "") || o.cuota_aumento, "crear apuesta")}</div>`;
  const tablaJ = (lista, campo, justa, titulo) => `<div class="c4"><h4>${titulo}</h4><div class="desplaza"><table class="tabla"><tr><th>Jugador</th><th class="d">Prob.</th><th class="d">Justa</th></tr>
    ${(lista || []).slice(0, 6).map((j) => `<tr><td>${esc(j.jugador)} <span class="nota">${esc(j.equipo)} · ${esc(j.pos)}</span></td><td class="d">${pct(j[campo], 0)}</td><td class="d">${n1(j[justa], 2)}</td></tr>`).join("")}</table></div></div>`;
  return `<div class="tarjeta poco"><h3>💰 Para poco dinero · lo más probable</h3>
    <p class="nota">Con 2-4 € lo que más sentido tiene es <b>una sola apuesta con 3 selecciones muy probables del mismo partido</b> (${nombreCrear})${vs ? "" : ": Bet365 da un 25 % más de ganancias con 3 o más selecciones"}.
      El programa elige las 3 que más veces salen JUNTAS en las simulaciones (no se contradicen y no repiten lo mismo).</p>
    ${ca ? `<div class="resumen3 dos">${caja(ca.segura, `${nombreCrear} · la más segura`, "🛡️", "s")}${caja(ca.equilibrada, `${nombreCrear} · equilibrada`, "⚖️", "a")}</div>` : ""}
    ${pk.estilo_tipster2 ? `<div class="resumen3 dos">${caja(pk.estilo_tipster2, "Estilo BETSEVOLUTION (3 selecciones, ~2,00)", "🧾", "a")}<div class="pickbox a"><div class="t">🧾 Estilo BETSEVOLUTION</div>
      <div class="nota">Su apuesta típica (874 boletos de 2026): «${nombreCrear}» de 2-3 selecciones a cuota 2,00 con gol en la 1ª mitad, ambos marcan, más de 1.5/2.5 goles,
      córners y ganador o doble oportunidad. Aquí, las 3 selecciones de su estilo que más veces salen juntas en las simulaciones${vs ? "" : " (con el +25 % de Bet365)"}.</div></div></div>` : ""}
    ${pk.estilo_tipster ? `<div class="resumen3 dos">${caja(pk.estilo_tipster, "Estilo Kjefes (2 selecciones, 1,50-1,75)", "🧾", "m")}<div class="pickbox m"><div class="t">🧾 Qué es esto</div>
      <div class="nota">Es el tipo de apuesta que más usa el canal que me pasaste (casi 600 apuestas): «${nombreCrear}» de 2 selecciones del mismo partido a cuota 1,50-1,75,
      con remates a puerta, intervalos de goles, tarjetas, córners o ambos marcan. Aquí se busca esa misma clase de apuesta en este partido, con las 2 selecciones
      que más veces salen juntas en las simulaciones. Sin el +25 % de Bet365 (necesita 3 selecciones).</div></div></div>` : ""}
    ${jp && !jp.error && (jp.goleadores || []).length ? `<h3 style="margin-top:14px">👤 Jugadores (marcará, marcará o asistirá, tarjeta)</h3>
      <div class="rejilla" style="margin-top:0">${tablaJ(jp.goleadores, "p_marca", "justa_marca", "⚽ Marcará")}${tablaJ(jp.marca_asiste, "p_marca_asiste", "justa_marca_asiste", "🅰️ Marcará o asistirá")}${tablaJ(jp.tarjetas, "p_tarjeta", "justa_tarjeta", "🟨 Tarjeta")}</div>
      <p class="nota">Estimación con los goles, asistencias, tarjetas y minutos de cada jugador esta temporada y los goles que se esperan de su equipo.
        Si ${vs ? "la terminal" : "Bet365"} paga MÁS que la «justa», hay valor. Remates, faltas o paradas no se calculan (no hay datos de tiros por jugador).</p>` : ""}</div>`;
}


// ---------------------------------------------------------------- comprobar la apuesta de un tipster (o una propia)
function bloqueTipster(d, pk) {
  const grupos = { goles: "Goles / resultado", corners: "Córners", tarjetas: "Tarjetas", remates: "Remates a puerta" };
  const ms = (pk.mercados || []).filter((m) => m.disponible !== false);
  const opts = Object.entries(grupos).map(([t, n]) => `<optgroup label="${n}">${ms.filter((m) => (m.tipo || "goles") === t)
    .sort((a, b) => a.mercado.localeCompare(b.mercado)).map((m) => `<option value="${esc(m.clave)}">${esc(m.mercado)} (${pct(m.prob, 0)})</option>`).join("")}</optgroup>`).join("");
  return `<details class="tarjeta" id="tipsterBox"><summary>🧾 Comprobar una apuesta (de un tipster o tuya) con las 15.000 simulaciones</summary>
    <p class="nota">Elige las selecciones de la apuesta (por ejemplo «Menos de 6.5 tarjetas» + «Menos de 11.5 remates a puerta»), pon la cuota y te dice
      cuántas veces salen TODAS juntas en las simulaciones y si la cuota compensa. Si la guardas, el programa comprueba sola si acertó y lleva el
      historial real del tipster (aciertos y beneficio) en la pestaña Historial.</p>
    <div class="fila-controles"><select id="tSel" style="max-width:28em">${opts}</select><button class="mini" id="tAdd">Añadir</button></div>
    <div id="tChips" class="chips" style="margin:8px 0"></div>
    <div class="fila-controles"><label>Cuota <input id="tCuota" inputmode="decimal" placeholder="1,72" style="width:6em"></label>
      <label>Stake <input id="tStake" inputmode="decimal" placeholder="1" style="width:5em"></label>
      <label>Tipster <input id="tFuente" placeholder="nombre del canal" style="width:12em" value="${esc(leer("tipster_fuente", ""))}"></label>
      <button class="primario" id="tCalc">Calcular</button><button id="tGuardar" disabled>Guardar en el registro</button></div>
    <div id="tRes"></div></details>`;
}
function ligarTipster(d) {
  const box = $("#tipsterBox");
  if (!box) return;
  const P = d.partido, sel = [];
  let ultimo = null;
  const pintar = () => ($("#tChips").innerHTML = sel.map((x, i) => `<span class="chip">${esc(x.t)} <a href="#" data-i="${i}">✕</a></span>`).join("") || `<span class="nota">Ninguna selección todavía</span>`);
  pintar();
  $("#tAdd").onclick = () => { const o = $("#tSel").selectedOptions[0]; if (o && !sel.some((x) => x.k === o.value)) sel.push({ k: o.value, t: o.textContent.replace(/ \(\d+%\)$/, "") }); pintar(); };
  $("#tChips").onclick = (e) => { if (e.target.dataset.i != null) { e.preventDefault(); sel.splice(+e.target.dataset.i, 1); pintar(); } };
  $("#tCalc").onclick = async () => {
    if (!sel.length) return;
    const cuota = parseFloat(($("#tCuota").value || "").replace(",", ".")) || "";
    $("#tRes").innerHTML = `<p class="nota"><span class="spinner"></span> Simulando…</p>`;
    const r = await api(`/api/${E.comp}/combinar?id=${P.id}&claves=${encodeURIComponent(sel.map((x) => x.k).join(","))}&cuota=${cuota}`);
    ultimo = r;
    $("#tGuardar").disabled = !r.prob;
    $("#tRes").innerHTML = r.error ? `<p class="nota">${esc(r.error)}</p>` : `<div class="mercados">
        <div class="mercado"><div class="n">Salen TODAS juntas</div><div class="v">${pct(r.prob, 0)}</div></div>
        <div class="mercado"><div class="n">Cuota justa</div><div class="v">${n1(r.cuota_justa, 2)}</div></div>
        ${r.cuota ? `<div class="mercado"><div class="n">Cuota que te dan</div><div class="v">@ ${n1(r.cuota, 2)}</div></div>
        <div class="mercado"><div class="n">La casa cree que sale</div><div class="v">${pct(1 / r.cuota, 0)}</div></div>` : ""}</div>
      ${(r.selecciones || []).map((x) => `<div class="nota">· ${esc(x.mercado)}: ${pct(x.prob, 0)}</div>`).join("")}
      ${r.no_calculables && r.no_calculables.length ? `<p class="nota">⚠️ No se pudo calcular: ${esc(r.no_calculables.join(", "))} (faltan datos de ese mercado para estos equipos).</p>` : ""}
      ${r.veredicto ? `<div class="veredicto ${r.veredicto}">${r.veredicto === "valor" ? "✅ El modelo también lo ve: la cuota paga más de lo que vale" : r.veredicto === "justo" ? "➖ Cuota justa: ni a favor ni en contra" : "❌ El modelo no lo ve: la cuota paga menos de lo que vale"}
        (si apostaras 10 € muchas veces: ${r.ev >= 0 ? "+" : ""}${n1(r.ev * 10, 2)} € de media)</div>` : ""}
      ${r.remates_esperados ? `<p class="nota">Remates a puerta esperados: ${esc(P.home)} ${n1(r.remates_esperados[0], 1)} · ${esc(P.away)} ${n1(r.remates_esperados[1], 1)}</p>` : ""}`;
  };
  $("#tGuardar").onclick = async () => {
    if (!ultimo || !ultimo.prob) return;
    guardar("tipster_fuente", $("#tFuente").value.trim());
    await api("/api/tipster", { method: "POST", body: JSON.stringify({ fuente: $("#tFuente").value.trim() || "tipster", comp: E.comp, partido_id: P.id,
      fecha: P.fecha, home: P.home, away: P.away, claves: sel.map((x) => x.k), mercados: sel.map((x) => x.t),
      cuota: parseFloat(($("#tCuota").value || "").replace(",", ".")) || null, stake: parseFloat(($("#tStake").value || "").replace(",", ".")) || 1, prob: ultimo.prob }) });
    $("#tGuardar").disabled = true; $("#tGuardar").textContent = "✅ Guardada";
  };
}
function bloqueKjefes(r) {
  const H = r.historiales || {}, fuentes = Object.keys(H);
  if (!fuentes.length) return "";
  const fila = (n, d) => `<tr><td>${esc(n)}</td><td class="d">${d.n}</td><td class="d">${pct(d.aciertos / d.n, 0)}</td><td class="d">${d.unidades >= 0 ? "+" : ""}${n1(d.unidades, 1)} u</td><td class="d">${pct(d.unidades / d.n, 1)}</td></tr>`;
  const algo = fuentes.some((f) => (H[f].total || {}).n);
  const fams = {};
  fuentes.forEach((f) => Object.entries(H[f].por_familia || {}).forEach(([k, d]) => ((fams[k] = fams[k] || {})[f] = d)));
  return `<div class="tarjeta"><h3>🔎 Tipsters: su historial comprobado con NUESTROS datos</h3>
    <p class="nota">Apuestas leídas de sus capturas (KjefesTipsters: 520; BETSEVOLUTION: 874 publicadas ANTES del partido en 2026). El programa busca cada partido en tus
      bases de datos y comprueba con los goles, córners, tarjetas y remates reales si de verdad acertaron, también en las que nunca publicaron el resultado.
      Las de jugadores, 1ª mitad y ligas que no tenemos no se pueden comprobar.</p>
    <button class="primario" id="btnKjefes">${algo ? "⟳ Volver a comprobar" : "Comprobar su historial ahora"}</button> <span class="nota" id="kjefesNota"></span>
    ${algo ? `<div class="rejilla" style="margin-top:8px">${fuentes.map((f) => { const t = H[f].total || {}; return `<div class="c6"><h4>${esc(f.replace(" (historial)", ""))}</h4>
      ${t.n ? `<div class="mercados"><div class="mercado"><div class="n">Comprobadas</div><div class="v">${t.n}</div></div><div class="mercado"><div class="n">Acierto REAL</div><div class="v">${pct(t.aciertos / t.n, 0)}</div></div>
      <div class="mercado"><div class="n">ROI real</div><div class="v">${pct(t.unidades / t.n, 1)}</div></div></div>
      <div class="desplaza"><table class="tabla"><tr><th>Según lo que publicó</th><th class="d">Apuestas</th><th class="d">Acierto real</th><th class="d">Beneficio</th><th class="d">ROI</th></tr>
      ${Object.entries(H[f].por_publicacion || {}).map(([n, d]) => fila(n, d)).join("")}</table></div>` : `<p class="nota">Ninguna apuesta comprobable todavía.</p>`}</div>`; }).join("")}</div>
      <h4>Lo mejor de cada uno: acierto real por tipo de apuesta</h4><div class="desplaza"><table class="tabla"><tr><th>Tipo</th>${fuentes.map((f) => `<th class="d">${esc(f.replace(" (historial)", ""))}</th>`).join("")}<th>Conclusión</th></tr>
      ${Object.entries(fams).filter(([, v]) => Object.values(v).some((d) => d.n >= 5)).map(([k, v]) => { const mejor = fuentes.filter((f) => v[f] && v[f].n >= 5).sort((a, b) => v[b].unidades / v[b].n - v[a].unidades / v[a].n)[0];
        const roi = mejor ? v[mejor].unidades / v[mejor].n : null;
        return `<tr><td>${esc(k)}</td>${fuentes.map((f) => `<td class="d">${v[f] ? `${pct(v[f].aciertos / v[f].n, 0)} · ROI ${pct(v[f].unidades / v[f].n, 0)} <span class="nota">(${v[f].n})</span>` : "–"}</td>`).join("")}
        <td>${roi == null ? "pocos datos" : roi > 0.02 ? `✅ copiar a ${esc(mejor.replace(" (historial)", ""))}` : roi > -0.05 ? "➖ ni gana ni pierde" : "❌ descartar"}</td></tr>`; }).join("")}</table></div>
      <p class="nota">El «🧾 Estilo tipster» de cada partido descarta solo los tipos de apuesta que aquí pierden dinero (con 15 apuestas o más).</p>` : ""}</div>`;
}
function ligarKjefes() {
  const b = $("#btnKjefes");
  if (b) b.onclick = async () => {
    b.disabled = true; b.innerHTML = `<span class="spinner"></span> Comprobando ~1.400 apuestas…`;
    try { const r = await api("/api/tipster/importar", { method: "POST" }); $("#kjefesNota").textContent = Object.entries(r).map(([f, x]) => `${f.replace(" (historial)", "")}: ${x.encontradas} partidos encontrados, ${x.comprobadas} comprobados`).join(" · "); }
    catch (e) { $("#kjefesNota").textContent = e.message; }
    const h = await bloqueRegistroTipster(); const t = $("#hTipster"); if (t) { t.innerHTML = h; ligarKjefes(); }
  };
}
async function bloqueRegistroTipster() {
  let r;
  try { r = await api("/api/tipster"); } catch (e) { return ""; }
  const k = bloqueKjefes(r);
  const res = Object.entries(r.resumen || {}).filter(([f]) => !f.includes("(historial)"));
  if (!res.length) return k;
  return k + `<div class="tarjeta"><h3>🧾 Registro de tipsters (comprobado con los resultados reales)</h3>
    <div class="desplaza"><table class="tabla"><tr><th>Tipster</th><th class="d">Apuestas</th><th class="d">Jugadas</th><th class="d">Aciertos</th><th class="d">Beneficio</th><th class="d">ROI</th><th class="d">Prob. media (modelo)</th><th class="d">Cuando el modelo veía valor</th></tr>
    ${res.map(([f, d]) => `<tr><td><b>${esc(f)}</b></td><td class="d">${d.apuestas}</td><td class="d">${d.jugadas}</td><td class="d">${d.jugadas ? `${d.aciertos} (${pct(d.aciertos / d.jugadas, 0)})` : "–"}</td>
      <td class="d">${d.jugadas ? (d.unidades >= 0 ? "+" : "") + n1(d.unidades, 2) + " u" : "–"}</td><td class="d">${d.roi != null ? pct(d.roi, 1) : "–"}</td>
      <td class="d">${d.prob_media != null ? pct(d.prob_media, 0) : "–"}</td><td class="d">${d.de_acuerdo ? `${d.de_acuerdo_ok}/${d.de_acuerdo}` : "–"}</td></tr>`).join("")}</table></div>
    <details><summary>Ver apuestas (${(r.apuestas || []).length})</summary><div class="desplaza"><table class="tabla"><tr><th>Fecha</th><th>Tipster</th><th>Partido</th><th>Apuesta</th><th class="d">Cuota</th><th class="d">Modelo</th><th>Resultado</th></tr>
      ${(r.apuestas || []).filter((a) => !String(a.fuente).includes("(historial)")).map((a) => `<tr><td class="nota">${esc((a.fecha_partido || "").slice(0, 10))}</td><td>${esc(a.fuente)}</td><td>${esc(a.home)} – ${esc(a.away)}</td><td>${esc(a.mercados)}</td>
        <td class="d">${n1(a.cuota, 2)}</td><td class="d">${pct(a.prob_modelo, 0)}</td><td>${a.ok == null ? "⏳" : a.ok ? "✅" : "❌"} <span class="nota">${esc(a.real || "")}</span></td></tr>`).join("")}</table></div></details>
    <p class="nota">Con 100 apuestas o más sabrás si el tipster gana de verdad. «Cuando el modelo veía valor» = aciertos de las apuestas en las que nuestro modelo también daba la cuota por buena.</p></div>`;
}

// ---------------------------------------------------------------- análisis de un partido (resumen claro + detalles plegables)
// Otra opción de córners/tarjetas (total del partido o de un equipo) para elegir la que pague mejor en Bet365
function altCT(pick, total, equipo) {
  const otra = [total, equipo].find((x) => x && pick && x.clave !== pick.clave);
  return otra ? `<b>También fiable:</b> ${esc(otra.mercado)} · ${pct(otra.prob, 0)}${otra.p10 != null ? ` (peor escenario ${pct(otra.p10, 0)})` : ""} · justa ${n1(otra.cuota_justa, 2)}<br>` : "";
}
function tarjetaPick(tipo, icono, titulo, p, nota) {
  if (!p) return `<div class="pickbox ${tipo} vacia"><div class="t">${icono} ${titulo}</div><div class="m">No hay una apuesta compatible</div>
    <div class="nota">${tipo === "a" && titulo.startsWith("Apuesta") ? "Ningún mercado de esta casa cabe dentro de la segura sin contradecirla." : "Ningún mercado encaja en este partido."}</div></div>`;
  const v = p.valor || valorManual(p);
  const cuota = p.cuota_casa ? `<div class="cuota">Cuota casa <b>${n1(p.cuota_casa, 2)}</b>${p.cuota_casa_real ? "" : " (aprox.)"} · justa ${n1(p.cuota_justa, 2)}</div>`
    : `<div class="cuota">Cuota justa ${n1(p.cuota_justa, 2)} <span class="nota">(paga más que esto = buena apuesta)</span></div>`;
  return `<div class="pickbox ${tipo}"><div class="t">${icono} ${titulo}</div><div class="m">${esc(p.mercado)}</div>
    <div class="p">${pct(p.prob, 0)}</div>
    <div class="sim">Se cumplió en <b>${(p.veces ?? 0).toLocaleString("es-ES")}</b> de 15.000 partidos simulados${p.p10 != null ? ` · en el peor escenario ${pct(p.p10, 0)}` : ""}</div>${cuota}
    ${p.valor ? "" : `<label class="mi-cuota">Cuota que ves en ${E.casa === "versus" ? "el terminal" : "Bet365"}: <input data-mercado="${esc(p.clave)}" inputmode="decimal" placeholder="1,85" value="${esc(leer(cuotaKey(p.clave), ""))}"></label>`}
    ${v ? `<div class="veredicto ${v.veredicto}">${v.veredicto === "valor" ? "✅" : v.veredicto === "justo" ? "➖" : "❌"} ${esc(v.texto)}
      ${v.veredicto === "valor" ? `<br><span class="nota">Si apuestas 100 € muchas veces, ganarías de media ${n1(v.ganancia_100, 1)} € por apuesta.</span>` : ""}</div>` : ""}
    ${nota ? `<div class="nota">${nota}</div>` : ""}
    ${E.ficha && p.clave ? btnJugada([{ ...E.ficha, clave: p.clave, mercado: p.mercado, prob: p.prob }], p.cuota_casa || leer(cuotaKey(p.clave), "")) : ""}</div>`;
}

// v2.2: lo que el examen de la app suspende en ESTE partido (no cambia los números del modelo)
function bloqueExamenPartido(d) {
  const e = d.examen;
  if (!e) return "";
  const nom = { segura: "🛡️ Apuesta segura", arriesgada: "⚡ Apuesta arriesgada", corners: "🚩 Córners", tarjetas: "🟨 Tarjetas", valor: "💎 Bet365 paga más" };
  return `<div class="veredicto sin_valor" style="margin-top:12px">❌ <b>El examen de la app no se fía de estas apuestas de este partido:</b>
    ${Object.entries(e).map(([k, t]) => `<br>· ${nom[k] || esc(k)} — ${esc(t)}`).join("")}
    <br><span class="nota">Por eso no entran en la combinada segura ni en el presupuesto. Los números del modelo no cambian: es lo que de verdad pasó con este tipo de apuesta en los últimos meses.</span></div>`;
}

function pintarAnalisis(d, cuotasTxt) {
  const p = d.prob, P = d.partido, ucl = esCopa(d.competicion), ap = d.apuestas || {}, pk = ap.picks || {};
  E.ficha = { comp: E.comp, partido_id: P.id, fecha: P.fecha, home: P.home, away: P.away,
    modelo: { lh: p.lh, la: p.la, ct: { corners: d.corners ? [d.corners.h, d.corners.a] : null, tarjetas: d.tarjetas ? [d.tarjetas.h, d.tarjetas.a] : null,
      remates: d.remates_esperados || null } } };   // v2.2: para «¿Cierro la apuesta?» en directo
  const ronda = P.ronda ? (P.ronda.toLowerCase().startsWith("league") ? `Fase liga · J${P.jornada}` : P.ronda) : `Jornada ${P.jornada}`;
  const cuotas = (cuotasTxt || "").split(",");
  const mez = ap.mezcla || {}, mod = mez.modelo, mer = mez.mercado;
  const v = vivoDe({ home: P.home, away: P.away });
  let h = `<button class="volver" id="btnVolver">← Partidos</button>
  <div class="tarjeta"><div class="cab-partido">
    <div class="equipos">${esc(P.home)}<span class="vs">vs</span>${esc(P.away)}</div>
    <div class="chips"><span class="chip">${esc(ronda)}</span><span class="chip">${esc(P.fecha)} ${esc(P.hora || "")}</span>
      ${P.arbitro ? `<span class="chip">🧑‍⚖️ ${esc(P.arbitro)}</span>` : ""}${P.neutral ? '<span class="chip aviso">campo neutral</span>' : ""}
      ${pk.nivel ? `<span class="chip ${nivelCls(pk.nivel)}">Fiabilidad ${esc(pk.nivel)} (${n1(pk.fiabilidad, 0)}/100)</span>` : ""}</div></div>
    ${v && v.estado.fase !== "pre" ? `<div class="vivo-cab">${v.estado.fase === "in" ? "● EN JUEGO " + esc(v.estado.minuto || "") : "FINAL"} · ${esc(v.home.goles)}-${esc(v.away.goles)}
      <button class="mini" id="btnVerVivo">Ver estadísticas</button></div>` : ""}
    ${pk.nota_plataforma ? `<p class="nota">🏷️ ${E.casa === "versus" ? "Versus (terminal)" : "Bet365"}: ${esc(pk.nota_plataforma)}</p>` : ""}
    <div class="resumen3">
      ${tarjetaPick("s", "🛡️", "Apuesta segura", pk.segura, "La más probable entre las apuestas habituales.")}
      ${tarjetaPick("a", "⚡", "Apuesta arriesgada", pk.arriesgada, pk.arriesgada ? "Va DENTRO de la segura: si aciertas esta, aciertas también la segura." : "")}
      <div class="pickbox m"><div class="t">🎯 Marcador</div><div class="r">${pk.marcador ? pk.marcador.h + "-" + pk.marcador.a : "–"}</div>
        <div class="p">${pk.marcador ? pct(pk.marcador.prob, 0) : ""}</div><div class="cuota">cuota justa ${pk.marcador ? n1(pk.marcador.cuota_justa, 1) : "–"}</div>
        <div class="sim">Salió <b>${pk.marcador ? (pk.marcador.veces || 0).toLocaleString("es-ES") : 0}</b> veces de 15.000</div>
        <div class="nota">El resultado exacto que más se repite en las simulaciones (compatible con la segura). Otros probables: ${(pk.marcadores_coherentes || []).slice(1).map((m) => `${m.h}-${m.a} (${pct(m.prob, 0)})`).join(", ") || "–"}</div></div>
    </div>
    ${bloqueAvisos(d)}
    ${bloqueExamenPartido(d)}
    ${pk.efecto_nombre ? `<div class="veredicto sin_valor" style="margin-top:12px">⚠️ <b>Efecto nombre:</b> ${esc(pk.efecto_nombre.texto)}</div>` : ""}
    ${pk.handicap || pk.handicap_paliza || pk.valor_150_200 ? `<div class="resumen3">${tarjetaPick("m", "💎", "Valor 1,50-2,00", pk.valor_150_200, "La más sólida de TODOS los mercados (hándicap, goles, combinados, córners, tarjetas) que paga entre 1,50 y 2,00. Riesgo medio: sale ~1 de cada 2 veces.")}${tarjetaPick("a", "⚖️", "Hándicap (la más sólida)", pk.handicap, "Si el favorito paga muy poco, el hándicap da más cuota con una probabilidad todavía alta.")}${pk.handicap_paliza ? tarjetaPick("a", "💥", "Favorito gana por paliza", pk.handicap_paliza, `Solo sale si el modelo da un 55 % o más y las casas también lo ven${pk.handicap_paliza.prob_casas != null ? ` (casas: ${pct(pk.handicap_paliza.prob_casas, 0)})` : ""}. Aun así falla más de 1 de cada 3 veces.`) : `<div class="pickbox a vacia"><div class="t">💥 Favorito gana por paliza</div><div class="m">No se recomienda paliza</div><div class="nota">${esc(pk.paliza_descartada || "Ningún equipo gana por 2 o más en al menos el 55 % de las simulaciones.")} Para ir seguro, mejor la tarjeta ⚖️ Hándicap.</div></div>`}</div>` : ""}
    ${pk.corners || pk.tarjetas ? `<div class="resumen3 dos">${tarjetaPick("c", "🚩", "Córners", pk.corners, altCT(pk.corners, pk.corners_total, pk.corners_equipo) + (d.estilo && d.estilo.explicacion_corners ? "Por qué: " + esc(d.estilo.explicacion_corners) : ""))}${tarjetaPick("c", "🟨", "Tarjetas", pk.tarjetas, altCT(pk.tarjetas, pk.tarjetas_total, pk.tarjetas_equipo) + "Cada casa cuenta las rojas a su manera.")}</div>` : ""}
    ${pk.remates ? `<div class="resumen3 dos">${tarjetaPick("c", "🎯", "Remates a puerta", pk.remates, "Con los remates a puerta reales que hace cada equipo y los que concede su rival (últimos 10 partidos).")}</div>` : ""}
    <div class="explica">
      ${pk.texto_cuotas ? `<p>💶 ${esc(pk.texto_cuotas)}</p>` : `<p>💶 Aún no hay cuotas de las casas para este partido (salen unos días antes). Pulsa “⟳ Actualizar partidos” más tarde o escribe tus cuotas abajo.</p>`}
      ${pk.acuerdo ? `<p>${pk.acuerdo.mismo_favorito ? "🤝" : "⚠️"} ${esc(pk.acuerdo.texto)} (diferencia máxima ${pct(pk.acuerdo.diferencia, 0)}).</p>` : ""}
      ${mer ? `<p class="nota">Probabilidad final = ${Math.round((1 - mez.peso) * 100)}% modelo + ${Math.round(mez.peso * 100)}% casas de apuestas (sin su margen).
        Modelo: ${pct(mod.p1, 0)} · ${pct(mod.px, 0)} · ${pct(mod.p2, 0)} — Casas: ${pct(mer.p1, 0)} · ${pct(mer.px, 0)} · ${pct(mer.p2, 0)}</p>` : ""}
    </div>
    ${barra1x2(p, P.home, P.away)}
    <div class="mercados">${[["Más de 1.5", p.o15], ["Más de 2.5", p.o25], ["Ambos marcan", p.btts], ["1X", p.dc1x], ["X2", p.dcx2],
      ["Goles esperados", null, `${n1(p.lh, 2)} – ${n1(p.la, 2)}`]].map(([n, x, t]) => `<div class="mercado"><div class="n">${n}</div><div class="v">${t || pct(x, 0)}</div></div>`).join("")}</div>
  </div>
  ${bloquePocoDinero(d, pk)}
  ${bloqueB365Valor(d)}
  ${bloqueIaCt(d, pk)}
  ${bloqueTipster(d, pk)}
  ${bloqueB365(ap, pk)}
  <div class="tarjeta ia-tarjeta"><h3>🤖 Asistente IA</h3>
    ${d.ia ? `<p class="nota">🧠 IA de predicción: ${d.ia.activa ? `<b>activa</b> (peso ${Math.round(d.ia.peso * 100)}%, goles IA ${n1(d.ia.lh_ia, 2)} – ${n1(d.ia.la_ia, 2)})` : "desactivada"} · ${esc(d.ia.motivo || "")}</p>` : ""}
    <div class="fila-controles"><button id="btnIa" class="primario">Leer noticias y explicar el pronóstico</button>
      <input id="iaPregunta" placeholder="o pregunta algo: ¿hay rotaciones? ¿vale para combinada?" style="flex:1;min-width:14em">
      <button id="btnIaPreguntar">Preguntar</button></div>
    <div id="iaRespuesta"></div>
    <p class="nota solo-web">El asistente que lee las noticias y te explica el pronóstico solo funciona en el programa del PC.</p></div>
  <details class="tarjeta"><summary>📋 Todos los mercados de ${E.casa === "versus" ? "Versus" : "Bet365"} (15.000 simulaciones) y tus cuotas</summary>
    <p class="nota">Escribe la cuota que te ofrecen y te dice al momento si merece la pena. “Peor escenario” = probabilidad en el 10 % de simulaciones más desfavorables.</p>
    <div class="desplaza"><table class="tabla"><tr><th>Mercado</th><th class="d">Probabilidad</th><th class="d">Veces /15.000</th><th class="d">Peor escenario</th><th class="d">Cuota justa</th><th class="d">Tu cuota</th><th>¿Merece la pena?</th></tr>
    ${(pk.mercados || []).filter((m) => m.disponible !== false).map((m) => { const v = valorManual(m);
      return `<tr class="${pk.segura && m.clave === pk.segura.clave ? "valor" : ""}"><td>${esc(m.mercado)}${pk.segura && m.clave === pk.segura.clave ? " 🛡️" : ""}${pk.arriesgada && m.clave === pk.arriesgada.clave ? " ⚡" : ""}</td>
      <td class="d">${pct(m.prob, 0)}</td><td class="d">${(m.veces ?? 0).toLocaleString("es-ES")}</td><td class="d">${m.p10 != null ? pct(m.p10, 0) : "–"}</td><td class="d">${n1(m.cuota_justa, 2)}</td>
      <td class="d"><input class="cuota-mini" data-mercado="${esc(m.clave)}" inputmode="decimal" value="${esc(leer(cuotaKey(m.clave), ""))}"></td>
      <td>${v ? `<span class="veredicto ${v.veredicto}">${v.veredicto === "valor" ? "✅ Sí" : v.veredicto === "justo" ? "➖ Justa" : "❌ No"}</span>` : ""}</td></tr>`; }).join("")}</table></div></details>
  <details class="tarjeta"><summary>🎲 Resultados que más se repiten en las 15.000 simulaciones</summary><div class="top3">${(pk.top_simulados || []).map((t, i) =>
      `<div class="marcador"><div class="c">#${i + 1}</div><div class="r">${t.h}-${t.a}</div><div class="p">${pct(t.prob)}</div><div class="c">${t.veces.toLocaleString("es-ES")} veces</div></div>`).join("")}</div></details>
  <details class="tarjeta"><summary>🎯 Marcadores y matriz de resultados</summary><div class="top3">${p.top3.map((t, i) =>
      `<div class="marcador"><div class="c">#${i + 1}</div><div class="r">${t.h}-${t.a}</div><div class="p">${pct(t.p)}</div><div class="c">cuota justa ${n1(t.cuota, 1)}</div></div>`).join("")}</div>
      ${calor(p.matriz)}</details>
  ${bloqueEstilo(d)}
  <details class="tarjeta"><summary>🚩 Córners y 🟨 tarjetas</summary><div class="rejilla" style="margin-top:0">
    <div class="c6">${bloqueCT(d.corners, "Córners esperados", "🚩")}</div><div class="c6">${bloqueCT(d.tarjetas, "Tarjetas esperadas", "🟨")}</div></div></details>
  ${d.eliminatoria ? `<details class="tarjeta" open><summary>🏆 Eliminatoria</summary><div class="nota">${esc(d.eliminatoria.texto)}</div>
      ${d.eliminatoria.pasa_home != null ? `<div class="mercados"><div class="mercado"><div class="n">Pasa ${esc(P.home)}</div><div class="v">${pct(d.eliminatoria.pasa_home)}</div></div>
      <div class="mercado"><div class="n">Pasa ${esc(P.away)}</div><div class="v">${pct(d.eliminatoria.pasa_away)}</div></div></div>` : ""}</details>` : ""}
  <details class="tarjeta"><summary>📊 Equipos (clasificación, forma, Opta)</summary>${bloqueEquipos(d)}</details>
  <details class="tarjeta"><summary>🚑 Bajas, sanciones y alineaciones</summary>${bloqueDisp(d)}${bloqueOnces(d)}</details>
  <details class="tarjeta"><summary>📅 Últimos 5 partidos y cara a cara</summary>
    <div class="rejilla" style="margin-top:0"><div class="c6">${previaEquipo(d.equipos[0], 0, ucl)}</div><div class="c6">${previaEquipo(d.equipos[1], 1, ucl)}</div></div>
    <h3 style="margin-top:12px">Cara a cara</h3>${d.h2h.length ? `<div class="desplaza"><table class="tabla"><tr><th>Fecha</th>${ucl ? "<th>Ronda</th>" : ""}<th>Local</th><th class="d">Res.</th><th>Visitante</th><th class="d">Córners</th><th class="d">Tarjetas</th></tr>
      ${d.h2h.map((x) => `<tr><td>${esc(x.fecha)}</td>${ucl ? `<td class="nota">${esc(x.ronda || "")}</td>` : ""}<td>${esc(x.local)}</td><td class="d">${x.gl}-${x.gv}</td><td>${esc(x.visitante)}</td>
      <td class="d">${x.corners_l ?? "?"}-${x.corners_v ?? "?"}</td><td class="d">${x.tarjetas_l ?? "?"}-${x.tarjetas_v ?? "?"}</td></tr>`).join("")}</table></div>` : `<div class="nota">Sin enfrentamientos en la base de datos</div>`}</details>
  <details class="tarjeta"><summary>💶 Valor esperado (EV) detallado y tus propias cuotas</summary>
    <form class="cuotas" id="formCuotas"><label>Cuota 1<input name="c1" inputmode="decimal" value="${esc(cuotas[0] || "")}" placeholder="2,10"></label>
      <label>Cuota X<input name="cx" inputmode="decimal" value="${esc(cuotas[1] || "")}" placeholder="3,40"></label>
      <label>Cuota 2<input name="c2" inputmode="decimal" value="${esc(cuotas[2] || "")}" placeholder="3,50"></label>
      <button class="primario">Usar mis cuotas</button><button type="button" id="btnBorrarCuotas">Usar las de la casa</button>
      <button type="button" id="btnInforme">Informe de consola</button></form>
    <p class="nota">EV = probabilidad × cuota − 1. Positivo = a la larga ganas; negativo = a la larga pierdes. Una probabilidad alta NO significa valor.</p>
    <p class="nota solo-web">En la web el EV usa las cuotas de Bet365 que guardó GitHub. Para probar otra cuota de un mercado, escríbela arriba en
      «📋 Todos los mercados» (te dice al momento si merece la pena); rehacer todo el análisis con tus cuotas 1X2 solo se puede en el PC.</p>
    ${bloqueEV(d.ev)}</details>`;
  const el = $("#analisis");
  el.innerHTML = h;
  $("#btnVolver").onclick = () => $("#v-pronosticos .partidos-layout").classList.remove("con-analisis");
  ligarCuotasManuales(el, d);
  ligarTipster(d);
  const pedirIa = async (pregunta) => {
    const r = $("#iaRespuesta");
    r.innerHTML = `<p class="nota"><span class="spinner"></span> Leyendo noticias y pensando… (puede tardar unos segundos)</p>`;
    try {
      const x = await api(`/api/${E.comp}/ia?id=${P.id}${pregunta ? "&pregunta=" + encodeURIComponent(pregunta) : ""}`, { method: "POST" });
      const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^### (.*)$/gm, "<b>$1</b>").replace(/^[-•] (.*)$/gm, "• $1").replace(/\n/g, "<br>");
      const n = Object.entries(x.noticias || {}).map(([eq, l]) => `<details><summary>${esc(eq)}: ${l.length} titulares</summary><ul class="nota">${l.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>`).join("");
      r.innerHTML = `<div class="ia-texto">${md(x.respuesta)}</div>${n}<p class="nota">Respuesta de ${x.proveedor === "anthropic" ? "Claude" : "Ollama"}. Es una opinión: los números del modelo no cambian.</p>`;
    } catch (e) { r.innerHTML = `<p class="nota">⚠️ ${esc(e.message)}</p>`; }
  };
  $("#btnIa").onclick = () => pedirIa("");
  $("#btnIaPreguntar").onclick = () => pedirIa($("#iaPregunta").value.trim());
  const bv = $("#btnVerVivo"); if (bv) bv.onclick = () => { cambiarVista("directo"); setTimeout(() => abrirDirecto(v.id), 300); };
  $("#formCuotas").onsubmit = (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const c = ["c1", "cx", "c2"].map((k) => String(f.get(k) || "").trim().replace(",", "."));
    const txt = c.every((x) => +x > 1) ? c.join(",") : "";
    guardar(`cuotas_${E.comp}_${P.id}`, txt);
    abrirPartido(P.id, txt);
  };
  $("#btnBorrarCuotas").onclick = () => { guardar(`cuotas_${E.comp}_${P.id}`, ""); abrirPartido(P.id, ""); };
  $("#btnInforme").onclick = async () => {
    $("#dlgTitulo").textContent = "Informe completo (igual que en consola)";
    $("#textoInforme").textContent = "Generando informe…"; $("#dlgInforme").showModal();
    const c = leer(`cuotas_${E.comp}_${P.id}`, "");
    const r = await api(`/api/${E.comp}/informe?id=${P.id}${c ? "&c=" + c : ""}`);
    $("#textoInforme").textContent = r.texto;
  };
  const bo = $("#btnOnces");
  if (bo) bo.onclick = async () => {
    bo.disabled = true; bo.innerHTML = `<span class="spinner"></span> Buscando…`;
    try { await api(`/api/${E.comp}/onces?id=${P.id}`); } catch (e) {}
    abrirPartido(P.id);
  };
  $$(".subpestanas", el).forEach((g) => $$("button", g).forEach((b) => (b.onclick = () => {
    $$("button", g).forEach((x) => x.classList.toggle("activa", x === b));
    $$(`[data-panel^="${g.dataset.grupo}-"]`, el).forEach((pn) => (pn.hidden = pn.dataset.panel !== `${g.dataset.grupo}-${b.dataset.k}`));
  })));
}

// ---------------------------------------------------------------- ajustes de IA
async function cargarAjustes() {
  const c = await api("/api/ia/config");
  $("#iaProv").value = c.proveedor; $("#iaModelo").value = c.modelo || "";
  $("#iaClave").value = ""; $("#iaClave").placeholder = c.clave_puesta ? `guardada (…${c.clave_final})` : "sk-ant-…";
  const ver = () => ($("#lblClave").hidden = $("#iaProv").value !== "anthropic");
  $("#iaProv").onchange = ver; ver();
  $("#iaEstado").textContent = c.proveedor === "ninguno" ? "Asistente desactivado." : `Asistente activo con ${c.proveedor === "anthropic" ? "Claude (API)" : "Ollama"}.`;
  $("#btnIaGuardar").onclick = async () => {
    const r = await api("/api/ia/config", { method: "POST", body: JSON.stringify({ proveedor: $("#iaProv").value, modelo: $("#iaModelo").value.trim(), clave: $("#iaClave").value.trim() }) });
    $("#iaEstado").textContent = "✅ Guardado. " + (r.proveedor === "ninguno" ? "Asistente desactivado." : "Abre un partido y pulsa «Leer noticias y explicar».");
  };
  const m = c.modelos_ia || {};
  $("#iaModelos").innerHTML = Object.keys(m).length ? `<div class="desplaza"><table class="tabla"><tr><th>Competición</th><th>Estado</th><th class="d">Partidos</th><th class="d">Mejora</th><th>Entrenada</th></tr>
    ${Object.entries(m).map(([k, e]) => `<tr><td>${esc((E.info.comps.find((x) => x.id === k) || {}).nombre || k)}</td><td>${e.activa ? `✅ activa (peso ${Math.round(e.peso * 100)}%)` : "➖ desactivada"}<br><span class="nota">${esc(e.motivo || "")}</span></td>
    <td class="d">${e.partidos ?? "–"}</td><td class="d">${e.mejora != null ? e.mejora.toFixed(4) : "–"}</td><td class="nota">${esc((e.entrenada || "").replace("T", " "))}</td></tr>`).join("")}</table></div>`
    : `<p class="nota">Todavía no se ha entrenado en ninguna liga: se entrena sola en la próxima sincronización.</p>`;
  pintarIaNumeros();
}

async function pintarIaNumeros() {
  const el = $("#iaNumeros");
  if (!el) return;
  let e;
  try { e = await api("/api/ia_numeros"); } catch (x) { el.innerHTML = `<p class="nota">${esc(x.message)}</p>`; return; }
  const L = e.logloss || {}, A = e.acierto || {};
  const imp = Object.entries(e.importancia || {}).filter(([k]) => k !== "Cuotas de las casas").sort((a, b) => b[1] - a[1]);
  const maxImp = Math.max(0.0001, ...imp.map(([, v]) => v));
  el.innerHTML = `<p><b>${e.activa ? "✅ ACTIVA" : e.entrenada ? "➖ APAGADA" : "⏳ Sin entrenar"}</b> · ${esc((e.motivo || "").replace(/^(ACTIVA|APAGADA):\s*/, ""))}</p>
    ${e.entrenada ? `<div class="mercados">
      <div class="mercado"><div class="n">Partidos aprendidos</div><div class="v">${(e.partidos || 0).toLocaleString("es-ES")}</div></div>
      <div class="mercado"><div class="n">Examen (no vistos)</div><div class="v">${(e.examen || 0).toLocaleString("es-ES")}</div></div>
      <div class="mercado"><div class="n">Acierto 1X2 casas</div><div class="v">${pct(A.casas, 1)}</div></div>
      <div class="mercado"><div class="n">Acierto 1X2 con IA</div><div class="v">${pct(A.ia, 1)}</div></div>
      <div class="mercado"><div class="n">Log-loss casas → IA</div><div class="v">${n1(L.casas, 4)} → ${n1(L.ia, 4)}</div></div>
      <div class="mercado"><div class="n">Entrenada</div><div class="v" style="font-size:1rem">${esc((e.entrenada || "").replace("T", " ").slice(0, 16))}</div></div></div>
    <p class="nota">Log-loss: cuanto más bajo, mejor (mide si las probabilidades eran buenas, no solo si acertó el favorito).
      Examen con partidos desde ${esc(e.corte || "–")}.${e.europa && e.europa.length ? "" : " ⚠️ No hay partidos de Champions/Europa League guardados: el cansancio por Europa no se puede aprender (sincroniza esas competiciones)."}</p>
    <details open><summary>Qué aporta cada dato (sobre las cuotas de las casas, que son el punto de partida)</summary><div class="desplaza"><table class="tabla">${imp.map(([k, v]) => `<tr><td>${esc(k)}</td>
      <td style="width:45%"><div class="medidor"><i class="${v > 0.0005 ? "ok" : "mal"}" style="width:${Math.max(0, (v / maxImp) * 100).toFixed(0)}%"></i></div></td>
      <td class="d nota">${v > 0.0005 ? "ayuda" : "casi nada"}</td></tr>`).join("")}</table></div></details>
    ${Object.keys(e.situaciones || {}).length ? `<details><summary>Dónde se nota</summary><div class="desplaza"><table class="tabla"><tr><th>Situación</th><th class="d">Partidos</th><th class="d">Acierto casas</th><th class="d">Acierto IA</th><th class="d">Mejora</th></tr>
      ${Object.entries(e.situaciones).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="d">${v.n}</td><td class="d">${pct(v.acierto_casas, 1)}</td><td class="d">${pct(v.acierto_ia, 1)}</td><td class="d">${v.mejora > 0 ? "✅" : "❌"} ${n1(v.mejora * 1000, 1)}</td></tr>`).join("")}</table></div></details>` : ""}` : ""}
    ${bloqueIaCtEstado(e.ia_ct)}
    ${e.empates ? `<h4 style="margin-top:14px">🎫 Detector de empates (quiniela)</h4><p>${e.empates.activa ? "✅ ACTIVO" : e.empates.entrenada ? "➖ apagado" : "⏳ sin entrenar"} · <span class="nota">${esc(e.empates.motivo || "")}</span></p>
      ${e.empates.aciertos_4dobles ? `<p class="nota">Examen con ${e.empates.jornadas_examen} quinielas de 14 partidos que no había visto: sencilla ${n1(e.empates.aciertos_sencilla[0], 2)} → ${n1(e.empates.aciertos_sencilla[1], 2)} aciertos ·
        con 4 dobles ${n1(e.empates.aciertos_4dobles[0], 2)} → ${n1(e.empates.aciertos_4dobles[1], 2)} · X puestas como sencillo ${e.empates.x_sencillas[0]} → ${e.empates.x_sencillas[1]} · empates reales ${pct(e.empates.empates_reales, 0)}</p>` : ""}` : ""}
    <div class="fila-controles"><button class="primario" id="btnIaNumEntrenar">${e.entrenada ? "Volver a entrenar ahora" : "Entrenar ahora"} (2-4 min, las dos IA)</button>
      <span class="nota">${e.necesita_entrenar && e.entrenada ? "Toca reentrenar (más de 7 días)." : ""}</span></div>
    <pre class="consola" id="iaNumLog" hidden></pre>`;
  $("#btnIaNumEntrenar").onclick = async () => {
    const b = $("#btnIaNumEntrenar");
    b.disabled = true; b.innerHTML = `<span class="spinner"></span> Entrenando…`;
    const r = await api("/api/ia_numeros/entrenar", { method: "POST" });
    if (r.error && !r.id) { $("#iaNumLog").hidden = false; $("#iaNumLog").textContent = r.error; b.disabled = false; return; }
    const log = $("#iaNumLog"); log.hidden = false;
    const mirar = async () => {
      const t = await api(`/api/tarea/${r.id}?desde=0`);
      log.textContent = t.lineas.join("\n");
      log.scrollTop = log.scrollHeight;
      if (t.fin) { setTimeout(pintarIaNumeros, 1500); return; }
      setTimeout(mirar, 1500);
    };
    mirar();
  };
}

// IA de córners y tarjetas (v2.0): estado del examen
function bloqueIaCtEstado(c) {
  if (!c) return "";
  const fila = (q, nom) => { const x = c[q] || {};
    return `<tr><td>${nom}</td><td>${x.activa ? "✅ activa" : x.logloss_antes != null ? "➖ apagada" : "⏳ sin entrenar"}<br><span class="nota">${esc(x.motivo || "")}</span></td>
      <td class="d">${x.examen ?? "–"}</td><td class="d">${x.logloss_antes != null ? `${n1(x.logloss_antes, 4)} → ${n1(x.logloss_ia, 4)}` : "–"}</td>
      <td class="d">${x.media_real != null ? `${n1(x.media_real, 2)} / ${n1(x.media_ia, 2)}` : "–"}</td></tr>`; };
  return `<h4 style="margin-top:14px">🚩🟨🎯 IA de córners, tarjetas y remates a puerta</h4>
    <p class="nota">Aprende de los córners, tarjetas, faltas y tiros REALES de 5 temporadas de las 5 grandes ligas, y de lo favorito que es cada equipo.
      Se examina con las apuestas típicas de Bet365 («Madrid más de 5.5 córners», «ambos equipos reciben tarjeta», «más de 4.5 tarjetas»...) en partidos que no ha visto.</p>
    <div class="desplaza"><table class="tabla"><tr><th>Mercado</th><th>Estado</th><th class="d">Examen</th><th class="d">Log-loss antes → IA</th><th class="d">Media real / IA</th></tr>
      ${fila("corners", "Córners")}${fila("tarjetas", "Tarjetas")}${fila("remates", "Remates a puerta")}</table></div>`;
}

// v2.0.2: «Bet365 paga más que el mercado» (idea de Beat the Bookie)
function bloqueB365Valor(d) {
  const v = d.b365_valor || [];
  if (!v.length) return "";
  return `<div class="tarjeta"><h3>💎 Bet365 paga más que el resto del mercado</h3>
    <div class="desplaza"><table class="tabla"><tr><th>Apuesta</th><th class="d">Bet365</th><th class="d">Justa (${esc(v[0].referencia)})</th><th class="d">Ventaja</th><th class="d">Prob.</th><th></th></tr>
    ${v.map((x) => `<tr><td>${esc(x.mercado)}</td><td class="d"><b>@ ${n1(x.cuota, 2)}</b></td><td class="d">${n1(x.justa, 2)}</td><td class="d verde">+${(x.ventaja * 100).toFixed(1)}%</td><td class="d">${pct(x.prob, 0)}</td>
      <td>${btnJugada([{ comp: E.comp, partido_id: d.partido.id, fecha: d.partido.fecha, home: d.partido.home, away: d.partido.away, clave: x.clave, mercado: x.mercado, prob: x.prob }], x.cuota, "sencilla")}</td></tr>`).join("")}</table></div>
    <p class="nota">No es el modelo: es comparar Bet365 con las casas que mejor aciertan (Pinnacle o la media de todas). Cuando Bet365 paga claramente más, suele ser un despiste suyo
      o una cuota que todavía no ha bajado. Es el método de «Beat the Bookie», que funcionó de verdad (hasta que las casas les limitaron las cuentas).
      ⚠️ Cuotas consultadas ${esc((v[0].consultado || "").replace("T", " ").slice(0, 16))}: mira que Bet365 siga pagando eso antes de apostar.</p></div>`;
}

// Bloque del análisis: qué dice la IA de córners y tarjetas y la probabilidad de cada apuesta
function bloqueIaCt(d, pk) {
  const c = d.ia_ct || {}, P = d.partido;
  const ms = (pk.mercados || []).filter((m) => m.tipo === "corners" || m.tipo === "tarjetas" || m.tipo === "remates");
  if (!ms.length) return "";
  const explica = (q, nom) => { const x = c[q]; if (!x) return "";
    const L = x.local || {}, V = x.visitante || {};
    return `<div class="c6"><h4>${nom}: ${esc(P.home)} ${n1(x.ia[0], 1)} · ${esc(P.away)} ${n1(x.ia[1], 1)}</h4>
      <p class="nota">${esc(P.home)} saca ${n1(L.saca, 1)} de media (${n1(L.saca_sitio, 1)} en casa) y concede ${n1(L.concede, 1)}.
        ${esc(P.away)} saca ${n1(V.saca, 1)} (${n1(V.saca_sitio, 1)} fuera) y concede ${n1(V.concede, 1)}. Media de la liga: ${n1(L.liga, 1)} por equipo.
        ${x.antes ? `Antes el programa decía ${n1(x.antes[0], 1)} · ${n1(x.antes[1], 1)}.` : ""}${q === "tarjetas" && c.arbitro && c.arbitro.nombre ? ` Árbitro: ${esc(c.arbitro.nombre)}${c.arbitro.conocido ? ` (la IA conoce ${c.arbitro.partidos} partidos suyos)` : " (sin historial en los datos)"}.` : ""}</p></div>`; };
  const tabla = (tipo, nom) => `<div class="c6"><h4>${nom}</h4><div class="desplaza"><table class="tabla"><tr><th>Apuesta</th><th class="d">Prob.</th><th class="d">Cuota justa</th></tr>
    ${ms.filter((m) => m.tipo === tipo && m.prob >= 0.03 && m.prob <= 0.97).sort((a, b) => b.prob - a.prob).map((m) => `<tr><td>${esc(m.mercado)}</td><td class="d">${pct(m.prob, 0)}</td><td class="d">${n1(1 / m.prob, 2)}</td></tr>`).join("")}</table></div></div>`;
  return `<details class="tarjeta"><summary>🚩🟨🎯 Córners, tarjetas y remates: probabilidad de cada apuesta ${c.activa ? "(IA ✅)" : ""}</summary>
    <p class="nota">${c.activa ? "Calculado con la IA de córners y tarjetas (aprobó el examen)." : esc(c.motivo || "Calculado con la fórmula del programa (la IA no está activa para este partido).")}
      Si Bet365 paga MÁS que la «cuota justa», tiene valor. Si paga menos, la casa sabe algo o se queda margen: no la juegues.
      Para comprobar una cuota concreta, usa «🧾 Comprobar una apuesta» de abajo.</p>
    <div class="rejilla">${explica("corners", "🚩 Córners esperados")}${explica("tarjetas", "🟨 Tarjetas esperadas")}</div>
    <div class="rejilla">${tabla("corners", "🚩 Córners")}${tabla("tarjetas", "🟨 Tarjetas")}</div>
    ${ms.some((m) => m.tipo === "remates") ? `<div class="rejilla">${explica("remates", "🎯 Remates a puerta esperados")}${tabla("remates", "🎯 Remates a puerta")}</div>` : ""}</details>`;
}

// ---------------------------------------------------------------- en directo
const ICONO_EV = { gol: "⚽", gol_pen: "⚽ (p)", gol_pp: "⚽ (pp)", amarilla: "🟨", roja: "🟥", cambio: "🔁" };

async function cargarDirecto() {
  const el = $("#listaDirecto");
  if (!E.vivo.length) el.innerHTML = `<div class="vacio"><span class="spinner"></span> Consultando ESPN…</div>`;
  const pintar = async () => {
    try {
      const r = await api(`/api/${E.comp}/vivo`);
      avisarGoles(r.partidos || []);
      E.vivo = r.partidos || [];
      const hayVivo = E.vivo.some((p) => p.estado.fase === "in");
      E.recarga = hayVivo ? 10000 : 30000;
      let h = `<div class="nota" style="padding:0 4px">Ayer, hoy y mañana · actualizado ${esc(r.consultado)} (cada ${hayVivo ? 10 : 30} s)</div>`;
      if (!E.vivo.length) h += `<div class="vacio">No hay partidos de ${esc(nombreComp())} entre ayer y mañana.</div>`;
      for (const p of E.vivo) {
        const st = p.estado, live = st.fase === "in";
        const goles = p.eventos.filter((e) => e.tipo.startsWith("gol") || e.tipo === "roja");
        h += `<button class="item directo ${live ? "en" : ""}" data-id="${p.id}">
          <div class="marcador-vivo"><span class="eq">${esc(p.home.nombre)}</span><b>${st.fase === "pre" ? "–" : esc(p.home.goles)}</b>
            <span class="eq">${esc(p.away.nombre)}</span><b>${st.fase === "pre" ? "–" : esc(p.away.goles)}</b></div>
          <div class="nota">${live ? `<span class="vivo en">● <span class="reloj" data-seg="${st.segundos ?? ""}" data-t="${st.momento}" data-parado="${st.parado ? 1 : 0}" data-per="${st.periodo || 1}">${esc(st.minuto || st.texto)}</span></span>` : esc(st.fase === "pre" ? new Date(p.fecha).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : st.texto)}
            ${p.resumen.shotsOnTarget ? ` · a puerta ${p.resumen.shotsOnTarget.join("-")}` : ""}${p.resumen.wonCorners ? ` · córners ${p.resumen.wonCorners.join("-")}` : ""}</div>
          ${goles.length ? `<div class="goleadores">${goles.map((g) => `<span>${ICONO_EV[g.tipo] || ""} ${esc(g.jugador || "")} ${esc(g.minuto || "")}${g.lado === "away" ? " (V)" : " (L)"}</span>`).join("")}</div>` : ""}
        </button>`;
      }
      el.innerHTML = h;
      $$(".item", el).forEach((b) => (b.onclick = () => abrirDirecto(b.dataset.id)));
      if (E.vivoSel) { $$(".item", el).forEach((b) => b.classList.toggle("activo", b.dataset.id === E.vivoSel)); abrirDirecto(E.vivoSel, true); }
    } catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
  };
  await pintar();
  const ciclo = () => { E.timerVivo = setTimeout(async () => { if (E.vista !== "directo") return; await pintar(); ciclo(); }, E.recarga || 30000); };
  ciclo();
}


// ---------------------------------------------------------------- previsión EN DIRECTO de córners y tarjetas
// Lo que ya ha pasado + lo que falta. El ritmo de lo que falta mezcla lo que esperaba el modelo antes del partido
// con el ritmo real de este partido (cuantos más minutos jugados, más pesa el ritmo real).
function nbMas(mu, falta, disp) {          // P(X >= falta), X ~ binomial negativa de media mu
  if (falta <= 0) return 1;
  const p = disp / (disp + Math.max(mu, 1e-6));
  let pk = Math.pow(p, disp), acum = 0;
  for (let k = 0; k < falta; k++) { acum += pk; pk = pk * (k + disp) / (k + 1) * (1 - p); }
  return Math.max(0, 1 - acum);
}
function minutoJugado(st) {
  if (st.segundos != null && !isNaN(+st.segundos) && +st.segundos > 0) return +st.segundos / 60;
  const m = String(st.minuto || "").match(/(\d+)(?:'?\s*\+\s*(\d+))?/);
  return m ? +m[1] + (+m[2] || 0) : 0;
}
function proyeccion(actual, esperado, minuto, lineas, disp) {
  const T = 95, m = Math.min(Math.max(minuto, 0), T - 1), resto = Math.max(T - m, 2), K = 35;
  const ritmo = esperado != null ? ((esperado / T) * K + actual) / (K + m) : (m > 5 ? actual / m : null);
  if (ritmo == null) return null;
  const mu = ritmo * resto;
  return { mu, final: actual + mu, ritmoReal: m > 5 ? (actual / m) * T : null,
    lineas: lineas.map((l) => ({ l, mas: nbMas(mu, Math.floor(l) + 1 - actual, disp) })) };
}
function bloqueProyeccion(d, st) {
  if (st.fase !== "in") return "";
  const fila = (n) => (d.estadisticas || []).find((s) => s.nombre === n);
  const num = (x) => parseFloat(x) || 0;
  const pre = (E.ranking || []).find((p) => mismoEquipo(d.home.nombre, p.home) && mismoEquipo(d.away.nombre, p.away));
  const ct = (pre && pre.ct) || {};
  const min = minutoJugado(st);
  const partes = [];
  const c = fila("Córners");
  if (c) {
    const act = num(c.home) + num(c.away), e = ct.corners ? ct.corners[0] + ct.corners[1] : null;
    const pr = proyeccion(act, e, min, [8.5, 9.5, 10.5, 11.5, 12.5, 13.5], 8);
    if (pr) partes.push({ t: "🚩 Córners", act, e, pr });
  }
  const am = fila("Amarillas"), ro = fila("Rojas");
  if (am) {
    const act = num(am.home) + num(am.away) + (ro ? num(ro.home) + num(ro.away) : 0), e = ct.tarjetas ? ct.tarjetas[0] + ct.tarjetas[1] : null;
    const pr = proyeccion(act, e, min, [2.5, 3.5, 4.5, 5.5, 6.5], 5);
    if (pr) partes.push({ t: "🟨 Tarjetas", act, e, pr });
  }
  if (!partes.length) return "";
  return `<div class="tarjeta c12"><h3>📈 Previsión en directo (minuto ${Math.round(min)})</h3>
    <div class="rejilla" style="margin-top:0">${partes.map((x) => `<div class="c6"><div class="goles"><span>${x.t}: <b>${x.act}</b> ahora</span><span class="xg">→ ~${n1(x.pr.final, 1)} al final</span></div>
      <div class="nota">${x.e != null ? `Antes del partido el modelo esperaba ${n1(x.e, 1)} en total. ` : "Este partido no está en los pronósticos: solo se usa el ritmo real. "}${x.pr.ritmoReal != null ? `Al ritmo actual saldrían ${n1(x.pr.ritmoReal, 1)}. ` : ""}Faltan ~${n1(x.pr.mu, 1)} más.</div>
      <div class="desplaza"><table class="tabla"><tr><th>Línea</th><th class="d">Más de</th><th class="d">Menos de</th></tr>
      ${x.pr.lineas.map((l) => `<tr class="${l.mas >= 0.75 || l.mas <= 0.25 ? "valor" : ""}"><td>${l.l}</td><td class="d">${pct(l.mas, 0)}</td><td class="d">${pct(1 - l.mas, 0)}</td></tr>`).join("")}</table></div></div>`).join("")}</div>
    <p class="nota">Se recalcula cada vez que se actualiza el marcador. Mezcla lo que esperaba el modelo con lo que está pasando: al principio pesa más el modelo y, según avanzan los minutos, el ritmo real del partido (unos 35 minutos de "confianza" al pronóstico previo).</p></div>`;
}

async function abrirDirecto(id, silencioso) {
  E.vivoSel = id;
  $$("#listaDirecto .item").forEach((b) => b.classList.toggle("activo", b.dataset.id === id));
  $("#v-directo .partidos-layout").classList.add("con-analisis");
  const el = $("#detalleDirecto");
  if (!silencioso) el.innerHTML = `<div class="vacio grande"><span class="spinner"></span></div>`;
  try {
    const d = await api(`/api/${E.comp}/vivo_detalle?id=${id}`);
    const st = d.estado || {}, H = d.home || {}, A = d.away || {};
    const barra = (a, b) => { const x = parseFloat(a) || 0, y = parseFloat(b) || 0, t = x + y || 1;
      return `<div class="barra-est"><i style="width:${(x / t) * 100}%"></i><i class="v" style="width:${(y / t) * 100}%"></i></div>`; };
    el.innerHTML = `<button class="volver" id="btnVolverD">← Partidos</button>
      <div class="tarjeta"><div class="marcador-grande">
        <div>${H.escudo ? `<img src="${esc(H.escudo)}" alt="" loading="lazy">` : ""}<div>${esc(H.nombre)}</div></div>
        <div class="res">${st.fase === "pre" ? "vs" : `${esc(H.goles)} - ${esc(A.goles)}`}<div class="nota">${st.fase === "in" ? `<span class="vivo en">● <span class="reloj" data-seg="${st.segundos ?? ""}" data-t="${st.momento}" data-parado="${st.parado ? 1 : 0}" data-per="${st.periodo || 1}">${esc(st.minuto || st.texto)}</span></span>` : esc(st.texto)}</div></div>
        <div>${A.escudo ? `<img src="${esc(A.escudo)}" alt="" loading="lazy">` : ""}<div>${esc(A.nombre)}</div></div></div>
        <div class="nota" style="text-align:center">Datos de ESPN · ${esc(d.consultado)}</div></div>
      <div class="rejilla">
      ${bloqueProyeccion(d, st)}
      <div class="tarjeta c6"><h3>Estadísticas</h3>${d.estadisticas.length ? d.estadisticas.map((s) => `<div class="fila-est"><b>${esc(s.home)}</b><span>${esc(s.nombre)}</span><b>${esc(s.away)}</b></div>${barra(s.home, s.away)}`).join("") : `<div class="nota">Sin estadísticas todavía.</div>`}</div>
      <div class="tarjeta c6"><h3>Goles y tarjetas</h3>${d.eventos.length ? `<ul class="cronologia">${d.eventos.map((e) => `<li class="${e.lado === "away" ? "der" : ""}"><span class="min">${esc(e.minuto || "")}</span> ${ICONO_EV[e.tipo] || ""} <b>${esc(e.jugador || "")}</b>${e.jugador2 ? ` <span class="nota">(${e.tipo === "cambio" ? "sale/entra " : "asist. "}${esc(e.jugador2)})</span>` : ""}</li>`).join("")}</ul>` : `<div class="nota">Sin goles ni tarjetas todavía.</div>`}</div>
      <div class="tarjeta c12"><h3>Narración minuto a minuto</h3>${(d.narracion || []).length ? `<ul class="cronologia narracion">${d.narracion.map((n) => `<li><span class="min">${esc(n.minuto)}</span> ${esc(n.texto)}</li>`).join("")}</ul>` : `<div class="nota">ESPN aún no ha publicado la narración de este partido.</div>`}</div>
      <div class="tarjeta c12"><h3>Alineaciones</h3><div class="rejilla" style="margin-top:0">${["home", "away"].map((k) => { const o = (d.alineaciones || {})[k];
        return `<div class="c6"><div class="equipo-cab">${esc((k === "home" ? H : A).nombre)} ${o && o.formacion ? `<span class="chip">${esc(o.formacion)}</span>` : ""}</div>${o && o.titulares.length ? `<ol class="lista-simple">${o.titulares.map((j) => `<li>${esc(j)}</li>`).join("")}</ol>` : `<div class="nota">Aún no publicadas</div>`}</div>`; }).join("")}</div></div>
      </div>`;
    $("#btnVolverD").onclick = () => $("#v-directo .partidos-layout").classList.remove("con-analisis");
  } catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

const nombreComp = () => (E.info.comps.find((c) => c.id === E.comp) || {}).nombre || "";

// ---------------------------------------------------------------- historial de predicciones
const okIcon = (x) => (x == null ? "⏳" : x ? "✅" : "❌");
const tasa = (a) => (a[1] ? `${a[0]}/${a[1]} (${Math.round((a[0] / a[1]) * 100)}%)` : "–");

async function cargarHistorial() {
  const ac = $("#aciertos");
  const H = E.hist || (E.hist = { modo: "partidos", equipo: "", desde: "", hasta: "", estado: "", nivel: "" });
  ac.innerHTML = `<div class="hist-cab"><h2>Historial de ${esc(nombreComp())}</h2>
    <div class="segmento-mini"><button data-m="partidos" class="${H.modo === "partidos" ? "activa" : ""}">Por partido</button><button data-m="snap" class="${H.modo === "snap" ? "activa" : ""}">Por actualización</button></div></div>
    <div class="fila-controles filtros-hist">
      <label>Equipo <input id="hEquipo" list="listaEquipos" value="${esc(H.equipo)}" placeholder="todos"></label>
      <label>Desde <input id="hDesde" type="date" value="${esc(H.desde)}"></label>
      <label>Hasta <input id="hHasta" type="date" value="${esc(H.hasta)}"></label>
      <label>Resultado <select id="hEstado"><option value="">Todos</option><option value="acertada">🛡️ Segura acertada</option><option value="fallada">🛡️ Segura fallada</option>
        <option value="arriesgada_ok">⚡ Arriesgada acertada</option><option value="marcador_ok">🎯 Marcador acertado</option><option value="pendiente">⏳ Pendientes</option></select></label>
      <label>Fiabilidad <select id="hNivel"><option value="">Todas</option><option>Alta</option><option>Media</option><option>Baja</option></select></label>
      <button class="mini" id="hLimpiar">Quitar filtros</button></div>
    <div id="hExamen"></div><div id="hResumen"></div><div id="hTipster"></div>`;
  pintarExamen();
  bloqueRegistroTipster().then((h) => { const t = $("#hTipster"); if (t) { t.innerHTML = h; ligarKjefes(); } });
  $("#hEstado").value = H.estado; $("#hNivel").value = H.nivel;
  $$(".segmento-mini button", ac).forEach((b) => (b.onclick = () => { H.modo = b.dataset.m; cargarHistorial(); }));
  const aplicar = () => { H.equipo = $("#hEquipo").value.trim(); H.desde = $("#hDesde").value; H.hasta = $("#hHasta").value;
    H.estado = $("#hEstado").value; H.nivel = $("#hNivel").value; pintarHistorial(); };
  ["hEquipo", "hDesde", "hHasta", "hEstado", "hNivel"].forEach((id) => ($("#" + id).onchange = aplicar));
  $("#hLimpiar").onclick = () => { Object.assign(H, { equipo: "", desde: "", hasta: "", estado: "", nivel: "" }); cargarHistorial(); };
  pintarHistorial();
}

// v2.0.2: examen de las apuestas que recomienda la app
async function pintarExamen() {
  const el = $("#hExamen");
  if (!el) return;
  el.innerHTML = `<div class="tarjeta"><div class="vacio"><span class="spinner"></span> Examinando las apuestas de la app…</div></div>`;
  let d;
  try { d = await api("/api/examen"); } catch (x) { el.innerHTML = ""; return; }
  const fila = (k, x) => `<tr><td>${esc(k)}</td><td class="d">${x.n}</td><td class="d">${x.n ? pct(x.acierto, 0) : "–"}</td><td class="d nota">${x.n ? pct(x.dice, 0) : "–"}</td>
    <td class="d ${x.z != null && x.z <= -2 ? "rojo" : ""}">${x.n ? (x.acierto - x.dice >= 0 ? "+" : "") + Math.round((x.acierto - x.dice) * 100) + " pts" : "–"}</td>
    <td class="d">${x.cuota_media ? n1(x.cuota_media, 2) : "–"}</td><td class="d ${x.beneficio > 0 ? "verde" : x.beneficio < 0 ? "rojo" : ""}">${x.n ? (x.beneficio > 0 ? "+" : "") + n1(x.beneficio, 1) + " u" : "–"}</td>
    <td class="d">${x.roi != null ? pct(x.roi, 1) : "–"}</td><td class="d nota">${x.clv != null ? (x.clv > 0 ? "+" : "") + (x.clv * 100).toFixed(1) + "%" : "–"}</td></tr>`;
  const tabla = (titulo, obj) => { const e = Object.entries(obj || {}); return e.length ? `<div class="c6"><h4>${titulo}</h4><div class="desplaza"><table class="tabla">
    <tr><th></th><th class="d">N</th><th class="d">Acierta</th><th class="d">Decía</th><th class="d">Dif.</th><th class="d">Cuota</th><th class="d">Beneficio</th><th class="d">ROI</th><th class="d">CLV</th></tr>
    ${e.map(([k, x]) => fila(k, x)).join("")}</table></div></div>` : ""; };
  el.innerHTML = `<div class="tarjeta"><h2>🧪 Examen de las apuestas de la app</h2>
    <p class="nota">Lo que de verdad pasó con las apuestas que te recomendó la app (la última predicción antes de cada partido${d.desde ? `, desde el ${esc(fechaLarga(d.desde))}` : ""}).
      «Decía» es la probabilidad que daba; si acierta mucho menos de lo que decía, ese tipo de apuesta no es de fiar. Beneficio con 1 € por apuesta y la cuota de Bet365 (real en 1X2 y +/-2.5; en el resto, estimada).</p>
    ${(d.deja || []).length ? `<div class="veredicto sin_valor">❌ <b>Deja de jugar:</b><br>${d.deja.map(esc).join("<br>")}</div>` : ""}
    ${(d.fiate || []).length ? `<div class="veredicto valor" style="margin-top:8px">✅ <b>De fiar:</b><br>${d.fiate.map(esc).join("<br>")}</div>` : ""}
    ${(d.info || []).map((t) => `<p class="nota">ℹ️ ${esc(t)}</p>`).join("")}
    ${bloqueFiltro(d.filtro)}
    <div class="rejilla">${tabla("Por tipo de apuesta", d.tipos)}${tabla("🛡️ Seguras por liga", d.por_liga)}</div>
    <details><summary>Más detalle de las 🛡️ seguras (por mercado, probabilidad, fiabilidad y mes)</summary>
      <div class="rejilla">${tabla("Por mercado", d.por_mercado)}${tabla("Por probabilidad que daba", d.por_tramo)}${tabla("Por fiabilidad", d.por_nivel)}${tabla("Por mes", d.por_mes)}</div></details>
    <p class="nota">Con menos de ${d.minimo} apuestas de un tipo no se saca ninguna conclusión. «Dif.» en rojo = acierta bastante menos de lo que decía (no es mala suerte).</p></div>`;
}

// v2.2: filtro automático (lo que el examen quita de las recomendaciones)
function bloqueFiltro(f) {
  if (!f) return "";
  const l = [...Object.values(f.comps || {}), ...Object.values(f.familias || {}), ...Object.values(f.tramos || {}), ...Object.values(f.tipos || {})];
  return l.length ? `<div class="veredicto sin_valor" style="margin-top:8px">🤖 <b>Filtro automático activo</b> (últimos ${Math.round((f.dias || 180) / 30)} meses, ${f.minimo} apuestas o más de cada tipo):
      ${l.map((t) => `<br>· ${esc(t)}`).join("")}<br><span class="nota">Estas apuestas salen marcadas con ❌ en los pronósticos (y en el resumen de Telegram) y no entran en la combinada segura ni en el presupuesto.
      Se quita solo cuando vuelvan a acertar lo que prometen.</span></div>`
    : `<p class="nota">🤖 Filtro automático: de momento no se quita nada (hace falta que un tipo de apuesta falle claramente en ${f.minimo || 40} apuestas o más de los últimos ${Math.round((f.dias || 180) / 30)} meses).</p>`;
}

function filaHist(p, conEquipoLink = true) {
  const clv = p.clv_segura == null ? "–" : (p.clv_segura > 0 ? "+" : "") + (p.clv_segura * 100).toFixed(1) + "%";
  return `<tr><td>${esc(p.home)} – ${esc(p.away)}<br><span class="chip ${nivelCls(p.nivel)}">${esc(p.nivel || "")}</span> <span class="nota">${esc((p.hora || "").slice(0, 5))}</span></td>
    <td>${okIcon(p.ok_segura)} ${esc(p.segura || "")} <span class="nota">${pct(p.segura_prob, 0)}</span></td>
    <td>${p.arriesgada ? `${okIcon(p.ok_arriesgada)} ${esc(p.arriesgada)} <span class="nota">${pct(p.arriesgada_prob, 0)}</span>` : "–"}</td>
    <td class="d">${okIcon(p.ok_marcador)} ${esc(p.marcador || "")}</td><td class="d nota">${p.c1 ? `${n1(p.c1, 2)} · ${n1(p.cx, 2)} · ${n1(p.c2, 2)}` : "–"}</td>
    <td class="d ${p.clv_segura > 0 ? "verde" : p.clv_segura < 0 ? "rojo" : ""}" title="${esc(p.cierre || "")}">${clv}</td>
    <td class="d"><b>${p.gh != null ? p.gh + "-" + p.ga : "pendiente"}</b></td></tr>`;
}

function tablaHistDias(partidos) {
  if (!partidos.length) return `<div class="vacio">No hay partidos con esos filtros.</div>`;
  const dias = {};
  partidos.forEach((p) => (dias[p.fecha_partido] = dias[p.fecha_partido] || []).push(p));
  return Object.keys(dias).sort().reverse().map((d) => {
    const l = dias[d], j = l.filter((p) => p.gh != null);
    const r = j.length ? ` · 🛡️ ${j.filter((p) => p.ok_segura).length}/${j.length} · ⚡ ${j.filter((p) => p.ok_arriesgada).length}/${j.filter((p) => p.ok_arriesgada != null).length} · 🎯 ${j.filter((p) => p.ok_marcador).length}/${j.length}` : "";
    return `<div class="fecha-grupo ${d === HOY() ? "hoy" : ""}">${esc(diaTitulo(d))}<span class="nota">${l.length} partidos${r}</span></div>
      <div class="desplaza"><table class="tabla"><tr><th>Partido</th><th>🛡️ Segura</th><th>⚡ Arriesgada</th><th class="d">🎯</th><th class="d">Cuotas</th><th class="d">CLV</th><th class="d">Resultado</th></tr>
      ${l.sort((a, b) => (b.fiabilidad || 0) - (a.fiabilidad || 0)).map((p) => filaHist(p)).join("")}</table></div>`;
  }).join("");
}

async function pintarHistorial() {
  const H = E.hist, el = $("#listaHistorial"), det = $("#detalleHistorial");
  const lay = $("#v-historial .partidos-layout");
  if (H.modo === "partidos") {
    lay.classList.add("solo");
    el.innerHTML = ""; det.innerHTML = `<div class="vacio"><span class="spinner"></span></div>`;
    const qs = new URLSearchParams({ comp: E.comp, equipo: H.equipo, desde: H.desde, hasta: H.hasta, estado: H.estado, nivel: H.nivel });
    try {
      const r = await api(`/api/historial/partidos?${qs}`);
      const s = r.resumen;
      $("#hResumen").innerHTML = s.jugados ? `<div class="mercados"><div class="mercado"><div class="n">Partidos (jugados)</div><div class="v">${s.partidos} (${s.jugados})</div></div>
        <div class="mercado"><div class="n">🛡️ Segura</div><div class="v">${pct(s.segura / s.jugados, 0)} <span class="nota">${s.segura}/${s.jugados}</span></div></div>
        <div class="mercado"><div class="n">⚡ Arriesgada</div><div class="v">${s.arriesgada_n ? pct(s.arriesgada / s.arriesgada_n, 0) : "–"} <span class="nota">${s.arriesgada}/${s.arriesgada_n}</span></div></div>
        <div class="mercado"><div class="n">🎯 Marcador exacto</div><div class="v">${pct(s.marcador / s.jugados, 0)} <span class="nota">${s.marcador}/${s.jugados}</span></div></div>
        <div class="mercado"><div class="n">🚩 Córners</div><div class="v">${s.corners_n ? pct(s.corners / s.corners_n, 0) : "–"} <span class="nota">${s.corners || 0}/${s.corners_n || 0}</span></div></div>
        <div class="mercado"><div class="n">🟨 Tarjetas</div><div class="v">${s.tarjetas_n ? pct(s.tarjetas / s.tarjetas_n, 0) : "–"} <span class="nota">${s.tarjetas || 0}/${s.tarjetas_n || 0}</span></div></div></div>
        <p class="nota">Para cada partido se cuenta la última predicción guardada antes de jugarse. Córners y tarjetas se comprueban cuando la base tiene las estadísticas del partido (desde la versión 1.7.5).</p>`
        : `<p class="nota">${s.partidos} partidos guardados, ninguno jugado todavía con estos filtros.</p>`;
      det.innerHTML = `<div class="tarjeta">${tablaHistDias(r.partidos)}</div>`;
    } catch (e) { det.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
    return;
  }
  lay.classList.remove("solo");
  $("#hResumen").innerHTML = "";
  el.innerHTML = `<div class="vacio"><span class="spinner"></span></div>`;
  det.innerHTML = `<div class="vacio grande">Elige una actualización para ver lo que dijo el modelo en ese momento.</div>`;
  try {
    const r = await api(`/api/historial?comp=${E.comp}`);
    let lista = r.lista.filter((x) => (!H.desde || x.momento.slice(0, 10) >= H.desde) && (!H.hasta || x.momento.slice(0, 10) <= H.hasta));
    if (!lista.length) { el.innerHTML = `<div class="vacio">Todavía no hay predicciones guardadas.</div>`; return; }
    let html = "", ult = "";
    for (const x of lista) {
      const d = x.momento.slice(0, 10);
      if (d !== ult) { ult = d; html += `<div class="fecha-grupo">${esc(diaTitulo(d))}</div>`; }
      html += `<button class="item" data-id="${x.id}"><div class="fila1"><span class="eq">${esc(x.momento.slice(11))}</span><span class="chip">v${esc(x.version)}</span></div>
        <div class="nota">${esc(x.origen)} · ${x.partidos} partidos</div>
        <div class="nota">🛡️ ${tasa(x.segura)} · ⚡ ${tasa(x.arriesgada)} · 🎯 ${tasa(x.marcador)}</div></button>`;
    }
    el.innerHTML = html;
    $$(".item", el).forEach((b) => (b.onclick = () => abrirHistorial(+b.dataset.id)));
  } catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

async function abrirHistorial(id) {
  $$("#listaHistorial .item").forEach((b) => b.classList.toggle("activo", +b.dataset.id === id));
  $("#v-historial .partidos-layout").classList.add("con-analisis");
  const el = $("#detalleHistorial");
  el.innerHTML = `<div class="vacio grande"><span class="spinner"></span></div>`;
  const d = await api(`/api/historial/${id}`);
  el.innerHTML = `<button class="volver" id="btnVolverH">← Historial</button><div class="tarjeta">
    <h2>${esc(d.liga)} · ${esc(d.momento)} · v${esc(d.version)}</h2><p class="nota">${esc(d.origen)}. Así lo veía el modelo en ese momento (ordenado por fiabilidad).</p>
    <div class="desplaza"><table class="tabla"><tr><th>Partido</th><th>Fecha</th><th>🛡️ Segura</th><th>⚡ Arriesgada</th><th class="d">🎯</th><th class="d">Cuotas</th><th class="d">CLV</th><th class="d">Resultado</th></tr>
    ${d.partidos.filter((p) => !E.hist || !E.hist.equipo || (p.home + " " + p.away).toLowerCase().includes(E.hist.equipo.toLowerCase())).map((p) => `<tr><td>${esc(p.home)} – ${esc(p.away)}<br><span class="chip ${nivelCls(p.nivel)}">${esc(p.nivel || "")}</span></td><td>${esc(p.fecha_partido || "")} ${esc(p.hora || "")}</td>
      <td>${okIcon(p.ok_segura)} ${esc(p.segura || "")} <span class="nota">${pct(p.segura_prob, 0)}</span></td>
      <td>${p.arriesgada ? `${okIcon(p.ok_arriesgada)} ${esc(p.arriesgada)} <span class="nota">${pct(p.arriesgada_prob, 0)}</span>` : "–"}</td>
      <td class="d">${okIcon(p.ok_marcador)} ${esc(p.marcador || "")}</td><td class="d nota">${p.c1 ? `${n1(p.c1, 2)} · ${n1(p.cx, 2)} · ${n1(p.c2, 2)}` : "–"}</td>
      <td class="d ${p.clv_segura > 0 ? "verde" : p.clv_segura < 0 ? "rojo" : ""}" title="${esc(p.cierre || "")}">${p.clv_segura == null ? "–" : (p.clv_segura > 0 ? "+" : "") + (p.clv_segura * 100).toFixed(1) + "%"}</td>
      <td class="d"><b>${p.gh != null ? p.gh + "-" + p.ga : "pendiente"}</b></td></tr>`).join("")}</table></div></div>`;
  $("#btnVolverH").onclick = () => $("#v-historial .partidos-layout").classList.remove("con-analisis");
}

// ---------------------------------------------------------------- otras vistas
// ---------------------------------------------------------------- otras vistas
async function cargarClasif() {
  const el = $("#clasif");
  el.innerHTML = `<span class="spinner"></span>`;
  try {
    const d = await api(`/api/${E.comp}/clasificacion`);
    el.innerHTML = d.grupos.map((g) => g.tipo === "ligas"
      ? `<h2>${esc(g.nombre)}</h2><div class="desplaza"><table class="tabla"><tr><th>Equipo</th><th>Liga</th><th class="d">Pos.</th><th class="d">PJ</th><th class="d">Pts</th><th class="d">Pts/PJ</th><th class="d">GF/PJ</th><th class="d">GC/PJ</th><th class="d">Córners</th><th class="d">Tarjetas</th></tr>
        ${g.filas.map((f) => `<tr><td>${esc(f.equipo)}</td><td>${esc(f.liga)}</td><td class="d">${f.pos ?? "–"}${f.n_equipos ? "/" + f.n_equipos : ""}</td><td class="d">${f.pj ?? "–"}</td><td class="d">${f.pts ?? "–"}</td>
        <td class="d">${n1(f.ppg, 2)}</td><td class="d">${n1(f.gf_pg)}</td><td class="d">${n1(f.gc_pg)}</td><td class="d">${n1(f.corners_f)}</td><td class="d">${n1(f.tarjetas)}</td></tr>`).join("")}</table></div>`
      : `<h2>${esc(g.nombre)}</h2><div class="desplaza"><table class="tabla"><tr><th class="d">#</th><th>Equipo</th><th class="d">PJ</th><th class="d">G</th><th class="d">E</th><th class="d">P</th><th class="d">GF</th><th class="d">GC</th><th class="d">DG</th><th class="d">Pts</th><th>Racha</th>${g.filas[0] && g.filas[0].zona ? "<th>Zona</th>" : ""}</tr>
        ${g.filas.map((f) => `<tr><td class="d">${f.pos}</td><td>${esc(f.equipo)}</td><td class="d">${f.pj}</td><td class="d">${f.g}</td><td class="d">${f.e}</td><td class="d">${f.p}</td><td class="d">${f.gf}</td><td class="d">${f.ga}</td><td class="d">${f.dg}</td><td class="d"><b>${f.pts}</b></td>
        <td>${(f.ultimos_5 || "").split("-").filter(Boolean).map((r) => `<span class="res ${r}">${r}</span>`).join(" ")}</td>${f.zona ? `<td class="nota">${esc(f.zona)}</td>` : ""}</tr>`).join("")}</table></div>`).join("") || "Sin datos";
  } catch (e) { el.textContent = e.message; }
}

async function cargarResultados() {
  const el = $("#resultados");
  el.innerHTML = `<span class="spinner"></span>`;
  try {
    const d = await api(`/api/${E.comp}/resultados?n=120`);
    el.innerHTML = `<h2>Últimos resultados</h2><div class="desplaza"><table class="tabla"><tr><th>Fecha</th><th>Ronda</th><th>Local</th><th class="d">Res.</th><th>Visitante</th><th class="d">Córners</th><th class="d">Amarillas</th><th class="d">Rojas</th></tr>
      ${d.map((r) => `<tr><td>${esc(r.fecha)}</td><td class="nota">${esc(r.ronda || "")}</td><td>${esc(r.home)}</td><td class="d"><b>${r.hs}-${r.as_}</b>${r.pen_h != null ? ` <span class="nota">(${r.pen_h}-${r.pen_a} p.)</span>` : ""}</td><td>${esc(r.away)}</td>
      <td class="d">${r.corners_h ?? "?"}-${r.corners_a ?? "?"}</td><td class="d">${r.amarillas_h ?? "?"}-${r.amarillas_a ?? "?"}</td><td class="d">${r.rojas_h ?? "?"}-${r.rojas_a ?? "?"}</td></tr>`).join("")}</table></div>`;
  } catch (e) { el.textContent = e.message; }
}

async function cargarEquipos() {
  const sel = $("#selEquipo");
  const eqs = await api(`/api/${E.comp}/equipos`);
  const prev = leer(`eq_${E.comp}`, eqs[0]);
  sel.innerHTML = eqs.map((e) => `<option ${e === prev ? "selected" : ""}>${esc(e)}</option>`).join("");
  cargarJugadores();
}

async function cargarJugadores() {
  const eq = $("#selEquipo").value, el = $("#jugadores");
  guardar(`eq_${E.comp}`, eq);
  el.innerHTML = `<span class="spinner"></span>`;
  const d = await api(`/api/${E.comp}/jugadores?equipo=${encodeURIComponent(eq)}`);
  el.innerHTML = `<div class="desplaza"><table class="tabla"><tr><th>Jugador</th><th>Pos.</th><th class="d">Min.</th><th class="d">Goles</th><th class="d">Asist.</th><th class="d">🟨</th><th class="d">🟥</th><th>Estado</th></tr>
    ${d.map((j) => `<tr><td>${esc(j.jugador)}</td><td>${esc(j.posicion || "")}</td><td class="d">${j.minutos ?? ""}</td><td class="d">${j.goles ?? ""}</td><td class="d">${j.asistencias ?? ""}</td>
    <td class="d">${j.amarillas ?? ""}</td><td class="d">${j.rojas ?? ""}</td><td>${j.estado ? `<span class="estado-j ${esc(j.estado.split(" ")[0])}" title="${esc(j.motivo)}">${esc(j.estado)}</span>` : ""}</td></tr>`).join("")}</table></div>`;
}

async function cargarDiagnostico() {
  const el = $("#diagnostico");
  el.innerHTML = `<span class="spinner"></span>`;
  try {
    const d = await api(`/api/${E.comp}/diagnostico`);
    el.innerHTML = `<div class="desplaza"><table class="tabla"><tr><th>Equipo</th><th>País</th><th>Nombre en su liga</th><th class="d">UCL</th><th class="d">UCL ant.</th><th class="d">Liga</th><th class="d">Elo</th><th class="d">Opta</th><th class="d">ClubElo</th><th class="d">Propio</th></tr>
      ${d.map((r) => `<tr><td>${esc(r.equipo)} ${(r.liga || 0) + (r.champions || 0) + (r.champions_ant || 0) < 15 || !r.elo ? "⚠️" : ""}</td><td>${esc(r.pais || "")}</td><td>${esc(r.nombre_liga || "no emparejado")}</td>
      <td class="d">${r.champions}</td><td class="d">${r.champions_ant}</td><td class="d">${r.liga}</td><td class="d">${r.elo ?? "–"}</td><td class="d">${r.opta ? r.opta + " #" + r.opta_rank : "–"}</td><td class="d">${r.clubelo ?? "–"}</td><td class="d">${r.propio ?? "–"}</td></tr>`).join("")}</table></div>`;
  } catch (e) { el.textContent = e.message; }
}

// ---------------------------------------------------------------- actualizar
function pintarBotones() {
  if (E.info.web) {
    $("#botonesTareas").innerHTML = "";
    $("#notaActualizar").textContent = "Web: no hace falta sincronizar. GitHub actualiza resultados, cuotas, IA y pronósticos solo a las 10, 15 y 20 h "
      + "(y a mediodía los fines de semana), con el PC apagado." + (E.info.actualizado ? " Última vez: " + new Date(E.info.actualizado).toLocaleString("es-ES") + "." : "");
    $("#notaAuto").innerHTML = ""; return;
  }
  const ucl = esCopa(E.comp), movil = E.info.movil || E.info.nube;
  const b = [];
  if (esNacional(E.comp)) {   // v2.3: copas nacionales, solo ESPN (sin FBref)
    b.push(`<div class="grupo">Copa nacional: partidos y resultados de ESPN + ligas del país (football-data) + Elo</div>`);
    b.push(`<button class="primario" data-t="rapido">⟳ Actualizar ${esc(nombreComp())}</button><button data-t="todas">⟳ Actualizar TODAS las competiciones</button>`);
    b.push(`<button data-t="sync_force">Volver a bajar la copa entera (desde julio)</button>`);
    $("#botonesTareas").innerHTML = b.join("");
    $$("#botonesTareas button").forEach((x) => (x.onclick = () => x.dataset.t === "todas" ? actualizarTodas() : lanzarTarea(x.dataset.t)));
    $("#notaActualizar").textContent = "Las copas nacionales no usan FBref: los cruces y resultados salen de ESPN y la fuerza de cada equipo de su liga "
      + "(también Segunda y categorías inferiores cuando hay datos) y del Elo. Los equipos modestos sin datos se tratan como equipos de categoría baja.";
    pintarAuto(); pintarTareas(); return;
  }
  b.push(`<div class="grupo">Rápido (segundos): resultados, onces, cuotas, Opta y estadísticas</div>`);
  b.push(`<button class="primario" data-t="rapido">⟳ Actualizar partidos de ${esc(nombreComp())}</button><button data-t="todas">⟳ Actualizar TODAS las competiciones</button>`);
  b.push(`<div class="grupo">Completo (FBref: calendario, jugadores, detalles)</div>`);
  if (!movil) b.push(`<button class="primario" data-t="sync">Sincronizar todo (FBref + ESPN${ucl ? " + ligas + Elo" : ""})</button>`);
  b.push(`<button data-t="espn">Sincronizar sin FBref (ESPN${ucl ? " + ligas + Elo" : ""})</button>`);
  b.push(`<button data-t="alineaciones">Buscar onces oficiales</button>`);
  if (!movil) b.push(`<button data-t="sync_force">Rehacer todo desde cero</button>`);
  b.push(`<div class="grupo">Modelo</div><button data-t="backtest">Comprobar precisión (backtest)</button>${esCopa(E.comp) ? "" : `<button data-t="estudio" title="5 temporadas, cientos de versiones del motor comparadas con el cierre de Pinnacle (4-6 min)">🔬 Estudio a fondo del motor</button>`}`);
  if (ucl) b.push(`<button data-t="ajustar">Ajustar parámetros del modelo</button><button data-t="diagnostico">Diagnóstico de datos</button>`);
  $("#botonesTareas").innerHTML = b.join("");
  $$("#botonesTareas button").forEach((x) => (x.onclick = () => x.dataset.t === "todas" ? actualizarTodas() : lanzarTarea(x.dataset.t)));
  $("#notaActualizar").textContent = E.info.nube
    ? "Versión de la nube: se actualiza sola a las 10, 15 y 20 h con ESPN, Understat y football-data (FBref solo funciona en el PC). Estos botones actualizan ahora mismo."
    : movil
    ? "En el móvil FBref no funciona: se usan ESPN (resultados, córners, tarjetas, onces) y football-data.co.uk. Para tener los datos completos del PC usa la pestaña Móvil."
    : "La primera sincronización completa de una liga nueva tarda (FBref limita a 1 página cada 7 s). Después basta con “Actualizar partidos”.";
  pintarAuto();
  pintarTareas();
}

async function pintarAuto() {
  const n = $("#notaAuto");
  if (E.info.movil || E.info.nube) { n.innerHTML = ""; return; }
  try {
    const a = await api("/api/auto");
    const ult = a.ultima ? a.ultima.replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/, "$3/$2/$1 $4:$5") : null;
    n.innerHTML = `<div class="auto-caja"><b>🕘 Actualización automática (10:00 y 20:00):</b>
      <button class="interruptor ${a.activa ? "on" : ""}" id="btnAuto">${a.activa ? "ACTIVADA" : "DESACTIVADA"}</button>
      <span class="nota">${a.en_marcha ? "⏳ en marcha ahora mismo" : ult ? "Última: " + esc(ult) : "Aún no se ha ejecutado"}</span>
      ${a.ultima ? `<button class="mini" id="btnVerAuto">Ver su registro</button>` : ""}</div>`;
    $("#btnAuto").onclick = async () => { const r = await api(`/api/auto?activar=${a.activa ? 0 : 1}`, { method: "POST" }); $("#tituloTarea").textContent = r.texto; pintarAuto(); };
    const v = $("#btnVerAuto");
    if (v) v.onclick = () => { E.verTarea = "auto"; pintarTareas(); };
  } catch (e) { n.textContent = ""; }
}

async function pintarTareas() {
  const lista = $("#listaTareas");
  if (!lista) return;
  let ts = [];
  try { ts = await api("/api/tareas"); } catch (e) {}
  if (!E.verTarea && ts.length) E.verTarea = ts[0].id;
  lista.innerHTML = (ts.length ? ts.map((t) => `<button class="mini tarea ${E.verTarea === t.id ? "activa" : ""}" data-id="${t.id}">${t.fin ? (t.rc === 0 ? "✅" : "⚠️") : "⏳"} ${esc(t.inicio)} · ${esc(t.titulo.split(":")[0])} <span class="nota">${esc(t.tipo)}</span></button>`).join("") : `<span class="nota">Aún no has lanzado ninguna actualización desde que abriste el programa.</span>`)
    + `<button class="mini tarea ${E.verTarea === "auto" ? "activa" : ""}" data-id="auto">🕘 Automática</button>`;
  $$(".tarea", lista).forEach((b) => (b.onclick = () => { E.verTarea = b.dataset.id; pintarTareas(); }));
  verRegistro();
}

async function verRegistro() {
  clearTimeout(E.timerLog);
  const c = $("#consola"), id = E.verTarea;
  if (!id) { c.textContent = "Pulsa un botón de arriba y aquí verás, línea a línea, todo lo que hace."; return; }
  let texto, fin = true, titulo;
  if (id === "auto") {
    const a = await api("/api/auto");
    texto = a.texto || "La actualización automática todavía no ha dejado ningún registro.";
    fin = !a.en_marcha; titulo = "Actualización automática " + (a.en_marcha ? "· en marcha…" : "· última");
  } else {
    const t = await api(`/api/tarea/${id}?desde=0`);
    texto = t.lineas.join("\n") || "Empezando…"; fin = t.fin;
    titulo = `${t.titulo} · ${t.segundos}s${t.fin ? (t.rc === 0 ? " · terminado ✅" : " · terminado con avisos ⚠️") : " · en marcha…"}`;
    $("#btnParar").hidden = t.fin;
  }
  if (E.verTarea !== id) return;
  const abajo = c.scrollTop + c.clientHeight >= c.scrollHeight - 40 || c.dataset.id !== id;
  c.textContent = texto; c.dataset.id = id;
  $("#tituloTarea").textContent = titulo;
  if (abajo) c.scrollTop = c.scrollHeight;
  if (!fin && E.vista === "actualizar") E.timerLog = setTimeout(verRegistro, 1500);
}

async function lanzarTarea(tipo) {
  try {
    const r = await api(`/api/${E.comp}/tarea?tipo=${tipo}`, { method: "POST" });
    E.tarea = r.id; E.verTarea = r.id;
    $("#progreso").hidden = false; $("#progresoTxt").textContent = `${nombreComp()}: en marcha…`;
    seguirTarea();
    if (E.vista === "actualizar") pintarTareas();
  } catch (e) { $("#consola").textContent = e.message; }
}

async function actualizarTodas() {
  const r = await api(`/api/todas/tarea?tipo=rapido`, { method: "POST" });
  const ids = (r.tareas || []).map((t) => t.id).filter(Boolean);
  $("#progreso").hidden = false;
  if (ids.length) E.verTarea = ids[0];
  if (E.vista === "actualizar") pintarTareas();
  const mirar = async () => {
    const ts = await Promise.all(ids.map((id) => api(`/api/tarea/${id}?desde=0`)));
    const hechas = ts.filter((t) => t.fin).length;
    $("#progresoTxt").textContent = `Actualizando todas: ${hechas}/${ts.length} terminadas`;
    if (E.vista === "actualizar") pintarTareasSoloLista();
    if (hechas < ts.length) return setTimeout(mirar, 1500);
    $("#progresoTxt").textContent = "Todas las competiciones actualizadas ✅";
    setTimeout(() => ($("#progreso").hidden = true), 4000);
    cargarEstado(); if (E.vista === "pronosticos") cargarPronosticos();
  };
  mirar();
}

async function pintarTareasSoloLista() {
  const lista = $("#listaTareas");
  if (!lista) return;
  const ts = await api("/api/tareas");
  $$(".tarea", lista).forEach((b) => { const t = ts.find((x) => x.id === b.dataset.id); if (t) b.innerHTML = `${t.fin ? (t.rc === 0 ? "✅" : "⚠️") : "⏳"} ${esc(t.inicio)} · ${esc(t.titulo.split(":")[0])} <span class="nota">${esc(t.tipo)}</span>`; });
}

async function seguirTarea() {
  if (!E.tarea) return;
  const t = await api(`/api/tarea/${E.tarea}?desde=${Math.max(0, E.desde || 0)}`);
  E.desde = t.total;
  const ultima = t.lineas.length ? t.lineas[t.lineas.length - 1] : null;
  if (ultima) E.ultimaLinea = ultima;
  $("#progresoTxt").textContent = t.fin ? (t.rc === 0 ? "Actualizado ✅ (predicción guardada en el historial)" : "Terminado con avisos: pulsa «Ver registro»")
    : `${t.titulo.split(":")[0]}: ${(E.ultimaLinea || "en marcha…").slice(0, 90)} (${t.segundos}s)`;
  if (E.vista === "actualizar" && E.verTarea === E.tarea && !E.timerLog) verRegistro();
  if (t.fin) {
    $("#btnParar").hidden = true; $("#btnActualizar").disabled = false; cargarEstado(); E.tarea = null; E.desde = 0;
    setTimeout(() => ($("#progreso").hidden = true), 6000);
    if (E.vista === "pronosticos") cargarPronosticos();
    if (E.vista === "historial") cargarHistorial();
    if (E.vista === "quiniela") cargarQuiniela(true);
    if (E.vista === "actualizar") pintarTareas();
    return;
  }
  setTimeout(seguirTarea, 1000);
}

// ---------------------------------------------------------------- móvil
async function activarMovil() {
  const r = await api("/api/movil/activar", { method: "POST" });
  E.info.ip = r.ip; mostrarComandoMovil();
}
function mostrarComandoMovil() {
  $("#cmdMovil").textContent = `curl -s http://${E.info.ip}:${E.info.puerto_movil}/movil/instalar.sh | bash`;
  $("#btnActivarMovil").textContent = "Conexión activa ✅";
}
async function importarPC() {
  const ip = $("#ipPC").value.trim(); guardar("ipPC", ip);
  $("#resImportar").innerHTML = `<span class="spinner"></span> Descargando del PC…`;
  try {
    const r = await api(`/api/movil/importar?ip=${encodeURIComponent(ip)}`, { method: "POST" });
    $("#resImportar").textContent = `✅ ${r.bases} bases de datos copiadas del PC.`; cargarEstado();
  } catch (e) { $("#resImportar").textContent = "No se pudo conectar: " + e.message; }
}


iniciar().catch((e) => {
  if (window.PBCT_WEB) {   // v2.2: en la web, un aviso claro en vez del error técnico (p. ej. GitHub aún no ha calculado nada)
    document.body.insertAdjacentHTML("beforeend", `<div class="tarjeta" style="margin:24px auto;max-width:560px"><h2>⏳ ${esc(e.message || e)}</h2>
      <p class="nota">Si acabas de actualizar, la primera vez GitHub tarda unos 10-15 minutos en calcularlo todo.</p>
      <p><button class="primario" onclick="location.reload()">⟳ Volver a intentar</button> · <a href="index.html#ligera">Abrir la versión ligera</a></p></div>`);
    return;
  }
  document.body.insertAdjacentHTML("beforeend", `<pre class="consola">${esc(e.stack || e)}</pre>`);
});

// ---------------------------------------------------------------- reloj segundo a segundo y avisos de gol
setInterval(() => {
  $$(".reloj").forEach((r) => {
    const seg = parseFloat(r.dataset.seg);
    if (isNaN(seg) || r.dataset.parado === "1") return;
    const ahora = seg + (Date.now() / 1000 - parseFloat(r.dataset.t));
    const tope = (+r.dataset.per >= 2 ? 90 : 45) * 60;
    const m = Math.floor(ahora / 60), s = Math.floor(ahora % 60);
    r.textContent = ahora > tope ? `${tope / 60}+${Math.floor((ahora - tope) / 60) + 1}'` : `${m}:${String(s).padStart(2, "0")}`;
  });
}, 1000);

const GOLES_VISTOS = {};
function avisarGoles(lista) {
  for (const p of lista) {
    const total = (+p.home.goles || 0) + (+p.away.goles || 0), clave = p.id;
    if (GOLES_VISTOS[clave] != null && total > GOLES_VISTOS[clave] && p.estado.fase === "in") {
      const txt = `⚽ GOL: ${p.home.nombre} ${p.home.goles}-${p.away.goles} ${p.away.nombre}`;
      try { if (window.Notification && Notification.permission === "granted") new Notification(txt); } catch (e) {}
      try { const a = new AudioContext(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch (e) {}
      $("#progreso").hidden = false; $("#progresoTxt").textContent = txt;
      setTimeout(() => ($("#progreso").hidden = true), 8000);
    }
    GOLES_VISTOS[clave] = total;
  }
}
try { if (window.Notification && Notification.permission === "default") document.addEventListener("click", () => Notification.requestPermission(), { once: true }); } catch (e) {}

// ---------------------------------------------------------------- La Quiniela
function bloqueCondicionada(d, Q) {
  const c = d.condicionada;
  if (!c) return `<p class="nota">Elige dobles y/o triples para poder condicionar.</p>`;
  if (c.error) return `<p class="nota">⚠️ ${esc(c.error)}</p>`;
  const r = c.condiciones;
  const caja = (k) => `<label title="${esc(r[k].nombre)}">${{ v: "Variantes", e: "Empates", d: "Doses" }[k]}
    <input id="q_${k}" style="width:4.5em" placeholder="auto" value="${esc(Q["c" + k] || "")}"></label>
    <span class="nota">${r[k].min === r[k].max ? r[k].min : r[k].min + "-" + r[k].max}${r[k].auto ? " (auto)" : ""}</span>`;
  return `<div class="explica"><p>🎯 <b>Quiniela condicionada</b> sobre los partidos ${c.partidos.join(", ")} (los que llevan doble o triple):
      de las ${c.sin_condicion.toLocaleString("es-ES")} apuestas (${n1(c.coste_sin, 2)} €) solo juegas <b>${c.apuestas.toLocaleString("es-ES")}</b>
      (${n1(d.coste, 2)} €), las que cumplen las condiciones. Si el resultado real cumple las condiciones (<b>${pct(c.cobertura, 0)}</b> de las veces según el modelo),
      no pierdes nada respecto a jugarlas todas.</p>
    <div class="fila-controles">${caja("v")}${caja("e")}${caja("d")}
      <button class="mini primario" id="qCondAplicar">Aplicar</button><button class="mini" id="qCondAuto">Automáticas</button></div>
    <p class="nota">Escribe cuántos partidos de esos quieres que acaben en X o 2 («variantes»), en X («empates») o en 2 («doses»): por ejemplo «2-4».
      Vacío = automático (lo más estrecho que recoge el 90 % de lo que dice el modelo). Es lo mismo que el boleto de condicionadas de Loterías.</p></div>`;
}

async function cargarQuiniela(recargar) {
  const cab = $("#quinielaCab"), cu = $("#quinielaCuerpo");
  const Q = E.quin || (E.quin = { dobles: +leer("q_dobles", 0), triples: +leer("q_triples", 0), modo: leer("q_modo", "segura"), red: leer("q_red", "ninguna"),
    cv: leer("q_cv", ""), ce: leer("q_ce", ""), cd: leer("q_cd", "") });
  cab.innerHTML = `<div class="vacio"><span class="spinner"></span> Buscando la quiniela activa y calculando los 15 partidos (puede tardar un poco)…</div>`;
  let d;
  const condQ = Q.red === "cond" ? `&cv=${encodeURIComponent(Q.cv || "")}&ce=${encodeURIComponent(Q.ce || "")}&cd=${encodeURIComponent(Q.cd || "")}` : "";
  try { d = await api(`/api/quiniela?dobles=${Q.dobles}&triples=${Q.triples}&modo=${Q.modo}&reduccion=${Q.red}${condQ}${Q.jornada ? "&jornada=" + Q.jornada : ""}${recargar ? "&recargar=1" : ""}`); }
  catch (e) { d = { error: e.message, filas: [] }; }
  const sel = (id, n, v) => `<select id="${id}">${[...Array(n + 1).keys()].map((i) => `<option ${i === v ? "selected" : ""}>${i}</option>`).join("")}</select>`;
  cab.innerHTML = `<div class="hist-cab"><h2>🎫 La Quiniela ${d.jornada ? "· Jornada " + esc(d.jornada) : ""}</h2>
      <span><button class="mini" id="qDatos" title="Segunda División (motor de LaLiga) y Liga F: bases de datos solo para la quiniela">⟳ Actualizar datos de la quiniela</button>
      <button class="mini" id="qRecargar">⟳ Volver a consultar</button></span></div>
    <div class="chips">${d.fecha ? `<span class="chip">Fecha ${esc(d.fecha)}</span>` : ""}${d.cierre ? `<span class="chip aviso">Cierre ${esc(d.cierre)}</span>` : ""}
      ${d.bote ? `<span class="chip ok">Bote ${esc(d.bote)} €</span>` : ""}<span class="chip">Jornada: ${esc(d.fuente || "no encontrada")}</span>
      <span class="chip">Partidos: ${esc(d.fuente_partidos || "no encontrados")}</span>
      ${(d.otras_jornadas || []).length || Q.jornada ? `<select id="qJornada"><option value="">Jornada activa</option>${(d.otras_jornadas || []).concat(Q.jornada && String(Q.jornada) === String(d.jornada) ? [{ jornada: d.jornada, fecha: d.fecha }] : [])
        .map((j) => `<option value="${j.jornada}" ${String(Q.jornada) === String(j.jornada) ? "selected" : ""}>Jornada ${j.jornada}${j.fecha ? " · " + esc(j.fecha) : ""}</option>`).join("")}</select>` : ""}</div>
    ${d.error ? `<p class="nota">⚠️ ${esc(d.error)}</p>` : ""}
    ${d.bases ? `<p class="nota">Bases propias de la quiniela: Segunda División ${d.bases.segunda ? "✅" : E.info.web ? "⏳ sin descargar (hay que bajarla UNA vez en el programa del PC con «Actualizar datos de la quiniela» y subir los datos; luego GitHub la mantiene sola)" : "⏳ sin descargar (pulsa «Actualizar datos de la quiniela»)"} ·
      Liga F ${d.bases.femenino.partidos ? `✅ ${d.bases.femenino.partidos} partidos de ${d.bases.femenino.equipos} equipos (${esc(d.bases.femenino.fuente || "")}, ${esc(d.bases.femenino.actualizado || "")})` : E.info.web ? "⏳ sin datos todavía (GitHub la descarga sola de ESPN)" : "⏳ sin datos"}
      ${d.bases.femenino.aviso ? " · ⚠️ " + esc(d.bases.femenino.aviso) : ""}</p>` : ""}
    <div class="fila-controles" style="margin-top:10px">
      <label>Estrategia <select id="qModo"><option value="segura" ${Q.modo === "segura" ? "selected" : ""}>Segura (más aciertos)</option><option value="rentable" ${Q.modo === "rentable" ? "selected" : ""}>Rentable (signos que juega poca gente)</option></select></label>
      <label>Reducción oficial <select id="qRed"><option value="ninguna">Ninguna</option><option value="r1" ${Q.red === "r1" ? "selected" : ""}>Reducida 1: 4 triples · 9 apuestas</option><option value="r2" ${Q.red === "r2" ? "selected" : ""}>Reducida 2: 7 dobles · 16 apuestas</option><option value="cond" ${Q.red === "cond" ? "selected" : ""}>Condicionada (variantes, empates, doses)</option></select></label>
      <label>Dobles ${sel("qDobles", 8, Q.dobles)}</label><label>Triples ${sel("qTriples", 6, Q.triples)}</label>
      ${d.apuestas ? `<span class="nota">${d.apuestas} apuesta(s) · ${n1(d.coste, 2)} € (a ${n1(d.precio_apuesta, 2)} € la apuesta)</span>` : ""}</div>
    <div class="fila-controles">${[["Sencilla", 0, 0], ["Segura · 4 dobles", 4, 0], ["Muy segura · 5 dobles + 2 triples", 5, 2], ["Máxima · 6 dobles + 4 triples", 6, 4]]
      .map(([t, dd, tt]) => `<button class="mini ${Q.dobles === dd && Q.triples === tt ? "activa" : ""}" data-d="${dd}" data-t="${tt}">${t} (${n1(2 ** dd * 3 ** tt * (d.precio_apuesta || 0.75), 2)} €)</button>`).join("")}</div>
    ${Q.red === "cond" ? bloqueCondicionada(d, Q) : ""}
    <p class="nota">Los dobles y triples se ponen solos en los partidos más dudosos. Más dobles = más segura, pero más cara.
      ${d.reduccion_nombre && d.reduccion !== "cond" ? `<b>${esc(d.reduccion_nombre)}</b>: si los 14 signos reales están dentro del sistema, tienes 13 aciertos asegurados por mucho menos dinero.` : ""}
      ${d.con_expertos ? " · Comparado con las casas de apuestas y con lo que juega la gente en Loterías (Quiniela15)." : ""}</p>`;
  $$("#quinielaCab [data-d]").forEach((b) => (b.onclick = () => { Q.dobles = +b.dataset.d; Q.triples = +b.dataset.t; guardar("q_dobles", Q.dobles); guardar("q_triples", Q.triples); cargarQuiniela(); }));
  $("#qDobles").onchange = (e) => { Q.dobles = +e.target.value; guardar("q_dobles", Q.dobles); cargarQuiniela(); };
  $("#qTriples").onchange = (e) => { Q.triples = +e.target.value; guardar("q_triples", Q.triples); cargarQuiniela(); };
  $("#qRecargar").onclick = () => cargarQuiniela(true);
  $("#qModo").onchange = (e) => { Q.modo = e.target.value; guardar("q_modo", Q.modo); cargarQuiniela(); };
  $("#qRed").onchange = (e) => { Q.red = e.target.value; guardar("q_red", Q.red); if (Q.red === "cond" && Q.dobles + Q.triples < 3) { Q.dobles = 4; Q.triples = 2; } cargarQuiniela(); };
  const bc = $("#qCondAplicar");
  if (bc) bc.onclick = () => { ["cv", "ce", "cd"].forEach((k) => { Q[k] = $("#q_" + k).value.trim(); guardar("q_" + k, Q[k]); }); cargarQuiniela(); };
  const ba = $("#qCondAuto");
  if (ba) ba.onclick = () => { ["cv", "ce", "cd"].forEach((k) => { Q[k] = ""; guardar("q_" + k, ""); }); cargarQuiniela(); };
  $("#qDatos").onclick = async () => {
    const r = await api("/api/quiniela/actualizar", { method: "POST" });
    if (r.tarea && r.tarea.id) { E.tarea = r.tarea.id; E.verTarea = r.tarea.id; E.desde = 0; $("#progreso").hidden = false;
      $("#progresoTxt").textContent = "Actualizando Segunda División y Liga F para la quiniela…"; seguirTarea(); }
    else if (r.tarea && r.tarea.error) { $("#progreso").hidden = false; $("#progresoTxt").textContent = r.tarea.error; }
  };
  const qj = $("#qJornada"); if (qj) qj.onchange = (e) => { Q.jornada = e.target.value; cargarQuiniela(); };
  const manual = `<details class="tarjeta" ${d.filas && d.filas.length ? "" : "open"}><summary>✍️ Escribir o pegar los partidos a mano</summary>
      <p class="nota">Si la web de Loterías no deja leer los partidos, pégalos aquí: un partido por línea, «Local - Visitante» (15 líneas, el 15 es el Pleno al 15).</p>
      <textarea id="qTexto" rows="8" style="width:100%" placeholder="Real Madrid - Getafe&#10;Sevilla - Betis&#10;…">${esc((d.filas || []).map((f) => f.local + " - " + f.visitante).join("\n"))}</textarea>
      <button class="primario" id="qGuardar">Guardar y calcular</button></details>`;
  if (!d.filas || !d.filas.length) { cu.innerHTML = manual; ligarManual(d); return; }
  const s = d.simulacion || {};
  const colores = (f) => f.p.map((x, i) => `<div style="width:${Math.max(x * 100, 1).toFixed(1)}%;background:var(${["--local", "--empate", "--visit"][i]})" title="${"1X2"[i]} ${pct(x, 0)}">${x > 0.14 ? pct(x, 0) : ""}</div>`).join("");
  const topc = (s.top_columnas || []);
  cu.innerHTML = `<div class="tarjeta"><h3>Pronóstico</h3><div class="desplaza"><table class="tabla quiniela">
      <tr><th>#</th><th>Partido</th><th>1 · X · 2</th><th class="d">Signo</th><th>Seguridad</th><th>Lo que juega la gente (LAE)</th><th>De dónde sale</th></tr>
      ${d.filas.map((f) => `<tr class="${f.n === 15 ? "pleno" : ""}"><td class="d"><b>${f.n}</b></td><td><b>${esc(f.local)}</b> – <b>${esc(f.visitante)}</b>${f.nombre_modelo ? `<br><span class="nota">${esc(f.nombre_modelo)}${f.fecha ? " · " + esc(fechaLarga(f.fecha)) + " " + esc(f.hora || "") : ""}</span>` : ""}</td>
        <td style="min-width:180px"><div class="barra1x2 mini">${colores(f)}</div></td>
        <td class="d">${f.n === 15 && f.pleno ? `<span class="signo">${esc(f.pleno.signo)}</span><br><span class="nota">Pleno ${pct(f.pleno.prob, 0)}</span>` : `<span class="signo ${f.tipo}">${esc(f.signo)}</span>`}</td>
        <td><div class="medidor"><i class="${f.fiabilidad >= 0.6 ? "ok" : f.fiabilidad >= 0.45 ? "aviso" : "mal"}" style="width:${(f.fiabilidad * 100).toFixed(0)}%"></i></div>
          <span class="nota">${pct(f.fiabilidad, 0)} · ${esc(f.seguridad)}</span></td>
        <td class="nota">${f.lae ? f.lae.map((x, i) => `<span class="${f.valor && f.valor[i] >= 1.25 ? "verde" : ""}" title="valor ${f.valor ? f.valor[i] : ""}">${"1X2"[i]} ${pct(x, 0)}</span>`).join(" · ") + (f.rentable ? " 💰" : "") : "–"}</td>
        <td class="nota">${f.sin_datos ? "⚠️ " : ""}${esc(f.fuente)}${f.comp && f.partido_id ? ` <button class="mini enlaceq" data-comp="${f.comp}" data-id="${f.partido_id}">ver</button>` : ""}</td></tr>`).join("")}
    </table></div></div>
    <div class="tarjeta"><h3>🎲 ${s.n ? s.n.toLocaleString("es-ES") : ""} quinielas simuladas con estos signos</h3>
      <div class="mercados">
        <div class="mercado"><div class="n">Aciertos esperados (de 14)</div><div class="v">${n1(s.media, 1)}</div></div>
        <div class="mercado"><div class="n">10 o más</div><div class="v">${pct(s.p10, 1)}</div></div>
        <div class="mercado"><div class="n">12 o más</div><div class="v">${pct(s.p12, 1)}</div></div>
        <div class="mercado"><div class="n">13 o más</div><div class="v">${pct(s.p13, 2)}</div></div>
        <div class="mercado"><div class="n">14 aciertos</div><div class="v">1 entre ${s.uno_entre_14 ? s.uno_entre_14.toLocaleString("es-ES") : "–"}</div></div>
        <div class="mercado"><div class="n">14 + Pleno al 15</div><div class="v">1 entre ${s.uno_entre_15 ? s.uno_entre_15.toLocaleString("es-ES") : "–"}</div></div>
        <div class="mercado"><div class="n">Seguridad media por partido</div><div class="v">${pct(d.fiabilidad_media, 0)}</div></div></div>
      <div class="histo">${(s.distribucion || []).map((v, k) => `<div title="${k} aciertos: ${v} veces"><i style="height:${Math.max(2, (v / Math.max(...s.distribucion)) * 100)}%"></i><span>${k}</span></div>`).join("")}</div>
      <p class="nota">Cuántas de las ${s.n ? s.n.toLocaleString("es-ES") : ""} jornadas simuladas sacaron cada número de aciertos con estos signos. Mejor resultado simulado: ${s.mejor} aciertos (${(s.veces14 || 0).toLocaleString("es-ES")} veces 14).</p>
      <h3 style="margin-top:14px">🔁 Columnas sencillas que más se repetirían</h3>
      <div class="desplaza"><table class="tabla"><tr><th>#</th><th>Columna (partidos 1 a 14)</th><th>Cambia respecto a la 1ª</th><th class="d">Probabilidad de 14</th>${topc.length && topc[0].indice != null ? `<th class="d" title="Lo que devuelve a la larga comparado con una columna media de las que juega la gente: >1 = mejor que la media">Rentabilidad</th>` : ""}</tr>
        ${topc.map((c, i) => `<tr><td>${i + 1}</td><td><code class="columna">${esc(c.columna)}</code></td><td class="nota">${c.cambios.length ? "partido " + c.cambios.join(" y ") : "—  la de los signos más probables"}</td><td class="d">1 entre ${c.uno_entre.toLocaleString("es-ES")}</td>${c.indice != null ? `<td class="d">×${n1(c.indice, 2)}</td>` : ""}</tr>`).join("")}</table></div>
      ${s.columna_rentable ? `<h3 style="margin-top:14px">💰 Columna rentable (la que más paga para lo probable que es)</h3>
        <p><code class="columna">${esc(s.columna_rentable.columna)}</code> · 1 entre ${s.columna_rentable.uno_entre.toLocaleString("es-ES")} · rentabilidad ×${n1(s.columna_rentable.indice, 2)} respecto a la columna media que juega la gente
        (la 1ª columna: ×${n1(s.columna_rentable.indice_base, 2)})${s.columna_rentable.cambios.length ? " · cambia los partidos " + s.columna_rentable.cambios.join(", ") : ""}</p>
        <p class="nota">Acierta algo menos que la 1ª, pero si aciertas compartes el premio con mucha menos gente. Es lo que hacen los peñistas profesionales:
          no jugar lo que juega todo el mundo. A la larga solo compensa en jornadas con bote.</p>` : ""}
      <p class="nota">La 1ª ya es «lo mejor de cada partido»: no hay ninguna columna que se repita más. Aun así, acertar los 14 es muy improbable porque las probabilidades se multiplican
        (14 partidos al 50 % = 1 entre 16.384). Los dobles y triples suben esa probabilidad; la seguridad de cada partido es lo que más importa.</p></div>
    <div class="tarjeta" id="qDinero"></div>
    ${manual}`;
  ligarManual(d);
  pintarQDinero(d);
  cargarHistQuinielas();
  $$(".enlaceq", cu).forEach((b) => (b.onclick = () => { cambiarComp(b.dataset.comp); setTimeout(() => abrirPartido(+b.dataset.id), 800); }));
}

// ---- v2.0.3: La Quiniela según tu dinero (dobles y triples donde más suben las probabilidades) ----
const PRECIO_Q = 0.75;
function distAciertos(q) {           // probabilidad de 0..14 aciertos (cada partido acierta con prob. q[i])
  let d = [1];
  for (const x of q) { const n = new Array(d.length + 1).fill(0); d.forEach((v, k) => { n[k] += v * (1 - x); n[k + 1] += v * x; }); d = n; }
  return d;
}
function quinielaSegunDinero(filas, euros, objetivo) {
  const F = (filas || []).filter((f) => f.n <= 14 && f.p && f.p.length === 3).slice(0, 14);
  if (F.length < 14) return null;
  const N = Math.floor(euros / PRECIO_Q + 1e-9);
  if (N < 2) return { error: `Con ${String(euros).replace(".", ",")} € no llega: el mínimo son 2 apuestas (1,50 €).` };
  const P = F.map((f) => { const s = f.p[0] + f.p[1] + f.p[2]; return f.p.map((x) => x / s); });
  const ord = P.map((p) => [0, 1, 2].sort((a, b) => p[b] - p[a]));
  const Q = P.map((p, i) => [p[ord[i][0]], p[ord[i][0]] + p[ord[i][1]], 1]);   // cubre: sencillo, doble, triple
  const med = (tipos) => { const q = tipos.map((t, i) => Q[i][t]); const d = distAciertos(q);
    const desde = (k) => d.slice(k).reduce((a, b) => a + b, 0);
    return { p10: desde(10), p12: desde(12), p13: desde(13), p14: d[14], media: q.reduce((a, b) => a + b, 0) }; };
  let mejor = null;
  for (let t = 0; 3 ** t <= N && t <= 14; t++) {
    for (let d = 0; 2 ** d * 3 ** t <= N && d + t <= 14; d++) {
      const coste = 2 ** d * 3 ** t;
      if (coste < 2) continue;
      // reparto que maximiza los 14 (producto de lo que cubre cada partido): programación dinámica
      const L = Q.map((q) => q.map((x) => Math.log(Math.max(x, 1e-12))));
      let dp = new Map([["0,0", { v: 0, tipos: [] }]]);
      for (let i = 0; i < 14; i++) {
        const nd = new Map();
        for (const [k, st] of dp) {
          const [a, b] = k.split(",").map(Number);
          for (const [tp, da, db] of [[0, 0, 0], [1, 1, 0], [2, 0, 1]]) {
            if (a + da > d || b + db > t) continue;
            const kk = `${a + da},${b + db}`, v = st.v + L[i][tp];
            if (!nd.has(kk) || nd.get(kk).v < v) nd.set(kk, { v, tipos: st.tipos.concat([tp]) });
          }
        }
        dp = nd;
      }
      const fin = dp.get(`${d},${t}`);
      if (!fin) continue;
      let tipos = fin.tipos, m = med(tipos);
      if (objetivo !== "p14") {      // para 10 o 12 aciertos, a veces conviene cambiar dónde van: búsqueda local
        let mejora = true;
        while (mejora) {
          mejora = false;
          for (let i = 0; i < 14; i++) for (let j = 0; j < 14; j++) {
            if (tipos[i] === tipos[j]) continue;
            const pr = tipos.slice(); [pr[i], pr[j]] = [pr[j], pr[i]];
            const mm = med(pr);
            if (mm[objetivo] > m[objetivo] + 1e-9) { tipos = pr; m = mm; mejora = true; }
          }
        }
      }
      const r = { dobles: d, triples: t, apuestas: coste, coste: coste * PRECIO_Q, tipos, ...m };
      if (!mejor || r[objetivo] > mejor[objetivo] + 1e-12 || (Math.abs(r[objetivo] - mejor[objetivo]) < 1e-12 && r.coste < mejor.coste)) mejor = r;
    }
  }
  if (!mejor) return null;
  mejor.signos = mejor.tipos.map((tp, i) => tp === 2 ? "1X2" : ord[i].slice(0, tp + 1).sort().map((k) => "1X2"[k]).join(""));
  mejor.filas = F;
  return mejor;
}
function htmlQuinielaDinero(r, objetivo) {
  if (!r) return `<p class="nota">Faltan partidos con probabilidades para calcularla.</p>`;
  if (r.error) return `<p class="nota">⚠️ ${esc(r.error)}</p>`;
  const fmt = (x) => (x == null ? "–" : x >= 0.01 ? Math.round(x * 100) + "%" : x > 0 ? "1 de " + Math.round(1 / x).toLocaleString("es-ES") : "0%");
  const nom = { p10: "10 o más aciertos", p12: "12 o más aciertos", p14: "los 14" };
  return `<p><b>${r.dobles} doble${r.dobles === 1 ? "" : "s"}${r.triples ? ` y ${r.triples} triple${r.triples === 1 ? "" : "s"}` : ""}</b> = ${r.apuestas} apuestas = <b>${r.coste.toFixed(2).replace(".", ",")} €</b>
      <span class="nota">(lo que más sube «${nom[objetivo]}» con tu dinero)</span></p>
    <div class="cifras"><div>10 o más<b>${fmt(r.p10)}</b></div><div>12 o más<b>${fmt(r.p12)}</b></div><div>14<b>${fmt(r.p14)}</b></div></div>
    <table class="tabla" style="margin-top:8px"><tr><th>#</th><th>Partido</th><th class="d">Signo</th></tr>
    ${r.filas.map((f, i) => `<tr><td>${f.n}</td><td>${esc(f.local)} – ${esc(f.visitante)}</td><td class="d"><b class="signo">${r.signos[i]}</b>${r.tipos[i] ? ` <span class="nota">${r.tipos[i] === 2 ? "triple" : "doble"}</span>` : ""}</td></tr>`).join("")}</table>
    <p class="nota">Aciertos esperados: ${r.media.toFixed(1).replace(".", ",")} de 14. El Pleno al 15 es aparte (el de la quiniela del programa).</p>`;
}
function htmlExamenQuiniela(e) {
  if (!e || !e.resumen || !e.resumen.jornadas) return `<p class="nota">Todavía no hay jornadas comprobadas para el examen.</p>`;
  const R = e.resumen, pc = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  const tabla = (tit, obj, cols) => { const en = Object.entries(obj || {}); return en.length ? `<h4 style="margin:10px 0 4px">${tit}</h4><table class="tabla">
    <tr><th></th><th class="d">Partidos</th><th class="d">Acierta</th><th class="d">Decía</th></tr>
    ${en.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="d">${v.n}</td><td class="d">${pc(v.acierto)}</td><td class="d">${pc(v.dice)}</td></tr>`).join("")}</table>` : ""; };
  return `<div class="cifras"><div>Jornadas<b>${R.jornadas}</b></div><div>Aciertos de media<b>${R.media.toFixed(1).replace(".", ",")}</b></div><div>Esperaba<b>${R.esperada.toFixed(1).replace(".", ",")}</b></div></div>
    ${(e.avisos || []).map((a) => `<p class="nota">⚠️ ${esc(a)}</p>`).join("")}
    <table class="tabla" style="margin-top:8px"><tr><th>Jornada</th><th class="d">Aciertos</th><th class="d">Esperados</th><th class="d">Apuestas</th></tr>
      ${e.jornadas.slice().reverse().map((j) => `<tr><td>J${esc(j.jornada)} <span class="nota">${esc(j.fecha || "")}</span></td><td class="d"><b>${j.aciertos}</b></td><td class="d">${String(j.esperados).replace(".", ",")}</td><td class="d">${j.apuestas ?? "–"}</td></tr>`).join("")}</table>
    ${tabla("Por signo que pusiste (sencillos)", e.por_puesto)}
    <h4 style="margin:10px 0 4px">Signos que salieron: cuántos cubrió la quiniela</h4><table class="tabla"><tr><th></th><th class="d">Salieron</th><th class="d">Cubiertos</th><th class="d">Prob. media que le daba</th></tr>
      ${Object.entries(e.por_real || {}).map(([k, v]) => `<tr><td><b class="signo">${esc(k)}</b></td><td class="d">${v.n}</td><td class="d">${v.cubiertos} (${pc(v.cubierto)})</td><td class="d">${pc(v.esperado / v.n)}</td></tr>`).join("")}</table>
    ${tabla("Por liga", e.por_liga)}${tabla("Sencillos, dobles y triples", e.por_tipo)}
    <p class="nota">«Decía» = probabilidad media que daba a lo que puso. Si acierta mucho menos de lo que decía en una liga, esos partidos están mal calculados.</p>`;
}

function pintarQDinero(d) {
  const el = $("#qDinero");
  if (!el) return;
  const eu = leer("qd_euros", "3"), ob = leer("qd_obj", "p10");
  el.innerHTML = `<h3>💶 La Quiniela según tu dinero</h3>
    <div class="fila-controles"><label>Tengo (€) <input id="qdEuros" inputmode="decimal" style="width:5em" value="${esc(eu)}"></label>
      <label>Quiero subir <select id="qdObj"><option value="p10" ${ob === "p10" ? "selected" : ""}>10 o más aciertos</option><option value="p12" ${ob === "p12" ? "selected" : ""}>12 o más aciertos</option><option value="p14" ${ob === "p14" ? "selected" : ""}>los 14</option></select></label></div>
    <div id="qdRes"></div>`;
  const calc = () => { const e = parseFloat(($("#qdEuros").value || "").replace(",", ".")) || 0, o = $("#qdObj").value;
    guardar("qd_euros", $("#qdEuros").value); guardar("qd_obj", o); $("#qdRes").innerHTML = htmlQuinielaDinero(quinielaSegunDinero(d.filas, e, o), o); };
  $("#qdEuros").oninput = calc; $("#qdObj").onchange = calc; calc();
}

function ligarManual(d) {
  const b = $("#qGuardar");
  if (b) b.onclick = async () => {
    await api("/api/quiniela/manual", { method: "POST", body: JSON.stringify({ texto: $("#qTexto").value, jornada: d.jornada }) });
    cargarQuiniela(true);
  };
}


// ---------------------------------------------------------------- combinada de los partidos más seguros de cada liga
async function cargarCombinada(recargar) {
  const el = $("#combinada");
  const C = E.combi || (E.combi = { dias: +leer("combi_dias", 3), sel: 2 });
  el.innerHTML = `<div class="tarjeta"><div class="vacio"><span class="spinner"></span> Calculando todas las ligas (la primera vez tarda un poco)…</div></div>`;
  let d;
  try { d = await api(`/api/combinada?dias=${C.dias}${recargar ? "&recargar=1" : ""}`); } catch (e) { el.innerHTML = `<div class="tarjeta"><p class="nota">${esc(e.message)}</p></div>`; return; }
  if (d.error) { el.innerHTML = `<div class="tarjeta"><p class="nota">⚠️ ${esc(d.error)}</p></div>`; return; }
  const combis = d.combinadas || [];
  const c = combis.find((x) => x.n === C.sel) || combis[0];
  const fila = (p) => `<tr><td class="nota">${esc(p.liga)}</td><td><b>${esc(p.home)}${puestoTxt(p.puestos, 0)} – ${esc(p.away)}${puestoTxt(p.puestos, 1)}</b><br><span class="nota">${esc(fechaLarga(p.fecha))} ${esc(p.hora || "")}</span>${(p.avisos || []).map((a) => `<br><span class="nota aviso-${esc(a.tipo)}">${a.icono} ${esc(a.texto)}</span>`).join("")}</td>
    <td>🛡️ ${esc(p.apuesta)}</td><td class="d">${pct(p.prob, 0)}${p.p10 != null ? `<br><span class="nota">peor esc. ${pct(p.p10, 0)}</span>` : ""}</td>
    <td class="d">${n1(p.cuota, 2)}<br><span class="nota">${p.cuota_real ? "real" : "estimada"}</span></td>
    <td><span class="chip ${nivelCls(p.nivel)}">${esc(p.nivel || "")} ${n1(p.fiabilidad, 0)}</span></td>
    <td><button class="mini irq" data-comp="${p.comp}" data-id="${p.id}">ver</button></td></tr>`;
  el.innerHTML = `<div class="tarjeta"><div class="hist-cab"><h2>🧩 Combinada segura · el partido más seguro de cada liga</h2>
      <div class="fila-controles"><label>Partidos de <select id="cDias">${[[1, "hoy y mañana"], [3, "los próximos 3 días"], [7, "la próxima semana"]].map(([v, t]) => `<option value="${v}" ${C.dias === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="mini" id="cRecargar">⟳ Recalcular</button></div></div>
    ${combis.length ? `<nav class="subpestanas">${combis.map((x) => `<button data-n="${x.n}" class="${c && c.n === x.n ? "activa" : ""}">${x.n} partidos · ${pct(x.prob, 0)} · @${n1(x.cuota, 2)}</button>`).join("")}</nav>` : ""}
    ${c ? `<div class="mercados">
        <div class="mercado"><div class="n">Probabilidad de acertar TODA</div><div class="v">${pct(c.prob, 0)}</div></div>
        <div class="mercado"><div class="n">Sale 1 de cada</div><div class="v">${n1(c.uno_de_cada, 1)} veces</div></div>
        <div class="mercado"><div class="n">Cuota ${esc(d.casa || "Bet365")} ${c.cuotas_reales ? "(real)" : "(aprox.)"}</div><div class="v">@ ${n1(c.cuota, 2)}</div></div>
        <div class="mercado"><div class="n">Cuota justa</div><div class="v">${n1(c.cuota_justa, 2)}</div></div>
        <div class="mercado"><div class="n">Con 2 € cobras</div><div class="v">${n1(c.cobras_2, 2)} €</div></div>
        <div class="mercado"><div class="n">Con 4 € cobras</div><div class="v">${n1(c.cobras_4, 2)} €</div></div></div>
      <div class="desplaza"><table class="tabla"><tr><th>Liga</th><th>Partido</th><th>Apuesta</th><th class="d">Prob.</th><th class="d">Cuota</th><th>Fiabilidad</th><th></th></tr>
        ${c.piernas.map(fila).join("")}</table></div>
      ${btnJugada(c.piernas.map((p) => ({ comp: p.comp, partido_id: p.id, fecha: p.fecha, home: p.home, away: p.away, clave: p.clave, mercado: p.apuesta, prob: p.prob })), c.cuota, "combinada")}
      <p class="nota">${c.ev > 0.02 ? "✅ Con estas cuotas la combinada paga más de lo que vale." : c.ev > -0.06 ? "➖ Cuota más o menos justa." : "❌ La cuota paga menos de lo que vale: es normal en combinadas, porque el margen de la casa se multiplica en cada partido."}
        Ojo: la combinada solo se cobra si aciertas TODOS. Con ${c.n} partidos al ${pct(Math.pow(c.prob, 1 / c.n), 0)} de media, la acertarías ${pct(c.prob, 0)} de las veces.
        ${c.n >= 4 ? "Con 4 partidos el margen de Bet365 se come mucho: mejor 2 o 3." : ""}</p>`
      : `<p class="nota">No hay suficientes partidos en ${C.dias === 1 ? "hoy y mañana" : `los próximos ${C.dias} días`} en ligas distintas. Prueba con más días.</p>`}
  </div>
  ${d.aviso_examen ? `<div class="tarjeta"><div class="veredicto sin_valor">❌ <b>Examen:</b> ${esc(d.aviso_examen)}. Las combinadas que propone la app están fallando más de lo que prometen: juega poco o ninguna.</div></div>` : ""}
  ${(d.quitadas_examen || []).length ? `<details class="tarjeta"><summary>❌ Quitadas por el examen (${d.quitadas_examen.length})</summary>
    <ul class="lista-simple">${d.quitadas_examen.map((q) => `<li><b>${esc(q.home)} – ${esc(q.away)}</b> <span class="nota">${esc(q.liga)}</span>: ${esc(q.apuesta || "")}<br><span class="nota">${esc(q.motivo)}</span></li>`).join("")}</ul>
    <p class="nota">El examen de la app (últimos 6 meses, 40 apuestas o más) demuestra que este tipo de segura acierta bastante menos de lo que dice: no se mete en la combinada.</p></details>` : ""}
  <details class="tarjeta"><summary>📋 Los más seguros de cada liga (${(d.candidatos || []).length})</summary>
    <div class="desplaza"><table class="tabla"><tr><th>Liga</th><th>Partido</th><th>Apuesta</th><th class="d">Prob.</th><th class="d">Cuota</th><th>Fiabilidad</th><th></th></tr>
    ${(d.candidatos || []).map(fila).join("")}</table></div>
    <p class="nota">Hasta 3 por liga: primero los que no tienen avisos (contra la clasificación, cansancio por Europa, entrenador nuevo, motivación) y luego de más a menos fiables. La combinada usa el primero de cada liga, para que no dependan unos de otros. Calculado ${esc(d.consultado || "")}.</p></details>`;
  $("#cDias").onchange = (e) => { C.dias = +e.target.value; guardar("combi_dias", C.dias); cargarCombinada(); };
  $("#cRecargar").onclick = () => cargarCombinada(true);
  $$("#combinada .subpestanas button").forEach((b) => (b.onclick = () => { C.sel = +b.dataset.n; cargarCombinada(); }));
  $$("#combinada .irq").forEach((b) => (b.onclick = () => { cambiarComp(b.dataset.comp); setTimeout(() => abrirPartido(+b.dataset.id), 800); }));
}

function ultimasPorJornada(lista) {
  const vistas = new Map();
  for (const q of lista) {               // vienen de la más nueva a la más antigua
    const k = `${q.jornada}|${q.fecha}`;
    if (!vistas.has(k)) vistas.set(k, { ...q, versiones: 1 });
    else vistas.get(k).versiones++;
  }
  return [...vistas.values()];
}
function subQuiniela(modo) {
  E.qSub = modo;
  $("#v-quiniela").classList.toggle("q-hist", modo === "hist");
  $$("#qSub button").forEach((b) => b.classList.toggle("activa", b.dataset.q === modo));
  if (modo === "hist") cargarHistQuinielas();
}
$$("#qSub button").forEach((b) => (b.onclick = () => subQuiniela(b.dataset.q)));
async function cargarHistQuinielas() {
  const el = $("#quinielaHist");
  el.innerHTML = `<h3>📚 Historial de quinielas</h3><div class="vacio"><span class="spinner"></span> Comprobando resultados oficiales…</div>`;
  let h;
  try { h = await api("/api/quiniela/historial"); } catch (e) { el.innerHTML = `<h3>📚 Historial de quinielas</h3><p class="nota">${esc(e.message)}</p>`; return; }
  const r = h.resumen;
  const fila = (q) => {
    const real = (q.resultado || {}).signos || (q.parcial || {}).signos || {};
    const celdas = q.filas.slice(0, 14).map((f) => {
      const s = real[f.n], ok = s ? f.signo.includes(s) : null;
      return `<td class="qcel ${ok == null ? "" : ok ? "bien" : "mal"}" title="${esc(f.local)} - ${esc(f.visitante)}${s ? " · salió " + s : ""}">${esc(f.signo)}${s && !ok ? `<small>${esc(s)}</small>` : ""}</td>`;
    }).join("");
    const pl = q.pleno ? `<td class="qcel ${q.pleno_ok == null ? "" : q.pleno_ok ? "bien" : "mal"}" title="Pleno al 15${(q.resultado || {}).pleno ? " · salió " + q.resultado.pleno : ""}">${esc(q.pleno)}</td>` : "<td>–</td>";
    return `<tr><td><b>J${esc(q.jornada)}</b><br><span class="nota">${esc(q.fecha || "")}</span></td><td class="nota">${esc(q.momento.slice(5, 16))}<br>${q.apuestas} ap. · v${esc(q.version)}${q.versiones > 1 ? ` · ${q.versiones} versiones` : ""}</td>${celdas}${pl}
      <td class="d"><b>${q.aciertos != null ? q.aciertos + "/14" : q.parcial ? `${q.parcial.aciertos}/${q.parcial.jugados}` : "⏳"}</b>${q.pleno_ok ? " +P15" : ""}
        ${q.aciertos == null && q.parcial ? `<br><span class="nota">${q.parcial.jugados} de 14 jugados</span>` : ""}
        <br><span class="nota">esperados ${n1(q.media, 1)}</span>
        ${q.aciertos == null ? `<br><button class="mini qres" data-id="${q.id}" title="Si Loterías no responde, escribe tú los signos que salieron">✍️ Poner resultado</button>` : (q.resultado || {}).url === "escrito a mano" ? `<br><span class="nota">✍️ a mano</span>` : (q.resultado || {}).url && !String(q.resultado.url).startsWith("http") ? `<br><span class="nota">${esc(q.resultado.url)}</span>` : ""}</td></tr>
      ${q.aciertos == null && q.parcial && (q.parcial.faltan || []).length ? `<tr class="qfalta"><td colspan="18" class="nota">
        ${q.parcial.lae_ok ? "" : "⚠️ Loterías no ha respondido. "}Comprobados con: ${esc((q.parcial.fuentes || []).join(", ") || "nada")}.
        ${q.parcial.faltan.map((x) => `<br>❓ <b>${x.n}. ${esc(x.partido)}</b>: ${esc(x.motivo)}`).join("")}</td></tr>` : ""}`;
  };
  el.innerHTML = `<h3>📚 Historial de quinielas</h3>
    ${r.jugadas ? `<div class="mercados"><div class="mercado"><div class="n">Jornadas comprobadas</div><div class="v">${r.jugadas}</div></div>
      <div class="mercado"><div class="n">Aciertos de media</div><div class="v">${n1(r.media, 1)} / 14</div></div>
      <div class="mercado"><div class="n">Mejor jornada</div><div class="v">${r.mejor} / 14</div></div>
      <div class="mercado"><div class="n">Jornadas con 10 o más</div><div class="v">${r.diez_o_mas}</div></div></div>` : ""}
    ${h.quinielas.length ? `<div class="fila-controles"><label><input type="checkbox" id="qHistTodas" ${E.qHistTodas ? "checked" : ""}> Ver todas las versiones guardadas (si no, solo la última de cada jornada)</label></div>
      <div class="desplaza"><table class="tabla qhist"><tr><th>Jornada</th><th>Guardada</th>${[...Array(14).keys()].map((i) => `<th class="d">${i + 1}</th>`).join("")}<th>P15</th><th class="d">Aciertos</th></tr>
      ${(E.qHistTodas ? h.quinielas : ultimasPorJornada(h.quinielas)).map(fila).join("")}</table></div>
      <p class="nota">Cada quiniela distinta que calcula el programa se guarda con su fecha y hora. Cuando Loterías publica los resultados se comprueba sola: verde = acertado, rojo = fallado (con el signo que salió).
        Si Loterías no responde, se usan los resultados que ya tiene el programa (LaLiga, Segunda, Premier…) y, si falta alguno, puedes escribirlos con «✍️ Poner resultado».</p>`
      : `<p class="nota">Todavía no hay quinielas guardadas: se guardan solas cada vez que abres esta pestaña con una jornada nueva.</p>`}`;
  const cb = $("#qHistTodas");
  if (cb) cb.onchange = () => { E.qHistTodas = cb.checked; cargarHistQuinielas(); };
  el.insertAdjacentHTML("beforeend", `<h3 style="margin-top:18px">🧪 Examen de la quiniela</h3><div id="qExamen"><div class="vacio"><span class="spinner"></span></div></div>`);
  api("/api/quiniela/examen").then((e) => { const x = $("#qExamen"); if (x) x.innerHTML = htmlExamenQuiniela(e); }).catch(() => {});
  $$("#quinielaHist .qres").forEach((b) => (b.onclick = async () => {
    const qq = h.quinielas.find((x) => x.id === +b.dataset.id) || {}, par = (qq.parcial || {}).signos || {};
    const pre = [...Array(14).keys()].map((i) => par[i + 1] || "?").join("");
    const sg = prompt("Los 14 signos que salieron, en orden. Los que ya se saben están puestos: cambia solo las «?» (por ejemplo 1X21121X211X12):", pre.includes("1") || pre.includes("X") || pre.includes("2") ? pre : "");
    if (!sg) return;
    const pl = prompt("Pleno al 15 (por ejemplo 2-1, M-0). Déjalo vacío si no lo sabes:") || "";
    const r = await api("/api/quiniela/resultado", { method: "POST", body: JSON.stringify({ id: +b.dataset.id, signos: sg, pleno: pl }) });
    if (r.error) alert(r.error);
    cargarHistQuinielas();
  }));
}

// ---------------------------------------------------------------- 💰 Mis apuestas: diario y presupuesto (v1.9.2)
function btnJugada(piernas, cuota, tipo) {
  const datos = encodeURIComponent(JSON.stringify({ piernas, cuota: cuota || "", tipo: tipo || "" }));
  return `<button class="mini jugada" data-j="${datos}" title="Apúntala en tu diario: se comprobará sola cuando acabe el partido">✅ La he jugado</button>`;
}

function abrirApuntar(d) {
  let m = $("#modalApuntar");
  if (!m) { m = document.createElement("div"); m.id = "modalApuntar"; m.className = "modal"; document.body.appendChild(m); }
  const piernas = d.piernas || [];
  m.innerHTML = `<div class="modal-caja"><h3>✅ Apuntar en mi diario</h3>
    ${piernas.length ? `<ul class="lista-simple">${piernas.map((p) => `<li><b>${esc(p.mercado)}</b>${p.home ? ` <span class="nota">${esc(p.home)} – ${esc(p.away)}</span>` : ""}${p.prob ? ` <span class="nota">(${pct(p.prob, 0)})</span>` : ""}</li>`).join("")}</ul>`
      : `<label>¿Qué apostaste? <input id="apDesc" placeholder="Ej.: Betis o empate + más de 1.5 goles" style="width:100%"></label>
         <label>Fecha del partido <input id="apFecha" type="date" value="${fechaLocal()}"></label>`}
    <div class="fila-controles">
      <label>Cuota <input id="apCuota" inputmode="decimal" style="width:6em" value="${esc(String(d.cuota || "").replace(".", ","))}" placeholder="1,85"></label>
      <label>Apostado (€) <input id="apStake" inputmode="decimal" style="width:6em" value="${esc(leer("ap_stake", "2"))}"></label>
      <label>Casa <select id="apCasa"><option ${E.casa !== "versus" ? "selected" : ""}>Bet365</option><option ${E.casa === "versus" ? "selected" : ""}>Versus</option><option>Otra</option></select></label></div>
    <label>Nota (opcional) <input id="apNota" style="width:100%" placeholder="Ej.: la vi en el canal del tipster"></label>
    <p class="nota" id="apMsg">${piernas.some((p) => p.partido_id && p.clave) ? "Se comprobará sola cuando acabe el partido." : "Como la escribes tú, cuando acabe la marcas como ganada o perdida en el diario."}</p>
    <div class="fila-controles"><button class="primario" id="apOk">Guardar</button><button id="apNo">Cancelar</button></div></div>`;
  m.hidden = false;
  $("#apNo").onclick = () => (m.hidden = true);
  m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  $("#apOk").onclick = async () => {
    const cuerpo = { piernas, tipo: d.tipo || undefined, cuota: $("#apCuota").value, stake: $("#apStake").value, casa: $("#apCasa").value,
      nota: $("#apNota").value, descripcion: $("#apDesc") ? $("#apDesc").value : undefined, fecha: $("#apFecha") ? $("#apFecha").value : undefined };
    let r;
    try { r = await api("/api/diario", { method: "POST", body: JSON.stringify(cuerpo) }); } catch (e) { r = { error: e.message }; }
    if (r.error) { $("#apMsg").textContent = "⚠️ " + r.error; return; }
    guardar("ap_stake", $("#apStake").value);
    m.innerHTML = `<div class="modal-caja"><h3>✅ Apuntada</h3><p>La tienes en <b>💰 Mis apuestas</b>.</p><button class="primario" id="apCerrar">Vale</button></div>`;
    $("#apCerrar").onclick = () => (m.hidden = true);
    if (E.vista === "apuestas") cargarMisApuestas();
  };
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".jugada");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { abrirApuntar(JSON.parse(decodeURIComponent(b.dataset.j))); } catch (x) { abrirApuntar({ piernas: [] }); }
});

const euro = (x) => (x == null ? "–" : `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(2).replace(".", ",")} €`);
const euroS = (x) => (x == null ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2).replace(".", ",")} €`);

async function cargarMisApuestas() {
  const sub = E.misSub || leer("mis_sub", "diario");
  E.misSub = sub;
  $$("#misSub button").forEach((b) => {
    b.classList.toggle("activa", b.dataset.m === sub);
    b.onclick = () => { E.misSub = b.dataset.m; guardar("mis_sub", b.dataset.m); cargarMisApuestas(); };
  });
  $("#misDiario").hidden = sub !== "diario";
  $("#misPresupuesto").hidden = sub !== "presupuesto";
  if (sub === "diario") pintarDiario(); else pintarPresupuesto();
}

function graficoEvolucion(ev) {
  if (!ev || ev.length < 2) return "";
  const W = 640, H = 150, pad = 26;
  const ys = ev.map((p) => p.beneficio), min = Math.min(0, ...ys), max = Math.max(0, ...ys), rango = max - min || 1;
  const X = (i) => pad + (i / (ev.length - 1)) * (W - 2 * pad), Y = (v) => H - pad - ((v - min) / rango) * (H - 2 * pad);
  const linea = ev.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.beneficio).toFixed(1)}`).join(" ");
  const ult = ys[ys.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico-ev" role="img" aria-label="Evolución del beneficio">
    <line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" class="eje"/>
    <path d="${linea}" class="${ult >= 0 ? "pos" : "neg"}" fill="none"/>
    <text x="${pad}" y="${Y(0) - 4}" class="et">0 €</text><text x="${W - pad}" y="${Y(ult) - 6}" text-anchor="end" class="et">${euroS(ult)}</text></svg>`;
}

function tablaGrupo(titulo, g) {
  const filas = Object.entries(g || {});
  if (!filas.length) return "";
  return `<div class="c6"><h4>${titulo}</h4><div class="desplaza"><table class="tabla"><tr><th></th><th class="d">Apuestas</th><th class="d">Acierto</th><th class="d">Beneficio</th><th class="d">ROI</th></tr>
    ${filas.map(([k, d]) => `<tr><td>${esc(k)}</td><td class="d">${d.n}</td><td class="d">${pct(d.acierto, 0)}</td>
      <td class="d ${d.beneficio > 0 ? "verde" : d.beneficio < 0 ? "rojo" : ""}">${euroS(d.beneficio)}</td><td class="d">${d.n >= 5 ? pct(d.roi, 0) : "–"}</td></tr>`).join("")}</table></div></div>`;
}

async function pintarDiario() {
  const el = $("#misDiario");
  el.innerHTML = `<div class="tarjeta"><div class="vacio"><span class="spinner"></span> Comprobando tus apuestas…</div></div>`;
  let d;
  try { d = await api("/api/diario"); } catch (e) { el.innerHTML = `<div class="tarjeta"><p class="nota">${esc(e.message)}</p></div>`; return; }
  const t = d.total;
  const estadoTxt = { pendiente: "⏳ En juego", ganada: "✅ Ganada", perdida: "❌ Perdida", nula: "↩️ Nula", cashout: "💵 Cash out" };
  const fila = (a) => `<tr class="ap-${a.estado}"><td class="nota">${esc(fechaLarga(a.fecha))}<br>${esc(a.casa || "")}</td>
    <td><b>${esc(a.descripcion)}</b>${a.piernas.length > 1 ? `<br><span class="nota">${a.piernas.map((p) => `${p.ok === true ? "✅" : p.ok === false ? "❌" : "⏳"} ${esc(p.mercado)}${p.real ? " (" + esc(p.real) + ")" : ""}`).join(" · ")}</span>`
      : a.piernas[0] && a.piernas[0].real ? `<br><span class="nota">Resultado: ${esc(a.piernas[0].real)}</span>` : ""}${a.nota ? `<br><span class="nota">📝 ${esc(a.nota)}</span>` : ""}</td>
    <td class="nota">${esc(a.tipo)}</td><td class="d">${n1(a.cuota, 2)}</td><td class="d">${euro(a.stake)}</td>
    <td>${estadoTxt[a.estado] || esc(a.estado)}${a.prob_modelo ? `<br><span class="nota">modelo ${pct(a.prob_modelo, 0)}</span>` : ""}
      ${puedeCerrar(a) ? `<br><button class="mini cierro" data-id="${a.id}" title="Con el marcador y el minuto: cuánto vale de verdad tu apuesta y si te conviene el cash out">📉 ¿La cierro?</button>` : ""}</td>
    <td class="d ${a.beneficio > 0 ? "verde" : a.beneficio < 0 ? "rojo" : ""}">${a.beneficio == null ? "–" : euroS(a.beneficio)}</td>
    <td class="d ${a.clv > 0 ? "verde" : a.clv < 0 ? "rojo" : ""}" title="${a.cuota_cierre ? `Cuota justa de cierre ${n1(a.cuota_cierre, 2)} (${esc(a.cierre_fuente || "")})` : "Sin cuota de cierre (córners, tarjetas, remates o aún no publicada)"}">${a.clv == null ? "–" : (a.clv > 0 ? "+" : "") + (a.clv * 100).toFixed(1) + "%"}</td>
    <td><select class="mini-sel apEstado" data-id="${a.id}"><option value="">cambiar…</option><option value="ganada">Ganada</option><option value="perdida">Perdida</option>
      <option value="nula">Nula (devuelta)</option><option value="cashout">💵 Cash out (la cerré)…</option><option value="pendiente">En juego</option><option value="borrar">🗑️ Borrar</option></select></td></tr>`;
  el.innerHTML = `<div class="tarjeta"><div class="hist-cab"><h2>📒 Mi diario de apuestas</h2>
      <button class="primario" id="apNueva">➕ Apuntar una apuesta a mano</button></div>
    ${(d.avisos || []).map((a) => `<div class="veredicto sin_valor" style="margin:6px 0">⚠️ ${esc(a)}</div>`).join("")}
    <div class="mercados">
      <div class="mercado"><div class="n">Beneficio total</div><div class="v ${t.beneficio > 0 ? "verde" : t.beneficio < 0 ? "rojo" : ""}">${euroS(t.beneficio)}</div></div>
      <div class="mercado"><div class="n">Apostado (resueltas)</div><div class="v">${euro(t.apostado)}</div></div>
      <div class="mercado"><div class="n">ROI</div><div class="v">${t.resueltas ? pct(t.roi, 1) : "–"}</div></div>
      <div class="mercado"><div class="n">Acertadas</div><div class="v">${t.ganadas}/${t.resueltas}</div></div>
      <div class="mercado"><div class="n">Cuota media</div><div class="v">${t.cuota_media ? n1(t.cuota_media, 2) : "–"}</div></div>
      <div class="mercado"><div class="n">En juego ahora</div><div class="v">${euro(t.en_juego)}</div></div>
      <div class="mercado"><div class="n">Racha</div><div class="v">${d.racha > 0 ? `✅ ${d.racha} seguidas` : d.racha < 0 ? `❌ ${-d.racha} seguidas` : "–"}</div></div>
      <div class="mercado" title="Cuánto mejor (o peor) era tu cuota que la justa de CIERRE. Positivo de media = apuestas bien, aunque pierdas una semana."><div class="n">CLV medio (${t.clv_n || 0})</div><div class="v ${t.clv_media > 0 ? "verde" : t.clv_media < 0 ? "rojo" : ""}">${t.clv_media == null ? "–" : (t.clv_media > 0 ? "+" : "") + (t.clv_media * 100).toFixed(1) + "%"}</div></div></div>
    ${t.clv_n ? `<p class="nota">📈 <b>CLV</b>: en ${t.clv_n} apuestas, el ${pct(t.clv_positivas, 0)} las cogiste a MEJOR cuota que la de cierre. Es la forma más honesta de saber si apuestas bien sin depender de la suerte:
      quien tiene CLV positivo de media gana a la larga. Solo se puede medir en ganador, doble oportunidad, goles, ambos marcan y hándicap (córners y tarjetas no tienen cuota de cierre pública).</p>` : ""}
    ${t.resueltas ? `<p class="nota">Con tus cuotas, para no perder tendrías que acertar el ${pct(t.acierto_cuotas, 0)}; aciertas el <b>${pct(t.acierto, 0)}</b>.
      ${t.acierto_modelo ? `En las que apuntaste desde el programa, el modelo daba de media un ${pct(t.acierto_modelo, 0)} y salieron el ${pct(t.acierto_real_modelo, 0)}.` : ""}</p>` : ""}
    ${graficoEvolucion(d.evolucion)}
    ${d.apuestas.length ? `<div class="desplaza"><table class="tabla diario"><tr><th>Fecha</th><th>Apuesta</th><th>Tipo</th><th class="d">Cuota</th><th class="d">Apostado</th><th>Estado</th><th class="d">Beneficio</th><th class="d" title="Tu cuota frente a la cuota justa de cierre">CLV</th><th></th></tr>
      ${d.apuestas.map(fila).join("")}</table></div>`
      : `<p class="nota">Aún no has apuntado ninguna. En cada pronóstico, en «Crear apuesta», en la combinada segura y en el presupuesto tienes el botón <b>✅ La he jugado</b>.
         Las que apuntes desde ahí se comprueban solas cuando acaba el partido; las que escribas a mano, las marcas tú.</p>`}
  </div>
  ${t.resueltas ? `<div class="tarjeta"><h3>📊 Dónde ganas y dónde pierdes</h3><div class="rejilla" style="margin-top:0">
    ${tablaGrupo("Por tipo de apuesta", d.por_familia)}${tablaGrupo("Sencilla, combinada o crear apuesta", d.por_tipo)}
    ${tablaGrupo("Por cuota", d.por_cuota)}${tablaGrupo("Del programa o mías", d.por_origen)}
    ${tablaGrupo("Por casa", d.por_casa)}${tablaGrupo("Por mes", d.por_mes)}</div>
    <p class="nota">El ROI es lo que ganas (o pierdes) por cada euro apostado. Con menos de 20-30 apuestas los números todavía cambian mucho: no saques conclusiones con 5.</p></div>` : ""}`;
  $("#apNueva").onclick = () => abrirApuntar({ piernas: [] });
  $$("#misDiario .cierro").forEach((b) => (b.onclick = () => abrirCierro(d.apuestas.find((x) => x.id === +b.dataset.id))));
  $$("#misDiario .apEstado").forEach((s) => (s.onchange = async () => {
    const v = s.value; if (!v) return;
    if (v === "borrar" && !confirm("¿Borrar esta apuesta del diario?")) { s.value = ""; return; }
    let cobrado;
    if (v === "cashout") {   // v2.2: apuntar lo que te devolvió la casa al cerrarla antes de tiempo
      const t = prompt("¿Cuánto te devolvió la casa al cerrarla (cash out)? En euros, por ejemplo 3,40:");
      cobrado = parseFloat(String(t || "").replace(",", ".").replace("€", ""));
      if (!(cobrado >= 0)) { s.value = ""; return; }
    }
    await api("/api/diario/cambiar", { method: "POST", body: JSON.stringify({ id: +s.dataset.id, estado: v === "borrar" ? null : v, borrar: v === "borrar", cobrado }) });
    pintarDiario();
  }));
}

// ---------------------------------------------------------------- v2.2: «¿La cierro?» (cash out en directo)
// Con el marcador, el minuto, las tarjetas, los córners y los remates de ESPN se calcula la probabilidad REAL de que
// tu apuesta salga desde este momento (goles: Poisson con los goles esperados del modelo para lo que queda; córners,
// tarjetas y remates: lo que queda al ritmo del modelo mezclado con el del partido). Valor justo = lo que cobras × prob.
const GOLES_K = { "1": (h, a) => h > a, X: (h, a) => h === a, "2": (h, a) => h < a, "1X": (h, a) => h >= a, X2: (h, a) => h <= a, "12": (h, a) => h !== a,
  O15: (h, a) => h + a >= 2, U15: (h, a) => h + a <= 1, O25: (h, a) => h + a >= 3, U25: (h, a) => h + a <= 2, O35: (h, a) => h + a >= 4,
  U35: (h, a) => h + a <= 3, U45: (h, a) => h + a <= 4, O45: (h, a) => h + a >= 5, BTTS: (h, a) => h > 0 && a > 0, NOBTTS: (h, a) => h === 0 || a === 0,
  HM: (h) => h > 0, AM: (h, a) => a > 0, "1-H1": (h, a) => h - a >= 2, "2-H1": (h, a) => a - h >= 2, "1-H2": (h, a) => h - a >= 3, "2-H2": (h, a) => a - h >= 3,
  "1+H1": (h, a) => h - a >= -1, "2+H1": (h, a) => a - h >= -1, "1+H2": (h, a) => h - a >= -2, "2+H2": (h, a) => a - h >= -2,
  "1&O15": (h, a) => h > a && h + a >= 2, "2&O15": (h, a) => h < a && h + a >= 2, "1&U35": (h, a) => h > a && h + a <= 3, "2&U35": (h, a) => h < a && h + a <= 3,
  "1X&U35": (h, a) => h >= a && h + a <= 3, "X2&U35": (h, a) => h <= a && h + a <= 3, "1X&O15": (h, a) => h >= a && h + a >= 2, "X2&O15": (h, a) => h <= a && h + a >= 2,
  "1&BTTS": (h, a) => h > a && a > 0, "2&BTTS": (h, a) => h < a && h > 0, "1&NOBTTS": (h, a) => h > a && a === 0, "2&NOBTTS": (h, a) => h < a && h === 0,
  "BTTS&O25": (h, a) => h > 0 && a > 0 && h + a >= 3, "G1-3": (h, a) => h + a >= 1 && h + a <= 3, "G2-4": (h, a) => h + a >= 2 && h + a <= 4,
  "G2-5": (h, a) => h + a >= 2 && h + a <= 5, "G1-4": (h, a) => h + a >= 1 && h + a <= 4, "H>1.5": (h) => h >= 2, "H<1.5": (h) => h <= 1,
  "A>1.5": (h, a) => a >= 2, "A<1.5": (h, a) => a <= 1, "H<2.5": (h) => h <= 2, "A<2.5": (h, a) => a <= 2, "H>2.5": (h) => h >= 3, "A>2.5": (h, a) => a >= 3,
  "X&U25": (h, a) => h === a && h + a <= 2 };
function tipoClave(k) {
  if (!k) return null;
  if (/^MT[<>][\d.]+$/.test(k)) return "mt";
  if (/^S:\d+-\d+$/.test(k)) return "goles";
  if (GOLES_K[k]) return "goles";
  if (k === "CH>CA" || k === "CA>CH" || /^[CTR][LVB]?[<>][\d.]+$/.test(k)) return k[0];
  return null;
}
function cumpleGoles(k, h, a, t1) {
  if (k.startsWith("S:")) { const [x, y] = k.slice(2).split("-").map(Number); return h === x && a === y; }
  const m = k.match(/^MT([<>])([\d.]+)$/);
  if (m) return m[1] === ">" ? t1 > +m[2] : t1 < +m[2];
  return GOLES_K[k](h, a);
}
function cumpleCT(k, x, y) {
  if (k === "CH>CA") return x > y;
  if (k === "CA>CH") return y > x;
  const m = k.match(/^[CTR]([LVB]?)([<>])([\d.]+)$/), l = +m[3];
  if (m[1] === "B") return m[2] === ">" ? x > l && y > l : x < l && y < l;
  const v = m[1] === "L" ? x : m[1] === "V" ? y : x + y;
  return m[2] === ">" ? v > l : v < l;
}
const fPois = (l, n) => { const o = []; let p = Math.exp(-l); for (let k = 0; k <= n; k++) { o.push(p); p *= l / (k + 1); } return o; };
const fNB = (mu, r, n) => { if (mu <= 1e-9) return [1].concat(Array(n).fill(0)); const p = r / (r + mu); const o = []; let q = Math.pow(p, r);
  for (let k = 0; k <= n; k++) { o.push(q); q = q * (k + r) / (k + 1) * (1 - p); } return o; };

// Estado del partido en directo a partir de /api/<liga>/vivo (ESPN)
function estadoVivo(ev) {
  const st = ev.estado || {}, fase = st.fase || "pre";
  const per = +st.periodo || 1, desc = /HT|descanso|half/i.test(st.texto || "") || (st.parado && per === 1 && minutoJugado(st) >= 44);
  const min = fase === "pre" ? 0 : desc ? 45 : Math.min(minutoJugado(st), 120);
  const lado = (e, l) => e.lado === l;
  const n = (t, l) => (ev.eventos || []).filter((e) => lado(e, l) && t.includes(e.tipo)).length;
  const gol = (ev.eventos || []).filter((e) => String(e.tipo).startsWith("gol"));
  const gh = +ev.home.goles || 0, ga = +ev.away.goles || 0;
  const minGol = (e) => parseInt(String(e.minuto || "").split("'")[0], 10);
  const ht = per >= 2 || desc || fase === "post" ? (gol.length === gh + ga && gol.every((e) => !isNaN(minGol(e))) ? gol.filter((e) => minGol(e) < 46).length : null) : gh + ga;
  const res = ev.resumen || {}, par = (x) => (x ? [parseFloat(x[0]) || 0, parseFloat(x[1]) || 0] : null);
  return { fase, min, primera: fase === "pre" || (per === 1 && !desc), desc, gh, ga, ht, rojas: [n(["roja"], "home"), n(["roja"], "away")],
    C: par(res.wonCorners), T: [n(["amarilla", "roja"], "home"), n(["amarilla", "roja"], "away")], R: par(res.shotsOnTarget), texto: st.fase === "in" ? (st.minuto || st.texto) : st.texto };
}

// Probabilidad de que salgan TODAS las selecciones de un partido desde el estado actual
function probPartidoVivo(legs, e, mod) {
  // nocalc: [{ mercado, motivo }] (v2.2: con el motivo, para no culpar a ESPN de lo que no es)
  const goles = legs.filter((l) => l.t === "goles" || l.t === "mt"), out = { prob: 1, legs: [], nocalc: [] };
  const fin = e.fase === "post", no = (ls, motivo) => out.nocalc.push(...ls.map((l) => ({ mercado: l.mercado, motivo })));
  // --- goles (y 1ª parte)
  if (goles.length) {
    if (!fin && !(mod && mod.lh > 0 && mod.la > 0)) no(goles, "faltan los goles esperados del modelo para este partido");
    else if (goles.some((l) => l.t === "mt") && e.ht == null && !e.primera) no(goles.filter((l) => l.t === "mt"), "ESPN no dice en qué minuto fue cada gol");
    const ok = goles.filter((l) => !out.nocalc.some((x) => x.mercado === l.mercado));
    if (ok.length) {
      const ROJA = 0.72, MAS = 1.22, [rh, ra] = e.rojas || [0, 0];
      const lh = fin ? 0 : mod.lh * Math.pow(ROJA, rh) * Math.pow(MAS, ra), la = fin ? 0 : mod.la * Math.pow(ROJA, ra) * Math.pow(MAS, rh);
      const f1 = fin || !e.primera ? 0 : Math.max(0, Math.min(1, (47 - e.min) / 47)), f2 = fin ? 0 : e.primera || e.desc ? 1 : Math.max(0, Math.min(1, (95 - e.min) / 50));
      const N = 9, P1h = fPois(lh * 0.45 * f1, N), P1a = fPois(la * 0.45 * f1, N), P2h = fPois(lh * 0.55 * f2, N), P2a = fPois(la * 0.55 * f2, N);
      const marg = ok.map(() => 0); let junta = 0;
      const t10 = e.primera ? e.gh + e.ga : e.ht;
      for (let h1 = 0; h1 <= N; h1++) for (let a1 = 0; a1 <= N; a1++) {
        const p1 = P1h[h1] * P1a[a1]; if (p1 < 1e-10) continue;
        for (let h2 = 0; h2 <= N; h2++) for (let a2 = 0; a2 <= N; a2++) {
          const pp = p1 * P2h[h2] * P2a[a2]; if (pp < 1e-12) continue;
          const H = e.gh + h1 + h2, A = e.ga + a1 + a2, T1 = (t10 ?? 0) + h1 + a1;
          let todas = true;
          ok.forEach((l, i) => { const c = cumpleGoles(l.clave, H, A, T1); if (c) marg[i] += pp; else todas = false; });
          if (todas) junta += pp;
        }
      }
      ok.forEach((l, i) => out.legs.push({ ...l, p: marg[i] }));
      out.prob *= junta;
    }
  }
  // --- córners (C), tarjetas (T) y remates a puerta (R): lo que falta, por equipo
  for (const t of ["C", "T", "R"]) {
    const ls = legs.filter((l) => l.t === t);
    if (!ls.length) continue;
    const act = e[t], esp = mod && mod.ct ? mod.ct[{ C: "corners", T: "tarjetas", R: "remates" }[t]] : null;
    const nom = { C: "los córners", T: "las tarjetas", R: "los remates a puerta" }[t];
    if (!act && e.fase !== "pre") { no(ls, `ESPN no da ${nom} de este partido en directo`); continue; }
    if (!fin && !esp) { no(ls, `faltan ${nom} esperados del modelo para este partido`); continue; }
    const cur = act || [0, 0], K = 35, T95 = 95, m = Math.min(e.min, T95 - 1), resto = fin ? 0 : Math.max(T95 - m, 2);
    const mu = [0, 1].map((i) => fin ? 0 : (((esp[i] || 0) / T95) * K + cur[i]) / (K + m) * resto);
    const r = { C: 8, T: 5, R: 10 }[t], N = { C: 25, T: 14, R: 25 }[t];
    const Ph = fNB(mu[0], r, N), Pa = fNB(mu[1], r, N);
    const marg = ls.map(() => 0); let junta = 0;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const pp = Ph[i] * Pa[j]; if (pp < 1e-12) continue;
      let todas = true;
      ls.forEach((l, k) => { if (cumpleCT(l.clave, cur[0] + i, cur[1] + j)) marg[k] += pp; else todas = false; });
      if (todas) junta += pp;
    }
    ls.forEach((l, k) => out.legs.push({ ...l, p: marg[k] }));
    out.prob *= junta;
  }
  no(legs.filter((l) => !l.t), "este tipo de apuesta no se puede seguir en directo");
  return out;
}

function puedeCerrar(a) {
  if (a.estado !== "pendiente") return false;
  const ps = (a.piernas || []).filter((p) => p.comp && p.home && p.clave);
  if (!ps.length || ps.length !== (a.piernas || []).length) return false;
  const hoy = HOY(), ayer = fechaLocal(new Date(Date.now() - 864e5)), man = fechaLocal(new Date(Date.now() + 864e5));
  return ps.some((p) => (p.fecha || a.fecha) >= ayer && (p.fecha || a.fecha) <= man) || (a.fecha >= ayer && a.fecha <= hoy);
}

async function datosCierro(a) {
  const grupos = new Map();
  for (const p of a.piernas) {
    const k = `${p.comp}|${p.partido_id ?? p.home + "-" + p.away}`;
    if (!grupos.has(k)) grupos.set(k, { comp: p.comp, home: p.home, away: p.away, partido_id: p.partido_id, modelo: p.modelo, legs: [] });
    grupos.get(k).legs.push({ clave: p.clave, mercado: p.mercado, t: tipoClave(p.clave), prob0: p.prob });
  }
  const vivos = {}, rks = {};
  for (const g of grupos.values()) {
    if (!vivos[g.comp]) { try { vivos[g.comp] = (await api(`/api/${g.comp}/vivo`)).partidos || []; } catch (x) { vivos[g.comp] = null; } }
    g.ev = (vivos[g.comp] || []).find((v) => mismoEquipo(v.home.nombre, g.home) && mismoEquipo(v.away.nombre, g.away));
    if (!(g.modelo && g.modelo.lh)) {   // apuntada desde la combinada o el presupuesto: los goles esperados del ranking
      if (!rks[g.comp]) { try { rks[g.comp] = (await api(`/api/${g.comp}/ranking`)).partidos || []; } catch (x) { rks[g.comp] = []; } }
      const r = rks[g.comp].find((x) => x.id === g.partido_id) || rks[g.comp].find((x) => mismoEquipo(x.home, g.home) && mismoEquipo(x.away, g.away));
      if (r && r.lambdas) g.modelo = { lh: r.lambdas[0], la: r.lambdas[1], ct: r.ct || {} };
    }
    if (!(g.modelo && g.modelo.lh) && g.partido_id != null) {   // v2.2: si no está en el ranking, el análisis del partido
      try {
        const d = await api(`/api/${g.comp}/analizar?id=${g.partido_id}`);
        if (d && d.prob && d.prob.lh) g.modelo = { lh: d.prob.lh, la: d.prob.la, ct: { corners: d.corners ? [d.corners.h, d.corners.a] : null,
          tarjetas: d.tarjetas ? [d.tarjetas.h, d.tarjetas.a] : null, remates: d.remates_esperados || null } };
      } catch (x) {}
    }
  }
  return [...grupos.values()];
}

function veredictoCierro(justo, oferta, cobras, prob) {
  if (!(oferta > 0)) return "";
  const r = oferta / justo;
  const perder = justo - oferta;
  if (r >= 1.0) return `<div class="veredicto valor">✅ <b>Te pagan lo que vale o más</b> (${euro(oferta)} por una apuesta que vale ${euro(justo)}). Cerrar ahora no te cuesta nada: si quieres asegurar, ciérrala.</div>`;
  if (r >= 0.9) return `<div class="veredicto justo">➖ <b>Cerrar te cuesta poco</b>: te dan ${euro(oferta)} y vale ${euro(justo)} (pierdes ${euro(perder)} de media, un ${Math.round((1 - r) * 100)} %).
      Si te quita los nervios o no te puedes permitir perderla, ciérrala; si no, aguantar es lo que más da a la larga.</div>`;
  return `<div class="veredicto sin_valor">❌ <b>Te pagan bastante menos de lo que vale</b>: ${euro(oferta)} por una apuesta que vale ${euro(justo)} (un ${Math.round((1 - r) * 100)} % menos).
      Si aguantas: ${pct(prob, 0)} de cobrar ${euro(cobras)} y ${pct(1 - prob, 0)} de quedarte sin nada. Cerrar solo tiene sentido si no te puedes permitir perderla.</div>`;
}

async function abrirCierro(a) {
  if (!a) return;
  let m = $("#modalCierro");
  if (!m) { m = document.createElement("div"); m.id = "modalCierro"; m.className = "modal"; document.body.appendChild(m); }
  m.hidden = false;
  m.onclick = (ev) => { if (ev.target === m) { m.hidden = true; clearTimeout(E.timerCierro); } };
  const cobras = a.stake * a.cuota;
  const pintar = async () => {
    if (m.hidden) return;
    if (!m.querySelector(".modal-caja")) m.innerHTML = `<div class="modal-caja"><h3>📉 ¿La cierro?</h3><div class="vacio"><span class="spinner"></span> Mirando cómo van los partidos…</div></div>`;
    const grupos = await datosCierro(a);
    let prob = 1, nocalc = [], vivo = false, html = "", calc = 0;
    for (const g of grupos) {
      const e = g.ev ? estadoVivo(g.ev) : { fase: "pre", min: 0, primera: true, gh: 0, ga: 0, ht: 0, rojas: [0, 0], C: null, T: [0, 0], R: null };
      if (!g.ev) e.sinVivo = true;
      vivo = vivo || e.fase === "in";
      const r = probPartidoVivo(g.legs, e, g.modelo);
      prob *= r.prob; nocalc.push(...r.nocalc); calc += r.legs.length;
      const marcador = e.fase === "pre" ? (e.sinVivo ? "sin datos en directo (ESPN)" : "no ha empezado") : `${e.gh}-${e.ga} · ${e.fase === "post" ? "final" : esc(e.texto || Math.round(e.min) + "'")}`;
      html += `<div class="tarjeta" style="margin:0"><b>${esc(g.home)} – ${esc(g.away)}</b> <span class="nota">${marcador}${e.C ? ` · córners ${e.C.join("-")}` : ""}${e.fase !== "pre" ? ` · tarjetas ${e.T.join("-")}` : ""}${e.R ? ` · a puerta ${e.R.join("-")}` : ""}</span>
        <ul class="lista-simple">${r.legs.map((l) => `<li>${l.p >= 0.999 ? "✅" : l.p <= 0.001 ? "❌" : "⏳"} ${esc(l.mercado)} <b>${l.p >= 0.999 ? "ya está" : l.p <= 0.001 ? "ya no puede salir" : pct(l.p, 0)}</b>
          ${l.prob0 ? `<span class="nota">(antes del partido ${pct(l.prob0, 0)})</span>` : ""}</li>`).join("")}
          ${r.nocalc.map((x) => `<li>❓ ${esc(x.mercado)} <span class="nota">no se puede calcular: ${esc(x.motivo)}</span></li>`).join("")}</ul></div>`;
    }
    const justo = cobras * prob, cota = nocalc.length ? "como mucho " : "";
    const oferta = parseFloat(String(leer(`co_${a.id}`, "")).replace(",", "."));
    m.innerHTML = `<div class="modal-caja"><h3>📉 ¿La cierro? <span class="nota">${esc(a.descripcion)}</span></h3>
      ${html}
      ${!calc ? `<p class="veredicto justo">⚠️ Ahora mismo no se puede calcular cuánto vale esta apuesta (mira arriba por qué). Si Bet365 te ofrece cerrarla,
        compáralo con lo que pagaría si sale (${euro(cobras)}) y con lo que creas que va a pasar.</p>`
        : nocalc.length ? `<p class="veredicto justo">⚠️ ${nocalc.length === 1 ? "Una selección no se puede" : "Algunas selecciones no se pueden"} calcular (mira arriba por qué).
        Lo de abajo es <b>lo máximo</b> que puede valer: la probabilidad real es MÁS BAJA.</p>` : ""}
      ${calc ? `<div class="mercados">
        <div class="mercado"><div class="n">Probabilidad de ganarla ahora</div><div class="v">${cota}${pct(prob, 0)}</div></div>
        <div class="mercado"><div class="n">Si sale cobras</div><div class="v">${euro(cobras)}</div></div>
        <div class="mercado"><div class="n">Lo que vale ahora (justo)</div><div class="v">${cota}${euro(justo)}</div></div></div>` : ""}
      <div class="fila-controles"><label>Bet365 te ofrece por cerrarla (€) <input id="coOferta" inputmode="decimal" style="width:6em" placeholder="${n1(justo * 0.9, 2)}" value="${esc(leer(`co_${a.id}`, ""))}"></label></div>
      <div id="coVeredicto">${nocalc.length ? "" : veredictoCierro(justo, oferta, cobras, prob)}</div>
      <p class="nota">Es una estimación del modelo con lo que ha pasado hasta ahora (goles, rojas, córners, tarjetas y remates de ESPN). No sabe de lesiones, de cambios ni de si un equipo aprieta.
        Las casas descuentan un margen en el cash out: casi siempre te dan algo menos de lo justo. ${vivo ? "Se actualiza solo cada 30 segundos." : ""}</p>
      <div class="fila-controles"><button class="primario" id="coRecalc">⟳ Recalcular</button><button id="coCerrar">Cerrar</button></div></div>`;
    $("#coOferta").oninput = () => { guardar(`co_${a.id}`, $("#coOferta").value); $("#coVeredicto").innerHTML = nocalc.length ? "" : veredictoCierro(justo, parseFloat($("#coOferta").value.replace(",", ".")), cobras, prob); };
    $("#coRecalc").onclick = pintar;
    $("#coCerrar").onclick = () => { m.hidden = true; clearTimeout(E.timerCierro); };
    clearTimeout(E.timerCierro);
    if (vivo) E.timerCierro = setTimeout(pintar, 30000);
  };
  m.innerHTML = "";
  await pintar();
}

async function pintarPresupuesto(recargar) {
  const el = $("#misPresupuesto");
  const P = E.pres || (E.pres = { euros: leer("pres_euros", "10"), dias: +leer("pres_dias", 3), modo: leer("pres_modo", "equilibrado") });
  el.innerHTML = `<div class="tarjeta"><div class="vacio"><span class="spinner"></span> Repartiendo ${esc(P.euros)} € entre las apuestas más fiables de todas las ligas…</div></div>`;
  let d;
  try { d = await api(`/api/presupuesto?euros=${encodeURIComponent(P.euros)}&dias=${P.dias}&modo=${P.modo}${recargar ? "&recargar=1" : ""}`); }
  catch (e) { d = { error: e.message, plan: [] }; }
  const linea = (p) => `<tr><td>${p.tipo === "sencilla" ? "🛡️ Sencilla" : p.tipo === "combinada" ? "🧩 Combinada" : "⚡ Más cuota"}</td>
    <td>${p.piernas.map((x) => `<b>${esc(x.mercado)}</b><br><span class="nota">${esc(x.liga)} · ${esc(x.home)} – ${esc(x.away)} · ${esc(fechaLarga(x.fecha))} ${esc(x.hora || "")}${(x.avisos || []).length ? " · " + x.avisos.map((a) => a.icono).join("") : ""}</span>`).join("<br>")}</td>
    <td class="d">${pct(p.prob, 0)}</td><td class="d">@ ${n1(p.cuota, 2)}${p.piernas.every((x) => x.cuota_real) ? "" : `<br><span class="nota">aprox.</span>`}</td>
    <td class="d"><b>${euro(p.stake)}</b></td><td class="d">${euro(p.cobras)}</td>
    <td>${btnJugada(p.piernas.map((x) => ({ comp: x.comp, partido_id: x.partido_id, fecha: x.fecha, home: x.home, away: x.away, clave: x.clave, mercado: x.mercado, prob: x.prob })), p.cuota, p.tipo === "combinada" ? "combinada" : "sencilla")}</td></tr>`;
  el.innerHTML = `<div class="tarjeta"><h2>💶 Presupuesto del fin de semana</h2>
    <div class="fila-controles">
      <label>Tengo (€) <input id="presEuros" inputmode="decimal" style="width:5em" value="${esc(P.euros)}"></label>
      <label>Partidos de <select id="presDias">${[[1, "hoy y mañana"], [3, "los próximos 3 días"], [7, "la semana"]].map(([v, t]) => `<option value="${v}" ${P.dias === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Estilo <select id="presModo">${[["prudente", "🛡️ Prudente"], ["equilibrado", "⚖️ Equilibrado"], ["atrevido", "⚡ Atrevido"]].map(([v, t]) => `<option value="${v}" ${P.modo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <button class="primario" id="presCalc">Repartir</button><button class="mini" id="presRecargar">⟳ Recalcular partidos</button></div>
    ${d.texto_modo ? `<p class="nota">${esc(d.texto_modo)}</p>` : ""}
    ${d.error ? `<p class="nota">⚠️ ${esc(d.error)}</p>` : ""}
    ${d.plan && d.plan.length ? `<div class="desplaza"><table class="tabla"><tr><th>Tipo</th><th>Apuesta</th><th class="d">Prob.</th><th class="d">Cuota ${esc(d.casa || "")}</th><th class="d">Pones</th><th class="d">Si sale cobras</th><th></th></tr>
      ${d.plan.map(linea).join("")}</table></div>
      <div class="mercados">
        <div class="mercado"><div class="n">Apuestas en total</div><div class="v">${euro(d.apostado)}</div></div>
        ${d.sobra > 0 ? `<div class="mercado"><div class="n">Te guardas</div><div class="v">${euro(d.sobra)}</div></div>` : ""}
        <div class="mercado"><div class="n">Probabilidad de ganar dinero</div><div class="v">${pct(d.p_ganar, 0)}</div></div>
        <div class="mercado"><div class="n">Probabilidad de perderlo todo</div><div class="v">${pct(d.p_cero, 0)}</div></div>
        <div class="mercado"><div class="n">Lo más normal: cobras</div><div class="v">${euro(d.tipico)}</div></div>
        <div class="mercado"><div class="n">Si sale todo</div><div class="v">${euro(d.mejor)}</div></div>
        <div class="mercado"><div class="n">A la larga, de media</div><div class="v">${euro(d.esperado)}</div></div></div>
      <p class="nota">Un solo partido por apuesta y nunca más del 35 % en una sola: si no hay bastantes apuestas buenas, el resto te lo guardas.
        «A la larga» es lo que volvería de media si repitieras este fin de semana muchas veces: como las casas se quedan su margen, suele ser algo menos de lo que pones.
        Apuesta solo lo que te puedas permitir perder.</p>` : ""}
  </div>`;
  const leerForm = () => { P.euros = $("#presEuros").value.replace(",", ".") || "10"; P.dias = +$("#presDias").value; P.modo = $("#presModo").value;
    guardar("pres_euros", P.euros); guardar("pres_dias", P.dias); guardar("pres_modo", P.modo); };
  $("#presCalc").onclick = () => { leerForm(); pintarPresupuesto(); };
  $("#presDias").onchange = $("#presModo").onchange = () => { leerForm(); pintarPresupuesto(); };
  $("#presRecargar").onclick = () => { leerForm(); pintarPresupuesto(true); };
}
