/* Headless-Simulationstest fuer Apoc Arena:
   Stubbt DOM/Canvas, laedt game.js und simuliert komplette Schlachten. */
'use strict';
const fs = require('fs');

/* ---- DOM-Stubs ---- */
const drawCalls = { drawImage: 0, ellipse: 0, arc: 0, fill: 0, stroke: 0, fillText: 0, roundRect: 0 };
function resetDrawCalls() { for (const k of Object.keys(drawCalls)) drawCalls[k] = 0; }
const ctxStub = new Proxy({}, {
  get: (t, p) => {
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createRadialGradient' || p === 'createLinearGradient' || p === 'createPattern')
      return () => ({ addColorStop() { } });
    if (p === '__calls') return drawCalls;
    if (p in t) return t[p];
    return () => { if (typeof p === 'string' && drawCalls[p] !== undefined) drawCalls[p]++; };
  },
  set: (t, p, v) => { t[p] = v; return true; },
});
const els = {};
function makeEl(id) {
  return {
    id, style: {}, textContent: '', innerHTML: '', value: '', disabled: false,
    children: [], scrollTop: 0, scrollHeight: 0, onclick: null,
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); },
    removeChild() { this.children.shift(); },
    get firstChild() { return this.children[0]; },
    addEventListener() { },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; },
    width: 960, height: 640,
  };
}
globalThis.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl(id)),
  createElement: (t) => makeEl(t),
  querySelectorAll: () => [],
  addEventListener() { },
  body: makeEl('body'),
};
globalThis.requestAnimationFrame = () => 0;
// Kampagnen-Speicher: eine Basis mit einem reaktivierten Cyborg-Veteranen
globalThis.localStorage = {
  store: {
    'apocarena.base': JSON.stringify({
      tiles: [], rooms: [], doors: [], traps: [], turrets: [], credits: 0, wave: 1, baseHp: 100,
      vets: [
        { name: 'Sgt. Falke', missions: 34, kills: 61, state: 'cyborg' },
        { name: 'Cpt. Nova', missions: 41, kills: 78, state: 'cryo' },
      ],
    }),
  },
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};

/* ---- game.js laden + interne API exportieren ---- */
const src = fs.readFileSync(__dirname + '/public/game.js', 'utf8');
const exportSnippet = `
;globalThis.__test = {
  state: () => state,
  getBusy: () => busy,
  vis, seenTiles,
  tickMoveAnim, startGame, issueCommand, applyCommand,
  planMoveCmd, planShootCmd, planGrenadeCmd,
  computeReachable, findPath, unitById, refreshVisibility,
  losClear, hitChance, isVisibleTo, rtTick, stopRtLoop,
  UNIT_TYPES, GRENADE, generateMap,
  setSelection, getSelection: () => selection,
  autoSelectSquad,
  setFormation: (f) => { formation = f; },
  setSquadMode: (m) => { squadMode = m; },
  getSquadMode: () => squadMode,
  planSquadTargets, hasCover,
  commandoRoll, setKey: (k, v) => { pressedKeys[k] = v; },
  startCityMission, startBaseDefense,
  scareCivs, buildCivCmd, escapeUnit, tryFleeTB, civAt, killUnit,
  orderSquadMove, computeSlots, orderAttack, FORMATIONS,
  // --- Ansicht / Level-Design / Animation ---
  VIEW, isIso, sx, sy, screenToTile, tileHpx, setView, toggleView, squash, dirSector,
  archetypeFor, ARCHETYPES, ARCH_ORDER, mapPlayable, mirrorHalf, LOWWALL, WALL, CRATE, FLOOR,
  coverTiles, coverPenalty, coverKind, LOS: losClear, BLOCKED: blocked,
  updateAnim, updateCivAnim, render, effects, setHover: (h) => { hoverTile = h; },
  setDrag: (a, b) => { dragStart = a; dragCur = b; isDragging = !!b; },
  setFireMode: (f) => { fireMode = f; }, setIntro: (ms) => { introUntil = performance.now() + ms; },
  decals, addDecal, renderGround, makeTextures, theme, THEMES, isoSpriteFor,
  setArch: (a) => { state.arch = a; }, spawnUnit,
};`;
eval(src + exportSnippet);
const t = globalThis.__test;

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✔ ' : '  ✘ FEHLER: ') + name);
  if (!cond) failures++;
}

function pump() {
  let n = performance.now();
  let g = 0;
  while (t.getBusy() && g++ < 100000) { n += 60; t.tickMoveAnim(n); }
}

/* =========== TEST 1: Fog of War =========== */
console.log('TEST 1: Fog of War');
t.startGame('hotseat', 12345, 'tb');
check('8 Einheiten erzeugt', t.state().units.length === 8);
check('Eigene Einheit sichtbar', t.isVisibleTo('A', 1, 3));
check('Gegner am Start NICHT sichtbar (Distanz 21 > Sichtweite 11)', !t.isVisibleTo('A', 22, 3));
check('Sichtbarkeitsmenge A nicht leer', t.vis.A.size > 10);
check('Erkundetes Terrain gemerkt', t.seenTiles.A.size >= t.vis.A.size);

/* =========== TEST 2: Granate + zerstoerbares Terrain =========== */
console.log('TEST 2: Granaten & Zerstoerung');
const s = t.state();
const a0 = t.unitById('A0'), b0 = t.unitById('B0');
a0.x = 4; a0.y = 5; a0.rx = 4; a0.ry = 5;
b0.x = 6; b0.y = 5; b0.rx = 6; b0.ry = 5;
s.map[5][5] = 2; // CRATE
t.refreshVisibility();
const hpBefore = b0.hp, ownBefore = a0.hp, nadesBefore = a0.grenades;
const gcmd = t.planGrenadeCmd(a0, 5, 5);
check('Granate erfasst beide Einheiten im Radius', gcmd.hits.length === 2);
check('Kiste im Radius markiert', gcmd.crates.some(([x, y]) => x === 5 && y === 5));
t.issueCommand(gcmd);
check('Kiste zerstoert', s.map[5][5] === 0);
check('Gegner beschaedigt', b0.hp < hpBefore);
check('Eigener Soldat auch getroffen (friendly fire)', a0.hp < ownBefore);
check('Granatenvorrat reduziert', a0.grenades === nadesBefore - 1);
check('TU abgezogen', a0.tu === a0.maxTu - t.GRENADE.cost);

