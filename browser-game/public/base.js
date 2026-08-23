/* Basis-Bau Prototyp v2 – Dungeon-Keeper-Stil:
   Gaenge in den Fels graben, Sicherheitstueren, Fallen, Geschuetztuerme,
   modulare 2x2-Raeume und eine Angriffs-Simulation (Raider vs. Verteidigung). */
'use strict';

const GW = 24, GH = 14, C = 40;
const canvas = document.getElementById('baseCanvas');
const ctx = canvas.getContext('2d');

const ROCK = 0, TUNNEL = 1;
const ENTRANCE = { x: 12, y: 0 };

/* ---------- Bau-Katalog ---------- */
const TOOLS = {
  dig:     { label: '⛏️ Graben', cost: 10, info: 'Fels ausheben – nur angrenzend an bestehende Gaenge. So entsteht dein Tunnelnetz (und deine Chokepoints!).' },
  door:    { label: '🚪 Sicherheitstuer', cost: 120, info: 'Panzertuer (150 HP). Raider muessen sie aufbrechen – Zeit, in der deine Tuerme feuern.' },
  boom:    { label: '💥 Sprengfalle', cost: 80, info: 'Zuendet beim Betreten: 50 Schaden im Umkreis. Einweg.' },
  gas:     { label: '☠️ Gasfalle', cost: 100, info: 'Zuendet beim Betreten: vergiftet Raider (10 Schaden/s fuer 4s). Einweg.' },
  mg:      { label: '🔫 MG-Turm', cost: 250, energy: -10, info: 'Reichweite 4,5 · 9 Schaden/Schuss. Braucht Energie – bei Defizit halbe Feuerrate.' },
  laser:   { label: '🔦 Laser-Turm', cost: 420, energy: -20, info: 'Reichweite 7 · 20 Schaden/Schuss. Braucht Energie.' },
  demolish:{ label: '🧹 Abreissen', cost: 0, info: 'Tuer/Falle/Turm entfernen (50% Erstattung).' },
};
const ROOMS = {
  kraftwerk: { label: 'Fusionsreaktor', icon: '⚡', cost: 600, energy: +60, color: '#8f6a1e', info: 'Versorgt Tuerme & Raeume mit Energie.' },
  quartiere: { label: 'Quartiere', icon: '🛏️', cost: 300, energy: -5, color: '#3e5a7a', info: '+4 Soldaten Kapazitaet.' },
  cryo:      { label: 'Cryo-Kammer', icon: '❄️', cost: 450, energy: -20, color: '#2e7d84', info: 'Lagert Veteranen bis zur Cyborg-Reaktivierung.' },
  cyborglab: { label: 'Cyborg-Labor', icon: '🦾', cost: 900, energy: -25, color: '#7a3a5e', info: 'Reaktiviert Veteranen als Cyborgs.' },
  werkstatt: { label: 'Mech-Werkstatt', icon: '🔧', cost: 800, energy: -20, color: '#6e5a2a', info: 'Baut Kampflaeufer.' },
  lager:     { label: 'Lager', icon: '📦', cost: 250, energy: -5, color: '#4a5560', info: 'Beute & Ausruestung.' },
  labor:     { label: 'Forschungslabor', icon: '🔬', cost: 550, energy: -15, color: '#3a6e4f', info: 'Analysiert Alien-Artefakte und erforscht neue Technologien.' },
  gym:       { label: 'Kraftraum', icon: '🏋️', cost: 400, energy: -10, color: '#5a4a2a', info: 'Training: +2 max. HP pro Zyklus fuer alle Soldaten (Cap +12).' },
  range:     { label: 'Schiessstand', icon: '🎯', cost: 450, energy: -10, color: '#2a5a3a', info: 'Training: +1 Genauigkeit pro Zyklus (Cap +8).' },
  simhall:   { label: 'Kampfsimulator', icon: '🤼', cost: 500, energy: -15, color: '#3a3a6e', info: 'Holo-Halle: +2 Reaktion pro Zyklus (Cap +10) – Squads ueben Formationen.' },
};
const KOMMANDO = { label: 'Kommandozentrale', icon: '🖥️', energy: -10, color: '#2a6f8f' };

/* ---------- Zustand ---------- */
const tiles = Array.from({ length: GH }, () => new Array(GW).fill(ROCK));
const roomAt = new Map();   // "x,y" -> room object
const rooms = [];           // {type,x,y} (2x2, x/y = Ursprung)
const doors = new Map();    // "x,y" -> {hp,max}
const traps = new Map();    // "x,y" -> {type,used}
const turrets = new Map();  // "x,y" -> {type,cd,angle,target}
let credits = 3000;
let baseHp = 100;
let wave = 1;
let tool = null;            // Werkzeug- oder Raum-Key
let hover = null;
let sim = null;             // laufende Angriffs-Simulation
const fx = [];              // Effekte {kind,t0,...}
const buildAnims = new Map();

const K = (x, y) => x + ',' + y;
function inb(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; }
function isOpen(x, y) { return inb(x, y) && tiles[y][x] === TUNNEL; }

const vets = [
  { name: 'Sgt. Falke', missions: 34, kills: 61, state: 'cryo' },
  { name: 'Cpt. Nova', missions: 41, kills: 78, state: 'cryo' },
];
const CYBORG_COST = 800;

/* ---------- Persistenz (Kampagne ueberlebt Reloads) ---------- */
function saveBase() {
  try {
    localStorage.setItem('apocarena.base', JSON.stringify({
      tiles, rooms,
      doors: [...doors.entries()],
      traps: [...traps.entries()],
      turrets: [...turrets.entries()].map(([k, t]) => [k, { type: t.type }]),
      credits, wave, baseHp, vets,
    }));
  } catch { }
}
function loadBase() {
  try {
    const b = JSON.parse(localStorage.getItem('apocarena.base') || 'null');
    if (!b || !b.tiles) return false;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) tiles[y][x] = b.tiles[y][x];
    for (const r of b.rooms) {
      rooms.push(r);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) roomAt.set(K(r.x + dx, r.y + dy), r);
    }
    for (const [k, d] of b.doors) doors.set(k, d);
    for (const [k, t] of b.traps) traps.set(k, t);
    for (const [k, t] of b.turrets) turrets.set(k, { type: t.type, cd: 0, angle: -Math.PI / 2, target: null });
    credits = b.credits;
    wave = b.wave || 1;
    baseHp = b.baseHp || 100;
    if (Array.isArray(b.vets) && b.vets.length) { vets.length = 0; vets.push(...b.vets); }
    return true;
  } catch { return false; }
}

