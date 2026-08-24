/* Stadtkarte – die lebende Stadt (X-COM-Apocalypse-Geist):
   Jedes Gebaeude hat Funktion & Besitzer-Organisation. Verkehr, Passanten
   und Polizeistreifen beleben die Strassen. Alien-Alarme in Gebaeuden
   starten Taktik-Einsaetze; Ergebnisse veraendern Beziehungen, Finanzierung
   und die Alien-Infiltration. */
'use strict';

const CW = 30, CH = 20, T = 32;
const canvas = document.getElementById('cityCanvas');
const ctx = canvas.getContext('2d');

/* ---------- Seeded RNG ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Organisationen ---------- */
const ORGS = {
  megapol:   { name: 'Megapol', color: '#3a7bd5', rel: 80 },
  regierung: { name: 'Stadtregierung', color: '#7fd0ff', rel: 70 },
  cyberweb:  { name: 'Cyberweb Industries', color: '#ff8c42', rel: 55 },
  solmine:   { name: 'Solmine Corp', color: '#37b6ff', rel: 60 },
  energon:   { name: 'Energon AG', color: '#ffd24a', rel: 60 },
  sanatorium:{ name: 'Sanatorium-Stiftung', color: '#ff7b9c', rel: 75 },
  habitat:   { name: 'Habitat-Verbund', color: '#7ec97e', rel: 65 },
  gilde:     { name: 'Freihandels-Gilde', color: '#c9a227', rel: 50 },
  syndikat:  { name: 'Syndikat der Unteren Ebenen', color: '#b05fd0', rel: 20 },
  xforce:    { name: 'X-Force (wir)', color: '#4ade80', rel: 100 },
};

/* ---------- Gebaeudetypen ---------- */
const BTYPES = {
  polizei:     { label: 'Polizeiwache', icon: '🚓', org: 'megapol', income: 0,  info: 'Megapol haelt die Ordnung. Streifen patrouillieren im Viertel.' },
  fabrik:      { label: 'Fabrik', icon: '🏭', org: 'cyberweb', income: 20, info: 'Industrieproduktion. Zahlt Schutzgeld... aeh, Foerdermittel, wenn man sie beschuetzt.' },
  buero:       { label: 'Konzernzentrale', icon: '🏢', org: 'solmine', income: 25, info: 'Bueroturm der Solmine Corp. Wichtige Steuerzahler.' },
  wohnblock:   { label: 'Wohnblock', icon: '🏘️', org: 'habitat', income: 8, info: 'Hier lebt die Bevoelkerung. Panik senkt die Stimmung – und die Zahlungen.' },
  markt:       { label: 'Marktkomplex', icon: '🛒', org: 'gilde', income: 15, info: 'Handel mit allem, was legal ist. Meistens.' },
  krankenhaus: { label: 'Krankenhaus', icon: '🏥', org: 'sanatorium', income: 5, info: 'Versorgt deine Verwundeten. Gute Beziehungen = schnellere Genesung.' },
  kraftwerk:   { label: 'Fusionskraftwerk', icon: '⚡', org: 'energon', income: 18, info: 'Versorgt die Stadt. Ein Alien-Ziel erster Klasse.' },
  slum:        { label: 'Untere Ebenen', icon: '🏚️', org: 'syndikat', income: 0, info: 'Das Syndikat regiert hier. Aliens rekrutieren gern im Schatten.' },
  spaceport:   { label: 'Raumhafen', icon: '🚀', org: 'regierung', income: 12, info: 'Tor zur Umlaufbahn – streng bewacht.' },
  lagerhaus:   { label: 'Lagerhaus', icon: '📦', org: 'gilde', income: 10, info: 'Container, Kisten, dunkle Ecken.' },
  base:        { label: 'X-Force HQ', icon: '🛡️', org: 'xforce', income: 0, info: 'Unsere Basis. Klick: zum Basis-Bau.' },
};

/* ---------- Persistenz ---------- */
function loadCity() {
  try { return JSON.parse(localStorage.getItem('apocarena.city') || 'null') || {}; } catch { return {}; }
}
function saveCity() {
  try {
    localStorage.setItem('apocarena.city', JSON.stringify({
      seed: citySeed, day, infiltration,
      rel: Object.fromEntries(Object.entries(ORGS).map(([k, o]) => [k, o.rel])),
    }));
  } catch { }
}
const saved = loadCity();
const citySeed = saved.seed || ((Math.random() * 0xffffffff) >>> 0);
let day = saved.day || 1;
let infiltration = saved.infiltration || 0;
if (saved.rel) for (const k in saved.rel) if (ORGS[k]) ORGS[k].rel = saved.rel[k];

/* ---------- Stadt-Generierung: 5x4 Bloecke, jedes Gebaeude eine Funktion ---------- */
const roadXs = [3, 10, 17, 24];
const roadYs = [4, 10, 15];
function isRoad(x, y) { return roadXs.includes(x) || roadYs.includes(y); }