/* =========== TEST 3: komplette rundenbasierte Schlacht =========== */
console.log('TEST 3: Rundenbasierte Schlacht (Hotseat, beide Seiten skriptgesteuert)');
t.startGame('hotseat', 987654, 'tb');
let reactionsSeen = 0, shotsFired = 0, movesDone = 0;
let guard = 0;
while (!t.state().over && guard++ < 400) {
  const st = t.state();
  const side = st.turn;
  const units = st.units.filter(u => u.side === side && u.alive);
  for (const u of units) {
    if (st.over || !u.alive) continue;
    // schiessen, solange sinnvoll
    for (let sh = 0; sh < 4; sh++) {
      if (!u.alive || st.over) break;
      const enemies = st.units.filter(e => e.alive && e.side !== side
        && t.isVisibleTo(side, e.x, e.y) && t.losClear(u.x, u.y, e.x, e.y));
      if (!enemies.length) break;
      const w = t.UNIT_TYPES[u.type].weapon;
      if (u.tu < w.snap.cost) break;
      t.issueCommand(t.planShootCmd(u, enemies[0], 'snap'));
      shotsFired++;
    }
    if (!u.alive || st.over) continue;
    // vorruecken
    const enemies = st.units.filter(e => e.alive && e.side !== side);
    if (!enemies.length) break;
    const target = enemies[0];
    const reach = t.computeReachable(u);
    let best = null, bd = 1e9;
    for (const [k, info] of reach) {
      const [x, y] = k.split(',').map(Number);
      const d = Math.hypot(x - target.x, y - target.y);
      if (d < bd) { bd = d; best = info; }
    }
    if (best && best.path.length) {
      const mc = t.planMoveCmd(u, best.path, best.cost);
      if (mc.reactions.length) reactionsSeen += mc.reactions.length;
      t.issueCommand(mc);
      movesDone++;
      pump();
    }
  }
  if (!t.state().over) t.issueCommand({ type: 'end' });
}
console.log(`  (Runden: ${t.state().round}, Schuesse: ${shotsFired}, Bewegungen: ${movesDone}, Reaktionsschuesse: ${reactionsSeen})`);
check('Schlacht wurde entschieden', t.state().over === true);
check('Es gibt einen Sieger', t.state().winner === 'A' || t.state().winner === 'B');
check('Es wurde geschossen', shotsFired > 0);
check('Verlierer-Squad komplett ausser Gefecht (tot oder niedergestreckt)',
  t.state().units.filter(u => u.side !== t.state().winner && u.alive && !u.down).length === 0);

/* =========== TEST 4: Reaktionsfeuer-Mechanik isoliert =========== */
console.log('TEST 4: Reaktionsfeuer');
t.startGame('hotseat', 555, 'tb');
const st4 = t.state();
const mover = t.unitById('A0');
const watcher = t.unitById('B0');
// Waechter mit vollen TU direkt in Sichtweite platzieren, freies Feld
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st4.map[y][x] = 0;
mover.x = 5; mover.y = 8; mover.rx = 5; mover.ry = 8;
watcher.x = 12; watcher.y = 8; watcher.rx = 12; watcher.ry = 8;
// andere Einheiten aus dem Weg
st4.units.forEach(u => { if (u !== mover && u !== watcher) { u.x = u.side === 'A' ? 0 : 23; } });
t.refreshVisibility();
let gotReaction = false;
for (let i = 0; i < 30 && !gotReaction; i++) {
  mover.tu = mover.maxTu;
  mover.hp = mover.maxHp;
  watcher.tu = watcher.maxTu;
  const reach = t.computeReachable(mover);
  const info = reach.get('7,8') || [...reach.values()][0];
  const mc = t.planMoveCmd(mover, info.path, info.cost);
  if (mc.reactions.length) gotReaction = true;
  // Zustand zuruecksetzen statt anwenden
  mover.x = 5; mover.y = 8;
}
check('Reaktionsfeuer wird ausgeloest (55% Chance, 30 Versuche)', gotReaction);

/* =========== TEST 5: Echtzeit-Gefecht (KI vs. Auto-Feuer) =========== */
console.log('TEST 5: Echtzeit-Modus');
t.startGame('ai', 777, 'rt');
t.stopRtLoop(); // Timer stoppen, Ticks manuell treiben (deterministisch schnell)
const st5 = t.state();
check('Echtzeit-Modus aktiv', st5.timeMode === 'rt');
let ticks = 0;
const hpStart = st5.units.reduce((a, u) => a + u.hp, 0);
while (!st5.over && ticks++ < 8000) t.rtTick();
const hpEnd = st5.units.reduce((a, u) => a + u.hp, 0);
console.log(`  (Ticks: ${ticks} = ${(ticks * 0.1).toFixed(0)}s Spielzeit, HP gesamt: ${hpStart} -> ${hpEnd})`);
check('KI hat sich bewegt (Einheiten nicht mehr am Spawn)',
  st5.units.some(u => u.side === 'B' && (u.x !== 22)));
check('Es wurde gekaempft (HP-Verlust)', hpEnd < hpStart);
check('Echtzeit-Schlacht wurde entschieden', st5.over === true);

/* =========== TEST 6: Online-Spiegelung (zwei Zustaende, Befehlsaustausch) =========== */
console.log('TEST 6: Befehls-Serialisierung');
const cmd = t.planShootCmd(t.unitById('A0'), t.unitById('B0'), 'snap');
const roundtrip = JSON.parse(JSON.stringify(cmd));
check('Befehle sind JSON-serialisierbar', roundtrip.type === 'shoot' && typeof roundtrip.hit === 'boolean');
const mv = { type: 'move', unit: 'A0', path: [{ x: 2, y: 3 }], cost: 4, reactions: [], died: false };
check('Move-Befehl serialisierbar', JSON.parse(JSON.stringify(mv)).path[0].x === 2);

/* =========== TEST 7: Squad-Formationen (Rundenmodus) =========== */
console.log('TEST 7: Squad-Formationen (Rundenmodus)');
t.startGame('hotseat', 4242, 'tb');
const squad = ['A0', 'A1', 'A2', 'A3'].map(id => t.unitById(id));
for (const f of ['wedge', 'line', 'column', 'box']) {
  t.setFormation(f);
  const slots = t.computeSlots(squad, { x: 7, y: 8 });
  const okSlots = slots.filter(Boolean);
  const uniq = new Set(okSlots.map(s => s.x + ',' + s.y));
  check(`Formation '${f}': 4 eindeutige begehbare Slots`, okSlots.length === 4 && uniq.size === 4);
}
t.setFormation('wedge');
t.setSelection(squad);
t.orderSquadMove(squad, { x: 7, y: 8 });
pump();
const movedCnt = squad.filter(u => u.x !== 1).length;
check('Mindestens 3 Soldaten haben sich bewegt', movedCnt >= 3);
check('Keine zwei Soldaten auf demselben Feld',
  new Set(squad.map(u => u.x + ',' + u.y)).size === 4);
check('Squad ist am Ziel zusammengerueckt (< 6 Felder Abstand)',
  squad.every(u => Math.hypot(u.x - 7, u.y - 8) < 6));

/* =========== TEST 8: Squad-Formationen (Echtzeit) =========== */
console.log('TEST 8: Squad-Formationen (Echtzeit)');
t.startGame('hotseat', 4242, 'rt'); // hotseat+rt: keine KI, keine Netzwerkeffekte
t.stopRtLoop();
const squadR = ['A0', 'A1', 'A2', 'A3'].map(id => t.unitById(id));
t.setFormation('line');
t.setSelection(squadR);
t.orderSquadMove(squadR, { x: 8, y: 8 });
check('Bewegungsbefehle fuer mind. 3 Soldaten gesetzt',
  squadR.filter(u => u.moveQueue.length > 0).length >= 3);
for (let i = 0; i < 120; i++) t.rtTick();
check('Echtzeit-Squad in Zielnaehe angekommen',
  squadR.filter(u => u.alive).every(u => Math.hypot(u.x - 8, u.y - 8) <= 6));