/* ---------- Start-Layout: Schacht + Kommando + Reaktor ---------- */
function placeRoom(type, x, y) {
  const r = { type, x, y };
  rooms.push(r);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    tiles[y + dy][x + dx] = TUNNEL;
    roomAt.set(K(x + dx, y + dy), r);
  }
  return r;
}
if (!loadBase()) {
  tiles[ENTRANCE.y][ENTRANCE.x] = TUNNEL;
  for (let y = 1; y <= 5; y++) tiles[y][12] = TUNNEL;
  for (let x = 9; x <= 15; x++) tiles[5][x] = TUNNEL;
  placeRoom('kommando', 11, 6);
  placeRoom('kraftwerk', 14, 6);
  doors.set(K(12, 2), { hp: 150, max: 150 });
}
// Beute aus Gefechten abholen
try {
  const pending = Number(localStorage.getItem('apocarena.loot')) || 0;
  if (pending > 0) {
    credits += pending;
    localStorage.setItem('apocarena.loot', '0');
    setTimeout(() => info(`💰 <b>Beute aus Einsaetzen eingetroffen: +${pending} Credits!</b> Zeit fuer den Ausbau.`), 150);
  }
} catch { }

/* ---------- Personal: Wissenschaftler, Techniker, Bauarbeiter ---------- */
const staff = [];
let staffCasualties = 0;
const STAFF_COLORS = { wissenschaftler: '#e8eef5', techniker: '#ff8c42', bauarbeiter: '#ffd24a' };
const STAFF_LABEL = { wissenschaftler: 'Wissenschaftler', techniker: 'Techniker', bauarbeiter: 'Bauarbeiter' };

function walkable(x, y) { return inb(x, y) && tiles[y][x] === TUNNEL; }
function tunnelTiles() {
  const out = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (walkable(x, y)) out.push({ x, y });
  return out;
}
function staffRoster() {
  const list = ['bauarbeiter', 'bauarbeiter'];
  for (const r of rooms) {
    if (r.type === 'labor') list.push('wissenschaftler', 'wissenschaftler');
    if (r.type === 'cyborglab') list.push('wissenschaftler');
    if (r.type === 'werkstatt') list.push('techniker', 'techniker');
    if (r.type === 'kraftwerk') list.push('techniker');
    if (r.type === 'quartiere') list.push('bauarbeiter');
  }
  return list.slice(0, 14);
}
function syncStaff() {
  const want = staffRoster();
  while (staff.length > want.length) staff.pop();
  const tt = tunnelTiles();
  while (staff.length < want.length) {
    const spot = tt[Math.floor(Math.random() * tt.length)] || { x: 12, y: 3 };
    staff.push({
      role: want[staff.length], x: spot.x, y: spot.y, rx: spot.x, ry: spot.y,
      path: [], state: 'idle', workT: 0, hp: 20, alive: true, cool: 0,
    });
  }
  want.forEach((r, i) => { if (staff[i]) staff[i].role = r; });
}

function staffPath(s, tx, ty) {
  const seen = new Map([[K(s.x, s.y), null]]);
  const q = [[s.x, s.y]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = K(nx, ny);
      if (!walkable(nx, ny) || seen.has(k)) continue;
      seen.set(k, K(x, y));
      q.push([nx, ny]);
    }
  }
  if (!seen.has(K(tx, ty))) return null;
  const path = [];
  let cur = K(tx, ty);
  while (cur && cur !== K(s.x, s.y)) {
    const [px2, py2] = cur.split(',').map(Number);
    path.unshift({ x: px2, y: py2 });
    cur = seen.get(cur);
  }
  return path;
}

function pickStaffTask(s) {
  if (s.role === 'techniker') {
    // Instandhaltung: beschaedigte Tuer suchen
    let best = null, bd = 1e9;
    for (const [k, d] of doors) {
      if (d.hp >= d.max) continue;
      const [dx, dy] = k.split(',').map(Number);
      const dist = Math.hypot(dx - s.x, dy - s.y);
      if (dist < bd) { bd = dist; best = { x: dx, y: dy }; }
    }
    if (best) {
      const p = staffPath(s, best.x, best.y);
      if (p) { s.path = p; s.state = 'towork'; s.workT = 320; return; }
    }
  }
  if (s.role === 'wissenschaftler') {
    const labs = rooms.filter(r => r.type === 'labor' || r.type === 'cyborglab');
    if (labs.length) {
      const r = labs[Math.floor(Math.random() * labs.length)];
      const p = staffPath(s, r.x + Math.floor(Math.random() * 2), r.y + Math.floor(Math.random() * 2));
      if (p) { s.path = p; s.state = 'towork'; s.workT = 420; return; }
    }
  }
  // Bauarbeiter & Fallback: zufaellig umherlaufen und werkeln
  const tt = tunnelTiles();
  const spot = tt[Math.floor(Math.random() * tt.length)];
  const p = spot && staffPath(s, spot.x, spot.y);
  if (p) { s.path = p; s.state = 'towork'; s.workT = 180 + Math.random() * 160; }
}

function staffMove() { // pro Frame: laufen & arbeiten (rein visuell + Instandhaltung)
  for (const s of staff) {
    if (!s.alive) continue;
    const dx = s.x - s.rx, dy = s.y - s.ry;
    if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
      s.rx += Math.sign(dx) * Math.min(Math.abs(dx), 0.05);
      s.ry += Math.sign(dy) * Math.min(Math.abs(dy), 0.05);
      continue;
    }
    s.rx = s.x; s.ry = s.y;
    if (s.path.length) {
      const n = s.path.shift();
      s.x = n.x; s.y = n.y;
    } else if (s.state === 'towork') {
      s.state = 'work';
    } else if (s.state === 'work') {
      s.workT--;
      if (s.workT <= 0) s.state = 'idle';
    } else if (Math.random() < 0.01) {
      pickStaffTask(s);
    }
  }
}

function staffMaintenance() { // Techniker reparieren angrenzende Tueren
  for (const s of staff) {
    if (!s.alive || s.role !== 'techniker' || s.state !== 'work') continue;
    for (const [k, d] of doors) {
      if (d.hp >= d.max) continue;
      const [dx, dy] = k.split(',').map(Number);
      if (Math.hypot(dx - s.x, dy - s.y) <= 1.6) {
        d.hp = Math.min(d.max, d.hp + 0.4);
      }
    }
  }
}