function genCity(seed) {
  const rng = mulberry32(seed);
  const xs = [[0, 2], [4, 9], [11, 16], [18, 23], [25, 29]];
  const ys = [[0, 3], [5, 9], [11, 14], [16, 19]];
  const plan = ['polizei', 'polizei', 'fabrik', 'fabrik', 'fabrik', 'buero', 'buero', 'buero',
    'wohnblock', 'wohnblock', 'wohnblock', 'wohnblock', 'markt', 'krankenhaus', 'kraftwerk',
    'slum', 'slum', 'spaceport', 'lagerhaus', 'base'];
  // seeded mischen
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  const list = [];
  let idx = 0;
  for (const [y0, y1] of ys) for (const [x0, x1] of xs) {
    const type = plan[idx];
    const t = BTYPES[type];
    list.push({
      id: idx, type, x0, y0, x1, y1,
      org: t.org, alarm: null, damage: 0,
      name: `${t.label} ${String.fromCharCode(65 + (idx % 26))}-${(idx + 3) * 7}`,
    });
    idx++;
  }
  return list;
}
const buildings = genCity(citySeed);
function buildingAt(x, y) {
  return buildings.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) || null;
}

/* ---------- Wirtschaft & Missionen ---------- */
function econPayout() {
  let sum = 0;
  for (const b of buildings) {
    const o = ORGS[b.org];
    const inc = BTYPES[b.type].income;
    if (o && o.rel >= 60 && inc > 0) {
      sum += Math.round(inc * (o.rel / 100) * (1 - (b.damage || 0) / 100));
    }
  }
  return sum;
}

function damageBuilding(b, amt) {
  b.damage = Math.min(90, (b.damage || 0) + amt);
}
function repairDay() {
  for (const b of buildings) if (b.damage > 0) b.damage = Math.max(0, b.damage - 10);
}

/* ---------- Missionstyp je Gebaeudefunktion (Geiselrettung etc.) ---------- */
function missionKindFor(b) {
  if (b.type === 'wohnblock' || b.type === 'krankenhaus' || b.type === 'markt') return 'geisel';
  if (b.type === 'fabrik' || b.type === 'kraftwerk' || b.type === 'lagerhaus') return 'sabotage';
  return 'standard';
}
const KIND_LABEL = {
  geisel: '🧑‍🤝‍🧑 GEISELRETTUNG – rette die Zivilisten!',
  sabotage: '🧨 SABOTAGE-TRUPP – sichere die Anlage!',
  standard: '⚔ SAEUBERUNG',
};
function walletAddLoot(n) {
  try {
    localStorage.setItem('apocarena.loot',
      String((Number(localStorage.getItem('apocarena.loot')) || 0) + n));
  } catch { }
}
function pendingLoot() {
  try { return Number(localStorage.getItem('apocarena.loot')) || 0; } catch { return 0; }
}

function applyMissionResult(res) {
  const o = ORGS[res.org];
  if (res.won) {
    if (o) o.rel = Math.min(100, o.rel + 10);
    infiltration = Math.max(0, infiltration - 5);
    ticker(`✅ Einsatz in "${res.name}" erfolgreich! ${o ? o.name + ' +10 Beziehung' : ''}, Infiltration -5.`, 'good');
  } else {
    if (o) o.rel = Math.max(0, o.rel - 8);
    infiltration = Math.min(100, infiltration + 8);
    ticker(`❌ Einsatz in "${res.name}" gescheitert. ${o ? o.name + ' -8 Beziehung' : ''}, Infiltration +8.`, 'bad');
  }
  // Geiselrettung: Zivilisten-Bilanz wirkt auf den Ruf
  if (res.kind === 'geisel') {
    const saved2 = res.civSaved || 0, dead2 = res.civDead || 0;
    if (saved2 > 0 && o) { o.rel = Math.min(100, o.rel + Math.min(6, saved2)); }
    if (dead2 >= 3) {
      for (const k of ['habitat', 'regierung']) ORGS[k].rel = Math.max(0, ORGS[k].rel - 4);
      ticker(`🕯️ ${dead2} Zivilisten kamen beim Einsatz um – die Stadt trauert. Habitat & Regierung -4.`, 'bad');
    } else if (saved2 > 0) {
      ticker(`🎗️ ${saved2} Geiseln gerettet – die Bevoelkerung feiert X-Force!`, 'good');
    }
  }
  saveCity();
}