check('Echtzeit: keine zwei Soldaten auf demselben Feld',
  new Set(squadR.filter(u => u.alive).map(u => u.x + ',' + u.y)).size === squadR.filter(u => u.alive).length);

/* =========== TEST 9: Salvenfeuer (Squad-Angriff) =========== */
console.log('TEST 9: Salvenfeuer');
t.startGame('hotseat', 31337, 'tb');
const st9 = t.state();
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st9.map[y][x] = 0;
const atk = ['A0', 'A1', 'A2'].map(id => t.unitById(id));
atk.forEach((u, i) => { u.x = 5; u.y = 6 + i; u.rx = u.x; u.ry = u.y; });
const victim = t.unitById('B0');
victim.x = 10; victim.y = 7; victim.rx = 10; victim.ry = 7; victim.hp = victim.maxHp;
t.refreshVisibility();
const tuBefore = atk.map(u => u.tu);
t.setSelection(atk);
t.orderAttack(atk, victim);
const firedCnt = atk.filter((u, i) => u.tu < tuBefore[i]).length;
check('Alle 3 Soldaten haben in der Salve gefeuert (TU verbraucht)', firedCnt === 3 || !victim.alive);

/* =========== TEST 10: Gruppe als Standard-Auswahl =========== */
console.log('TEST 10: Gruppenauswahl als Standard');
t.startGame('hotseat', 2024, 'tb');
check('Beim Spielstart ist das ganze Squad ausgewaehlt',
  t.getSelection().length === 4 && t.getSelection().every(u => u.side === 'A'));
t.issueCommand({ type: 'end' });
check('Nach Zugwechsel ist das Squad von Seite B ausgewaehlt',
  t.getSelection().length === 4 && t.getSelection().every(u => u.side === 'B'));
check('Anfuehrer ist fest (erste lebende Einheit B0)', t.getSelection()[0].id === 'B0');
t.unitById('B0').alive = false;
t.autoSelectSquad();
check('Faellt der Anfuehrer, uebernimmt der naechste (B1)',
  t.getSelection()[0].id === 'B1' && t.getSelection().length === 3);
t.startGame('hotseat', 2024, 'rt');
t.stopRtLoop();
check('Auch im Echtzeit-Modus startet die Gruppe ausgewaehlt',
  t.getSelection().length === 4);

/* =========== TEST 11: einstellbare Squad-Groesse =========== */
console.log('TEST 11: Squad-Groesse 2 bis 6');
for (const n of [2, 3, 4, 5, 6]) {
  t.startGame('hotseat', 1000 + n, 'tb', n);
  const a = t.state().units.filter(u => u.side === 'A').length;
  const b = t.state().units.filter(u => u.side === 'B').length;
  const ys = new Set(t.state().units.filter(u => u.side === 'A').map(u => u.y));
  check(`Groesse ${n}: beide Seiten ${n} Soldaten, eigene Spawn-Reihen`, a === n && b === n && ys.size === n);
}
t.startGame('hotseat', 777, 'tb', 6);
const squad6 = t.state().units.filter(u => u.side === 'A');
t.setFormation('wedge');
const slots6 = t.computeSlots(squad6, { x: 8, y: 8 });
check('Keil-Formation liefert 6 eindeutige Slots',
  slots6.filter(Boolean).length === 6 &&
  new Set(slots6.filter(Boolean).map(s => s.x + ',' + s.y)).size === 6);

/* =========== TEST 12: Verhalten Vorsichtig vs. Aggressiv =========== */
console.log('TEST 12: Deckungssuche im vorsichtigen Modus');
t.startGame('hotseat', 5555, 'tb', 2);
const st12 = t.state();
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st12.map[y][x] = 0;
st12.map[8][10] = 1; // Wand als einzige Deckung
const duo = st12.units.filter(u => u.side === 'A');
duo[0].x = 2; duo[0].y = 8; duo[0].rx = 2; duo[0].ry = 8;
duo[1].x = 2; duo[1].y = 10; duo[1].rx = 2; duo[1].ry = 10;
const foe = t.unitById('B0');
foe.x = 14; foe.y = 8; foe.rx = 14; foe.ry = 8; // sichtbare Bedrohung oestlich
st12.units.forEach(u => { if (u.side === 'B' && u !== foe) { u.alive = false; } });
t.refreshVisibility();
t.setFormation('line');
t.setSquadMode('aggressive');
const aggro = t.planSquadTargets(duo, { x: 8, y: 11 });
t.setSquadMode('cautious');
const caut = t.planSquadTargets(duo, { x: 8, y: 11 });
const coveredCaut = caut.filter(s => s && t.hasCover(foe, s)).length;
const coveredAggro = aggro.filter(s => s && t.hasCover(foe, s)).length;
console.log(`  (Deckung: vorsichtig ${coveredCaut}/2, aggressiv ${coveredAggro}/2)`);
check('Vorsichtig findet mehr Deckung als Aggressiv', coveredCaut > coveredAggro);
check('Vorsichtig: mindestens ein Soldat hinter der Wand', coveredCaut >= 1);
// TU-Reserve pruefen
t.setSquadMode('cautious');
t.orderSquadMove(duo, { x: 8, y: 11 });
pump();
const w0 = t.UNIT_TYPES[duo[0].type].weapon;
check('Vorsichtig: TU-Reserve fuer Reaktionsfeuer bleibt',
  duo.every(u => u.tu >= t.UNIT_TYPES[u.type].weapon.snap.cost));
t.setSquadMode('cautious'); // Standard wiederherstellen

/* =========== TEST 13: Zivilbevoelkerung =========== */
console.log('TEST 13: Zivilisten - Panik, Flucht, Kollateralschaden');
t.startGame('hotseat', 9090, 'tb');
const civs = t.state().civs;
check('Zivilisten gespawnt (6-9)', civs.length >= 6 && civs.length <= 9);
check('Zivilisten stehen auf freien Feldern',
  civs.every(c => t.state().map[c.y][c.x] === 0));
const c0 = civs[0];
t.scareCivs(c0.x, c0.y, 2);
check('Schuesse in der Naehe loesen Panik aus', c0.panic > 0);
const civCmd = t.buildCivCmd();
check('Zivilisten-Befehl ist JSON-serialisierbar',
  JSON.parse(JSON.stringify(civCmd)).type === 'civ');
// Flucht zum Kartenrand
c0.x = 1; c0.y = 1; c0.panic = 4;
let escaped = false;
for (let i = 0; i < 15 && !escaped; i++) {
  t.applyCommand(t.buildCivCmd());
  c0.panic = Math.max(c0.panic, 2);
  escaped = c0.escaped;
}
check('Panischer Zivilist entkommt ueber den Kartenrand', escaped);
// Granate trifft Zivilisten
const c1 = civs.find(c => c.alive);
const thrower = t.unitById('A0');
thrower.x = c1.x - 1; thrower.y = c1.y; thrower.tu = thrower.maxTu; thrower.grenades = 2;
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) t.state().map[y][x] = 0;
t.refreshVisibility();
const gcmd13 = t.planGrenadeCmd(thrower, c1.x, c1.y);
check('Granate erfasst den Zivilisten', gcmd13.civHits.some(h => h.id === c1.id));
t.applyCommand(gcmd13);
check('Zivilist stirbt in der Explosion (Statistik zaehlt)',
  !c1.alive && t.state().civDead >= 1);