let lastShift = 0;
function staffShift(now) { // Wissenschaftler im Labor erzeugen Forschung
  if (now - lastShift < 30000) return;
  lastShift = now;
  let n = 0;
  for (const s of staff) {
    if (!s.alive || s.role !== 'wissenschaftler' || s.state !== 'work') continue;
    if (rooms.some(r => (r.type === 'labor' || r.type === 'cyborglab')
      && s.x >= r.x && s.x <= r.x + 1 && s.y >= r.y && s.y <= r.y + 1)) n++;
  }
  if (n > 0) {
    setResearch(getResearch() + n);
    info(`🥼 Laborschicht: ${n} Wissenschaftler erarbeiten <b>+${n} 🔬</b>.`);
    updateUI();
  }
}

function staffCombat() { // Bei Angriff: Personal greift zur Pistole
  if (!sim) return;
  const now = performance.now();
  for (const s of staff) {
    if (!s.alive) continue;
    s.cool--;
    let best = null, bd = 1e9;
    for (const r of sim.raiders) {
      if (r.dead || now < r.spawned) continue;
      const d = Math.hypot(r.x - s.x, r.y - s.y);
      if (d < bd) { bd = d; best = r; }
    }
    if (best && bd <= 3.5 && s.cool <= 0) {
      s.cool = 9;
      best.hp -= 5;
      fx.push({ kind: 'tracer', t0: now, x0: s.x, y0: s.y, x1: best.x, y1: best.y, laser: false });
    }
    if (best && bd <= 1.3) {
      s.hp -= 0.8;
      if (s.hp <= 0) {
        s.alive = false;
        staffCasualties++;
        fx.push({ kind: 'kill', t0: now, x: s.x, y: s.y });
      }
    }
  }
}

/* ---------- Kader (geteilt mit dem Gefecht via localStorage) ---------- */
const NAMES6 = ['Krieger', 'Falke', 'Nova', 'Bison', 'Puma', 'Astra'];
const TYPES6 = ['assault', 'assault', 'sniper', 'heavy', 'assault', 'sniper'];
const CLS = { assault: 'Sturm', sniper: 'Sniper', heavy: 'Heavy' };
function loadRoster() {
  try {
    const r = JSON.parse(localStorage.getItem('apocarena.roster') || 'null');
    if (r && Array.isArray(r.soldiers) && r.soldiers.length >= 6) return r;
  } catch { }
  return {
    soldiers: NAMES6.map((n, i) => ({
      name: n, type: TYPES6[i], xp: 0, missions: 0, kills: 0,
      train: { hp: 0, acc: 0, re: 0 },
    })),
  };
}
function saveRoster(r) { try { localStorage.setItem('apocarena.roster', JSON.stringify(r)); } catch { } }
function levelOf(s) { return Math.floor((s.xp || 0) / 100) + 1; }
const roster = loadRoster();
const TRAIN_COST = 150;
const TRAIN_CAPS = { hp: 12, acc: 8, re: 10 };

function countRooms(type) { return rooms.filter(r => r.type === type).length; }

function trainCycle() {
  const gyms = countRooms('gym'), ranges = countRooms('range'), sims = countRooms('simhall');
  if (gyms + ranges + sims === 0) {
    info('⛔ Keine Trainingsraeume! Baue 🏋️ Kraftraum, 🎯 Schiessstand oder 🤼 Kampfsimulator.');
    return false;
  }
  if (credits < TRAIN_COST) { info('⛔ Nicht genug Credits fuer den Trainingszyklus.'); return false; }
  credits -= TRAIN_COST;
  let gains = { hp: 0, acc: 0, re: 0 };
  for (const s of roster.soldiers) {
    s.train = s.train || { hp: 0, acc: 0, re: 0 };
    const dHp = Math.min(TRAIN_CAPS.hp - s.train.hp, 2 * gyms);
    const dAcc = Math.min(TRAIN_CAPS.acc - s.train.acc, 1 * ranges);
    const dRe = Math.min(TRAIN_CAPS.re - s.train.re, 2 * sims);
    if (dHp > 0) { s.train.hp += dHp; gains.hp += dHp; }
    if (dAcc > 0) { s.train.acc += dAcc; gains.acc += dAcc; }
    if (dRe > 0) { s.train.re += dRe; gains.re += dRe; }
  }
  saveRoster(roster);
  if (gains.hp + gains.acc + gains.re === 0) {
    info('🏋️ Der Kader ist austrainiert (alle Caps erreicht). Mehr geht nur ueber Kampferfahrung (XP).');
  } else {
    info(`🏃 <b>Trainingszyklus abgeschlossen!</b> Kader gesamt: +${gains.hp} HP · +${gains.acc} Genauigkeit · +${gains.re} Reaktion.`);
  }
  updateUI();
  return true;
}

function renderRoster() {
  const el = document.getElementById('roster');
  if (!el) return;
  el.innerHTML = '';
  for (const s of roster.soldiers) {
    const t = s.train || { hp: 0, acc: 0, re: 0 };
    const div = document.createElement('div');
    div.className = 'vet';
    div.innerHTML = `<b>${s.name}</b> <small>(${CLS[s.type] || s.type})</small> · Lvl ${levelOf(s)} · ${s.xp || 0} XP<br>
      <span class="state">${s.missions || 0} Einsaetze · ${s.kills || 0} Kills · Training: +${t.hp} HP / +${t.acc} ACC / +${t.re} REA</span>`;
    el.appendChild(div);
  }
}

function hasWalker() { try { return localStorage.getItem('apocarena.walker') === '1'; } catch { return false; } }
const WALKER_COST = 1200;
function renderMech() {
  const el = document.getElementById('mech');
  if (!el) return;
  if (!hasRoom('werkstatt')) {
    el.innerHTML = '<span class="state" style="color:var(--dim)">Baue eine 🔧 Mech-Werkstatt, um Kampflaeufer zu fertigen.</span>';
    return;
  }
  if (hasWalker()) {
    el.innerHTML = '<b style="color:#7fd0ff">🤖 KL-1 "Brutus" einsatzbereit</b><br><span class="state" style="color:var(--dim)">Kaempft im naechsten KI-Gefecht mit. Wird er zerstoert, muss ein neuer gebaut werden.</span>';
    return;
  }
  el.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'mod-btn';
  b.innerHTML = `<span>🤖 Kampflaeufer bauen</span><small>${WALKER_COST} Cr</small>`;
  b.disabled = credits < WALKER_COST;
  b.onclick = () => {
    if (credits < WALKER_COST) return;
    credits -= WALKER_COST;
    try { localStorage.setItem('apocarena.walker', '1'); } catch { }
    info('🤖 <b>KL-1 "Brutus" fertiggestellt!</b> Der Kampflaeufer verstaerkt dein Squad im naechsten KI-Gefecht: 120 HP, Zwillings-Maschinenkanone.');
    updateUI();
  };
  el.appendChild(b);
}

