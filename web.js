"use strict";
// PBCT v2.1 · EL PROGRAMA COMPLETO EN LA WEB (sin servidor). Es la misma interfaz que el programa del PC (app.js);
// aquí se contestan sus peticiones /api/... con los «documentos» que GitHub calcula 3 veces al día (Supabase, solo
// con tu sesión) y, lo que depende de lo que elijas (Crear apuesta, quiniela con dobles, presupuesto, tu diario),
// se calcula en el propio navegador con esos datos.
(function () {
  const C = window.CONFIG || {};
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  const token = () => LS.get("pbct_sesion", null);
  const SOLO_PC = "Esto solo se puede hacer en el programa del PC. En la web todo se actualiza solo (GitHub, 3 veces al día).";
  const err = (t, extra) => Object.assign({ error: t }, extra || {});

  function fuera(estado) {
    LS.set("pbct_sesion", null);
    location.replace("index.html" + (estado === "bloqueado" ? "#bloqueado" : ""));
    throw new Error("Sesión caducada");
  }
  async function rpc(fn, args) {
    const h = { "Content-Type": "application/json", apikey: C.supabase_clave };
    if (!String(C.supabase_clave || "").startsWith("sb_")) h.Authorization = "Bearer " + C.supabase_clave;
    const r = await fetch(`${C.supabase_url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("No se pudo conectar con el servidor de datos (" + r.status + ")");
    const j = await r.json();
    if (j && (j.estado === "sesion" || j.estado === "bloqueado")) fuera(j.estado);
    return j;
  }

  // ------------------------------------------------------------------ documentos (caché 5 min)
  const CACHE = new Map();
  let NOMBRE = null, ACTUALIZADO = null;
  async function docs(claves, forzar) {
    const ahora = Date.now(), falta = claves.filter((k) => forzar || !CACHE.has(k) || ahora - CACHE.get(k).t > 300000);
    for (let i = 0; i < falta.length; i += 40) {
      const trozo = falta.slice(i, i + 40);
      const r = await rpc("pbct_docs", { token: token(), claves: trozo });
      NOMBRE = r.nombre || NOMBRE; ACTUALIZADO = r.actualizado || ACTUALIZADO;
      for (const k of trozo) CACHE.set(k, { t: ahora, v: (r.docs || {})[k] ?? null });
    }
    const out = {};
    for (const k of claves) out[k] = CACHE.get(k).v;
    return out;
  }
  const doc = async (k, forzar) => (await docs([k], forzar))[k];
  window.pbctRecargar = () => CACHE.clear();

  // ------------------------------------------------------------------ utilidades
  const hoyISO = (mas = 0) => { const d = new Date(); d.setDate(d.getDate() + mas); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const prod = (a) => a.reduce((x, y) => x * y, 1);
  const num = (x, d = null) => { const v = parseFloat(String(x ?? "").replace(",", ".").replace("€", "").trim()); return Number.isFinite(v) ? v : d; };
  const r2 = (x) => Math.round(x * 100) / 100;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ------------------------------------------------------------------ «Crear apuesta» exacta (bits de las simulaciones)
  function bits(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function combinar(comp, q) {
    const a = await doc(`${comp}/analizar/${q.id}`);
    if (!a) return err("Este partido todavía no está analizado en la web (se analizan los de los próximos 6 días).");
    const claves = String(q.claves || "").split(",").filter(Boolean), B = a.bits || {};
    const ms = (((a.apuestas || {}).picks || {}).mercados) || [];
    const nombre = (k) => (ms.find((m) => m.clave === k) || {}).mercado || k;
    const probM = (k) => (ms.find((m) => m.clave === k) || {}).prob;
    const N = 800, sel = [], faltan = [];
    let todo = null;
    for (const k of claves) {
      if (!B[k]) { faltan.push(k); continue; }
      const b = bits(B[k]);
      let n = 0; for (let i = 0; i < N; i++) n += (b[i >> 3] >> (7 - (i & 7))) & 1;
      sel.push({ clave: k, mercado: nombre(k), prob: probM(k) ?? n / N });
      todo = todo ? todo.map((x, i) => x & b[i]) : Array.from(b);
    }
    let prob = null;
    if (todo) { let n = 0; for (let i = 0; i < N; i++) n += (todo[i >> 3] >> (7 - (i & 7))) & 1; prob = n / N; }
    // Con una sola selección se usa la probabilidad exacta (15.000 simulaciones); con varias, cruzadas en 800
    if (sel.length === 1 && sel[0].prob != null) prob = sel[0].prob;
    const r = { prob, selecciones: sel, no_calculables: faltan, independiente: sel.length ? prod(sel.map((x) => x.prob)) : null,
      partido: { id: a.partido.id, home: a.partido.home, away: a.partido.away }, remates_esperados: a.remates_esperados || null,
      simulaciones: N };
    if (prob) {
      r.cuota_justa = prob > 0 ? r2(1 / prob) : null;
      const cuota = num(q.cuota);
      if (cuota && !faltan.length) {
        r.cuota = cuota; r.ev = prob * cuota - 1;
        r.veredicto = r.ev > 0.03 ? "valor" : r.ev > -0.04 ? "justo" : "sin_valor";
      }
    }
    return r;
  }

  // ------------------------------------------------------------------ En directo (ESPN, desde el navegador)
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
  const ESTADISTICAS = [["possessionPct", "Posesión (%)"], ["totalShots", "Tiros"], ["shotsOnTarget", "Tiros a puerta"],
    ["wonCorners", "Córners"], ["foulsCommitted", "Faltas"], ["yellowCards", "Amarillas"], ["redCards", "Rojas"],
    ["offsides", "Fueras de juego"], ["saves", "Paradas"], ["accuratePasses", "Pases buenos"], ["passPct", "Precisión de pase"]];
  const getJSON = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const estadoEv = (ev) => { const st = ev.status || {}, t = st.type || {};
    return { fase: t.state, texto: t.shortDetail || t.detail || "", completado: !!t.completed, minuto: st.displayClock, segundos: st.clock,
      periodo: st.period, parado: ["STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_DELAYED", "STATUS_SUSPENDED"].includes(t.name), momento: Date.now() / 1000 }; };
  const equiposEv = (comp) => { const o = {}; for (const c of comp.competitors || []) { const t = c.team || {};
    o[c.homeAway] = { id: t.id, nombre: t.displayName || t.name, corto: t.abbreviation, escudo: t.logo, goles: c.score, penaltis: c.shootoutScore }; } return o; };
  async function slugDe(comp) { const i = await doc("info"); return ((i && i.comps) || []).find((c) => c.id === comp)?.slug; }
  async function vivo(comp) {
    const slug = await slugDe(comp);
    if (!slug) return { partidos: [] };
    const fechas = [-1, 0, 1].map((k) => hoyISO(k).replace(/-/g, ""));
    const js = await Promise.all(fechas.map((f) => getJSON(`${ESPN}/${slug}/scoreboard?dates=${f}`)).concat([getJSON(`${ESPN}/${slug}/scoreboard`)]));
    if (!js.some(Boolean)) return err("ESPN no responde. Prueba en un minuto.", { partidos: [] });
    const vistos = new Set(), out = [];
    for (const j of js.filter(Boolean)) for (const ev of j.events || []) {
      if (vistos.has(ev.id)) continue; vistos.add(ev.id);
      const comp_ = (ev.competitions || [{}])[0], eqs = equiposEv(comp_);
      if (!eqs.home || !eqs.away) continue;
      const lado = {}; for (const [k, v] of Object.entries(eqs)) lado[v.id] = k;
      const eventos = [];
      for (const d of comp_.details || []) {
        let k = null;
        if (d.scoringPlay) k = d.ownGoal ? "gol_pp" : d.penaltyKick ? "gol_pen" : "gol"; else if (d.redCard) k = "roja"; else if (d.yellowCard) k = "amarilla";
        if (!k) continue;
        const quien = (d.athletesInvolved || []).map((a) => a.displayName || a.shortName);
        eventos.push({ tipo: k, texto: (d.type || {}).text || "", minuto: (d.clock || {}).displayValue, lado: lado[(d.team || {}).id], jugador: quien[0] || null });
      }
      const st = {}; for (const c of comp_.competitors || []) { st[c.homeAway] = {}; for (const s of c.statistics || []) st[c.homeAway][s.name] = s.displayValue; }
      const resumen = {}; for (const k of ["shotsOnTarget", "wonCorners", "possessionPct"]) if ((st.home || {})[k]) resumen[k] = [st.home[k], (st.away || {})[k]];
      out.push({ id: ev.id, fecha: ev.date, estado: estadoEv(ev), home: eqs.home, away: eqs.away, eventos, resumen, estadio: (comp_.venue || {}).fullName });
    }
    const orden = { in: 0, pre: 1, post: 2 };
    out.sort((a, b) => (orden[a.estado.fase] ?? 3) - (orden[b.estado.fase] ?? 3) || String(a.fecha).localeCompare(String(b.fecha)));
    return { partidos: out, consultado: new Date().toLocaleTimeString("es-ES") };
  }
  async function vivoDetalle(comp, id) {
    const slug = await slugDe(comp);
    const js = slug && await getJSON(`${ESPN}/${slug}/summary?event=${id}`);
    if (!js) return err("ESPN no responde");
    const hdr = ((js.header || {}).competitions || [{}])[0], eqs = equiposEv(hdr);
    const st = {}; for (const t of (js.boxscore || {}).teams || []) { st[t.homeAway] = {}; for (const s of t.statistics || []) st[t.homeAway][s.name] = s.displayValue; }
    const tabla = ESTADISTICAS.filter(([k]) => (st.home || {})[k] != null).map(([k, n]) => ({ nombre: n, home: st.home[k], away: (st.away || {})[k] }));
    const lado = {}; for (const [k, v] of Object.entries(eqs)) lado[v.id] = k;
    const eventos = [];
    for (const ke of js.keyEvents || []) {
      const tl = ((ke.type || {}).text || "").toLowerCase();
      const tipo = tl.includes("goal") ? "gol" : tl.includes("red") ? "roja" : tl.includes("yellow") ? "amarilla" : tl.includes("substitution") ? "cambio" : null;
      if (!tipo) continue;
      const part = (ke.participants || []).map((p) => (p.athlete || {}).displayName);
      eventos.push({ tipo, minuto: (ke.clock || {}).displayValue, lado: lado[(ke.team || {}).id], jugador: part[0] || null, jugador2: part[1] || null, texto: ke.text });
    }
    const narracion = (js.commentary || []).map((c) => ({ minuto: (c.time || {}).displayValue || "", texto: c.text || (c.play || {}).text, orden: c.sequence || 0 }))
      .filter((x) => x.texto).sort((a, b) => b.orden - a.orden).slice(0, 150);
    const onces = {};
    for (const ro of js.rosters || []) onces[ro.homeAway] = { formacion: ro.formation, titulares: (ro.roster || []).filter((j) => j.starter).map((j) => (j.athlete || {}).displayName) };
    return { id, estado: estadoEv({ status: hdr.status || {} }), home: eqs.home, away: eqs.away, estadisticas: tabla, eventos, alineaciones: onces, narracion,
      consultado: new Date().toLocaleTimeString("es-ES") };
  }

  // ------------------------------------------------------------------ La Quiniela (dobles, triples, estrategia y reducciones)
  function quiniela(base, dobles, triples, modo, red) {
    const d = JSON.parse(JSON.stringify(base || {}));
    if (!d.filas || !d.filas.length) return d;
    const signos = "1X2", filas = d.filas, catorce = filas.slice(0, 14);
    let aviso = null;
    if (red === "cond") { aviso = "La condicionada solo se calcula en el programa del PC (necesita mucha potencia)."; red = "ninguna"; }
    const R = (d.reducciones || {})[red];
    if (R) { triples = R.triples; dobles = R.dobles; }
    for (const f of filas) {
      let orden = [0, 1, 2].sort((i, j) => f.p[j] - f.p[i]);
      delete f.rentable;
      if (modo === "rentable" && f.valor) {
        let alt = 0, mejor = -1;
        for (let i = 0; i < 3; i++) { const v = f.p[i] >= f.p[orden[0]] - 0.12 && f.p[i] >= 0.25 ? f.valor[i] : 0; if (v > mejor) { mejor = v; alt = i; } }
        if (alt !== orden[0] && f.valor[alt] > f.valor[orden[0]] * 1.15) { orden = [alt].concat(orden.filter((i) => i !== alt)); f.rentable = true; }
      }
      f.orden = orden; f.duda = 1 - f.p[orden[0]];
    }
    const dudosos = catorce.slice().sort((a, b) => b.duda - a.duda);
    const tset = new Set(dudosos.slice(0, triples).map((f) => f.n)), dset = new Set(dudosos.slice(triples, triples + dobles).map((f) => f.n));
    for (const f of filas) {
      const k = tset.has(f.n) ? 3 : dset.has(f.n) ? 2 : 1, el = f.orden.slice(0, k).sort();
      f.signo = el.map((i) => signos[i]).join(""); f.fiabilidad = el.reduce((s, i) => s + f.p[i], 0);
      f.tipo = k === 3 ? "triple" : k === 2 ? "doble" : "sencillo";
      f.seguridad = f.sin_datos && k < 3 ? "Sin datos" : f.fiabilidad >= 0.75 ? "Muy segura" : f.fiabilidad >= 0.6 ? "Segura" : f.fiabilidad >= 0.45 ? "Dudosa" : "Muy dudosa";
    }
    const pleno = filas.length >= 15 ? filas[14].pleno : null;
    const P = catorce.map((f) => { const s = f.p[0] + f.p[1] + f.p[2]; return f.p.map((x) => x / s); });
    const validos = catorce.map((f) => f.signo.split("").map((c) => signos.indexOf(c)));
    const rng = mulberry32((+d.jornada || 0) + 7), NS = 100000, dist = new Array(catorce.length + 1).fill(0);
    const idxRed = R ? catorce.map((f, j) => (f.tipo === R.tipo ? j : -1)).filter((j) => j >= 0) : [];
    let suma = 0, mejor = 0;
    const res = new Array(catorce.length);
    for (let s = 0; s < NS; s++) {
      for (let j = 0; j < catorce.length; j++) { const u = rng(); res[j] = u < P[j][0] ? 0 : u < P[j][0] + P[j][1] ? 1 : 2; }
      let a = 0;
      if (R) {
        for (let j = 0; j < catorce.length; j++) if (!idxRed.includes(j) && validos[j].includes(res[j])) a++;
        const pos = idxRed.map((j) => validos[j].indexOf(res[j]));
        let m = 0; for (const col of R.columnas) { let c = 0; for (let x = 0; x < pos.length; x++) if (pos[x] === col[x]) c++; if (c > m) m = c; }
        a += m;
      } else for (let j = 0; j < catorce.length; j++) if (validos[j].includes(res[j])) a++;
      dist[a]++; suma += a; if (a > mejor) mejor = a;
    }
    const mas = (k) => dist.slice(k).reduce((x, y) => x + y, 0) / NS;
    let p14 = prod(catorce.map((f) => f.fiabilidad)), apuestas = 2 ** dset.size * 3 ** tset.size;
    if (R) { p14 = mas(14); apuestas = R.columnas.length; }
    const pp = pleno ? pleno.prob : 0;
    const sim = { n: NS, distribucion: dist, media: suma / NS, p10: mas(10), p12: mas(12), p13: mas(13), p14, p15: p14 * pp, mejor,
      veces14: dist.slice(14).reduce((x, y) => x + y, 0), uno_entre_14: p14 > 0 ? Math.round(1 / p14) : null, uno_entre_15: p14 * pp > 0 ? Math.round(1 / (p14 * pp)) : null };
    // Columnas sencillas más probables
    const base0 = catorce.map((f) => f.orden[0]), pr = (col) => prod(col.map((s, k) => P[k][s]));
    const cand = [[pr(base0), base0]];
    for (let j = 0; j < catorce.length; j++) for (const alt of catorce[j].orden.slice(1)) { const c = base0.slice(); c[j] = alt; cand.push([pr(c), c]); }
    for (let a = 0; a < catorce.length; a++) for (let b = a + 1; b < catorce.length; b++) { const c = base0.slice(); c[a] = catorce[a].orden[1]; c[b] = catorce[b].orden[1]; cand.push([pr(c), c]); }
    cand.sort((x, y) => y[0] - x[0]);
    const vistas = new Set(), top = [];
    for (const [p, col] of cand) {
      const k = col.join(""); if (vistas.has(k)) continue; vistas.add(k);
      top.push({ columna: col.map((i) => signos[i]).join(""), prob: p, uno_entre: p > 0 ? Math.round(1 / p) : null, cambios: col.map((s, j) => (s !== base0[j] ? j + 1 : 0)).filter(Boolean) });
      if (top.length >= 6) break;
    }
    const lae = catorce.map((f) => f.lae);
    if (lae.every(Boolean)) {
      const indice = (col) => prod(col.map((s, k) => P[k][s] / Math.max(lae[k][s], 0.01)));
      for (const t of top) t.indice = r2(indice(t.columna.split("").map((c) => signos.indexOf(c))));
      const pBase = cand[0][0];
      let col = base0.slice();
      for (;;) {
        let mc = null;
        for (let j = 0; j < catorce.length; j++) for (let s = 0; s < 3; s++) {
          const c2 = col.slice(); c2[j] = s;
          if (c2.join("") !== col.join("") && pr(c2) >= 0.5 * pBase && indice(c2) > indice(mc || col) * 1.0001) mc = c2;
        }
        if (!mc) break;
        col = mc;
      }
      const p = pr(col);
      sim.columna_rentable = { columna: col.map((i) => signos[i]).join(""), prob: p, indice: r2(indice(col)), uno_entre: p > 0 ? Math.round(1 / p) : null,
        cambios: col.map((s, j) => (s !== base0[j] ? j + 1 : 0)).filter(Boolean), indice_base: r2(indice(base0)) };
    }
    sim.top_columnas = top;
    return Object.assign(d, { filas, simulacion: sim, dobles: dset.size, triples: tset.size, modo, reduccion: R ? red : "ninguna",
      reduccion_nombre: R ? R.nombre : null, condicionada: aviso ? { error: aviso } : null, apuestas,
      coste: r2(apuestas * (d.precio_apuesta || 0.75)), precio_apuesta: d.precio_apuesta || 0.75,
      fiabilidad_media: catorce.reduce((s, f) => s + f.fiabilidad, 0) / catorce.length });
  }

  // ------------------------------------------------------------------ Presupuesto (igual que en el PC)
  const MODOS = {
    prudente: { sencillas: 1.0, combinada: 0.0, valor: 0.0, prob_min: 0.75, texto: "Solo sencillas muy seguras: se cobra poco, pero casi siempre algo." },
    equilibrado: { sencillas: 0.7, combinada: 0.3, valor: 0.0, prob_min: 0.72, texto: "Sencillas seguras y una combinada doble para que pague algo más." },
    atrevido: { sencillas: 0.5, combinada: 0.25, valor: 0.25, prob_min: 0.70, texto: "Además, alguna apuesta de cuota 1,60-2,50: más premio, más riesgo." } };
  const redondeo = (x) => Math.max(0.5, Math.round(x * 2) / 2);
  function repartir(total, pesos) {
    if (!pesos.length) return [];
    const s = pesos.reduce((a, b) => a + b, 0), st = pesos.map((p) => redondeo(total * p / s));
    const sum = () => st.reduce((a, b) => a + b, 0);
    while (sum() > total + 1e-9 && Math.max(...st) > 0.5) st[st.indexOf(Math.max(...st))] -= 0.5;
    while (sum() + 0.5 <= total + 1e-9) st[st.length === 1 ? 0 : st.indexOf(Math.min(...st))] += 0.5;
    return st;
  }
  async function presupuesto(q) {
    const doc_ = await doc("presupuesto/candidatos");
    let euros = Math.max(1, Math.min(num(q.euros, 10), 500));
    const dias = +q.dias || 3, modo = MODOS[q.modo] ? q.modo : "equilibrado", cfg = MODOS[modo];
    const hoy = hoyISO(), lim = hoyISO(dias), ahora = new Date(), minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const seguras = [], valor = [];
    for (const c of (doc_ || {}).candidatos || []) {
      if (!(hoy <= c.fecha && c.fecha <= lim)) continue;
      if (c.hora && c.fecha === hoy) { const [h, m] = String(c.hora).slice(0, 5).split(":").map(Number); if (minAhora > h * 60 + m - 5) continue; }
      const base = { comp: c.comp, liga: c.liga, partido_id: c.partido_id, fecha: c.fecha, hora: c.hora, home: c.home, away: c.away, fiabilidad: c.fiabilidad, avisos: c.avisos || [] };
      const s = c.segura;   // v2.2: lo que el examen suspende (s.examen) no entra en el presupuesto
      if (s.prob >= cfg.prob_min && s.cuota >= 1.2 && !s.examen) seguras.push(Object.assign({}, base, s));
      const a = c.arriesgada;
      if (a && !a.examen && a.prob >= 0.45 && a.prob <= 0.66 && a.cuota >= 1.6 && a.cuota <= 2.6) valor.push(Object.assign({}, base, a));
    }
    const cmp = (...f) => (x, y) => { for (const g of f) { const d = g(x) - g(y); if (d) return d; } return 0; };
    seguras.sort(cmp((x) => +!!x.avisos.length, (x) => -x.fiabilidad, (x) => -x.prob));
    valor.sort(cmp((x) => +!!x.avisos.length, (x) => -(x.prob * x.cuota), (x) => -x.fiabilidad));
    const usados = new Set(), key = (x) => x.comp + "|" + x.partido_id, plan = [];
    const nSen = Math.max(1, Math.min(4, Math.floor(euros * cfg.sencillas / 2) || 1));
    const sen = [];
    for (const x of seguras) { if (sen.length >= nSen) break; if (usados.has(key(x))) continue; sen.push(x); usados.add(key(x)); }
    let combi = [];
    if (cfg.combinada > 0) {
      const ligas = new Set(sen.map((x) => x.comp));
      for (const x of seguras.slice().sort(cmp((x) => +ligas.has(x.comp), (x) => +!!x.avisos.length, (x) => -x.fiabilidad))) {
        if (combi.length >= 2) break;
        if (usados.has(key(x)) || combi.some((c) => c.comp === x.comp)) continue;
        combi.push(x); usados.add(key(x));
      }
      if (combi.length < 2) { combi.forEach((c) => usados.delete(key(c))); combi = []; }
    }
    const val = [];
    if (cfg.valor > 0) for (const x of valor) { if (val.length >= 2) break; if (usados.has(key(x))) continue; val.push(x); usados.add(key(x)); }
    const partes = { sencillas: cfg.sencillas + (combi.length ? 0 : cfg.combinada) + (val.length ? 0 : cfg.valor), combinada: combi.length ? cfg.combinada : 0, valor: val.length ? cfg.valor : 0 };
    const stSen = sen.length ? repartir(euros * partes.sencillas, sen.map((x) => x.prob ** 2)) : [];
    sen.forEach((x, i) => plan.push({ tipo: "sencilla", piernas: [x], cuota: x.cuota, prob: x.prob, stake: stSen[i] }));
    if (combi.length) plan.push({ tipo: "combinada", piernas: combi, cuota: r2(prod(combi.map((c) => c.cuota))), prob: prod(combi.map((c) => c.prob)), stake: redondeo(euros * partes.combinada) });
    const stVal = val.length ? repartir(euros * partes.valor, val.map(() => 1)) : [];
    val.forEach((x, i) => plan.push({ tipo: "valor", piernas: [x], cuota: x.cuota, prob: x.prob, stake: stVal[i] }));
    const tope = { sencilla: Math.max(2, redondeo(euros * 0.35)), combinada: Math.max(1, redondeo(euros * 0.3)), valor: Math.max(1, redondeo(euros * 0.15)) };
    plan.forEach((p) => (p.stake = Math.min(p.stake, tope[p.tipo])));
    let total = plan.reduce((s, p) => s + p.stake, 0);
    while (plan.length && total > euros + 1e-9) { const m = plan.reduce((a, b) => (b.stake > a.stake ? b : a)); if (m.stake <= 0.5) break; m.stake -= 0.5; total -= 0.5; }
    plan.forEach((p) => { p.cobras = r2(p.stake * p.cuota); p.ev = p.prob * p.cuota - 1; });
    const eventos = plan.flatMap((p) => p.piernas), dist = [];
    if (eventos.length && eventos.length <= 14) {
      for (let m = 0; m < 1 << eventos.length; m++) {
        const ok = eventos.map((_, i) => !(m & (1 << i)));
        const p = prod(eventos.map((e, i) => (ok[i] ? e.prob : 1 - e.prob)));
        const cobro = plan.reduce((s, pl) => s + (pl.piernas.every((x) => ok[eventos.indexOf(x)]) ? pl.stake * pl.cuota : 0), 0);
        dist.push([cobro, p]);
      }
    }
    const apostado = plan.reduce((s, p) => s + p.stake, 0);
    const res = { euros, apostado, sobra: r2(euros - apostado), modo, texto_modo: cfg.texto, dias, casa: (doc_ || {}).casa || "Bet365", plan, candidatos: seguras.length };
    if (dist.length) {
      const S = (f) => dist.filter(f).reduce((s, x) => s + x[1], 0);
      Object.assign(res, { esperado: dist.reduce((s, [c, p]) => s + c * p, 0), p_ganar: S(([c]) => c > apostado + 1e-9), p_algo: S(([c]) => c > 0),
        p_cero: S(([c]) => c <= 0), p_recuperar: S(([c]) => c >= apostado - 1e-9), mejor: Math.max(...dist.map((x) => x[0])),
        tipico: dist.slice().sort((a, b) => b[1] - a[1])[0][0] });
    }
    if (!plan.length) res.error = doc_ ? "No hay apuestas lo bastante seguras en esos días. Prueba con más días o con el modo «atrevido»." : "No hay pronósticos calculados todavía.";
    return res;
  }

  // ------------------------------------------------------------------ Mis apuestas (tu diario, guardado en tu cuenta)
  let DIARIO = null;
  async function diarioCargar(forzar) {
    if (DIARIO && !forzar) return DIARIO;
    const r = await rpc("pbct_kv_get", { token: token(), clave: "diario_web" });
    try { DIARIO = JSON.parse(r.valor || "[]"); } catch (e) { DIARIO = []; }
    return DIARIO;
  }
  async function diarioGuardarTodo() {
    const r = await rpc("pbct_kv_set", { token: token(), clave: "diario_web", valor: JSON.stringify(DIARIO) });
    if (r.estado !== "ok") throw new Error(r.estado === "grande" ? "El diario es demasiado grande" : "No se pudo guardar");
  }
  const ahoraTxt = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19).replace("T", " "); };
  async function diarioGuardar(d) {
    const cuota = num(d.cuota), stake = num(d.stake);
    if (!cuota || cuota <= 1 || !stake || stake <= 0) return err("Pon la cuota (mayor que 1) y lo que apostaste.");
    const piernas = (d.piernas || []).map((p) => ({ comp: p.comp || null, partido_id: p.partido_id ?? null, fecha: String(p.fecha || "").slice(0, 10),
      home: p.home || "", away: p.away || "", clave: p.clave || "", mercado: p.mercado || "", prob: num(p.prob), ok: null, real: null,
      ...(p.modelo && typeof p.modelo === "object" ? { modelo: { lh: p.modelo.lh, la: p.modelo.la, ct: p.modelo.ct } } : {}) }));
    if (!piernas.length && !String(d.descripcion || "").trim()) return err("Escribe qué apostaste.");
    const probs = piernas.map((p) => p.prob).filter(Boolean);
    const prob = piernas.length && probs.length === piernas.length ? prod(probs) : null;
    const tipo = d.tipo || (new Set(piernas.map((p) => p.partido_id ?? p.home)).size > 1 ? "combinada" : piernas.length > 1 ? "crear apuesta" : "sencilla");
    const fechas = piernas.map((p) => p.fecha).filter(Boolean).sort();
    const fecha = String(d.fecha || fechas[0] || hoyISO()).slice(0, 10);
    const desc = String(d.descripcion || "").trim() || piernas.map((p) => p.mercado + (p.home ? ` (${p.home} – ${p.away})` : "")).join(" + ");
    await diarioCargar(true);
    const id = DIARIO.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1;
    DIARIO.push({ id, momento: ahoraTxt(), fecha, casa: d.casa || "Bet365", tipo, descripcion: desc.slice(0, 400), cuota, stake, estado: "pendiente",
      cobrado: null, origen: piernas.some((p) => p.clave && p.partido_id != null) ? "programa" : "manual", prob_modelo: prob, piernas,
      nota: String(d.nota || "").slice(0, 300), resuelta: null, clv: null, cuota_cierre: null, cierre_fuente: null });
    await diarioGuardarTodo();
    return { ok: true, id };
  }
  async function diarioCambiar(c) {
    await diarioCargar(true);
    const id = +c.id;
    if (c.borrar) DIARIO = DIARIO.filter((a) => a.id !== id);
    else {
      const a = DIARIO.find((x) => x.id === id);
      if (!a) return err("Apuesta no encontrada");
      if (!["pendiente", "ganada", "perdida", "nula", "cashout"].includes(c.estado)) return err("Estado no válido");
      a.estado = c.estado;
      const fijos = { ganada: a.stake * a.cuota, perdida: 0, nula: a.stake, pendiente: null };
      a.cobrado = c.estado in fijos ? fijos[c.estado] : num(c.cobrado, 0);   // cash out: lo que te devolvieron
      a.resuelta = c.estado !== "pendiente" ? "a mano" : null;
    }
    await diarioGuardarTodo();
    return { ok: true };
  }
  const FAM = { T: "tarjetas", C: "córners", R: "remates", G: "intervalo de goles", M: "goles 1ª parte", S: "resultado exacto" };
  function familia(k) {
    if (!k) return "escrita a mano";
    if (FAM[k[0]]) return FAM[k[0]];
    if (k === "BTTS" || k === "NOBTTS") return "ambos marcan";
    if (["1", "X", "2"].includes(k)) return "ganador (1X2)";
    if (["1X", "X2", "12"].includes(k)) return "doble oportunidad";
    if (k.slice(1, 3).includes("H") && ["1-", "2-", "1+", "2+"].includes(k.slice(0, 2))) return "hándicap";
    if ("HA".includes(k[0])) return "goles de un equipo";
    return "goles (más/menos)";
  }
  const tramo = (c) => (c < 1.5 ? "menos de 1,50" : c < 2 ? "1,50 - 2,00" : c < 3 ? "2,00 - 3,00" : "más de 3,00");
  function acumular(dic, k, a) { const d = dic[k] || (dic[k] = { n: 0, ganadas: 0, apostado: 0, cobrado: 0 }); d.n++; d.ganadas += a.estado === "ganada"; d.apostado += a.stake; d.cobrado += a.cobrado || 0; }
  function cerrar(dic) {
    for (const d of Object.values(dic)) { d.beneficio = d.cobrado - d.apostado; d.roi = d.apostado ? d.beneficio / d.apostado : 0; d.acierto = d.n ? d.ganadas / d.n : 0; }
    return Object.fromEntries(Object.entries(dic).sort((a, b) => b[1].n - a[1].n));
  }
  async function diarioListar() {
    const filas = JSON.parse(JSON.stringify(await diarioCargar(true)));
    filas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.id - a.id);
    for (const f of filas) f.beneficio = f.estado !== "pendiente" && f.cobrado != null ? f.cobrado - f.stake : null;
    const hechas = filas.filter((f) => ["ganada", "perdida", "cashout"].includes(f.estado)).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || a.id - b.id);
    const sum = (l, g) => l.reduce((s, x) => s + g(x), 0);
    const tot = { apuestas: filas.length, pendientes: filas.filter((f) => f.estado === "pendiente").length, resueltas: hechas.length,
      ganadas: hechas.filter((f) => f.estado === "ganada").length, apostado: sum(hechas, (f) => f.stake), cobrado: sum(hechas, (f) => f.cobrado || 0),
      en_juego: sum(filas.filter((f) => f.estado === "pendiente"), (f) => f.stake) };
    tot.beneficio = tot.cobrado - tot.apostado; tot.roi = tot.apostado ? tot.beneficio / tot.apostado : 0; tot.acierto = tot.resueltas ? tot.ganadas / tot.resueltas : 0;
    tot.cuota_media = hechas.length ? sum(hechas, (f) => f.cuota) / hechas.length : null;
    tot.acierto_cuotas = hechas.length ? sum(hechas, (f) => 1 / f.cuota) / hechas.length : null;
    const cp = hechas.filter((f) => f.prob_modelo);
    tot.acierto_modelo = cp.length ? sum(cp, (f) => f.prob_modelo) / cp.length : null;
    tot.acierto_real_modelo = cp.length ? cp.filter((f) => f.estado === "ganada").length / cp.length : null;
    const cc = filas.filter((f) => f.clv != null);
    tot.clv_n = cc.length; tot.clv_media = cc.length ? sum(cc, (f) => f.clv) / cc.length : null; tot.clv_positivas = cc.length ? cc.filter((f) => f.clv > 0).length / cc.length : null;
    const pt = {}, pf = {}, pc = {}, pca = {}, po = {}, pm = {};
    for (const f of hechas) {
      acumular(pt, f.tipo, f);
      const fams = [...new Set((f.piernas || []).map((p) => familia(p.clave)))].sort();
      acumular(pf, !fams.length ? "escrita a mano" : fams.length <= 2 ? fams.join(" + ") : "varias", f);
      acumular(pc, tramo(f.cuota), f); acumular(pca, f.casa || "–", f);
      acumular(po, f.origen === "programa" ? "Del programa" : "Mías (a mano)", f); acumular(pm, (f.fecha || "").slice(0, 7), f);
    }
    const evol = []; let acum = 0;
    for (const f of hechas) { acum += (f.cobrado || 0) - f.stake; evol.push({ fecha: f.fecha, beneficio: r2(acum) }); }
    const ult = hechas.map((f) => f.estado === "ganada").reverse();
    let racha = 0;
    if (ult.length) { for (const x of ult) { if (x !== ult[0]) break; racha++; } if (!ult[0]) racha = -racha; }
    const avisos = [], u10 = hechas.slice(-10);
    if (u10.length >= 5) { const b10 = sum(u10, (f) => (f.cobrado || 0) - f.stake); if (b10 < -2 * (sum(u10, (f) => f.stake) / u10.length)) avisos.push(`En las últimas ${u10.length} apuestas llevas ${b10 >= 0 ? "+" : ""}${b10.toFixed(2)} €. Para un poco o baja lo que pones.`); }
    if (racha <= -4) avisos.push(`Llevas ${-racha} apuestas perdidas seguidas. Es normal que pase, pero no subas lo que apuestas para recuperar.`);
    const media = hechas.length ? tot.apostado / hechas.length : 2;
    if (tot.en_juego > Math.max(3 * media, 10)) avisos.push(`Tienes ${tot.en_juego.toFixed(2)} € en juego ahora mismo: no metas más hasta que se resuelvan.`);
    const pctS = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
    if (tot.clv_n >= 10) {
      if (tot.clv_media > 0.01) avisos.push(`✅ CLV ${pctS(tot.clv_media)} en ${tot.clv_n} apuestas: sueles coger MEJOR cuota que la de cierre. Es la mejor señal de que apuestas bien, aunque una mala racha diga lo contrario.`);
      else if (tot.clv_media < -0.03) avisos.push(`CLV ${pctS(tot.clv_media)} en ${tot.clv_n} apuestas: sueles coger PEOR cuota que la de cierre. A la larga eso pierde dinero: apuesta antes, o solo cuando la cuota sea mejor que la justa.`);
    }
    const malos = Object.entries(cerrar(JSON.parse(JSON.stringify(pf)))).filter(([, d]) => d.n >= 8 && d.roi < -0.15).map(([k]) => k);
    if (malos.length) avisos.push("Pierdes dinero sobre todo en: " + malos.join(", ") + ". Mejor dejar ese tipo de apuesta.");
    return { total: tot, apuestas: filas, por_tipo: cerrar(pt), por_familia: cerrar(pf), por_cuota: cerrar(pc), por_casa: cerrar(pca), por_origen: cerrar(po),
      por_mes: Object.fromEntries(Object.entries(cerrar(pm)).sort()), evolucion: evol, racha, avisos };
  }

  // ------------------------------------------------------------------ historial de predicciones (filtros como en el PC)
  async function historialPartidos(q) {
    const comps = q.comp ? [q.comp] : ((await doc("info")) || { comps: [] }).comps.map((c) => c.id);
    const ds = await docs(comps.map((c) => `historial/partidos/${c}`));
    let filas = Object.values(ds).flatMap((d) => (d && d.partidos) || []);
    if (q.desde) filas = filas.filter((f) => (f.fecha_partido || "") >= q.desde);
    if (q.hasta) filas = filas.filter((f) => (f.fecha_partido || "") <= q.hasta);
    if (q.nivel) filas = filas.filter((f) => f.nivel === q.nivel);
    const e = q.estado;
    if (e === "pendiente") filas = filas.filter((f) => f.gh == null);
    else if (e === "acertada") filas = filas.filter((f) => f.ok_segura === 1);
    else if (e === "fallada") filas = filas.filter((f) => f.ok_segura === 0);
    else if (e === "arriesgada_ok") filas = filas.filter((f) => f.ok_arriesgada === 1);
    else if (e === "marcador_ok") filas = filas.filter((f) => f.ok_marcador === 1);
    if (q.equipo) { const t = q.equipo.toLowerCase(); filas = filas.filter((f) => (f.home || "").toLowerCase().includes(t) || (f.away || "").toLowerCase().includes(t)); }
    const jug = filas.filter((f) => f.gh != null), s = (g) => jug.reduce((a, f) => a + (g(f) || 0), 0), n = (g) => jug.filter((f) => g(f) != null).length;
    const resumen = { partidos: filas.length, jugados: jug.length };
    if (jug.length) Object.assign(resumen, { segura: s((f) => f.ok_segura), arriesgada: s((f) => f.ok_arriesgada), arriesgada_n: n((f) => f.ok_arriesgada),
      marcador: s((f) => f.ok_marcador), corners: s((f) => f.ok_corners), corners_n: n((f) => f.ok_corners), tarjetas: s((f) => f.ok_tarjetas), tarjetas_n: n((f) => f.ok_tarjetas) });
    return { resumen, partidos: filas };
  }

  // ------------------------------------------------------------------ el «servidor» de la web
  async function responder(url, opts) {
    const u = new URL(url, location.href), q = Object.fromEntries(u.searchParams.entries());
    const metodo = ((opts || {}).method || "GET").toUpperCase();
    const cuerpo = (() => { try { return JSON.parse((opts || {}).body || "{}"); } catch (e) { return {}; } })();
    const p = u.pathname.replace(/^.*\/api\//, "").split("/").filter(Boolean).map(decodeURIComponent);
    const ruta = p.join("/");
    if (ruta === "info") {
      const i = await doc("info", true);
      if (!i) return err("Todavía no hay datos: GitHub los calcula en la próxima actualización (10, 15 o 20 h). Vuelve en un rato.");
      return Object.assign({}, i, { usuario: NOMBRE, actualizado: ACTUALIZADO, web: true, nube: true, movil: false, plataforma: "bet365" });
    }
    if (ruta === "salir") { const t = token(); LS.set("pbct_sesion", null); try { if (t) await rpc("pbct_salir", { token: t }); } catch (e) {} return { ok: true }; }
    if (ruta === "plataforma") return { ok: true, plataforma: "bet365" };
    if (ruta === "combinada") return (await doc(`combinada/${[1, 3, 7].includes(+q.dias) ? +q.dias : 3}`)) || err("Todavía no hay combinada calculada.");
    if (ruta === "presupuesto") return presupuesto(q);
    if (ruta === "quiniela") {
      if (q.jornada) return err("En la web solo está la jornada activa (las demás, en el programa del PC).", { filas: [] });
      const b = await doc("quiniela/base", q.recargar === "1");
      if (!b) return err("Todavía no está calculada la quiniela de esta jornada.", { filas: [] });
      return quiniela(b, +q.dobles || 0, +q.triples || 0, q.modo || "segura", q.reduccion || "ninguna");
    }
    if (["quiniela/historial", "quiniela/examen", "examen", "examen/filtro", "tipster", "ia_numeros", "ia/config"].includes(ruta) && metodo === "GET")
      return (await doc(ruta)) || err("Todavía no está calculado. Vuelve tras la próxima actualización.");
    if (ruta === "historial") { const d = await doc(`historial/${q.comp}`); return d || { lista: [], aciertos: {} }; }
    if (ruta === "historial/partidos") return historialPartidos(q);
    if (p[0] === "historial" && p.length === 2) return (await doc(`historial/detalle/${p[1]}`)) || err("En la web solo se guardan las 30 últimas actualizaciones de cada liga (todas, en el programa del PC).", { partidos: [] });
    if (ruta === "diario" && metodo === "GET") return diarioListar();
    if (ruta === "diario" && metodo === "POST") return diarioGuardar(cuerpo);
    if (ruta === "diario/cambiar") return diarioCambiar(cuerpo);
    if (ruta === "tareas") return [];
    if (ruta === "auto") return { activa: false, texto: "" };
    const info = await doc("info");
    if (info && info.comps.some((c) => c.id === p[0]) && p.length >= 2) {
      const comp = p[0], acc = p[1];
      if (acc === "ranking") return (await doc(`${comp}/ranking`)) || { competicion: comp, partidos: [], error: "Todavía no hay pronósticos de esta competición." };
      if (acc === "analizar") {
        const a = await doc(`${comp}/analizar/${q.id}`);
        if (!a) return err("Este partido todavía no está analizado en la web: se analizan los de los próximos 6 días. Vuelve más cerca del partido.");
        return a;
      }
      if (acc === "combinar") return combinar(comp, q);
      if (acc === "equipo") return (await doc(`${comp}/equipo/${q.nombre}`)) || err("No hay ficha de ese equipo.");
      if (acc === "jugadores") return (await doc(`${comp}/jugadores/${q.equipo}`)) || [];
      if (["clasificacion", "resultados", "equipos", "estado", "diagnostico"].includes(acc)) return (await doc(`${comp}/${acc}`)) || err("Sin datos todavía", { sin_datos: true });
      if (acc === "vivo") return vivo(comp);
      if (acc === "vivo_detalle") return vivoDetalle(comp, q.id);
      if (acc === "onces") return { ok: true };
    }
    return err(SOLO_PC);
  }
  window.apiWeb = async function (url, opts) {
    try { return await responder(url, opts); } catch (e) { return err(e.message || String(e)); }
  };
  if (!token()) location.replace("index.html");
})();