/* ---------- UI ---------- */
function $id(i) { return document.getElementById(i); }
function ticker(html, cls) {
  const el = $id('ticker');
  if (!el) return;
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  el.prepend(div);
  while (el.children.length > 40) el.removeChild(el.lastChild);
}
function renderOrgs() {
  const el = $id('orgs');
  if (!el) return;
  el.innerHTML = '';
  for (const [k, o] of Object.entries(ORGS)) {
    if (k === 'xforce') continue;
    const div = document.createElement('div');
    div.className = 'orgline';
    const col = o.rel >= 60 ? '#4ade80' : o.rel >= 35 ? '#fbbf24' : '#ff5f4f';
    div.innerHTML = `<span style="color:${o.color}">●</span> <span style="flex:1;margin-left:6px">${o.name}</span>
      <span class="relbar"><span class="relfill" style="width:${o.rel}%;background:${col}"></span></span>
      <span style="width:30px;text-align:right;color:${col}">${o.rel}</span>`;
    el.appendChild(div);
  }
}
function updateBar() {
  $id('cWallet').textContent = pendingLoot();
  $id('cDay').textContent = day;
  $id('cAlarms').textContent = buildings.filter(b => b.alarm).length;
  $id('infilFill').style.width = infiltration + '%';
  renderOrgs();
}

let selectedB = null;
function showBuilding(b) {
  selectedB = b;
  const t = BTYPES[b.type];
  const o = ORGS[b.org];
  let html = `<h4>${t.icon} ${b.name}</h4>
    <div class="dim2">${t.info}</div>
    <div style="margin-top:6px">Besitzer: <b style="color:${o.color}">${o.name}</b> · Beziehung: <b>${o.rel}</b></div>
    ${t.income ? `<div>Foerdert X-Force mit bis zu <b>${t.income} Cr/Tag</b> (ab Beziehung 60).</div>` : ''}`;
  if (b.type === 'base') html += `<div style="margin-top:8px"><a href="base.html" style="color:var(--accent)">🏗️ Zum Basis-Bau &rarr;</a></div>`;
  if (b.damage > 0) html += `<div style="color:#ff8c42">🔥 Gebaeudeschaden: ${b.damage}% (Wiederaufbau ~${Math.ceil(b.damage / 10)} Tage)</div>`;
  if (b.alarm) {
    html += `<div style="margin-top:8px;color:#ff8dc7"><b>🛸 ALIEN-AKTIVITAET!</b><br>${KIND_LABEL[missionKindFor(b)]}</div>
      <button id="btnMission" class="big danger" style="width:100%;margin-top:6px">⚔ Einsatzteam entsenden</button>`;
  }
  $id('binfo').innerHTML = html;
  const btn = $id('btnMission');
  if (btn) btn.onclick = () => {
    try {
      localStorage.setItem('apocarena.mission', JSON.stringify({
        id: b.id, name: b.name, org: b.org, kind: missionKindFor(b),
      }));
    } catch { }
    window.location.href = '/?mission=1';
  };
}

// Klick/Hover laufen ueber die isometrische Rueckprojektion
canvas.addEventListener('click', (ev) => {
  const r = canvas.getBoundingClientRect();
  const pxX = (ev.clientX - r.left) / r.width * canvas.width;
  const pxY = (ev.clientY - r.top) / r.height * canvas.height;
  const u = ufoAt(pxX, pxY);
  if (u) { launchInterceptor(u); return; }
  const cr = crashAt(pxX, pxY);
  if (cr) {
    try {
      localStorage.setItem('apocarena.mission', JSON.stringify({
        id: cr.id, name: 'UFO-Absturzstelle', org: 'regierung', kind: 'bergung',
      }));
    } catch { }
    window.location.href = '/?mission=1';
    return;
  }
  const t = cityTileAt(pxX, pxY);
  const b = buildingAt(t.x, t.y);
  if (b) showBuilding(b);
});
let hoverB = null;
canvas.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  const pxX = (ev.clientX - r.left) / r.width * canvas.width;
  const pxY = (ev.clientY - r.top) / r.height * canvas.height;
  const t = cityTileAt(pxX, pxY);
  hoverB = buildingAt(t.x, t.y);
  canvas.style.cursor = (hoverB || ufoAt(pxX, pxY) || crashAt(pxX, pxY)) ? 'pointer' : 'default';
});

/* ---------- Verkehr & Passanten ---------- */
const rng2 = mulberry32(citySeed ^ 0xAB);
function roadCells() {
  const cells = [];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (isRoad(x, y)) cells.push([x, y]);
  return cells;
}
const roads = roadCells();
function makeMover(speed, police) {
  const [x, y] = roads[Math.floor(rng2() * roads.length)];
  return { x, y, rx: x, ry: y, speed, police, dir: [1, 0], wait: 0 };
}
const cars = [];
for (let i = 0; i < 9; i++) cars.push(makeMover(0.055 + rng2() * 0.03, false));
for (let i = 0; i < 2; i++) cars.push(makeMover(0.075, true));
const peds = [];
for (let i = 0; i < 16; i++) peds.push(makeMover(0.02 + rng2() * 0.012, false));