/* ---------- Forschung: Artefakte -> Technologien -> bessere Ausruestung ---------- */
const TECH_TREE = {
  laser:   { label: 'Lasergewehre', icon: '🔫', cost: 60,  req: null,    info: '+2 Schaden und +5 Genauigkeit fuer alle Soldaten.' },
  armor:   { label: 'Verbundpanzerung', icon: '🦺', cost: 80, req: null, info: '+10 maximale HP fuer alle Soldaten.' },
  medigel: { label: 'Medi-Gel', icon: '🧪', cost: 50, req: null, info: 'Stabilisieren kostet nur 4 TU, Verwundete halten 2 Runden laenger durch.' },
  plasma:  { label: 'Plasmawaffen', icon: '☄️', cost: 120, req: 'laser', info: 'Weitere +3 Schaden fuer alle Soldaten.' },
};
function getResearch() { try { return Number(localStorage.getItem('apocarena.research')) || 0; } catch { return 0; } }
function setResearch(n) { try { localStorage.setItem('apocarena.research', String(Math.max(0, n))); } catch { } }
function getArtifacts() { try { return Number(localStorage.getItem('apocarena.artifacts')) || 0; } catch { return 0; } }
function setArtifacts(n) { try { localStorage.setItem('apocarena.artifacts', String(Math.max(0, n))); } catch { } }
function getTech() { try { return JSON.parse(localStorage.getItem('apocarena.tech') || '{}') || {}; } catch { return {}; } }
function setTech(t) { try { localStorage.setItem('apocarena.tech', JSON.stringify(t)); } catch { } }

function analyzeArtifacts() {
  if (!hasRoom('labor')) { info('⛔ Artefakt-Analyse braucht ein 🔬 Forschungslabor.'); return false; }
  const a = getArtifacts();
  if (a <= 0) { info('Keine Alien-Artefakte im Lager. UFOs abschiessen und Absturzstellen bergen!'); return false; }
  setArtifacts(0);
  setResearch(getResearch() + a * 10);
  info(`🔬 ${a} Artefakt(e) analysiert: <b>+${a * 10} Forschung</b>.`);
  updateUI();
  return true;
}

function doResearch(key) {
  const t = TECH_TREE[key];
  const tech = getTech();
  if (!hasRoom('labor')) { info('⛔ Forschung braucht ein 🔬 Forschungslabor.'); return false; }
  if (tech[key]) return false;
  if (t.req && !tech[t.req]) { info(`⛔ Benoetigt zuerst: ${TECH_TREE[t.req].label}.`); return false; }
  if (getResearch() < t.cost) { info(`⛔ Nicht genug Forschungspunkte (${t.cost} 🔬 noetig).`); return false; }
  setResearch(getResearch() - t.cost);
  tech[key] = true;
  setTech(tech);
  info(`🔬 <b>${t.icon} ${t.label} erforscht!</b> ${t.info} Gilt ab dem naechsten Einsatz.`);
  updateUI();
  return true;
}

function renderResearch() {
  const el = document.getElementById('research');
  if (!el) return;
  const tech = getTech();
  let html = `<div style="font-size:13px;margin-bottom:6px">🔬 Forschung: <b style="color:var(--warn)">${getResearch()}</b> · 🛸 Artefakte: <b style="color:var(--warn)">${getArtifacts()}</b></div>`;
  el.innerHTML = html;
  const ana = document.createElement('button');
  ana.className = 'mod-btn';
  ana.innerHTML = '<span>🛸 Artefakte analysieren</span><small>+10 🔬 je Stueck</small>';
  ana.onclick = analyzeArtifacts;
  el.appendChild(ana);
  for (const [k, t] of Object.entries(TECH_TREE)) {
    const b = document.createElement('button');
    b.className = 'mod-btn';
    const done = tech[k];
    b.innerHTML = `<span>${t.icon} ${t.label}${done ? ' ✅' : ''}</span><small>${done ? 'erforscht' : t.cost + ' 🔬'}</small>`;
    b.disabled = !!done;
    b.onclick = () => { info(`<b>${t.icon} ${t.label}</b><br>${t.info}`); doResearch(k); };
    el.appendChild(b);
  }
}

/* ---------- Wirtschaft ---------- */
function energyBalance() {
  let e = 0;
  for (const r of rooms) e += (r.type === 'kommando' ? KOMMANDO.energy : ROOMS[r.type].energy);
  for (const t of turrets.values()) e += TOOLS[t.type].energy || 0;
  return e;
}
function hasRoom(type) { return rooms.some(r => r.type === type); }

function updateUI() {
  document.getElementById('rCredits').textContent = credits;
  const e = energyBalance();
  const eb = document.getElementById('rEnergy');
  eb.textContent = (e >= 0 ? '+' : '') + e;
  document.getElementById('rEnergyBox').classList.toggle('bad', e < 0);
  document.getElementById('rBaseHp').textContent = baseHp;
  document.getElementById('rWave').textContent = wave;
  const st = document.getElementById('rStaff');
  if (st) st.textContent = staff.filter(s => s.alive).length + ' (' +
    staff.filter(s => s.alive && s.role === 'wissenschaftler').length + '🥼 ' +
    staff.filter(s => s.alive && s.role === 'techniker').length + '🔧 ' +
    staff.filter(s => s.alive && s.role === 'bauarbeiter').length + '👷)';
  renderVets();
  renderRoster();
  renderMech();
  renderResearch();
  saveBase();
}
function info(html) { document.getElementById('info').innerHTML = html; }

/* ---------- Palette ---------- */
const paletteEl = document.getElementById('palette');
function palBtn(key, html, infoTxt) {
  const b = document.createElement('button');
  b.className = 'mod-btn';
  b.innerHTML = html;
  b.onclick = () => {
    tool = tool === key ? null : key;
    document.querySelectorAll('.mod-btn').forEach(x => x.classList.remove('sel'));
    if (tool) b.classList.add('sel');
    info(tool ? infoTxt : 'Auswahl aufgehoben.');
  };
  paletteEl.appendChild(b);
}
for (const [key, t] of Object.entries(TOOLS)) {
  palBtn(key, `<span>${t.label}</span><small>${t.cost ? t.cost + ' Cr' : ''}${t.energy ? ' · ' + t.energy + '⚡' : ''}</small>`, t.info);
}
for (const [key, r] of Object.entries(ROOMS)) {
  palBtn(key, `<span>${r.icon} ${r.label} <small>(2×2)</small></span><small>${r.cost} Cr · ${r.energy > 0 ? '+' : ''}${r.energy}⚡</small>`, r.info + ' Braucht eine freie 2×2 ausgehobene Flaeche.');
}