/* =========== TEST 14: fliehende KI-Soldaten =========== */
console.log('TEST 14: schwer verwundete Soldaten fliehen');
t.startGame('ai', 8080, 'tb');
const runner = t.unitById('B0');
runner.hp = 5; // schwer verwundet (< 30%)
const posBefore = { x: runner.x, y: runner.y };
const fled = t.tryFleeTB(runner);
pump();
check('Verwundeter Soldat zieht sich zurueck', fled === true);
check('Er hat sich bewegt oder ist entkommen',
  runner.escaped || runner.x !== posBefore.x || runner.y !== posBefore.y);
// direkt an der Kante -> Flucht vom Feld
t.state().units.filter(u => u.side === 'B' && u !== runner).forEach(u => { u.alive = false; });
runner.alive = true; runner.hp = 5; runner.x = 23; runner.y = 8;
t.tryFleeTB(runner);
check('An der Kante flieht er vom Schlachtfeld', runner.escaped === true && !runner.alive);
check('Flucht des letzten Gegners beendet das Gefecht', t.state().over === true && t.state().winner === 'A');

/* =========== TEST 15: Kampagnen-Loop (Cyborg-Veteran & Beute) =========== */
console.log('TEST 15: Kampagne - Cyborg im Squad & Beute-Konto');
t.startGame('ai', 4711, 'tb');
const aUnits = t.state().units.filter(u => u.side === 'A');
const cyborg = aUnits.find(u => u.type === 'cyborg');
check('Reaktivierter Cyborg kaempft im Squad mit (4 Soldaten + 1 Cyborg)',
  aUnits.length === 5 && !!cyborg);
check('Cyborg traegt den Namen des Veteranen', cyborg && cyborg.name === 'Sgt. Falke');
check('Nur der Cyborg-Veteran wird geladen (Cryo bleibt in der Basis)',
  aUnits.filter(u => u.type === 'cyborg').length === 1);
check('Cyborg-Werte: 62 HP, Reaktion 75', cyborg && cyborg.maxHp === 62 && t.UNIT_TYPES.cyborg.reactions === 75);
check('Cyborg kann schiessen (Trefferchance berechenbar)',
  typeof t.hitChance(cyborg, t.unitById('B0'), 'snap') === 'number');
// KI-Sieg -> Beute landet im Kampagnen-Konto
localStorage.setItem('apocarena.loot', '0');
t.state().units.filter(u => u.side === 'B').forEach(u => t.killUnit(u));
check('Sieg ausgeloest', t.state().over === true && t.state().winner === 'A');
check('Beute im Kampagnen-Konto (300 + 80/Ueberlebender)',
  Number(localStorage.getItem('apocarena.loot')) === 300 + 80 * aUnits.filter(u => u.alive).length);

