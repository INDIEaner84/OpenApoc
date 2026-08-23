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

canvas.addEventListener('click', (ev) => {
  const r = canvas.getBoundingClientRect();
  const pxX = (ev.clientX - r.left) / r.width * CW * T;
  const pxY = (ev.clientY - r.top) / r.height * CH * T;
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
  const x = Math.floor(pxX / T), y = Math.floor(pxY / T);
  const b = buildingAt(x, y);
  if (b) showBuilding(b);
});
let hoverB = null;
canvas.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * CW);
  const y = Math.floor((ev.clientY - r.top) / r.height * CH);
  hoverB = buildingAt(x, y);
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
function crashAt(pxX, pxY) {
  return crashes.find(c => Math.hypot(c.x * T - pxX, c.y * T - pxY) < 28) || null;
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

function ufoAt(pxX, pxY) {
  return ufos.find(u => Math.hypot(u.x * T - pxX, u.y * T - pxY) < 26) || null;
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
function render(now) {
  requestAnimationFrame(render);
  cityTick(now);
  for (const m of cars) stepMover(m);
  for (const m of peds) stepMover(m);

  // Strassen & Untergrund
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (isRoad(x, y)) {
      ctx.fillStyle = '#14181e';
      ctx.fillRect(x * T, y * T, T, T);
    } else {
      const shade = ((x * 7 + y * 13) % 5);
      ctx.fillStyle = `rgb(${18 + shade},${21 + shade},${26 + shade})`;
      ctx.fillRect(x * T, y * T, T, T);
    }
  }
  // Fahrbahnmarkierungen
  ctx.strokeStyle = 'rgba(55,182,255,0.18)';
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1.5;
  for (const rx of roadXs) {
    ctx.beginPath();
    ctx.moveTo(rx * T + T / 2, 0);
    ctx.lineTo(rx * T + T / 2, CH * T);
    ctx.stroke();
  }
  for (const ry of roadYs) {
    ctx.beginPath();
    ctx.moveTo(0, ry * T + T / 2);
    ctx.lineTo(CW * T, ry * T + T / 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Gebaeude
  for (const b of buildings) {
    const t = BTYPES[b.type];
    const o = ORGS[b.org];
    const px0 = b.x0 * T + 3, py0 = b.y0 * T + 3;
    const w = (b.x1 - b.x0 + 1) * T - 6, h = (b.y1 - b.y0 + 1) * T - 6;
    const g = ctx.createLinearGradient(px0, py0, px0 + w, py0 + h);
    g.addColorStop(0, o.color + '55');
    g.addColorStop(1, '#10141b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(px0, py0, w, h, 8); ctx.fill();
    ctx.strokeStyle = (hoverB === b || selectedB === b) ? '#ffffff' : o.color + '99';
    ctx.lineWidth = (hoverB === b || selectedB === b) ? 2 : 1.5;
    ctx.beginPath(); ctx.roundRect(px0, py0, w, h, 8); ctx.stroke();
    // Fenster
    ctx.fillStyle = 'rgba(255,235,170,0.10)';
    for (let wy = py0 + 10; wy < py0 + h - 12; wy += 12) {
      for (let wx = px0 + 8; wx < px0 + w - 10; wx += 14) {
        if (((wx * 13 + wy * 7 + b.id) % 5) < 2) ctx.fillRect(wx, wy, 5, 4);
      }
    }
    // Icon & Name
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.icon, px0 + w / 2, py0 + h / 2 - 2);
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillStyle = '#d7e1ee';
    ctx.fillText(t.label, px0 + w / 2, py0 + h / 2 + 14);
    // Alarm
    if (b.alarm) {
      const pulse = 0.4 + 0.35 * Math.sin(now / 220);
      ctx.strokeStyle = `rgba(255,60,120,${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px0 - 2, py0 - 2, w + 4, h + 4, 10); ctx.stroke();
      ctx.font = '16px sans-serif';
      ctx.fillText('🛸', px0 + w / 2 + 24, py0 + 18);
    }
    if (b.type === 'base') {
      ctx.strokeStyle = 'rgba(74,222,128,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(px0 - 2, py0 - 2, w + 4, h + 4, 10); ctx.stroke();
    }
    if (b.damage > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px0 + 4, py0 + 4, 46, 6);
      ctx.fillStyle = '#ff8c42';
      ctx.fillRect(px0 + 4, py0 + 4, 46 * b.damage / 100, 6);
      ctx.font = '11px sans-serif';
      ctx.fillText('🔥', px0 + 58, py0 + 11);
    }
  }

  // Fahrzeuge
  for (const m of cars) {
    const cx = m.rx * T + T / 2, cy = m.ry * T + T / 2;
    const horiz = m.dir[0] !== 0;
    ctx.fillStyle = m.police ? '#3a7bd5' : ['#5b6570', '#6e5a2a', '#4a5560'][Math.floor((m.speed * 1000) % 3)];
    ctx.beginPath();
    ctx.roundRect(cx - (horiz ? 8 : 4), cy - (horiz ? 4 : 8), horiz ? 16 : 8, horiz ? 8 : 16, 3);
    ctx.fill();
    if (m.police) {
      const blink = Math.sin(performance.now() / 120) > 0;
      ctx.fillStyle = blink ? '#ff4a4a' : '#4a9bff';
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }
  }
  // Passanten
  ctx.fillStyle = '#c9be6e';
  for (const m of peds) {
    ctx.beginPath();
    ctx.arc(m.rx * T + T / 2 + 8, m.ry * T + T / 2 + 8, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Strassengefechte (Muendungsfeuer-Blitze)
  for (const f of streetFights) {
    const fx2 = f.x * T + T / 2, fy2 = f.y * T + T / 2;
    if (Math.random() < 0.25) {
      ctx.fillStyle = 'rgba(255,230,120,0.9)';
      const ox = (Math.random() - 0.5) * 26, oy = (Math.random() - 0.5) * 26;
      ctx.beginPath(); ctx.arc(fx2 + ox, fy2 + oy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,120,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx2 + ox, fy2 + oy);
      ctx.lineTo(fx2 - ox, fy2 - oy);
      ctx.stroke();
    }
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠️', fx2, fy2 - 14);
  }

  // Absturzstellen (Bergungsmissionen)
  for (const c of crashes) {
    const cx = c.x * T, cy = c.y * T;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.4);
    ctx.fillStyle = '#2a2136';
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a4a76';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // Feuer & Rauch
    const fl = 0.5 + 0.4 * Math.sin(now / 130 + c.x);
    ctx.fillStyle = `rgba(255,150,50,${fl})`;
    ctx.beginPath(); ctx.arc(cx + 6, cy - 3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,80,80,0.25)';
    ctx.beginPath(); ctx.arc(cx + 8, cy - 12 - (now / 60 % 8), 6, 0, Math.PI * 2); ctx.fill();
    // Bergungs-Ring
    ctx.strokeStyle = `rgba(74,222,128,${0.4 + 0.3 * Math.sin(now / 300)})`;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.textAlign = 'center';
    ctx.fillText('BERGUNG', cx, cy + 34);
  }

  // UFOs
  for (const u of ufos) {
    const ux = u.x * T, uy = u.y * T + Math.sin(now / 300) * 3;
    if (u.phase === 'attack') { // Angriffsstrahl
      const bx = u.tx * T, by = u.ty * T;
      ctx.strokeStyle = `rgba(180,95,208,${0.4 + 0.3 * Math.sin(now / 90)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ux, uy + 6); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(ux + 3, uy + 16, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(ux - 4, uy - 4, 2, ux, uy, 18);
    g.addColorStop(0, '#d8c9ff');
    g.addColorStop(0.5, '#8a5fd0');
    g.addColorStop(1, '#3a2a56');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(ux, uy, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(216,201,255,0.8)';
    ctx.beginPath(); ctx.ellipse(ux, uy - 5, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) { // Positionslichter
      const la = now / 200 + k * Math.PI / 2;
      ctx.fillStyle = '#ff8dc7';
      ctx.beginPath(); ctx.arc(ux + Math.cos(la) * 13, uy + Math.sin(la) * 5, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Abfangjaeger
  if (interceptor) {
    const it = interceptor;
    const ang = Math.atan2(it.ufo.y - it.y, it.ufo.x - it.x);
    const ix = it.x * T, iy = it.y * T;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(ang);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (Math.hypot(it.ufo.x - it.x, it.ufo.y - it.y) <= 1.7 && Math.sin(now / 80) > 0.3) {
      ctx.strokeStyle = 'rgba(255,230,120,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(it.ufo.x * T, it.ufo.y * T); ctx.stroke();
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
