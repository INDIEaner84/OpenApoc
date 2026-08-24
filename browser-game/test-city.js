/* Headless-Tests fuer die lebende Stadt (city.js) */
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
    prepend(c) { this.children.unshift(c); },
    removeChild() { this.children.pop(); },
    get lastChild() { return this.children[this.children.length - 1]; },
    querySelector() { return null; },
    addEventListener() { }, onclick: null,
    getContext() {
      return new Proxy({}, {
        get: (t, p) => (p === 'createLinearGradient' || p === 'createRadialGradient')
          ? () => ({ addColorStop() { } }) : () => { },
        set: () => true,
      });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; },
  };
}
globalThis.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl(id)),
  createElement: (t) => makeEl(t),
  addEventListener() { },
  body: makeEl('body'),
};
globalThis.requestAnimationFrame = () => 0;
globalThis.window = { location: { href: '' } };
globalThis.localStorage = {
  store: { 'apocarena.missionresult': JSON.stringify({ won: true, name: 'Fabrik T-42', org: 'cyberweb' }) },
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};

const src = fs.readFileSync(__dirname + '/public/city.js', 'utf8');
eval(src + `
;(() => {
  console.log('TEST 1: Stadt-Generierung – jedes Gebaeude eine Funktion');
  globalThis.__c('20 Gebaeude in 5x4 Bloecken', buildings.length === 20);
  const types = new Set(buildings.map(b => b.type));
  for (const t of ['polizei', 'fabrik', 'buero', 'wohnblock', 'krankenhaus', 'kraftwerk', 'slum', 'spaceport', 'base']) {
    globalThis.__c('Funktion vorhanden: ' + t, types.has(t));
  }
  globalThis.__c('Genau eine X-Force-Basis', buildings.filter(b => b.type === 'base').length === 1);
  globalThis.__c('Jedes Gebaeude hat eine Organisation', buildings.every(b => ORGS[b.org]));

  console.log('TEST 2: Determinismus & Persistenz');
  const again = genCity(citySeed);
  globalThis.__c('Gleicher Seed -> gleiche Stadt', JSON.stringify(again.map(b => b.type)) === JSON.stringify(buildings.map(b => b.type)));
  const savedNow = JSON.parse(localStorage.getItem('apocarena.city'));
  globalThis.__c('Stadtzustand gespeichert (Seed + Beziehungen)', savedNow.seed === citySeed && savedNow.rel.megapol !== undefined);

  console.log('TEST 3: Einsatz-Rueckmeldung aus dem Gefecht');
  globalThis.__c('Sieg verbessert Beziehung (Cyberweb 55 -> 65)', ORGS.cyberweb.rel === 65);
  globalThis.__c('Ergebnis wurde konsumiert', localStorage.getItem('apocarena.missionresult') === null);

  console.log('TEST 4: Wirtschaft der lebenden Stadt');
  const pay = econPayout();
  globalThis.__c('Verbuendete zahlen Foerderung (> 0 Cr/Tag)', pay > 0);
  ORGS.solmine.rel = 20;
  const pay2 = econPayout();
  globalThis.__c('Schlechte Beziehungen kosten Foerderung', pay2 < pay);
  ORGS.solmine.rel = 60;

  console.log('TEST 5: Misserfolg & Infiltration');
  const infBefore = infiltration;
  applyMissionResult({ won: false, name: 'Testgebaeude', org: 'gilde' });
  globalThis.__c('Niederlage: Infiltration steigt +8', infiltration === Math.min(100, infBefore + 8));
  globalThis.__c('Niederlage: Beziehung sinkt (Gilde 50 -> 42)', ORGS.gilde.rel === 42);

  console.log('TEST 6: UFOs, Gebaeudeschaden & Wiederaufbau');
  const fab = buildings.find(b => BTYPES[b.type].income > 0 && ORGS[b.org].rel >= 60);
  const payFull = econPayout();
  damageBuilding(fab, 40);
  globalThis.__c('UFO-Schaden reduziert die Foerderung', econPayout() < payFull);
  repairDay();
  globalThis.__c('Wiederaufbau: -10% Schaden pro Tag', fab.damage === 30);
  for (let i = 0; i < 5; i++) repairDay();
  globalThis.__c('Gebaeude vollstaendig repariert', fab.damage === 0);
  spawnUfo();
  globalThis.__c('UFO gespawnt mit Zielgebaeude', ufos.length === 1 && !!ufos[0].target);
  for (let i = 0; i < 2000 && ufos[0] && ufos[0].phase === 'fly'; i++) ufoTick();
  globalThis.__c('UFO erreicht sein Ziel und greift an', ufos[0] && ufos[0].phase === 'attack');
  const dmgBefore = ufos[0].target.damage;
  for (let i = 0; i < 200; i++) ufoTick();
  globalThis.__c('UFO-Beschuss beschaedigt das Gebaeude', ufos[0].target.damage > dmgBefore);
  ufos.length = 0;

  console.log('TEST 7: Missionstypen je Gebaeudefunktion');
  const wohn = buildings.find(b => b.type === 'wohnblock');
  const fab2 = buildings.find(b => b.type === 'fabrik');
  globalThis.__c('Wohnblock -> Geiselrettung', missionKindFor(wohn) === 'geisel');
  globalThis.__c('Fabrik -> Sabotage-Abwehr', missionKindFor(fab2) === 'sabotage');

  console.log('TEST 8: Absturzstellen (Bergungsmissionen)');
  createCrashSite(12, 8);
  globalThis.__c('Absturzstelle erzeugt', crashes.length === 1 && crashes[0].x === 12);
  const cp = crashScreen(crashes[0]);
  globalThis.__c('Absturzstelle klickbar (iso-Trefferzone)', crashAt(cp.x, cp.y) === crashes[0]);
  globalThis.__c('Klick daneben trifft nicht', crashAt(cp.x + 200, cp.y + 120) === null);
  crashes.length = 0;

  console.log('TEST 10: Isometrische Stadt (Projektion & Gebaeude-Treffer)');
  const bb = buildings.find(b => b.type === 'base');
  const bcx = (bb.x0 + bb.x1 + 1) / 2, bcy = (bb.y0 + bb.y1 + 1) / 2;
  const t = cityTileAt(cxp(bcx, bcy), cyp(bcx, bcy));
  globalThis.__c('Rueckprojektion trifft Basis-Tile', buildingAt(t.x, t.y) === bb);
  globalThis.__c('Hoechere Gebaeude ragen ueber den Boden', (BHEIGHT.buero || 0) > (BHEIGHT.lagerhaus || 0));
  let inB = true;
  for (const b2 of buildings) {
    const px2 = cxp(b2.x0, b2.y1 + 1), py2 = cyp(b2.x0, b2.y1 + 1) - (BHEIGHT[b2.type] || 40);
    if (px2 < -40 || px2 > 1000 || py2 < -40 || py2 > 700) { inB = false; break; }
  }
  globalThis.__c('Iso-Stadt bleibt im Canvas', inB);

  console.log('TEST 11: Atmosphaere-Renderer (Regen/Tag-Nacht/Rail/Flugverkehr)');
  let ok11 = true;
  try {
    render(2000);      // Regen an
    render(180000);    // Regen aus / andere Tageszeit
    render(180050);
  } catch (e) { ok11 = false; console.log('   render-Fehler: ' + e.message); }
  globalThis.__c('Renderer laeuft mit allen Atmosphaeren-Schichten ohne Fehler', ok11);
  globalThis.__c('Rail-Pods bleiben auf ihrer Route', (() => { const p = railPoint(railA, 0.5); return p[1] === 10.5; })());
  globalThis.__c('Flugverkehr & Wolken definiert', fliers.length > 0 && typeof drawClouds === 'function');

  console.log('TEST 9: Strassennetz & Verkehr');
  globalThis.__c('Strassenzellen vorhanden', roads.length > 50);
  const car = cars[0];
  const sx = car.x, sy = car.y;
  for (let i = 0; i < 400; i++) stepMover(car);
  globalThis.__c('Fahrzeuge bewegen sich auf Strassen', (car.x !== sx || car.y !== sy) && isRoad(car.x, car.y));
})();
`.replace(/globalThis\.__c/g, 'check'));

console.log(failures === 0 ? '\nSTADT-TESTS BESTANDEN ✅' : `\n${failures} TEST(S) FEHLGESCHLAGEN ❌`);
process.exit(failures === 0 ? 0 : 1);