/* ---------- Veteranen ---------- */
function renderVets() {
  const el = document.getElementById('vets');
  el.innerHTML = '';
  for (const v of vets) {
    const div = document.createElement('div');
    div.className = 'vet';
    if (v.state === 'cryo') {
      const ok = hasRoom('cyborglab') && credits >= CYBORG_COST;
      div.innerHTML = `<b>${v.name}</b> · ${v.missions} Einsaetze<br><span class="state">❄️ Cryo-Schlaf</span>
        <button ${ok ? '' : 'disabled'}>🦾 Cyborg-Reaktivierung (${CYBORG_COST} Cr)</button>
        ${hasRoom('cyborglab') ? '' : '<small class="state">Benoetigt Cyborg-Labor</small>'}`;
      div.querySelector('button').onclick = () => {
        if (!hasRoom('cyborglab') || credits < CYBORG_COST) return;
        credits -= CYBORG_COST;
        v.state = 'cyborg';
        info(`🦾 <b>${v.name}</b> reaktiviert – kaempft ab jetzt als Cyborg!`);
        updateUI();
      };
    } else {
      div.innerHTML = `<b>${v.name}</b><br><span class="cyborg">🦾 CYBORG – einsatzbereit</span>`;
    }
    el.appendChild(div);
  }
}

/* ---------- Bauen ---------- */
function canDig(x, y) {
  if (!inb(x, y) || tiles[y][x] !== ROCK) return false;
  if (y === 0) return false; // Oberflaeche bleibt zu (ausser Eingang)
  return isOpen(x + 1, y) || isOpen(x - 1, y) || isOpen(x, y + 1) || isOpen(x, y - 1);
}
function tileFree(x, y) {
  return isOpen(x, y) && !roomAt.has(K(x, y)) && !doors.has(K(x, y)) && !traps.has(K(x, y)) && !turrets.has(K(x, y));
}
function pay(cost) {
  if (credits < cost) { info('⛔ Nicht genug Credits.'); return false; }
  credits -= cost;
  return true;
}

canvas.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * GW);
  const y = Math.floor((ev.clientY - r.top) / r.height * GH);
  hover = inb(x, y) ? { x, y } : null;
});

canvas.addEventListener('click', () => {
  if (!hover || sim) return;
  const { x, y } = hover;
  const k = K(x, y);

  if (!tool) {
    if (roomAt.has(k)) {
      const r = roomAt.get(k);
      const def = r.type === 'kommando' ? KOMMANDO : ROOMS[r.type];
      info(`<b>${def.icon} ${def.label}</b><br>${def.info || 'Herz der Basis – beschuetze sie!'}`);
    } else if (doors.has(k)) info(`🚪 Sicherheitstuer · ${doors.get(k).hp}/${doors.get(k).max} HP`);
    else if (traps.has(k)) info(`Falle (${traps.get(k).type === 'boom' ? '💥 Spreng' : '☠️ Gas'}) ${traps.get(k).used ? '– ausgeloest' : '– scharf'}`);
    else if (turrets.has(k)) info(`${TOOLS[turrets.get(k).type].label} – automatische Verteidigung`);
    return;
  }

  if (tool === 'dig') {
    if (!canDig(x, y)) { info('⛔ Graben nur angrenzend an Gaenge (nicht in der obersten Reihe).'); return; }
    if (!pay(TOOLS.dig.cost)) return;
    tiles[y][x] = TUNNEL;
    buildAnims.set(k, performance.now());
    updateUI();
    return;
  }
  if (tool === 'demolish') {
    for (const m of [doors, traps, turrets]) {
      if (m.has(k)) {
        const obj = m.get(k);
        const refund = Math.floor((TOOLS[obj.type || 'door'].cost || 120) / 2);
        credits += refund;
        m.delete(k);
        info(`🧹 Entfernt (+${refund} Cr Erstattung).`);
        updateUI();
        return;
      }
    }
    info('Hier steht nichts zum Abreissen.');
    return;
  }
  if (tool === 'door' || tool === 'boom' || tool === 'gas' || tool === 'mg' || tool === 'laser') {
    if (!tileFree(x, y)) { info('⛔ Braucht einen freien Gang-Abschnitt.'); return; }
    if (!pay(TOOLS[tool].cost)) return;
    if (tool === 'door') doors.set(k, { hp: 150, max: 150 });
    else if (tool === 'boom' || tool === 'gas') traps.set(k, { type: tool, used: false });
    else turrets.set(k, { type: tool, cd: 0, angle: -Math.PI / 2, target: null });
    buildAnims.set(k, performance.now());
    updateUI();
    return;
  }
  // Raum (2x2)
  if (ROOMS[tool]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (!tileFree(x + dx, y + dy)) { info('⛔ Braucht eine freie, ausgehobene 2×2-Flaeche (Klick = linke obere Ecke).'); return; }
    }
    if (!pay(ROOMS[tool].cost)) return;
    placeRoom(tool, x, y);
    buildAnims.set(k, performance.now());
    info(`✅ ${ROOMS[tool].icon} ${ROOMS[tool].label} gebaut!`);
    updateUI();
  }
});

/* ---------- Angriffs-Simulation ---------- */
function findPath(sx, sy, tx, ty) {
  // Dijkstra: Tunnel=1, Tuer=10 (aufbrechen dauert), Fels unpassierbar
  const dist = new Map([[K(sx, sy), 0]]);
  const prev = new Map();
  const pq = [[0, sx, sy]];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, x, y] = pq.splice(bi, 1)[0];
    if (x === tx && y === ty) break;
    if (d > (dist.get(K(x, y)) ?? 1e9)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!isOpen(nx, ny)) continue;
      const dr = doors.get(K(nx, ny));
      const cost = d + 1 + (dr && dr.hp > 0 ? 10 : 0);
      if (cost < (dist.get(K(nx, ny)) ?? 1e9)) {
        dist.set(K(nx, ny), cost);
        prev.set(K(nx, ny), K(x, y));
        pq.push([cost, nx, ny]);
      }
    }
  }
  if (!dist.has(K(tx, ty))) return null;
  const path = [];
  let cur = K(tx, ty);
  while (cur && cur !== K(sx, sy)) {
    const [px, py] = cur.split(',').map(Number);
    path.unshift({ x: px, y: py });
    cur = prev.get(cur);
  }
  return path;
}

function losTunnel(x0, y0, x1, y1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    if (!isOpen(cx, cy)) return false;
    const dr = doors.get(K(cx, cy));
    if (dr && dr.hp > 0 && !(cx === x1 && cy === y1)) return false;
  }
  return true;
}