function stepMover(m) {
  const dx = m.x - m.rx, dy = m.y - m.ry;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    m.rx += Math.sign(dx) * Math.min(Math.abs(dx), m.speed);
    m.ry += Math.sign(dy) * Math.min(Math.abs(dy), m.speed);
    return;
  }
  m.rx = m.x; m.ry = m.y;
  // naechstes Straßenfeld: geradeaus bevorzugen
  const opts = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const d of dirs) {
    const nx = m.x + d[0], ny = m.y + d[1];
    if (nx < 0 || ny < 0 || nx >= CW || ny >= CH || !isRoad(nx, ny)) continue;
    const straight = d[0] === m.dir[0] && d[1] === m.dir[1];
    const back = d[0] === -m.dir[0] && d[1] === -m.dir[1];
    opts.push({ d, w: straight ? 6 : back ? 0.3 : 1.5 });
  }
  if (!opts.length) return;
  let total = opts.reduce((a, o) => a + o.w, 0);
  let pick = Math.random() * total;
  for (const o of opts) {
    pick -= o.w;
    if (pick <= 0) { m.dir = o.d; m.x += o.d[0]; m.y += o.d[1]; break; }
  }
}

/* ---------- UFOs & Abfangjaeger ---------- */
const ufos = [];
const crashes = [];
const streetFights = [];
let interceptor = null;

function createCrashSite(x, y) {
  crashes.push({ id: 'crash' + Date.now(), x, y, day });
  ticker('🛸 <b>Absturzstelle markiert!</b> Bergungsteam entsenden, bevor das Syndikat die Truemmer pluendert (2 Tage).', 'good');
}
function crashScreen(c) { return { x: cxp(c.x + 0.5, c.y + 0.5), y: cyp(c.x + 0.5, c.y + 0.5) }; }
function crashAt(pxX, pxY) {
  return crashes.find(c => { const p = crashScreen(c); return Math.hypot(p.x - pxX, p.y - pxY) < 30; }) || null;
}
let lastUfo = performance.now() - 20000;
const UFO_EVERY = 35000;
const INTERCEPT_COST = 200;

function spawnUfo() {
  const cands = buildings.filter(b => b.type !== 'base');
  const target = cands[Math.floor(Math.random() * cands.length)];
  const fromLeft = Math.random() < 0.5;
  ufos.push({
    x: fromLeft ? -2 : CW + 2, y: 1 + Math.random() * (CH - 2),
    tx: (target.x0 + target.x1 + 1) / 2, ty: (target.y0 + target.y1 + 1) / 2,
    target, phase: 'fly', beamT: 0, hp: 3,
  });
  ticker(`🛸 <b>UFO gesichtet!</b> Kurs auf "${target.name}". Klick es an und starte den Abfangjaeger!`, 'alarm');
}

function ufoScreen(u, now) {
  const bob = Math.sin((now || performance.now()) / 300) * 3;
  return { x: cxp(u.x, u.y), y: cyp(u.x, u.y) - 96 + bob };
}
function ufoAt(pxX, pxY) {
  const now = performance.now();
  return ufos.find(u => { const p = ufoScreen(u, now); return Math.hypot(p.x - pxX, p.y - pxY) < 28; }) || null;
}

function launchInterceptor(ufo) {
  if (interceptor) { ticker('✈️ Der Abfangjaeger ist bereits in der Luft.', 'bad'); return; }
  if (pendingLoot() < INTERCEPT_COST) { ticker(`⛔ Abfangjaeger kostet ${INTERCEPT_COST} Cr (Beute-Konto zu leer).`, 'bad'); return; }
  walletAddLoot(-INTERCEPT_COST);
  const hq = buildings.find(b => b.type === 'base');
  interceptor = {
    x: (hq.x0 + hq.x1 + 1) / 2, y: (hq.y0 + hq.y1 + 1) / 2,
    ufo, shots: 0, t0: performance.now(),
  };
  ticker(`✈️ <b>Abfangjaeger gestartet</b> (-${INTERCEPT_COST} Cr) – Ziel: UFO ueber "${ufo.target.name}".`);
  updateBar();
}

function ufoTick() {
  for (let i = ufos.length - 1; i >= 0; i--) {
    const u = ufos[i];
    if (u.phase === 'fly') {
      const dx = u.tx - u.x, dy = u.ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.15) { u.phase = 'attack'; u.beamT = 0; }
      else { u.x += dx / d * 0.045; u.y += dy / d * 0.045; }
    } else if (u.phase === 'attack') {
      u.beamT++;
      if (u.beamT % 90 === 0) {
        damageBuilding(u.target, 10);
        ticker(`💥 UFO beschiesst "${u.target.name}" – Schaden ${u.target.damage}%.`, 'bad');
        updateBar();
        if (u.target.damage >= 60) { u.phase = 'leave'; }
      }
    } else if (u.phase === 'leave') {
      u.x += 0.09; u.y -= 0.02;
      if (u.x > CW + 3) { ufos.splice(i, 1); infiltration = Math.min(100, infiltration + 4); saveCity(); updateBar(); }
    }
  }
  // Abfangjaeger
  if (interceptor) {
    const it = interceptor, u = it.ufo;
    if (!ufos.includes(u)) { interceptor = null; return; }
    const dx = u.x - it.x, dy = u.y - it.y;
    const d = Math.hypot(dx, dy);
    if (d > 1.6) {
      it.x += dx / d * 0.11; it.y += dy / d * 0.11;
    } else if (performance.now() - it.t0 > it.shots * 450) {
      it.shots++;
      if (Math.random() < 0.45) u.hp--;
      if (u.hp <= 0) {
        ufos.splice(ufos.indexOf(u), 1);
        interceptor = null;
        infiltration = Math.max(0, infiltration - 4);
        ticker('🎆 <b>UFO abgeschossen!</b> Infiltration -4.', 'good');
        createCrashSite(u.x, u.y);
        updateBar();
      } else if (it.shots > 10) {
        interceptor = null;
        u.phase = 'leave';
        ticker('✈️ Abfangjaeger muss abdrehen – das UFO entkommt beschaedigt.', 'bad');
      }
    }
  }
}

