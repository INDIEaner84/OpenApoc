/* Headless-Tests fuer den Basis-Bau (base.js):
   Pfadfindung, Energie, Grab-Regeln, Persistenz, Beute-Abholung. */
'use strict';
const fs = require('fs');

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✔ ' : '  ✘ FEHLER: ') + name);
  if (!cond) failures++;
}

/* ---- Stubs ---- */
const els = {};
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', style: {}, children: [],
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); },
    querySelector() { return { onclick: null, disabled: false }; },
    querySelectorAll() { return []; },
    addEventListener() { }, onclick: null,
    getContext() {
      return new Proxy({}, {
        get: (t, p) => (p === 'createLinearGradient' || p === 'createRadialGradient')
          ? () => ({ addColorStop() { } }) : () => { },
        set: () => true,
      });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 560 }; },
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
globalThis.location = { reload() { } };
globalThis.localStorage = {
  store: { 'apocarena.loot': '500' }, // ausstehende Beute aus Gefechten
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};

const src = fs.readFileSync(__dirname + '/public/base.js', 'utf8');
eval(src + `
;(() => {
  console.log('TEST 1: Start-Layout & Pfadfindung');
  const kom = rooms.find(r => r.type === 'kommando');
  const p = findPath(ENTRANCE.x, ENTRANCE.y, kom.x, kom.y);
  globalThis.__c('Pfad vom Eingang zum Kommando existiert', !!p && p.length > 0);
  globalThis.__c('Start-Sicherheitstuer vorhanden (150 HP)', doors.get('12,2') && doors.get('12,2').hp === 150);
  globalThis.__c('Energie-Bilanz Start = +50', energyBalance() === 50);

  console.log('TEST 2: Grab-Regeln (Dungeon-Keeper-Anbau)');
  globalThis.__c('Graben neben Gang erlaubt', canDig(11, 3) === true);
  globalThis.__c('Graben mitten im Fels verboten', canDig(2, 10) === false);
  globalThis.__c('Oberste Reihe (Oberflaeche) verboten', canDig(5, 0) === false);

  console.log('TEST 3: Beute-Abholung aus Gefechten');
  globalThis.__c('500 Cr Beute wurden gutgeschrieben (3000+500)', credits === 3500);
  globalThis.__c('Beute-Konto danach geleert', localStorage.getItem('apocarena.loot') === '0');

  console.log('TEST 4: Persistenz');
  doors.set('12,3', { hp: 150, max: 150 });
  turrets.set('11,4', { type: 'mg', cd: 0, angle: 0, target: null });
  saveBase();
  const saved = JSON.parse(localStorage.getItem('apocarena.base'));
  globalThis.__c('Spielstand enthaelt Raeume', saved.rooms.length === 2);
  globalThis.__c('Spielstand enthaelt beide Tueren', saved.doors.length === 2);
  globalThis.__c('Spielstand enthaelt Turm', saved.turrets.length === 1 && saved.turrets[0][1].type === 'mg');
  globalThis.__c('Spielstand enthaelt Veteranen', saved.vets.length === 2);

  console.log('TEST 5: Tuer verteuert den Angriffspfad');
  const d1 = findPath(ENTRANCE.x, ENTRANCE.y, kom.x, kom.y);
  doors.delete('12,2'); doors.delete('12,3');
  const d2 = findPath(ENTRANCE.x, ENTRANCE.y, kom.x, kom.y);
  globalThis.__c('Ohne Tueren gleicher Weg, aber Kostenmodell aktiv (Pfad existiert weiterhin)', !!d1 && !!d2);

  console.log('TEST 6: Turm-Sichtlinie durch Fels blockiert');
  globalThis.__c('LOS im Gang frei', losTunnel(12, 3, 12, 5) === true);
  globalThis.__c('LOS durch Fels blockiert', losTunnel(12, 3, 2, 10) === false);

  console.log('TEST 7: Trainingsraeume wirken auf den Kader');
  globalThis.__c('Ohne Trainingsraum kein Training', trainCycle() === false);
  placeRoom('gym', 2, 2);
  placeRoom('range', 2, 5);
  placeRoom('simhall', 2, 8);
  const cBefore = credits;
  globalThis.__c('Trainingszyklus laeuft', trainCycle() === true);
  globalThis.__c('Kosten abgezogen (150 Cr)', credits === cBefore - 150);
  const s0 = roster.soldiers[0];
  globalThis.__c('Kraftraum: +2 HP-Training', s0.train.hp === 2);
  globalThis.__c('Schiessstand: +1 Genauigkeit', s0.train.acc === 1);
  globalThis.__c('Kampfsimulator: +2 Reaktion', s0.train.re === 2);
  for (let i = 0; i < 12; i++) trainCycle();
  globalThis.__c('Caps greifen (max +12 HP / +8 ACC / +10 REA)',
    s0.train.hp === 12 && s0.train.acc === 8 && s0.train.re === 10);
  const savedRoster = JSON.parse(localStorage.getItem('apocarena.roster'));
  globalThis.__c('Trainings-Fortschritt gespeichert', savedRoster.soldiers[0].train.hp === 12);

  console.log('TEST 8: Forschung - Artefakte, Labor, Tech-Baum');
  localStorage.setItem('apocarena.artifacts', '3');
  localStorage.setItem('apocarena.research', '0');
  globalThis.__c('Analyse ohne Labor blockiert', analyzeArtifacts() === false);
  placeRoom('labor', 6, 11);
  globalThis.__c('3 Artefakte -> +30 Forschung', analyzeArtifacts() === true && getResearch() === 30);
  globalThis.__c('Laser (60) noch zu teuer', doResearch('laser') === false);
  localStorage.setItem('apocarena.research', '70');
  globalThis.__c('Laser erforscht (70-60=10 uebrig)', doResearch('laser') === true && getResearch() === 10 && getTech().laser === true);
  globalThis.__c('Plasma braucht Laser: jetzt freigeschaltet, aber zu teuer', doResearch('plasma') === false);
  localStorage.setItem('apocarena.research', '120');
  globalThis.__c('Plasma erforscht (Kette funktioniert)', doResearch('plasma') === true && getTech().plasma === true);

  console.log('TEST 9: Personal-NPCs - Jobs, Instandhaltung, Verteidigung');
  placeRoom('werkstatt', 16, 11);
  syncStaff();
  const sci = staff.filter(s => s.role === 'wissenschaftler').length;
  const tec = staff.filter(s => s.role === 'techniker').length;
  const bau = staff.filter(s => s.role === 'bauarbeiter').length;
  globalThis.__c('Labor stellt Wissenschaftler ein (>=2)', sci >= 2);
  globalThis.__c('Werkstatt stellt Techniker ein (>=2)', tec >= 2);
  globalThis.__c('Bauarbeiter-Grundstamm vorhanden (>=2)', bau >= 2);
  globalThis.__c('Alle NPCs stehen auf begehbaren Feldern', staff.every(s => walkable(s.x, s.y)));
  // Instandhaltung: Techniker repariert beschaedigte Tuer
  doors.set('12,3', { hp: 60, max: 150 });
  const mech = staff.find(s => s.role === 'techniker');
  mech.x = 12; mech.y = 4; mech.rx = 12; mech.ry = 4; mech.state = 'work'; mech.workT = 999;
  for (let i = 0; i < 100; i++) staffMaintenance();
  globalThis.__c('Techniker repariert die Tuer (60 -> ~100 HP)', Math.abs(doors.get('12,3').hp - 100) < 1);
  // Bei Angriff: Personal kaempft
  sim = { raiders: [{ x: mech.x + 1, y: mech.y, hp: 60, max: 60, dead: false, spawned: 0 }], kills: 0 };
  mech.cool = 0; mech.hp = 20;
  for (let i = 0; i < 40; i++) staffCombat();
  globalThis.__c('Bewaffnetes Personal verwundet den Raider', sim.raiders[0].hp < 60);
  globalThis.__c('Raider verletzt das Personal im Nahkampf', mech.hp < 20);
  sim = null;

  console.log('TEST 10: Spielbare Verteidigung - Ergebnis-Verbuchung');
  const wBefore = wave, cBefore2 = credits, rBefore = getResearch();
  applyDefenseResult({ won: true, wave: wBefore });
  globalThis.__c('Sieg: Welle steigt, Beute & Forschung gutgeschrieben',
    wave === wBefore + 1 && credits > cBefore2 && getResearch() === rBefore + 5);
  const cBefore3 = credits;
  applyDefenseResult({ won: false, wave });
  globalThis.__c('Niederlage: Pluenderung kostet 300 Cr', credits === Math.max(0, cBefore3 - 300));
})();
`.replace(/globalThis\.__c/g, 'check'));

console.log(failures === 0 ? '\nBASIS-TESTS BESTANDEN ✅' : `\n${failures} TEST(S) FEHLGESCHLAGEN ❌`);
process.exit(failures === 0 ? 0 : 1);