document.getElementById('btnPlayDef').onclick = () => {
  if (sim) return;
  const kom = rooms.find(r => r.type === 'kommando');
  const test = findPath(ENTRANCE.x, ENTRANCE.y, kom.x, kom.y);
  if (!test) { info('⛔ Kein Weg vom Eingang zur Kommandozentrale – die Raider kaemen nie an. Erst einen Zugang graben!'); return; }
  try {
    localStorage.setItem('apocarena.defense', JSON.stringify({
      tiles, entrance: ENTRANCE, kom: { x: kom.x, y: kom.y },
      turrets: [...turrets.entries()].map(([k, t]) => ({ k, type: t.type })),
      wave,
    }));
  } catch { }
  window.location.href = '/?defense=1';
};

function applyDefenseResult(res) {
  if (res.won) {
    const loot = 400 + wave * 120;
    credits += loot;
    setResearch(getResearch() + 5);
    wave++;
    setTimeout(() => info(`🏆 <b>Verteidigung im Gefecht gewonnen!</b> +${loot} Cr, +5 🔬. Naechste Welle: ${wave}.`), 200);
  } else {
    credits = Math.max(0, credits - 300);
    setTimeout(() => info('💀 <b>Die Basis wurde im Gefecht ueberrannt.</b> Pluenderung: -300 Cr. Baue die Verteidigung aus!'), 200);
  }
  updateUI();
}
try {
  const dres = JSON.parse(localStorage.getItem('apocarena.defenseresult') || 'null');
  if (dres) {
    localStorage.removeItem('apocarena.defenseresult');
    applyDefenseResult(dres);
  }
} catch { }

// Ambient: tiefes Basis-Brummen (startet bei erster Interaktion)
let baseAmbient = null;
document.addEventListener('click', () => {
  if (baseAmbient) return;
  try {
    baseAmbient = new (window.AudioContext || window.webkitAudioContext)();
    const o = baseAmbient.createOscillator(), g = baseAmbient.createGain();
    o.type = 'sine'; o.frequency.value = 38;
    g.gain.value = 0.014;
    o.connect(g).connect(baseAmbient.destination);
    o.start();
  } catch { }
}, { once: true });

document.getElementById('btnTrain').onclick = () => { if (!sim) trainCycle(); };

document.getElementById('btnReset').onclick = () => {
  if (sim) return;
  try { localStorage.removeItem('apocarena.base'); } catch { }
  location.reload();
};

document.getElementById('btnAttack').onclick = () => {
  if (sim) return;
  const kom = rooms.find(r => r.type === 'kommando');
  const test = findPath(ENTRANCE.x, ENTRANCE.y, kom.x, kom.y);
  if (!test) { info('⛔ Es gibt keinen Weg vom Eingang zur Kommandozentrale – die Raider wuerden nie ankommen. (Gut verbunkert! Aber auch deine Squads kommen so nicht raus …)'); return; }
  const n = 4 + wave;
  sim = { raiders: [], kills: 0 };
  for (let i = 0; i < n; i++) {
    sim.raiders.push({
      x: ENTRANCE.x, y: ENTRANCE.y - 0.5 - i * 0.8,
      hp: 50 + wave * 12, max: 50 + wave * 12,
      path: null, idx: 0, prog: 0, gasUntil: 0, breaking: null, dead: false, spawned: performance.now() + i * 700,
    });
  }
  info(`🚨 <b>Welle ${wave}:</b> ${n} Raider stuermen die Basis!`);
  simTimer = setInterval(simTick, 100);
};

let simTimer = null;
function endSim(won) {
  clearInterval(simTimer);
  simTimer = null;
  const loot = 400 + wave * 120;
  if (staffCasualties > 0) {
    const cost = staffCasualties * 40;
    credits = Math.max(0, credits - cost);
    info(`🕯️ ${staffCasualties} Mitarbeiter sind gefallen – Ersatz kostet ${cost} Cr.`);
    for (const s of staff) {
      if (!s.alive) {
        const tt = tunnelTiles();
        const spot = tt[Math.floor(Math.random() * tt.length)] || { x: 12, y: 3 };
        s.alive = true; s.hp = 20; s.x = spot.x; s.y = spot.y; s.rx = spot.x; s.ry = spot.y;
        s.path = []; s.state = 'idle';
      }
    }
    staffCasualties = 0;
  }
  if (won) {
    credits += loot;
    setResearch(getResearch() + 5);
    info(`🏆 <b>Welle ${wave} abgewehrt!</b> Beute: +${loot} Credits, +5 🔬 (Analyse der Angreifer). Ruesten und nachbauen!`);
    wave++;
  } else {
    info('💀 <b>Die Basis wurde ueberrannt!</b> Kommando-HP auf 0. Baue mehr Tueren, Fallen und Tuerme – und nutze enge Korridore als Todeszonen.');
    baseHp = 100;
  }
  sim = null;
  updateUI();
}