/* ---------- Alarme & Tagesrhythmus ---------- */
let lastAlarm = performance.now();
let lastDay = performance.now();
const ALARM_EVERY = 18000, ALARM_TTL = 75000, DAY_EVERY = 40000;

function cityTick(now) {
  // neue Alarme
  if (now - lastAlarm > ALARM_EVERY && buildings.filter(b => b.alarm).length < 2) {
    lastAlarm = now;
    const cands = buildings.filter(b => !b.alarm && b.type !== 'base' && b.type !== 'polizei');
    if (cands.length) {
      const b = cands[Math.floor(Math.random() * cands.length)];
      b.alarm = { t0: now };
      ticker(`🛸 <b>Alarm:</b> Alien-Aktivitaet in "${b.name}" (${ORGS[b.org].name})! Einsatzteam entsenden!`, 'alarm');
      updateBar();
    }
  }
  // verfallene Alarme
  for (const b of buildings) {
    if (b.alarm && now - b.alarm.t0 > ALARM_TTL) {
      b.alarm = null;
      infiltration = Math.min(100, infiltration + 6);
      const o = ORGS[b.org];
      if (o) o.rel = Math.max(0, o.rel - 6);
      ticker(`👾 Alarm in "${b.name}" ignoriert – die Aliens nisten sich ein. Infiltration +6, ${o.name} -6.`, 'bad');
      saveCity();
      updateBar();
    }
  }
  // UFO-Spawns
  if (now - lastUfo > UFO_EVERY && ufos.length < 2) {
    lastUfo = now;
    spawnUfo();
  }
  ufoTick();
  // Sichtbare Strassengefechte zwischen Organisationen
  if (!cityTick.fightAt || now - cityTick.fightAt > 65000) {
    cityTick.fightAt = now;
    if (Math.random() < 0.55) {
      const spot = roads[Math.floor(Math.random() * roads.length)];
      streetFights.push({ x: spot[0], y: spot[1], until: now + 9000 });
      const pair = Math.random() < 0.5
        ? ['Megapol', 'dem Syndikat'] : ['Cyberweb-Werkschutz', 'Gang-Laeufern'];
      ticker(`🔫 <b>Strassengefecht:</b> ${pair[0]} liefert sich ein Feuergefecht mit ${pair[1]}!`, 'alarm');
      ORGS.megapol.rel = Math.min(100, ORGS.megapol.rel + 1);
      saveCity();
    }
  }
  for (let i = streetFights.length - 1; i >= 0; i--) {
    if (now > streetFights[i].until) streetFights.splice(i, 1);
  }
  // Organisations-Zwischenfaelle (die Stadt lebt auch ohne uns)
  if (!cityTick.feudAt || now - cityTick.feudAt > 50000) {
    cityTick.feudAt = now;
    if (Math.random() < 0.6) {
      const keys = Object.keys(ORGS).filter(k => k !== 'xforce');
      const a = ORGS[keys[Math.floor(Math.random() * keys.length)]];
      const evs = [
        `${a.name} meldet Rekordgewinne.`,
        `Streik bei ${a.name} – Produktion stockt.`,
        `Geruecht: ${a.name} verhandelt heimlich mit dem Syndikat.`,
        `${a.name} spendet fuer den Wiederaufbau der Stadt.`,
      ];
      ticker(`📰 ${evs[Math.floor(Math.random() * evs.length)]}`);
    }
  }
  // Tagesende: Finanzierung
  if (now - lastDay > DAY_EVERY) {
    lastDay = now;
    day++;
    repairDay();
    for (let i = crashes.length - 1; i >= 0; i--) {
      if (day - crashes[i].day >= 2) {
        crashes.splice(i, 1);
        infiltration = Math.min(100, infiltration + 5);
        ticker('🏴 Das Syndikat hat eine unbewachte Absturzstelle gepluendert. Infiltration +5.', 'bad');
      }
    }
    const pay = econPayout();
    walletAddLoot(pay);
    ticker(`📅 <b>Tag ${day}:</b> Verbuendete Organisationen zahlen <b>+${pay} Cr</b> Foerderung ins Beute-Konto.`, 'good');
    if (infiltration >= 70) ticker('⚠️ <b>Warnung:</b> Die Alien-Infiltration ist kritisch! Ignoriere keine Alarme.', 'bad');
    saveCity();
    updateBar();
  }
}