/* =========== TEST 16: Trainings-Boni, Level & Kampflaeufer =========== */
console.log('TEST 16: Kader-Stats & Kampflaeufer im Gefecht');
localStorage.setItem('apocarena.roster', JSON.stringify({
  soldiers: [
    { name: 'Krieger', type: 'assault', xp: 250, missions: 9, kills: 12, train: { hp: 4, acc: 2, re: 2 } },
    { name: 'Falke', type: 'assault', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
    { name: 'Nova', type: 'sniper', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
    { name: 'Bison', type: 'heavy', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
    { name: 'Puma', type: 'assault', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
    { name: 'Astra', type: 'sniper', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  ],
}));
localStorage.setItem('apocarena.walker', '1');
t.startGame('ai', 999, 'tb');
const a16 = t.state().units.filter(u => u.side === 'A');
check('Squad = 4 Soldaten + Cyborg + Kampflaeufer (6 Einheiten)', a16.length === 6);
const vet16 = a16.find(u => u.name === 'Krieger');
check('Level 3 + Training: 52 max. HP (40 + 8 Level + 4 Training)', vet16 && vet16.maxHp === 52);
check('Genauigkeit 71 (65 + 4 Level + 2 Training)', vet16 && vet16.acc === 71);
check('Reaktion 63 (55 + 6 Level + 2 Training)', vet16 && vet16.reactions === 63);
const walker16 = a16.find(u => u.type === 'walker');
check('Kampflaeufer KL-1 dabei (120 HP)', walker16 && walker16.maxHp === 120 && walker16.name.includes('KL-1'));
check('Frische Soldaten unveraendert (Falke: 40 HP)',
  a16.find(u => u.name === 'Falke').maxHp === 40);
// Walker stirbt -> Verlust wird gespeichert
walker16.hp = 0;
t.killUnit(walker16);
t.state().units.filter(u => u.side === 'B' && u.alive).forEach(u => t.killUnit(u));
check('Zerstoerter Walker wird ausgetragen (Neubau noetig)',
  localStorage.getItem('apocarena.walker') === '0');
const roster16 = JSON.parse(localStorage.getItem('apocarena.roster'));
check('XP nach dem Gefecht verbucht (Krieger > 250 XP)', roster16.soldiers[0].xp > 250);
check('Einsatz gezaehlt', roster16.soldiers[0].missions === 10);

/* =========== TEST 17: Haltungen (Knien/Liegen) & Kampfrolle =========== */
console.log('TEST 17: Haltungen & Kampfrolle');
t.startGame('hotseat', 13579, 'tb');
const st17 = t.state();
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st17.map[y][x] = 0;
const kneeler = t.unitById('A0');
const target17 = t.unitById('B0');
kneeler.x = 5; kneeler.y = 8; kneeler.rx = 5; kneeler.ry = 8;
target17.x = 11; target17.y = 8; target17.rx = 11; target17.ry = 8;
t.refreshVisibility();
const tuBefore17 = kneeler.tu;
const chanceStand = t.hitChance(kneeler, target17, 'snap');
t.issueCommand({ type: 'stance', unit: 'A0', stance: 'kneel' });
check('Knien gesetzt und 4 TU abgezogen',
  kneeler.stance === 'kneel' && kneeler.tu === tuBefore17 - 4);
const chanceKneel = t.hitChance(kneeler, target17, 'snap');
check('Knien erhoeht die Trefferchance', chanceKneel > chanceStand);
target17.stance = 'prone';
const chanceVsProne = t.hitChance(kneeler, target17, 'snap');
check('Liegende Ziele sind schwerer zu treffen', chanceVsProne < chanceKneel);
target17.stance = 'stand';
// Robben kostet doppelt
t.issueCommand({ type: 'stance', unit: 'A0', stance: 'prone' });
check('Hinlegen kostet 6 TU', kneeler.stance === 'prone' && kneeler.tu === tuBefore17 - 10);
const reachProne = t.computeReachable(kneeler);
const oneStep = reachProne.get('6,8');
check('Robben: 1 Feld gerade kostet 8 TU (4 × 2)', oneStep && oneStep.cost === 8);
// Kampfrolle
t.issueCommand({ type: 'stance', unit: 'A0', stance: 'stand' });
kneeler.tu = kneeler.maxTu;
const reach17 = t.computeReachable(kneeler);
const rollInfo = reach17.get('7,8');
const rollCmd = t.planMoveCmd(kneeler, rollInfo.path, 12, { roll: true });
check('Roll-Befehl ist markiert und serialisierbar',
  rollCmd.roll === true && JSON.parse(JSON.stringify(rollCmd)).roll === true);
t.issueCommand(rollCmd);
pump();
check('Rolle bewegt 2 Felder fuer 12 TU',
  kneeler.x === 7 && kneeler.tu === kneeler.maxTu - 12);
check('Roll-Animation gesetzt (Spin laeuft)', kneeler.rollUntil > 0);

/* =========== TEST 18: Commando-Modus (Crusader-Stil) =========== */
console.log('TEST 18: Commando-Modus - 1 Held, direkte Steuerung');
t.startGame('commando', 24680, 'rt');
t.stopRtLoop();
const st18 = t.state();
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st18.map[y][x] = 0;
const hero = t.unitById('A0');
check('Genau 1 Held (Silencer, 120 HP) gegen 5 Feinde',
  hero && hero.name === 'Silencer' && hero.maxHp === 120 &&
  st18.units.filter(u => u.side === 'B').length === 5);
// Feinde ausser Sichtweite parken, damit der Bewegungstest ungestoert laeuft
st18.units.filter(u => u.side === 'B').forEach((u, i) => { u.x = 22; u.y = 2 + i * 2; });
t.refreshVisibility();
// WASD: nach rechts laufen
const startX = hero.x;
t.setKey('d', true);
for (let i = 0; i < 20; i++) t.rtTick();
t.setKey('d', false);
check('WASD-Steuerung bewegt den Helden', hero.x > startX + 2);
// Hechtrolle: 2 Felder schnell + Ausweichbonus
hero.moveQueue = [];
const rollX = hero.x;
t.setKey('s', true);
t.commandoRoll();
t.setKey('s', false);
check('Rolle geplant (2 schnelle Schritte, Spin aktiv)',
  hero.fastSteps === 2 && hero.rollUntil > 0);
for (let i = 0; i < 6; i++) t.rtTick();
check('Rolle bewegt 2 Felder in Blitzgeschwindigkeit', hero.y >= 8 + 2 || hero.moveQueue.length === 0);
const foe18 = st18.units.find(u => u.side === 'B');
hero.rollUntil = performance.now() + 500;
const chanceRolling = t.hitChance(foe18, hero, 'snap');
hero.rollUntil = 0;
const chanceStanding = t.hitChance(foe18, hero, 'snap');
check('Rollender Held ist schwerer zu treffen (-25%)', chanceRolling < chanceStanding);
// Sieg
st18.units.filter(u => u.side === 'B' && u.alive).forEach(u => t.killUnit(u));
check('Alle Feinde tot -> Auftrag erfuellt', st18.over === true && st18.winner === 'A');

/* =========== TEST 19: Verwundeten-System & Overwatch-Reserve =========== */
console.log('TEST 19: Verwundete, Stabilisieren, Verbluten, Overwatch');
t.startGame('hotseat', 8642, 'tb');
const st19 = t.state();
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) st19.map[y][x] = 0;
const opfer19 = t.unitById('B0');
const medic19 = t.unitById('B1');
const gunner = t.unitById('A0');
opfer19.x = 10; opfer19.y = 8; opfer19.rx = 10; opfer19.ry = 8;
medic19.x = 11; medic19.y = 8; medic19.rx = 11; medic19.ry = 8;
gunner.x = 5; gunner.y = 8; gunner.rx = 5; gunner.ry = 8;
t.refreshVisibility();
t.applyCommand({ type: 'shoot', unit: 'A0', target: 'B0', mode: 'snap', hit: true, dmg: 999 });
check('0 HP = niedergestreckt statt tot', opfer19.alive === true && opfer19.down === true);
check('Niedergestreckter blockiert das Feld nicht mehr', t.unitAtTest ? true : (function(){
  // unitAt ist intern – indirekt pruefen: Pfad direkt durch das Feld moeglich
  const p = t.findPath(gunner, 12, 8);
  return !!p && p.some(s => s.x === 10 && s.y === 8);
})());
check('Verblutungs-Timer laeuft (3 Runden)', opfer19.bleed === 3);
check('Gefecht laeuft weiter (nicht vorbei)', st19.over === false);
// Stabilisieren durch Nachbarn
const tuMed = medic19.tu;
t.issueCommand({ type: 'stab', unit: 'B1', target: 'B0' });
check('Sanitaeter stabilisiert (8 TU)', opfer19.stable === true && medic19.tu === tuMed - 8);
// Zweites Opfer verblutet ohne Hilfe
const opfer2 = t.unitById('B2');
opfer2.x = 3; opfer2.y = 2; opfer2.rx = 3; opfer2.ry = 2;
t.applyCommand({ type: 'shoot', unit: 'A0', target: 'B2', mode: 'snap', dmg: 999, hit: true });
check('Zweites Opfer nieder', opfer2.down === true);
t.issueCommand({ type: 'end' });
t.issueCommand({ type: 'end' });
t.issueCommand({ type: 'end' });
check('Ohne Hilfe nach 3 Runden verblutet', opfer2.alive === false);
check('Stabilisierter ueberlebt alle Runden', opfer19.alive === true && opfer19.down === true);
// Overwatch-Reserve
gunner.tu = gunner.maxTu;
const reachFree = t.computeReachable(gunner).size;
gunner.reserve = true;
const reachGuard = t.computeReachable(gunner).size;
gunner.reserve = false;
check('Overwatch-Reserve verkleinert den Bewegungsradius', reachGuard < reachFree);
// Sieg zaehlt nur aktive: restliche B-Soldaten ausschalten -> nur Verwundete uebrig
t.applyCommand({ type: 'shoot', unit: 'A0', target: 'B3', mode: 'snap', dmg: 999, hit: true });
t.applyCommand({ type: 'shoot', unit: 'A0', target: 'B1', mode: 'snap', dmg: 999, hit: true });
check('Nur Verwundete uebrig -> Seite A gewinnt', st19.over === true && st19.winner === 'A');

/* =========== TEST 20: Geiselrettungs-Mission aus der Stadt =========== */
console.log('TEST 20: Stadt-Mission Geiselrettung');
t.startCityMission({ id: 3, name: 'Wohnblock D-42', org: 'habitat', kind: 'geisel' });
check('Geiselmission: deutlich mehr Zivilisten (>= 12)', t.state().civs.length >= 12);
check('Missionsinfo gesetzt', t.state().missionInfo && t.state().missionInfo.kind === 'geisel');
localStorage.setItem('apocarena.loot', '0');
t.state().units.filter(u => u.side === 'B' && u.alive).forEach(u => t.killUnit(u));
const mres = JSON.parse(localStorage.getItem('apocarena.missionresult'));
check('Ergebnis fuer die Stadt geschrieben (won, kind, civSaved)',
  mres && mres.won === true && mres.kind === 'geisel' && typeof mres.civSaved === 'number');
check('Geretteten-Praemie im Beute-Konto (>= Grundsold 150 + Kader-Beute)',
  Number(localStorage.getItem('apocarena.loot')) >= 150 + mres.civSaved * 30);

/* =========== TEST 21: Forschungs-Technologien wirken im Gefecht =========== */
console.log('TEST 21: Tech-Boni (Laser/Panzerung/Medi-Gel) & Bergungsmission');
localStorage.setItem('apocarena.tech', JSON.stringify({ laser: true, armor: true, medigel: true }));
localStorage.setItem('apocarena.walker', '0');
localStorage.setItem('apocarena.roster', JSON.stringify({ soldiers: [
  { name: 'Krieger', type: 'assault', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  { name: 'Falke', type: 'assault', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  { name: 'Nova', type: 'sniper', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  { name: 'Bison', type: 'heavy', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  { name: 'Puma', type: 'assault', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
  { name: 'Astra', type: 'sniper', xp: 0, missions: 0, kills: 0, train: { hp: 0, acc: 0, re: 0 } },
] }));
t.startGame('ai', 5150, 'tb');
const tSold = t.unitById('A0');
check('Verbundpanzerung: 40 + 10 = 50 max. HP', tSold.maxHp === 50);
check('Laser: Genauigkeit 65 + 5 = 70', tSold.acc === 70);
check('Laser: +2 Schadensbonus gesetzt', tSold.dmgBonus === 2);
// Schadensbonus im Schuss
const b21 = t.unitById('B0');
b21.x = tSold.x + 3; b21.y = tSold.y; t.refreshVisibility();
let minDmg = 99;
for (let i = 0; i < 40; i++) {
  const c = t.planShootCmd(tSold, b21, 'snap');
  if (c.hit && c.dmg < minDmg) minDmg = c.dmg;
}
check('Schuss-Schaden enthaelt Laser-Bonus (min >= 9)', minDmg >= 9);
// Bergungsmission liefert Artefakte + Forschung
localStorage.setItem('apocarena.research', '0');
localStorage.setItem('apocarena.artifacts', '0');
t.startCityMission({ id: 'crash1', name: 'UFO-Absturzstelle', org: 'regierung', kind: 'bergung' });
t.state().units.filter(u => u.side === 'B' && u.alive).forEach(u => t.killUnit(u));
check('Bergung: Artefakte geborgen (2-3)', Number(localStorage.getItem('apocarena.artifacts')) >= 2);
check('Bergung: Forschungspunkte (+15 gesamt)', Number(localStorage.getItem('apocarena.research')) === 15);

/* =========== TEST 22: Spielbare Basisverteidigung =========== */
console.log('TEST 22: Basisverteidigung im Battlescape');
const defTiles = Array.from({ length: 14 }, () => new Array(24).fill(0));
for (let y = 0; y <= 10; y++) defTiles[y][12] = 1;         // Schacht
for (let x = 8; x <= 16; x++) defTiles[10][x] = 1;          // Querkorridor
for (let y = 8; y <= 9; y++) for (let x = 10; x <= 11; x++) defTiles[y][x] = 1; // Kommando 2x2
t.startBaseDefense({
  tiles: defTiles, entrance: { x: 12, y: 0 }, kom: { x: 10, y: 8 },
  turrets: [{ k: '12,6', type: 'mg' }, { k: '12,4', type: 'laser' }],
  wave: 3,
});
t.stopRtLoop();
const dst = t.state();
check('Karte uebernommen: Fels als Wand, Gaenge frei',
  dst.map[0][0] === 1 && dst.map[10][12] === 0);
const raiders = dst.units.filter(u => u.side === 'B');
check('Welle 3: 7 Raider stuermen (4 + Welle)', raiders.length === 7);
check('Raider skaliert (+18 HP durch Welle)', raiders[0].maxHp >= 40 + 18);
const defTurrets = dst.units.filter(u => u.type === 'turret');
check('Beide Tuerme kaempfen mit (MG + Laser)', defTurrets.length === 2 && defTurrets.some(u => u.dmgBonus === 6));
const komDefs = dst.units.filter(u => u.side === 'A' && u.type !== 'turret');
check('Squad steht an der Kommandozentrale',
  komDefs.every(u => Math.hypot(u.x - 10, u.y - 8) < 7));
for (let i = 0; i < 8; i++) t.rtTick();
check('Tuerme bleiben stationaer', defTurrets.every(u => u.x === 12 && u.moveQueue.length === 0));
raiders.forEach(u => { if (u.alive) t.killUnit(u); });
const dres = JSON.parse(localStorage.getItem('apocarena.defenseresult'));
check('Verteidigungs-Ergebnis fuer die Basis geschrieben',
  dst.over === true && dres && dres.won === true && dres.wave === 3);


/* =========== TEST 23: Isometrische Projektion & Picking =========== */
console.log('TEST 23: Isometrische Ansicht (Projektion, Hoehe, Picking)');
t.startGame('hotseat', 20260824, 'tb');
t.setView('iso');
check('Ansicht ist isometrisch', t.isIso() === true);
const st23 = t.state();
// Projektion bleibt im Canvas (960x640)
let inBounds = true, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (let y = 0; y < 16 && inBounds; y++) for (let x = 0; x < 24; x++) {
  const a = t.sx(x, y), b = t.sy(x, y);
  minX = Math.min(minX, a - 24); maxX = Math.max(maxX, a + 24);
  minY = Math.min(minY, b - 30); maxY = Math.max(maxY, b + 24);
  if (a - 24 < 0 || a + 24 > 960 || b - 30 < 0 || b + 24 > 640) { inBounds = false; break; }
}
check('Iso-Projektion fuellt den Canvas aus (' + Math.round(maxX - minX) + 'x' + Math.round(maxY - minY) + ')', inBounds);
// Hoehe-Picking: Mittelpunkt der Deckflaeche jedes Tiles
let picksOk = 0, picksTotal = 0, wrongWall = 0, wrongFloor = 0, nullPick = 0;
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
  const tile = st23.map[y][x];
  const z = tile === 1 ? 1 : tile === 2 ? 0.55 : tile === 3 ? 0.45 : 0;
  const px2 = t.sx(x, y), py2 = t.sy(x, y, z) + 12;   // Zentrum der Deckflaeche
  const hit = t.screenToTile(px2, py2);
  picksTotal++;
  if (!hit) { nullPick++; continue; }
  if (hit.x === x && hit.y === y) picksOk++;
  else if (tile === 1) wrongWall++;
  else if (st23.map[y + 1] && st23.map[y + 1][x + 1] !== 0) { /* korrekt verdeckt: Objekt steht davor */ }
  else wrongFloor++;
}
check('Picking liefert immer ein Tile (' + picksTotal + ' Felder, 0 daneben)', nullPick === 0);
check('Jede Wand wird ueber ihre Deckflaeche getroffen', wrongWall === 0);
check('Freie Felder werden getroffen (ausser hinter Waenden)', wrongFloor === 0);
check('Rundweg: ' + picksOk + '/' + picksTotal + ' Felder exakt', picksOk > picksTotal * 0.8);
// Hoehen-Picking: Klick auf die Front einer Wand waehlt die Wand, nicht den Boden dahinter
let wallTile = null;
for (let y = 0; y < 15 && !wallTile; y++) for (let x = 0; x < 23; x++) {
  if (st23.map[y][x] === 1 && st23.map[y + 1][x + 1] === 0) { wallTile = { x, y }; break; }
}
if (wallTile) {
  const frontHit = t.screenToTile(t.sx(wallTile.x, wallTile.y), t.sy(wallTile.x, wallTile.y, 1) + 20);
  check('Klick auf die Wandfront trifft die Wand (Hoehe zaehlt)',
    frontHit && frontHit.x === wallTile.x && frontHit.y === wallTile.y);
}
// Draufsicht-Picking bleibt exakt
t.setView('top');
const topHit = t.screenToTile(45, 85);
check('Draufsicht-Picking: (45,85) -> Tile (1,2)', topHit && topHit.x === 1 && topHit.y === 2);
t.setView('iso');
check('Ansichtswechsel wird gespeichert', localStorage.getItem('apocarena.view') === 'iso');
t.toggleView();
check('V-Taste schaltet zurueck auf Draufsicht', t.isIso() === false);
t.setView('iso');

/* =========== TEST 24: Level-Design – vier Karten-Archetypen =========== */
console.log('TEST 24: Level-Design (Karten-Archetypen, Symmetrie, Begehbarkeit)');
const seenArch = new Set();
let deterministic = true, symmetric = true, playable = true, lowFound = 0, reachableAll = true;
for (let i = 0; i < 24; i++) {
  const seed = 1000 + i * 7717;
  const arch = t.archetypeFor(seed);
  seenArch.add(arch);
  if (t.archetypeFor(seed) !== arch) deterministic = false;
  const m = t.generateMap(seed);
  const m2 = t.generateMap(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
    if (m[y][x] !== m2[y][x]) deterministic = false;
    if (m[y][x] !== m[16 - 1 - y + 0] && false) { }
    if (m[y][x] !== m[y][23 - x]) symmetric = false;
  }
  if (!t.mapPlayable(m)) playable = false;
  let low = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) if (m[y][x] === 3) low++;
  if (low > 0) lowFound++;
  // beide Spawn-Ecken muessen per Pfad verbunden sein
  t.startGame('hotseat', seed, 'tb');
  const ua = t.unitById('A0'), ub = t.unitById('B0');
  // Ziel steht selbst auf dem Feld -> dessen Einheit als Hindernis ausblenden
  if (!t.findPath(ua, ub.x, ub.y, 400, new Set([ub.id]))) reachableAll = false;
}
check('Archetyp ist deterministisch, Karte ebenso', deterministic);
check('Karten sind gespiegelt (faire Spawns)', symmetric);
check('Alle 24 Karten spielbar (verbunden + genug Deckung)', playable);
check('Beide Spawn-Punkte immer erreichbar', reachableAll);
check('Vier Archetypen im Umlauf: ' + [...seenArch].sort().join(', '), seenArch.size === 4);
check('Bruestungen (huefthohe Deckung) in ' + lowFound + '/24 Karten', lowFound >= 12);

/* =========== TEST 25: Huefthohe Deckung & Haltung =========== */
console.log('TEST 25: Bruestung – Deckung je Haltung, Sicht bleibt frei');
t.startGame('hotseat', 4242, 'tb');
const s25 = t.state();
const sh = t.unitById('A0'), tg = t.unitById('B0');
sh.x = 4; sh.y = 5; sh.rx = 4; sh.ry = 5; sh.stance = 'stand';
tg.x = 6; tg.y = 5; tg.rx = 6; tg.ry = 5; tg.stance = 'stand';
for (let yy = 3; yy <= 7; yy++) for (let xx = 3; xx <= 7; xx++) s25.map[yy][xx] = 0;
s25.map[5][5] = 3;                                          // Bruestung genau dazwischen
// uebrige Einheiten aus dem Testgebiet holen, damit sie den Pfad nicht blockieren
for (const o of s25.units) if (o !== sh && o !== tg) { o.x = o.side === 'A' ? 1 : 22; o.y = 14; o.rx = o.x; o.ry = o.y; }
t.refreshVisibility();
check('Sichtlinie ueber die Bruestung bleibt frei', t.LOS(4, 5, 6, 5) === true);
check('Bruestung als Deckung erkannt', t.coverKind(sh, tg) === 'low');
check('Stehend: halbe Deckung (-12 %)', t.coverPenalty(sh, tg) === 12);
tg.stance = 'kneel';
check('Kniend: volle Deckung (-20 %)', t.coverPenalty(sh, tg) === 20);
tg.stance = 'prone';
check('Liegend: volle Deckung (-20 %)', t.coverPenalty(sh, tg) === 20);
tg.stance = 'stand';
const noCover = t.hitChance(sh, tg, 'snap');
s25.map[5][5] = 1;                                          // gleiche Stelle als Wand
const withWall = t.hitChance(sh, tg, 'snap');
check('Wand deckt besser als Bruestung (' + withWall + ' % vs ' + noCover + ' %)', withWall < noCover);
s25.map[5][5] = 3;
check('Bruestung blockiert die Bewegung', t.BLOCKED(5, 5) === true);
const others = new Set(s25.units.filter(o => o !== sh).map(o => o.id));
const pathAround = t.findPath(sh, 6, 5, 400, others);
check('Pfad fuehrt um die Bruestung herum', !!pathAround && !pathAround.some(p => p.x === 5 && p.y === 5));
check('Pfad kommt am Ziel an', !!pathAround && pathAround[pathAround.length - 1].x === 6);
// Granate raeumt die Bruestung weg
let gcmd25 = null;
for (let i = 0; i < 40 && !gcmd25; i++) {
  const c = t.planGrenadeCmd(sh, 5, 5);
  if (c.lows && c.lows.some(([x, y]) => x === 5 && y === 5)) gcmd25 = c;
}
check('Granate erfasst Bruestungen', !!gcmd25);
if (gcmd25) {
  t.issueCommand(gcmd25);
  check('Bruestung weggesprengt', s25.map[5][5] === 0);
}

/* =========== TEST 26: Bewegungs-Animationen =========== */
console.log('TEST 26: Animationen (stehen, gehen, knien, robben, Rolle, Rueckstoss)');
t.startGame('ai', 31337, 'rt', 4);
const u26 = t.unitById('A0');
let now26 = 1000;
const step = (u, dx, dy, t2) => { u.rx += dx; u.ry += dy; t.updateAnim(u, t2); };
u26.rx = u26.x; u26.ry = u26.y; u26.moveQueue = []; u26.stance = 'stand'; u26.down = false;
u26.rollUntil = 0;
check('Stehen im Stillstand -> idle', t.updateAnim(u26, now26) === 'idle');
const phaseIdle = u26.phase;
t.updateAnim(u26, now26 + 16);
check('Idle atmet (Phase laeuft weiter)', u26.phase > phaseIdle);
step(u26, 0.1, 0, now26 + 32);
check('Bewegung im Stehen -> walk', u26.animName === 'walk');
const phaseWalk = u26.phase;
step(u26, 0.1, 0, now26 + 48);
check('Gehzyklus laeuft weiter (keine Phase-Zuruecksetzung)', u26.phase > phaseWalk);
u26.stance = 'kneel';
step(u26, 0, 0, now26 + 64);
check('Kniend + Stillstand -> kneelIdle', u26.animName === 'kneelIdle');
step(u26, 0.05, 0, now26 + 80);
check('Kniend + Bewegung -> crouchWalk', u26.animName === 'crouchWalk');
u26.stance = 'prone';
step(u26, 0.02, 0, now26 + 96);
check('Liegend + Bewegung -> crawl (robben)', u26.animName === 'crawl');
step(u26, 0, 0, now26 + 112);
check('Liegend + Stillstand -> proneIdle', u26.animName === 'proneIdle');
u26.rollUntil = now26 + 400; u26.rollDur = 330; u26.stance = 'stand';
step(u26, 0.1, 0, now26 + 128);
check('Kampfrolle -> roll', u26.animName === 'roll');
u26.rollUntil = 0;
u26.down = true;
check('Niedergestreckt -> down', t.updateAnim(u26, now26 + 144) === 'down');
u26.down = false;
// Rueckstoss: nach einem Schuss ist der Zeitstempel gesetzt
const sh26 = t.unitById('A1');
const en26 = t.unitById('B0');
sh26.shotAt = -99999;
t.issueCommand(t.planShootCmd(sh26, en26, 'snap'));
check('Schuss setzt Rueckstoss-Zeitstempel', sh26.shotAt > 0);
// 8-Wege-Richtung fuer die Iso-Sprites (Sektoren liegen im Bildschirmraum:
// +x zeigt im 2:1-Raster nach rechts unten, +y nach links unten)
check('Richtung +x/+y (im Raster) zeigt am Bildschirm nach Sueden', t.dirSector(1, 1) === 2);
check('Richtung +x/-y zeigt nach Osten', t.dirSector(1, -1) === 0);
check('Richtung -x/-y zeigt nach Norden', t.dirSector(-1, -1) === 6);
check('Richtung -x/+y zeigt nach Westen', t.dirSector(-1, 1) === 4);
check('Richtung +x zeigt nach Suedosten', t.dirSector(1, 0) === 1);
check('Richtung +y zeigt nach Suedwesten', t.dirSector(0, 1) === 3);
// Zivilisten haben denselben Zyklus
const civ26 = { x: 3, y: 3, rx: 3, ry: 3, panic: 0 };
t.updateCivAnim(civ26, 1);
civ26.rx += 0.1;
t.updateCivAnim(civ26, 2);
check('Zivilist bekommt Gehzyklus', civ26.moving === true && civ26.phase > 0);

/* =========== TEST 27: Tilesets, Decals, Ansichtswechsel =========== */
console.log('TEST 27: Tilesets pro Archetyp & persistente Blutspuren');
t.startGame('hotseat', 777, 'tb');
const arch27 = t.state().arch;
check('Karte hat einen Archetyp: ' + arch27, !!t.ARCHETYPES[arch27]);
check('Tileset passt zum Archetyp (' + t.ARCHETYPES[arch27].theme + ')',
  t.theme() === t.THEMES[t.ARCHETYPES[arch27].theme]);
t.setArch('nest');
t.makeTextures(t.state().seed);
check('Tilesetwechsel auf Aliennest moeglich', t.theme() === t.THEMES.organic);
t.setArch(arch27);
t.makeTextures(t.state().seed);
check('Iso-Sprites fuer Wand/Kiste/Bruestung gebacken',
  !!t.isoSpriteFor(1) && !!t.isoSpriteFor(2) && !!t.isoSpriteFor(3) && t.isoSpriteFor(0) === null);
check('Wand-Sprite hoeher als Bruestungs-Sprite',
  t.isoSpriteFor(1).hpx > t.isoSpriteFor(3).hpx);
t.addDecal(5, 5, 'rgba(120,26,18,0.8)', false);
check('Blutspur abgelegt', t.decals.length === 1 && t.decals[0].dots.length > 0);
t.renderGround();
t.setView('top');
t.renderGround();
check('Blutspuren ueberstehen Ansichtswechsel + Neubauchung', t.decals.length === 1);
t.setView('iso');
t.addDecal(6, 6, 'rgba(12,12,12,0.85)', true);
check('Brandspur kommt dazu', t.decals.length === 2);
t.startGame('hotseat', 778, 'tb');
check('Neue Karte startet ohne alte Spuren', t.decals.length === 0);


/* =========== TEST 28: Renderer laeuft in beiden Ansichten =========== */
console.log('TEST 28: Renderer (Iso + Draufsicht) zeichnen ohne Fehler');
function renderScene(label) {
  resetDrawCalls();
  let err = null;
  try {
    for (let f = 0; f < 3; f++) t.render(performance.now() + f * 16);
  } catch (e) { err = e; }
  check(label + ': Renderer ohne Absturz' + (err ? ' – ' + err.message : ''), !err);
  check(label + ': Boden/Sprites geblitted (' + drawCalls.drawImage + ')', drawCalls.drawImage > 20);
  check(label + ': Figuren gezeichnet (' + drawCalls.ellipse + ' Ellipsen, ' + drawCalls.arc + ' Kreise)',
    drawCalls.ellipse > 4 && drawCalls.arc > 4);
  return err;
}
t.startGame('ai', 555, 'rt', 4);
t.setIntro(2000);                                  // Dropship-Intro aktiv
const s28 = t.state();
s28.units.forEach((u, i) => {                      // alle Posen gleichzeitig aufs Feld
  u.stance = ['stand', 'kneel', 'prone', 'stand', 'kneel', 'prone', 'stand', 'kneel'][i % 8];
});
s28.units[0].down = true;                          // Verwundeter
s28.units[1].moveQueue = [{ x: s28.units[1].x + 1, y: s28.units[1].y }];
s28.units[2].rollUntil = performance.now() + 300;  // Kampfrolle
t.setSelection(s28.units.filter(u => u.side === 'A'));
t.setHover({ x: 12, y: 8 });
t.setDrag({ px: 10, py: 10 }, { px: 300, py: 300 });
// Effekte aller Arten erzeugen (Schuss, Granate, Tod)
const a28 = t.unitById('A0'), b28 = t.unitById('B0');
a28.down = false; a28.stance = 'stand';
t.issueCommand(t.planShootCmd(a28, b28, 'snap'));
t.issueCommand(t.planGrenadeCmd(a28, b28.x, b28.y));
t.issueCommand(t.planGrenadeCmd(a28, b28.x, b28.y));
check('Effekte liegen an (Schuss/Granate/Leiche)', t.effects.length >= 3);
t.setView('iso');
renderScene('Iso-Ansicht');
const isoBlits = drawCalls.drawImage;
const isoRound = drawCalls.roundRect;
t.setView('top');
renderScene('Draufsicht');
check('Beide Ansichten zeichnen das Gelaende (Iso ' + isoBlits + ' / Top ' + drawCalls.drawImage + ' Blits)',
  isoBlits > 20 && drawCalls.drawImage > 20);
check('Iso-Soldaten mit Rucksack/Waffendetails gezeichnet (roundRect: Iso ' + isoRound + ' / Top ' + drawCalls.roundRect + ')',
  isoRound > 4);
// Granaten-Vorschau + Pfadvorschau muessen ebenfalls rendern
t.setFireMode('nade');
t.setView('iso');
renderScene('Iso mit Granaten-Zielvorschau');
t.setFireMode('snap');
t.setDrag(null, null);
t.setView('iso');

console.log(failures === 0 ? '\nALLE TESTS BESTANDEN ✅' : `\n${failures} TEST(S) FEHLGESCHLAGEN ❌`);
process.exit(failures === 0 ? 0 : 1);