function simTick() {
  if (!sim) return;
  const now = performance.now();
  const kom = rooms.find(r => r.type === 'kommando');
  const e = energyBalance();
  const firePenalty = e < 0 ? 2 : 1;

  for (const r of sim.raiders) {
    if (r.dead || now < r.spawned) continue;
    if (!r.path) { r.path = findPath(Math.round(Math.max(0, r.y)) === 0 ? ENTRANCE.x : Math.round(r.x), Math.max(0, Math.round(r.y)), kom.x, kom.y) || []; r.idx = 0; }
    // Gas-Schaden
    if (r.gasUntil > now) r.hp -= 1;
    // Tuer aufbrechen?
    if (r.breaking) {
      const dr = doors.get(r.breaking);
      if (!dr || dr.hp <= 0) {
        if (dr) doors.delete(r.breaking);
        r.breaking = null;
        for (const o of sim.raiders) o.path = null; // Weg neu planen
      } else {
        dr.hp -= 4;
        if (Math.random() < 0.3) fx.push({ kind: 'spark', t0: now, x: +r.breaking.split(',')[0], y: +r.breaking.split(',')[1] });
      }
    } else if (r.path && r.idx < r.path.length) {
      const next = r.path[r.idx];
      const dr = doors.get(K(next.x, next.y));
      if (dr && dr.hp > 0) {
        r.breaking = K(next.x, next.y);
      } else {
        r.prog += 0.28;
        if (r.prog >= 1) {
          r.prog = 0;
          r.x = next.x; r.y = next.y;
          r.idx++;
          // Falle?
          const tr = traps.get(K(next.x, next.y));
          if (tr && !tr.used) {
            tr.used = true;
            if (tr.type === 'boom') {
              fx.push({ kind: 'boom', t0: now, x: next.x, y: next.y });
              for (const o of sim.raiders) {
                if (!o.dead && Math.hypot(o.x - next.x, o.y - next.y) <= 1.3) o.hp -= 50;
              }
            } else {
              fx.push({ kind: 'gascloud', t0: now, x: next.x, y: next.y });
              for (const o of sim.raiders) {
                if (!o.dead && Math.hypot(o.x - next.x, o.y - next.y) <= 1.3) o.gasUntil = now + 4000;
              }
            }
          }
        }
      }
    } else if (r.path && r.idx >= r.path.length) {
      // Kommando erreicht
      baseHp -= 12;
      r.dead = true;
      fx.push({ kind: 'alarm', t0: now, x: kom.x + 0.5, y: kom.y + 0.5 });
      if (baseHp <= 0) { updateUI(); return endSim(false); }
    }
    if (r.hp <= 0 && !r.dead) {
      r.dead = true;
      sim.kills++;
      fx.push({ kind: 'kill', t0: now, x: r.x, y: r.y });
    }
  }

  // Personal verteidigt sich mit Pistolen
  staffCombat();

  // Tuerme feuern
  for (const [k, t] of turrets) {
    t.cd -= 100;
    const [tx, ty] = k.split(',').map(Number);
    const range = t.type === 'mg' ? 4.5 : 7;
    let best = null, bd = 1e9;
    for (const r of sim.raiders) {
      if (r.dead || now < r.spawned || r.y < 0) continue;
      const d = Math.hypot(r.x - tx, r.y - ty);
      if (d <= range && d < bd && losTunnel(tx, ty, Math.round(r.x), Math.round(r.y))) { bd = d; best = r; }
    }
    t.target = best;
    if (best) {
      t.angle = Math.atan2(best.y - ty, best.x - tx);
      if (t.cd <= 0) {
        t.cd = (t.type === 'mg' ? 400 : 900) * firePenalty;
        best.hp -= t.type === 'mg' ? 9 : 20;
        fx.push({ kind: 'tracer', t0: now, x0: tx, y0: ty, x1: best.x, y1: best.y, laser: t.type === 'laser' });
      }
    }
  }

  if (sim.raiders.every(r => r.dead)) { updateUI(); return endSim(true); }
  updateUI();
}