/* ---------- Rendering ---------- */
/* ---------- Isometrische Projektion der Stadt ---------- */
const ISO_C = { tw: 36, th: 18, ox: 480, oy: 132 };
function cxp(x, y) { return ISO_C.ox + (x - y) * ISO_C.tw / 2; }
function cyp(x, y, z) { return ISO_C.oy + (x + y) * ISO_C.th / 2 - (z || 0); }
function cityTileAt(px, py) {
  const rx = px - ISO_C.ox, ry = py - ISO_C.oy;
  const a = rx / (ISO_C.tw / 2), b = ry / (ISO_C.th / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}
function tileDiamond(x, y) {
  const tX = cxp(x, y), tY = cyp(x, y);
  ctx.beginPath();
  ctx.moveTo(tX, tY);
  ctx.lineTo(tX + ISO_C.tw / 2, tY + ISO_C.th / 2);
  ctx.lineTo(tX, tY + ISO_C.th);
  ctx.lineTo(tX - ISO_C.tw / 2, tY + ISO_C.th / 2);
  ctx.closePath();
}
function hex2rgb(h) {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function shade(h, f) {           // f>0 heller, f<0 dunkler
  const [r, g, b] = hex2rgb(h);
  const m = (v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
const BHEIGHT = { buero: 92, spaceport: 66, krankenhaus: 48, wohnblock: 58, polizei: 44, kraftwerk: 40, fabrik: 34, markt: 30, lagerhaus: 26, slum: 20, base: 50 };

function face(P, Q, Q2, P2, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.lineTo(Q2[0], Q2[1]); ctx.lineTo(P2[0], P2[1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
// beleuchtete Fenster auf einer Seitenflaeche (Basis-Kante P->Q, Hoehe h)
function faceWindows(P, Q, h, rows, cols, seed, warm) {
  for (let r = 0; r < rows; r++) {
    const v1 = h * (0.14 + 0.72 * r / rows), v2 = h * (0.14 + 0.72 * (r + 1) / rows);
    for (let c = 0; c < cols; c++) {
      const hash = (seed * 31 + r * 7 + c * 13) % 7;
      if (hash > 3) continue;
      const t1 = (c + 0.3) / cols, t2 = (c + 0.7) / cols;
      const x1 = P[0] + (Q[0] - P[0]) * t1, y1 = P[1] + (Q[1] - P[1]) * t1;
      const x2 = P[0] + (Q[0] - P[0]) * t2, y2 = P[1] + (Q[1] - P[1]) * t2;
      ctx.fillStyle = warm && hash < 2 ? 'rgba(255,214,140,0.85)' : 'rgba(150,210,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(x1, y1 - v1); ctx.lineTo(x2, y2 - v1); ctx.lineTo(x2, y2 - v2); ctx.lineTo(x1, y1 - v2);
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawBuildingIso(b, now) {
  const t = BTYPES[b.type], o = ORGS[b.org];
  const h = BHEIGHT[b.type] || 40;
  const x0 = b.x0, y0 = b.y0, x1 = b.x1 + 1, y1 = b.y1 + 1;
  const A = [cxp(x0, y0), cyp(x0, y0)], B = [cxp(x1, y0), cyp(x1, y0)];
  const C = [cxp(x1, y1), cyp(x1, y1)], D = [cxp(x0, y1), cyp(x0, y1)];
  const up = (p) => [p[0], p[1] - h];
  const A2 = up(A), B2 = up(B), C2 = up(C), D2 = up(D);
  const sel = (hoverB === b || selectedB === b);

  // Boden-Schatten
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(A[0], A[1] + 2); ctx.lineTo(B[0], B[1] + 2); ctx.lineTo(C[0], C[1] + 2); ctx.lineTo(D[0], D[1] + 2);
  ctx.closePath(); ctx.fill();

  // linke Flaeche (y=y1): D->C ; rechte Flaeche (x=x1): C->B  (dunkle Nacht-Fassaden)
  face(D, C, C2, D2, shade(o.color, -0.72), 'rgba(0,0,0,0.5)');
  face(C, B, B2, C2, shade(o.color, -0.84), 'rgba(0,0,0,0.5)');
  const cols = Math.max(2, Math.round((b.x1 - b.x0 + 1) * 2));
  const rows = Math.max(2, Math.round(h / 14));
  faceWindows(D, C, h, rows, cols, b.id + 3, true);
  faceWindows(C, B, h, rows, cols, b.id + 5, false);

  // Dach
  ctx.beginPath();
  ctx.moveTo(A2[0], A2[1]); ctx.lineTo(B2[0], B2[1]); ctx.lineTo(C2[0], C2[1]); ctx.lineTo(D2[0], D2[1]);
  ctx.closePath();
  ctx.fillStyle = shade(o.color, -0.45); ctx.fill();
  // Neon-Dachkante in Organisationsfarbe
  ctx.strokeStyle = sel ? '#ffffff' : o.color;
  ctx.lineWidth = sel ? 2 : 1.4; ctx.stroke();
  ctx.strokeStyle = o.color + '33';
  ctx.lineWidth = 4; ctx.stroke();

  // Dach-Detail je Typ
  const rcx = (A2[0] + C2[0]) / 2, rcy = (A2[1] + C2[1]) / 2;
  if (b.type === 'base') {
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(rcx, rcy, 12, 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#4ade80';
    ctx.fillText('H', rcx, rcy + 3);
  } else if (b.type === 'buero' || b.type === 'spaceport') {
    ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(rcx, rcy - 12); ctx.stroke();
    const blink = Math.sin(now / 260 + b.id) > 0.3;
    ctx.fillStyle = blink ? '#ff5f7a' : 'rgba(255,95,122,0.25)';
    ctx.beginPath(); ctx.arc(rcx, rcy - 13, 2, 0, Math.PI * 2); ctx.fill();
  } else if (b.type === 'kraftwerk') {
    const g = ctx.createRadialGradient(rcx - 3, rcy - 3, 1, rcx, rcy, 9);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(1, '#c98a1a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(rcx, rcy, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Alarm-Ring + Schaden
  if (b.alarm) {
    const pulse = 0.4 + 0.35 * Math.sin(now / 220);
    ctx.strokeStyle = `rgba(255,60,120,${pulse})`; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(A2[0], A2[1]); ctx.lineTo(B2[0], B2[1]); ctx.lineTo(C2[0], C2[1]); ctx.lineTo(D2[0], D2[1]);
    ctx.closePath(); ctx.stroke();
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🛸', rcx + 20, rcy - h * 0.2);
  }
  if (b.damage > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(A2[0] - 2, A2[1] - 12, 46, 6);
    ctx.fillStyle = '#ff8c42';
    ctx.fillRect(A2[0] - 2, A2[1] - 12, 46 * b.damage / 100, 6);
  }
  // Label
  ctx.font = 'bold 9.5px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(215,225,238,0.9)';
  ctx.fillText(t.icon + ' ' + t.label, rcx, C[1] + 12);
}

function render(now) {
  requestAnimationFrame(render);
  cityTick(now);
  for (const m of cars) stepMover(m);
  for (const m of peds) stepMover(m);

  // Nachthimmel-Vignette
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#05070c'); sky.addColorStop(1, '#0a0f16');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Strassen & Boden (Diamanten)
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (isRoad(x, y)) {
      tileDiamond(x, y);
      ctx.fillStyle = '#0d1117'; ctx.fill();
      ctx.strokeStyle = 'rgba(55,182,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      tileDiamond(x, y);
      const sh = ((x * 7 + y * 13) % 4);
      ctx.fillStyle = `rgb(${14 + sh},${17 + sh},${22 + sh})`; ctx.fill();
      // nasser Lichtschimmer auf manchen Platten
      if (sh === 0) { ctx.fillStyle = 'rgba(120,180,255,0.03)'; ctx.fill(); }
    }
  }
  // Neon-Fahrspurmittellinien auf Strassen
  ctx.strokeStyle = 'rgba(55,182,255,0.20)';
  ctx.setLineDash([5, 7]); ctx.lineWidth = 1.4;
  for (const rx of roadXs) {
    ctx.beginPath(); ctx.moveTo(cxp(rx + 0.5, 0), cyp(rx + 0.5, 0));
    ctx.lineTo(cxp(rx + 0.5, CH), cyp(rx + 0.5, CH)); ctx.stroke();
  }
  for (const ry of roadYs) {
    ctx.beginPath(); ctx.moveTo(cxp(0, ry + 0.5), cyp(0, ry + 0.5));
    ctx.lineTo(cxp(CW, ry + 0.5), cyp(CW, ry + 0.5)); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Gebaeude tiefensortiert
  const sorted = buildings.slice().sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0));
  for (const b of sorted) drawBuildingIso(b, now);

  // Fahrzeuge (auf Strassen, mit Licht)
  for (const m of cars) {
    const gx = cxp(m.rx + 0.5, m.ry + 0.5), gy = cyp(m.rx + 0.5, m.ry + 0.5);
    const horiz = m.dir[0] !== 0;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(horiz ? Math.PI / 6 : -Math.PI / 6);
    ctx.fillStyle = m.police ? '#3a7bd5' : ['#5b6570', '#6e5a2a', '#4a5560'][Math.floor((m.speed * 1000) % 3)];
    ctx.beginPath(); ctx.roundRect(-6, -3, 12, 6, 2); ctx.fill();
    if (m.police) {
      const blink = Math.sin(performance.now() / 120) > 0;
      ctx.fillStyle = blink ? '#ff4a4a' : '#4a9bff';
      ctx.fillRect(-1.5, -1.5, 3, 3);
    } else {
      ctx.fillStyle = 'rgba(255,240,180,0.7)';
      ctx.fillRect(4.5, -1.5, 2, 3);
    }
    ctx.restore();
  }
  // Passanten
  ctx.fillStyle = '#c9be6e';
  for (const m of peds) {
    ctx.beginPath();
    ctx.arc(cxp(m.rx + 0.5, m.ry + 0.5) + 4, cyp(m.rx + 0.5, m.ry + 0.5) + 4, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Strassengefechte
  for (const f of streetFights) {
    const fx2 = cxp(f.x + 0.5, f.y + 0.5), fy2 = cyp(f.x + 0.5, f.y + 0.5);
    if (Math.random() < 0.25) {
      ctx.fillStyle = 'rgba(255,230,120,0.9)';
      const ox = (Math.random() - 0.5) * 22, oy = (Math.random() - 0.5) * 12;
      ctx.beginPath(); ctx.arc(fx2 + ox, fy2 + oy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚠️', fx2, fy2 - 16);
  }

  // Absturzstellen
  for (const c of crashes) {
    const p = crashScreen(c);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(0.4);
    ctx.fillStyle = '#2a2136';
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a4a76'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const fl = 0.5 + 0.4 * Math.sin(now / 130 + c.x);
    ctx.fillStyle = `rgba(255,150,50,${fl})`;
    ctx.beginPath(); ctx.arc(p.x + 6, p.y - 3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,80,80,0.25)';
    ctx.beginPath(); ctx.arc(p.x + 8, p.y - 12 - (now / 60 % 8), 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(74,222,128,${0.4 + 0.3 * Math.sin(now / 300)})`;
    ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 26, 13, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#4ade80'; ctx.textAlign = 'center';
    ctx.fillText('BERGUNG', p.x, p.y + 26);
  }

  // UFOs (schweben hoch ueber der Stadt, mit Bodenschatten)
  for (const u of ufos) {
    const p = ufoScreen(u, now);
    const ground = cyp(u.x, u.y);
    if (u.phase === 'attack') {
      const bp = { x: cxp(u.tx, u.ty), y: cyp(u.tx, u.ty) };
      ctx.strokeStyle = `rgba(180,95,208,${0.4 + 0.3 * Math.sin(now / 90)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + 6); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cxp(u.x, u.y), ground, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, 18);
    g.addColorStop(0, '#d8c9ff'); g.addColorStop(0.5, '#8a5fd0'); g.addColorStop(1, '#3a2a56');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(216,201,255,0.8)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 5, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) {
      const la = now / 200 + k * Math.PI / 2;
      ctx.fillStyle = '#ff8dc7';
      ctx.beginPath(); ctx.arc(p.x + Math.cos(la) * 13, p.y + Math.sin(la) * 5, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Abfangjaeger
  if (interceptor) {
    const it = interceptor;
    const ip = { x: cxp(it.x, it.y), y: cyp(it.x, it.y) - 60 };
    const up2 = ufoScreen(it.ufo, now);
    const ang = Math.atan2(up2.y - ip.y, up2.x - ip.x);
    ctx.save(); ctx.translate(ip.x, ip.y); ctx.rotate(ang);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (Math.hypot(it.ufo.x - it.x, it.ufo.y - it.y) <= 1.7 && Math.sin(now / 80) > 0.3) {
      ctx.strokeStyle = 'rgba(255,230,120,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ip.x, ip.y); ctx.lineTo(up2.x, up2.y); ctx.stroke();
    }
  }
}

// Ambient: Stadt-Summen
let cityAmbient = null;
document.addEventListener('click', () => {
  if (cityAmbient) return;
  try {
    cityAmbient = new (window.AudioContext || window.webkitAudioContext)();
    const o = cityAmbient.createOscillator(), g = cityAmbient.createGain();
    o.type = 'sawtooth'; o.frequency.value = 52;
    g.gain.value = 0.006;
    const f = cityAmbient.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 200;
    o.connect(f).connect(g).connect(cityAmbient.destination);
    o.start();
  } catch { }
}, { once: true });

/* ---------- Start ---------- */
(function init() {
  // Einsatz-Ergebnis aus dem Gefecht verbuchen
  try {
    const res = JSON.parse(localStorage.getItem('apocarena.missionresult') || 'null');
    if (res) {
      applyMissionResult(res);
      localStorage.removeItem('apocarena.missionresult');
    }
  } catch { }
  ticker(`🌆 Willkommen in der Stadt. ${buildings.length} Gebaeude, ${Object.keys(ORGS).length - 1} Organisationen – und irgendwo da draussen: die Aliens.`);
  saveCity();
  updateBar();
  requestAnimationFrame(render);
})();