/* ---------- Rendering ---------- */
function render(now) {
  requestAnimationFrame(render);
  // Fels
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const shade = ((x * 7 + y * 13) % 5) * 2;
    if (tiles[y][x] === ROCK) {
      ctx.fillStyle = `rgb(${13 + shade},${15 + shade},${19 + shade})`;
      ctx.fillRect(x * C, y * C, C, C);
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(x * C + (x % 3) * 9, y * C + (y % 4) * 7, 6, 4);
    } else {
      // Gang
      ctx.fillStyle = `rgb(${30 + shade},${37 + shade},${46 + shade})`;
      ctx.fillRect(x * C, y * C, C, C);
      ctx.strokeStyle = 'rgba(55,182,255,0.10)';
      ctx.strokeRect(x * C + .5, y * C + .5, C - 1, C - 1);
    }
  }
  // Eingang
  ctx.fillStyle = 'rgba(74,222,128,0.2)';
  ctx.fillRect(ENTRANCE.x * C, 0, C, C);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EINGANG', ENTRANCE.x * C + C / 2, 12);

  // Raeume
  for (const r of rooms) {
    const def = r.type === 'kommando' ? KOMMANDO : ROOMS[r.type];
    const px = r.x * C, py = r.y * C, s = C * 2;
    const g = ctx.createLinearGradient(px, py, px + s, py + s);
    g.addColorStop(0, def.color);
    g.addColorStop(1, '#10141b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(px + 3, py + 3, s - 6, s - 6, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(55,182,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(px + 3, py + 3, s - 6, s - 6, 8); ctx.stroke();
    if (r.type === 'kraftwerk') {
      ctx.fillStyle = `rgba(255,170,60,${0.3 + 0.2 * Math.sin(now / 300)})`;
      ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2 + 10, 14, 0, Math.PI * 2); ctx.fill();
    }
    if (r.type === 'cryo') {
      ctx.fillStyle = `rgba(120,230,255,${0.25 + 0.15 * Math.sin(now / 500)})`;
      for (const ox of [-24, -8, 8, 24]) ctx.fillRect(px + s / 2 + ox - 4, py + s / 2, 9, 20);
    }
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.icon, px + s / 2, py + s / 2 - 4);
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillStyle = '#d7e1ee';
    ctx.fillText(def.label, px + s / 2, py + s / 2 + 16);
    if (r.type === 'kommando' && sim) {
      ctx.fillStyle = baseHp > 50 ? '#4ade80' : '#ff5f4f';
      ctx.fillRect(px + 6, py + 6, (s - 12) * baseHp / 100, 4);
    }
  }

  // Tueren
  for (const [k, d] of doors) {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = '#20272f';
    ctx.fillRect(x * C + 3, y * C + 12, C - 6, C - 24);
    ctx.fillStyle = d.hp > 0 ? '#c9a227' : '#5a5140';
    ctx.fillRect(x * C + 5, y * C + 14, C - 10, C - 28);
    ctx.fillStyle = '#20272f'; // Warnstreifen
    for (let i = 0; i < 4; i++) ctx.fillRect(x * C + 7 + i * 8, y * C + 14, 4, C - 28);
    if (d.hp < d.max) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x * C + 4, y * C + 6, C - 8, 4);
      ctx.fillStyle = d.hp / d.max > 0.4 ? '#fbbf24' : '#ff5f4f';
      ctx.fillRect(x * C + 4, y * C + 6, (C - 8) * Math.max(0, d.hp) / d.max, 4);
    }
  }

  // Fallen
  for (const [k, tr] of traps) {
    const [x, y] = k.split(',').map(Number);
    ctx.globalAlpha = tr.used ? 0.25 : 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = tr.type === 'boom' ? 'rgba(255,140,60,0.8)' : 'rgba(120,220,120,0.8)';
    ctx.strokeRect(x * C + 8.5, y * C + 8.5, C - 17, C - 17);
    ctx.setLineDash([]);
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tr.type === 'boom' ? '💥' : '☠️', x * C + C / 2, y * C + C / 2 + 5);
    ctx.globalAlpha = 1;
  }

  // Tuerme
  for (const [k, t] of turrets) {
    const [x, y] = k.split(',').map(Number);
    const cx = x * C + C / 2, cy = y * C + C / 2;
    ctx.fillStyle = '#232b35';
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.type === 'laser' ? '#ff8c66' : '#37b6ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.stroke();
    if (!sim) t.angle += 0.008; // Leerlauf-Rotation
    ctx.strokeStyle = '#141920';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(t.angle) * 15, cy + Math.sin(t.angle) * 15);
    ctx.stroke();
    ctx.strokeStyle = '#98a2b3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(t.angle) * 13, cy + Math.sin(t.angle) * 13);
    ctx.stroke();
    ctx.fillStyle = t.type === 'laser' ? '#ff8c66' : '#37b6ff';
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // Personal (NPCs): laufen, arbeiten, reparieren
  staffMove();
  staffMaintenance();
  staffShift(now);
  if (staff.length !== staffRoster().length) syncStaff();
  for (const s of staff) {
    if (!s.alive) continue;
    const scx = s.rx * C + C / 2, scy = s.ry * C + C / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(scx + 1, scy + 3, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = STAFF_COLORS[s.role];
    ctx.beginPath(); ctx.arc(scx, scy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#12161c';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(scx, scy, 5.5, 0, Math.PI * 2); ctx.stroke();
    if (s.role === 'bauarbeiter') { // Helm
      ctx.fillStyle = '#e8b830';
      ctx.beginPath(); ctx.arc(scx, scy - 2, 3, Math.PI, 0); ctx.fill();
    }
    if (s.role === 'wissenschaftler') { // Kittel-Streifen
      ctx.strokeStyle = '#37b6ff';
      ctx.beginPath(); ctx.moveTo(scx, scy - 4); ctx.lineTo(scx, scy + 4); ctx.stroke();
    }
    if (sim) { // bewaffnet: Pistole
      ctx.strokeStyle = '#1a1f26';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(scx + 4, scy); ctx.lineTo(scx + 9, scy); ctx.stroke();
      if (s.hp < 20) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(scx - 7, scy - 11, 14, 2.5);
        ctx.fillStyle = '#ff5f4f';
        ctx.fillRect(scx - 7, scy - 11, 14 * Math.max(0, s.hp) / 20, 2.5);
      }
    } else if (s.state === 'work') { // Arbeits-Animationen
      if (s.role === 'techniker' && Math.random() < 0.25) {
        ctx.fillStyle = 'rgba(255,220,120,0.9)';
        ctx.fillRect(scx + (Math.random() - 0.5) * 12, scy + (Math.random() - 0.5) * 12, 2, 2);
      } else if (s.role === 'wissenschaftler') {
        ctx.strokeStyle = `rgba(55,182,255,${0.3 + 0.25 * Math.sin(now / 250)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(scx, scy - 9, 3.5, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔨', scx + 7, scy - 5 + Math.sin(now / 120) * 2);
      }
    }
  }

  // Raider
  if (sim) {
    for (const r of sim.raiders) {
      if (r.dead || performance.now() < r.spawned) continue;
      let rx = r.x, ry = r.y;
      if (r.path && r.idx < r.path.length && !r.breaking) {
        const nx = r.path[r.idx];
        rx = r.x + (nx.x - r.x) * r.prog;
        ry = r.y + (nx.y - r.y) * r.prog;
      }
      const cx = rx * C + C / 2, cy = ry * C + C / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(cx + 1, cy + 3, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = r.gasUntil > performance.now() ? '#7ec97e' : '#c9483a';
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5e1f18';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(cx - 9, cy - 14, 18, 3);
      ctx.fillStyle = '#ff5f4f';
      ctx.fillRect(cx - 9, cy - 14, 18 * Math.max(0, r.hp) / r.max, 3);
    }
  }

  // Effekte
  const now2 = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    const age = now2 - e.t0;
    if (e.kind === 'tracer') {
      if (age > 160) { fx.splice(i, 1); continue; }
      ctx.strokeStyle = e.laser ? `rgba(255,120,80,${1 - age / 160})` : `rgba(255,230,120,${1 - age / 160})`;
      ctx.lineWidth = e.laser ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(e.x0 * C + C / 2, e.y0 * C + C / 2);
      ctx.lineTo(e.x1 * C + C / 2, e.y1 * C + C / 2);
      ctx.stroke();
    } else if (e.kind === 'boom') {
      if (age > 500) { fx.splice(i, 1); continue; }
      const p = age / 500;
      ctx.globalAlpha = 1 - p;
      const g = ctx.createRadialGradient(e.x * C + C / 2, e.y * C + C / 2, 2, e.x * C + C / 2, e.y * C + C / 2, 55 * p + 10);
      g.addColorStop(0, '#fff7cc');
      g.addColorStop(0.5, '#ffb03a');
      g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x * C + C / 2, e.y * C + C / 2, 55 * p + 10, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'gascloud') {
      if (age > 4000) { fx.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(110,200,110,${0.35 * (1 - age / 4000)})`;
      for (const [ox, oy] of [[0, 0], [-14, 8], [14, -8], [8, 14], [-10, -12]]) {
        ctx.beginPath();
        ctx.arc(e.x * C + C / 2 + ox, e.y * C + C / 2 + oy, 16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.kind === 'spark') {
      if (age > 200) { fx.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255,220,120,${1 - age / 200})`;
      for (let s = 0; s < 4; s++) {
        ctx.fillRect(e.x * C + C / 2 + (Math.random() - 0.5) * 20, e.y * C + C / 2 + (Math.random() - 0.5) * 20, 2, 2);
      }
    } else if (e.kind === 'kill') {
      if (age > 1200) { fx.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age / 1200;
      ctx.fillStyle = '#ff8d81';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☠', e.x * C + C / 2, e.y * C + C / 2 - age / 60);
      ctx.globalAlpha = 1;
    } else if (e.kind === 'alarm') {
      if (age > 900) { fx.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,60,40,${1 - age / 900})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x * C + C / 2, e.y * C + C / 2, 14 + age / 18, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Bau-Hinweise
  if (tool === 'dig' && !sim) {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!canDig(x, y)) continue;
      ctx.fillStyle = `rgba(74,222,128,${0.08 + 0.05 * Math.sin(now / 350 + x + y)})`;
      ctx.fillRect(x * C + 2, y * C + 2, C - 4, C - 4);
    }
  }
  if (hover) {
    const ok2 = tool === 'dig' ? canDig(hover.x, hover.y)
      : ROOMS[tool] ? true : tool ? tileFree(hover.x, hover.y) : true;
    ctx.strokeStyle = ok2 ? 'rgba(255,255,255,0.55)' : 'rgba(255,90,70,0.7)';
    ctx.lineWidth = 2;
    const hs = ROOMS[tool] ? 2 : 1;
    ctx.strokeRect(hover.x * C + 2.5, hover.y * C + 2.5, C * hs - 5, C * hs - 5);
  }
}
syncStaff();
requestAnimationFrame(render);
updateUI();
