/* ============================================================
   APOC ARENA – Squad-Taktikspiel im Browser
   Inspiriert vom Battlescape aus X-COM: Apocalypse.

   Features:
   - Rundenmodus (Time Units) UND Echtzeit-Modus (Cooldowns)
   - Fog of War mit Terrain-Erinnerung
   - Reaktionsfeuer (Overwatch) im Rundenmodus
   - Granaten + zerstoerbares Terrain
   - Hotseat-PvP, KI-Gefecht, Online-PvP (WebSocket-Relay)

   Architektur: ALLE Zustandsaenderungen laufen als serialisier-
   bare Befehle durch applyCommand() – lokal wie uebers Netz.
   Der ausfuehrende Client wuerfelt und schickt Ergebnisse mit
   (owner-authoritative), dadurch keine Desyncs.
   ============================================================ */
'use strict';

/* ---------------- Konstanten ---------------- */
const W = 24, H = 16, T = 40;           // Kartengroesse in Tiles, Tile-Pixel (Top-Down)
const FLOOR = 0, WALL = 1, CRATE = 2, LOWWALL = 3;
// Hoehe der Tiles in "Etagen" – treibt die isometrische Ansicht UND die Deckung:
//   WALL     = mannshoch, blockiert Sicht und Bewegung
//   CRATE    = brusthoch, blockiert Sicht und Bewegung
//   LOWWALL  = huefthoch (Bruestung/Sandsack/Mauerrest): blockiert nur die Bewegung,
//              man kann drueberschiessen – Deckung haengt von der Haltung ab
const TILE_H = {};
TILE_H[FLOOR] = 0; TILE_H[WALL] = 1; TILE_H[CRATE] = 0.55; TILE_H[LOWWALL] = 0.45;
const MOVE_ORTHO = 4, MOVE_DIAG = 6;    // TU-Kosten pro Feld
const COVER_PENALTY = 20;               // Trefferchance-Malus bei voller Deckung
const LOWCOVER_PENALTY = 12;            // ... bei huefthoher Deckung im Stehen
const VISION = 11;                      // Sichtweite in Tiles

/* ---------------- Ansicht: Top-Down oder isometrisch ---------------- */
// Die gesamte Spiellogik bleibt im Tile-Raster; nur die Projektion wechselt.
const VIEW = {
  mode: 'iso',        // 'iso' | 'top' – umschaltbar mit Taste V
  tw: 48, th: 24,     // Diamant-Ausmasse eines Tiles (2:1)
  wallH: 26,          // Pixel pro Hoeheneinheit
  ox: 384, oy: 104,   // Bildschirm-Position der oberen Ecke von Tile (0,0)
};
function isIso() { return VIEW.mode === 'iso'; }
function tileH(t) { return TILE_H[t] || 0; }
function tileHpx(x, y) {
  if (!state.map || !state.map[y] || state.map[y][x] === undefined) return 0;
  return tileH(state.map[y][x]) * VIEW.wallH;
}
// Welt (Tile-Koordinaten, Bruchteile erlaubt) -> Bildschirm
function sx(x, y) { return isIso() ? VIEW.ox + (x - y) * (VIEW.tw / 2) : x * T + T / 2; }
function sy(x, y, z) {
  const lift = (z || 0) * (isIso() ? VIEW.wallH : 1);
  return isIso() ? VIEW.oy + (x + y) * (VIEW.th / 2) - lift : y * T + T / 2 - lift;
}
// Bildschirm -> Tile (mit Hoehen-Picking: hoechste Flaeche unter dem Cursor gewinnt)
function screenToTile(px, py) {
  if (!isIso()) {
    const x = Math.floor(px / T), y = Math.floor(py / T);
    return (x >= 0 && y >= 0 && x < W && y < H) ? { x, y } : null;
  }
  for (let z = VIEW.wallH; z >= 0; z -= 1) {
    const ux = px - VIEW.ox, uy = py + z - VIEW.oy;
    const a = ux / (VIEW.tw / 2), b = uy / (VIEW.th / 2);
    const x = Math.floor((a + b) / 2), y = Math.floor((b - a) / 2);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (tileHpx(x, y) >= z) return { x, y };
  }
  return null;
}
// 8-Wege-Sektor (0=O, 1=SO, 2=S, ... 7=NO) aus einer Richtung in Tile-Koordinaten
function dirSector(dx, dy) {
  const ax = (dx - dy) * (VIEW.tw / 2), ay = (dx + dy) * (VIEW.th / 2);
  let s = Math.round(Math.atan2(ay, ax) / (Math.PI / 4));
  return ((s % 8) + 8) % 8;
}
// Bildschirmwinkel einer Tile-Richtung (fuer Waffen/Lauf/Muendungsfeuer)
function dirScreenAngle(dx, dy) {
  if (!isIso()) return Math.atan2(dy, dx);
  return Math.atan2((dx + dy) * (VIEW.th / 2), (dx - dy) * (VIEW.tw / 2));
}
// Ellipsen-Radien: isometrisch in y gestaucht (Kreise werden zu Diamant-Kreisen)
function squash(r) { return isIso() ? r * 0.5 : r; }
// Pfad eines Tiles (Diamant in Iso, Rechteck in Top-Down)
function tilePath(x, y, z) {
  ctx.beginPath();
  if (!isIso()) { ctx.rect(x * T, y * T - (z || 0), T, T); return; }
  const topX = sx(x, y), topY = sy(x, y, z);
  ctx.moveTo(topX, topY);
  ctx.lineTo(topX + VIEW.tw / 2, topY + VIEW.th / 2);
  ctx.lineTo(topX, topY + VIEW.th);
  ctx.lineTo(topX - VIEW.tw / 2, topY + VIEW.th / 2);
  ctx.closePath();
}

const GRENADE = { cost: 25, range: 8, dmgMin: 22, dmgMax: 34, radius: 2.2, wallChance: 0.4, cdTicks: 60 };

// Haltungen & Kampfrolle
const STANCE_TU = { stand: 4, kneel: 4, prone: 6 };   // TU-Kosten fuer Haltungswechsel
const STAB_COST = 8;          // TU fuer Erste Hilfe (stabilisieren)
const BLEED_ROUNDS = 3;       // Runden bis ein Niedergestreckter verblutet
const BLEED_TICKS = 300;      // Echtzeit: 30 Sekunden
const ROLL_COST = 12;                                  // TU fuer die Kampfrolle (max. 2 Felder)
function stanceAccMult(u) {
  const s = u.stance || 'stand';
  return s === 'prone' ? 1.18 : s === 'kneel' ? 1.10 : 1;
}
function stanceDefense(u) {
  const s = (u && u.stance) || 'stand';
  return s === 'prone' ? 15 : s === 'kneel' ? 8 : 0;
}
function moveCostFactor(u) {
  const s = u.stance || 'stand';
  return s === 'prone' ? 2 : s === 'kneel' ? 1.25 : 1;
}

// Echtzeit-Parameter
const TICK_MS = 100;
const STEP_TICKS_ORTHO = 3, STEP_TICKS_DIAG = 4;
const CD_FACTOR = 2.0;                  // Cooldown-Ticks = TU-Kosten * Faktor

const UNIT_TYPES = {
  assault: {
    cls: 'Sturmsoldat', icon: 'S', hp: 40, tu: 60, acc: 65, reactions: 55, grenades: 2,
    weapon: { name: 'M4-Impulsgewehr', dmgMin: 7, dmgMax: 13, range: 9,
      snap: { cost: 14, mult: 1.0 }, aimed: { cost: 24, mult: 1.35 } },
  },
  sniper: {
    cls: 'Scharfschuetze', icon: 'P', hp: 30, tu: 52, acc: 80, reactions: 70, grenades: 1,
    weapon: { name: 'Laser-Praezisionsgewehr', dmgMin: 12, dmgMax: 20, range: 16,
      snap: { cost: 20, mult: 0.9 }, aimed: { cost: 34, mult: 1.45 } },
  },
  heavy: {
    cls: 'Schwerer Soldat', icon: 'H', hp: 50, tu: 46, acc: 55, reactions: 40, grenades: 2,
    weapon: { name: 'Disruptor-Kanone', dmgMin: 10, dmgMax: 18, range: 11,
      snap: { cost: 18, mult: 1.0 }, aimed: { cost: 30, mult: 1.35 } },
  },
  cyborg: { // reaktivierte Veteranen aus dem Cyborg-Labor der Basis
    cls: 'Cyborg', icon: 'C', hp: 62, tu: 56, acc: 72, reactions: 75, grenades: 1,
    weapon: { name: 'Integrierte Armkanone', dmgMin: 11, dmgMax: 17, range: 12,
      snap: { cost: 15, mult: 1.0 }, aimed: { cost: 26, mult: 1.35 } },
  },
  hero: { // Commando-Modus: der "Silencer" (direkte Steuerung)
    cls: 'Silencer', icon: '!', hp: 120, tu: 60, acc: 75, reactions: 80, grenades: 3,
    weapon: { name: 'Sturmkanone', dmgMin: 10, dmgMax: 16, range: 11,
      snap: { cost: 5, mult: 1.0 }, aimed: { cost: 10, mult: 1.3 } },
  },
  turret: { // stationaere Basisgeschuetze (Basisverteidigung)
    cls: 'MG-Turm', icon: 'T', hp: 60, tu: 0, acc: 65, reactions: 0, grenades: 0,
    weapon: { name: 'Automatik-MG', dmgMin: 8, dmgMax: 12, range: 5,
      snap: { cost: 6, mult: 1.0 }, aimed: { cost: 10, mult: 1.1 } },
  },
  walker: { // Kampflaeufer aus der Mech-Werkstatt
    cls: 'Kampflaeufer', icon: 'W', hp: 120, tu: 40, acc: 60, reactions: 30, grenades: 0,
    weapon: { name: 'Zwillings-Maschinenkanone', dmgMin: 9, dmgMax: 15, range: 10,
      snap: { cost: 12, mult: 1.0 }, aimed: { cost: 22, mult: 1.25 } },
  },
};
const SQUAD_COMPS = {
  2: ['assault', 'sniper'],
  3: ['assault', 'sniper', 'heavy'],
  4: ['assault', 'assault', 'sniper', 'heavy'],
  5: ['assault', 'assault', 'sniper', 'heavy', 'assault'],
  6: ['assault', 'assault', 'sniper', 'heavy', 'assault', 'sniper'],
};
const NAMES_A = ['Krieger', 'Falke', 'Nova', 'Bison', 'Puma', 'Astra'];
const NAMES_B = ['Viper', 'Rabe', 'Dorn', 'Golem', 'Wolf', 'Nyx'];

// Formationen: Offsets in Formations-Koordinaten (Blickrichtung = +x),
// werden bei Befehlen in die Bewegungsrichtung rotiert. Bis zu 6 Slots.
const FORMATIONS = {
  wedge:  [[0, 0], [-1, -1], [-1, 1], [-2, -2], [-2, 2], [-2, 0]],
  line:   [[0, 0], [0, -1], [0, 1], [0, -2], [0, 2], [0, 3]],
  column: [[0, 0], [-1, 0], [-2, 0], [-3, 0], [-4, 0], [-5, 0]],
  box:    [[0, 0], [0, 1], [-1, 0], [-1, 1], [-2, 0], [-2, 1]],
};
const FORMATION_ORDER = ['wedge', 'line', 'column', 'box'];
const FORMATION_LABELS = { wedge: 'Keil', line: 'Linie', column: 'Kolonne', box: 'Box' };

/* ---------------- Seeded RNG (mulberry32) ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rollInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

/* ---------------- Kartengenerierung (deterministisch, gespiegelt) ---------------- */
/* ---------------- Level-Design: Karten-Archetypen ----------------
   Jede Karte entsteht deterministisch aus dem Seed (beide Clients bauen
   exakt dieselbe Karte), wird nur fuer die linke Haelfte entworfen und dann
   gespiegelt -> faire, symmetrische Spawns. Vier Archetypen mit eigenem
   Tileset und eigener Deckungs-Dramaturgie.                        */
const ARCHETYPES = {
  bunker: { label: 'Bunkerhof', theme: 'concrete', desc: 'Betonbloecke, Kisten, Sandsacklinien' },
  stadt: { label: 'Stadtstrasse', theme: 'urban', desc: 'Haeuserzeilen mit Durchbruechen, Truemmer als Deckung' },
  lager: { label: 'Lagerhalle', theme: 'cargo', desc: 'Regalreihen und Paletten, lange Schussbahnen' },
  nest: { label: 'Aliennest', theme: 'organic', desc: 'Organische Waben, Kapseln, Harzgrate' },
};
const ARCH_ORDER = ['bunker', 'stadt', 'lager', 'nest'];
function archetypeFor(seed) {
  const r = mulberry32((seed ^ 0x5bf03635) >>> 0)();
  return ARCH_ORDER[Math.floor(r * ARCH_ORDER.length) % ARCH_ORDER.length];
}

// Die Layout-Bauer beschreiben nur die linke Haelfte (x < W/2).
const LAYOUTS = {
  // Klassischer Bunkerhof: Betonbloecke + huefthohe Bruestungen
  bunker(rng, map) {
    const half = W / 2;
    const blocks = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < blocks; i++) {
      const bw = 1 + Math.floor(rng() * 2);
      const bh = 1 + Math.floor(rng() * 3);
      const bx = 3 + Math.floor(rng() * (half - 4 - bw));
      const by = 1 + Math.floor(rng() * (H - 2 - bh));
      for (let y = by; y < by + bh; y++)
        for (let x = bx; x < bx + bw; x++) map[y][x] = WALL;
    }
    const lines = 2 + Math.floor(rng() * 2);          // Sandsacklinien
    for (let i = 0; i < lines; i++) {
      const y = 2 + Math.floor(rng() * (H - 4));
      const x0 = 4 + Math.floor(rng() * 5);
      const len = 2 + Math.floor(rng() * 4);
      for (let x = x0; x < x0 + len && x < half - 1; x++)
        if (map[y][x] === FLOOR && rng() < 0.85) map[y][x] = LOWWALL;
    }
    const crates = 8 + Math.floor(rng() * 5);
    for (let i = 0; i < crates; i++) {
      const x = 2 + Math.floor(rng() * (half - 2));
      const y = Math.floor(rng() * H);
      if (map[y][x] === FLOOR) map[y][x] = CRATE;
    }
  },

  // Stadtstrasse: geschlossene Haeuserzeilen mit Tuerdurchbruechen,
  // Truemmergrate (huefthoch) als Deckung auf der Strasse
  stadt(rng, map) {
    const half = W / 2;
    const houses = 3;
    for (let i = 0; i < houses; i++) {
      const bw = 3 + Math.floor(rng() * 3);
      const bh = 3 + Math.floor(rng() * 3);
      const bx = 4 + Math.floor(rng() * Math.max(1, half - 5 - bw));
      const by = 1 + Math.floor(rng() * Math.max(1, H - 3 - bh));
      for (let y = by; y < by + bh && y < H - 1; y++)
        for (let x = bx; x < bx + bw && x < half - 1; x++) map[y][x] = WALL;
      // Tuerdurchbruch zur Strasse (Ostseite) und manchmal nach Sueden/Norden
      const dy = by + 1 + Math.floor(rng() * Math.max(1, bh - 2));
      if (bx + bw - 1 < half - 1 && dy < H) map[dy][bx + bw - 1] = FLOOR;
      if (rng() < 0.5) {
        const dx = bx + 1 + Math.floor(rng() * Math.max(1, bw - 2));
        if (rng() < 0.5 && by > 0) map[by][dx] = FLOOR;
        else if (by + bh - 1 < H) map[by + bh - 1][dx] = FLOOR;
      }
    }
    // Truemmergrate quer zur Strasse
    for (let i = 0; i < 3; i++) {
      const y = 2 + Math.floor(rng() * (H - 4));
      const x0 = 3 + Math.floor(rng() * 6);
      const len = 2 + Math.floor(rng() * 3);
      for (let x = x0; x < x0 + len && x < half - 1; x++)
        if (map[y][x] === FLOOR && rng() < 0.8) map[y][x] = LOWWALL;
    }
    // Muellcontainer / Autowracks
    for (let i = 0; i < 6; i++) {
      const x = 2 + Math.floor(rng() * (half - 2));
      const y = Math.floor(rng() * H);
      if (map[y][x] === FLOOR) map[y][x] = CRATE;
    }
  },

  // Lagerhalle: lange Regalreihen (Kisten) mit Gassen, dazwischen Paletten
  lager(rng, map) {
    const half = W / 2;
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      const y = 3 + r * 5;
      if (y >= H - 1) break;
      const x0 = 4 + Math.floor(rng() * 2);
      const x1 = Math.min(half - 2, x0 + 4 + Math.floor(rng() * 3));
      const gap = x0 + 1 + Math.floor(rng() * Math.max(1, x1 - x0 - 1));
      for (let x = x0; x < x1; x++) {
        if (x === gap || x === gap + 1) continue;      // Gasse zum Durchschluepfen
        if (map[y][x] === FLOOR) map[y][x] = CRATE;
      }
    }
    // Palettenstapel + Laderampe als huefthohe Deckung
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(rng() * (half - 4));
      const y = 1 + Math.floor(rng() * (H - 2));
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < half - 1 && ty < H && map[ty][tx] === FLOOR) map[ty][tx] = CRATE;
      }
    }
    for (let i = 0; i < 2; i++) {
      const y = 1 + Math.floor(rng() * (H - 2));
      const x0 = 3 + Math.floor(rng() * 4);
      for (let x = x0; x < x0 + 3 && x < half - 1; x++)
        if (map[y][x] === FLOOR) map[y][x] = LOWWALL;
    }
    // Buerowand mit Durchgang
    const wy = 2 + Math.floor(rng() * (H - 6));
    for (let y = wy; y < wy + 4 && y < H - 1; y++) if (map[y][half - 2] === FLOOR) map[y][half - 2] = WALL;
    map[wy + 1][half - 2] = FLOOR;
  },

  // Aliennest: runde Waben aus Wand, Kapsel-Cluster und Harzgrate
  nest(rng, map) {
    const half = W / 2;
    const blobs = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const cx2 = 4 + Math.floor(rng() * (half - 5));
      const cy2 = 2 + Math.floor(rng() * (H - 4));
      const rad = 1 + rng() * 1.6;
      for (let y = Math.max(0, cy2 - 2); y <= Math.min(H - 1, cy2 + 2); y++)
        for (let x = Math.max(2, cx2 - 2); x <= Math.min(half - 2, cx2 + 2); x++) {
          const d = Math.hypot(x - cx2, (y - cy2) * 1.15);
          if (d <= rad) map[y][x] = WALL;
        }
    }
    const pods = 3 + Math.floor(rng() * 3);           // Brutkapseln (Dreier-Cluster)
    for (let i = 0; i < pods; i++) {
      const cx2 = 3 + Math.floor(rng() * (half - 4));
      const cy2 = 1 + Math.floor(rng() * (H - 3));
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        const tx = cx2 + dx, ty = cy2 + dy;
        if (tx < half - 1 && ty < H && map[ty][tx] === FLOOR) map[ty][tx] = CRATE;
      }
    }
    for (let i = 0; i < 3; i++) {                     // Harzgrate
      const y = 2 + Math.floor(rng() * (H - 4));
      const x0 = 3 + Math.floor(rng() * 5);
      for (let x = x0; x < x0 + 3 && x < half - 1; x++)
        if (map[y][x] === FLOOR && rng() < 0.8) map[y][x] = LOWWALL;
    }
  },
};

function mirrorHalf(map) {
  const half = W / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < half; x++) map[y][W - 1 - x] = map[y][x];
  for (let y = 0; y < H; y++) {
    map[y][0] = FLOOR; map[y][1] = FLOOR;
    map[y][W - 1] = FLOOR; map[y][W - 2] = FLOOR;
  }
}

// Spielbar = alle Spawn-Felder beider Seiten sind miteinander verbunden
// und es gibt genug Deckung (sonst neu wuerfeln).
const SPAWN_ROWS = [3, 6, 9, 12];
function mapPlayable(map) {
  const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && map[y][x] === FLOOR;
  const seen = new Set(['1,3']);
  const stack = [[1, 3]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(nx, ny)) continue;
      const k = nx + ',' + ny;
      if (!seen.has(k)) { seen.add(k); stack.push([nx, ny]); }
    }
  }
  for (const sy2 of SPAWN_ROWS) {
    if (!seen.has('1,' + sy2) || !seen.has((W - 2) + ',' + sy2)) return false;
  }
  let cover = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (map[y][x] === LOWWALL || map[y][x] === CRATE) cover++;
  return cover >= 6;
}

function generateMap(seed) {
  const arch = archetypeFor(seed);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rng = mulberry32(seed + attempt * 7919);
    const map = Array.from({ length: H }, () => new Array(W).fill(FLOOR));
    LAYOUTS[arch](rng, map);
    mirrorHalf(map);
    if (mapPlayable(map)) return map;
  }
  return Array.from({ length: H }, () => new Array(W).fill(FLOOR));
}

/* ---------------- Sound (WebAudio, synthetisch) ---------------- */
let audioCtx = null;
let muted = false;
function ac() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
  return audioCtx;
}
function beep(freq, dur, type, vol, slide) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol, lowpass) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain(); g.gain.value = vol || 0.12;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass || 2000;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}
let droneStarted = false;
function startDrone() {
  if (droneStarted || muted) return;
  const c = ac(); if (!c) return;
  droneStarted = true;
  try {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 42;
    g.gain.value = 0.012;
    o.connect(g).connect(c.destination);
    o.start();
    const o2 = c.createOscillator(), g2 = c.createGain();
    o2.type = 'triangle'; o2.frequency.value = 63;
    g2.gain.value = 0.006;
    o2.connect(g2).connect(c.destination);
    o2.start();
  } catch { }
}

const sfx = {
  select: () => beep(660, 0.06, 'square', 0.05),
  shot: () => { noise(0.12, 0.10, 3200); beep(220, 0.08, 'sawtooth', 0.05, 90); },
  hit: () => beep(140, 0.15, 'sawtooth', 0.09, 60),
  miss: () => beep(500, 0.07, 'sine', 0.04, 320),
  boom: () => { noise(0.5, 0.22, 900); beep(70, 0.4, 'sine', 0.14, 32); },
  death: () => beep(200, 0.4, 'sawtooth', 0.08, 40),
  reaction: () => beep(880, 0.05, 'square', 0.06, 1200),
};

/* ---------------- Prozedurale 2D-Texturen (einmal vorgerendert) ---------------- */
/* ---------------- Tilesets & Texturen ----------------
   Jeder Karten-Archetyp bringt ein eigenes Tileset mit: Top-Down-Texturen
   fuer die Draufsicht und fertig gebackene Iso-Sprites (Deckflaeche plus
   zwei Seitenflaechen) fuer die isometrische Ansicht.                */
const THEMES = {
  concrete: {
    name: 'Beton',
    floor: [25, 31, 38], joint: 'rgba(0,0,0,0.28)',
    wall: { top: '#6d7a90', a: '#414d5e', b: '#28303c', trim: 'rgba(255,255,255,0.10)' },
    crate: { top: '#9c7544', a: '#6d5029', b: '#4c3a1e', trim: 'rgba(215,215,190,0.30)' },
    low: { top: '#93907c', a: '#5f5d51', b: '#43423a', trim: 'rgba(255,255,255,0.10)' },
  },
  urban: {
    name: 'Stadt',
    floor: [33, 31, 30], joint: 'rgba(0,0,0,0.32)',
    wall: { top: '#9a6a52', a: '#6e4634', b: '#4a2e22', trim: 'rgba(255,225,200,0.12)' },
    crate: { top: '#6f7d63', a: '#4d5744', b: '#333b2d', trim: 'rgba(255,220,120,0.28)' },
    low: { top: '#8b8378', a: '#5b544c', b: '#3d3833', trim: 'rgba(255,255,255,0.08)' },
  },
  cargo: {
    name: 'Fracht',
    floor: [27, 33, 35], joint: 'rgba(0,0,0,0.30)',
    wall: { top: '#4f7f86', a: '#33565c', b: '#213a3f', trim: 'rgba(190,240,255,0.14)' },
    crate: { top: '#b08534', a: '#7d5c22', b: '#553d15', trim: 'rgba(255,230,160,0.30)' },
    low: { top: '#7d8894', a: '#525c66', b: '#384048', trim: 'rgba(255,255,255,0.10)' },
  },
  organic: {
    name: 'Organisch',
    floor: [26, 32, 27], joint: 'rgba(0,0,0,0.26)',
    wall: { top: '#7b5aa0', a: '#553c74', b: '#362550', trim: 'rgba(210,180,255,0.14)' },
    crate: { top: '#8fae4c', a: '#64802f', b: '#44591f', trim: 'rgba(220,255,170,0.28)' },
    low: { top: '#6fa08a', a: '#4a7260', b: '#31503f', trim: 'rgba(190,255,225,0.12)' },
  },
};
function theme() {
  const a = state.arch && ARCHETYPES[state.arch] ? ARCHETYPES[state.arch].theme : 'concrete';
  return THEMES[a] || THEMES.concrete;
}

let texFloor = [], texWall = null, texCrate = null, texLow = null;
let isoFloor = [], isoSprites = {};
let groundCanvas = null, groundDirty = true;
const decals = [];                  // Blut/Brandspuren – ueberleben Ansicht & Zerstoerung
const PAD = 6;                      // Rand um Iso-Sprites (fuer Ueberhang)

function makeTileTex(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w || T; c.height = h || T;
  draw(c.getContext('2d'));
  return c;
}
// Diamant-Textur (Boden in der Iso-Ansicht)
function makeDiamondTex(draw) {
  const w = VIEW.tw + PAD * 2, h = VIEW.th + PAD * 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const cx = w / 2, cy = PAD + VIEW.th / 2;
  g.beginPath();
  g.moveTo(cx, PAD); g.lineTo(cx + VIEW.tw / 2, cy);
  g.lineTo(cx, PAD + VIEW.th); g.lineTo(cx - VIEW.tw / 2, cy);
  g.closePath();
  g.save(); g.clip();
  g.translate(cx - VIEW.tw / 2, PAD);
  draw(g, VIEW.tw, VIEW.th);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, PAD); g.lineTo(cx + VIEW.tw / 2, cy);
  g.lineTo(cx, PAD + VIEW.th); g.lineTo(cx - VIEW.tw / 2, cy);
  g.closePath(); g.stroke();
  return c;
}
// Quader-Sprite: Deckflaeche + suedwestliche + suedoestliche Seitenflaeche
function makeBoxSprite(hFrac, pal, detail) {
  const hpx = Math.round(hFrac * VIEW.wallH);
  const w = VIEW.tw + PAD * 2, h = VIEW.th + hpx + PAD * 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const cx = w / 2, top = PAD + hpx, hw = VIEW.tw / 2, hh = VIEW.th / 2;
  const quad = (pts, fill, stroke) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  };
  const topFace = [[cx, top], [cx + hw, top + hh], [cx, top + 2 * hh], [cx - hw, top + hh]];
  const leftFace = [[cx - hw, top + hh], [cx, top + 2 * hh],
                    [cx, top + 2 * hh + hpx], [cx - hw, top + hh + hpx]];
  const rightFace = [[cx + hw, top + hh], [cx, top + 2 * hh],
                     [cx, top + 2 * hh + hpx], [cx + hw, top + hh + hpx]];
  quad(leftFace, pal.a, 'rgba(0,0,0,0.5)');
  quad(rightFace, pal.b, 'rgba(0,0,0,0.5)');
  quad(topFace, pal.top, 'rgba(0,0,0,0.5)');
  if (detail) detail(g, { cx, top, hw, hh, hpx });
  c.hpx = hpx;
  return c;
}

function makeTextures(seed) {
  const rng = mulberry32((seed ^ 0x7e57) >>> 0);
  const th = theme();
  const [fr, fg, fb] = th.floor;

  const speckle = (g, w, h, n) => {
    for (let i = 0; i < n; i++) {
      const a = 0.03 + rng() * 0.06;
      g.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a + 0.03})`;
      g.fillRect(Math.floor(rng() * w), Math.floor(rng() * h),
        1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
    }
  };
  const crack = (g, w, h) => {
    if (rng() >= 0.35) return;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    let x = rng() * w, y = 0;
    g.moveTo(x, y);
    while (y < h) { x += (rng() - 0.5) * 9; y += 4 + rng() * 6; g.lineTo(x, y); }
    g.stroke();
  };

  // --- Top-Down-Boden ---
  texFloor = [];
  for (let v = 0; v < 4; v++) {
    texFloor.push(makeTileTex(g => {
      const b = v * 2;
      g.fillStyle = `rgb(${fr + b},${fg + b + 6},${fb + b + 13})`;
      g.fillRect(0, 0, T, T);
      speckle(g, T, T, 36);
      g.strokeStyle = th.joint; g.strokeRect(0.5, 0.5, T - 1, T - 1);
      g.strokeStyle = 'rgba(255,255,255,0.045)'; g.strokeRect(1.5, 1.5, T - 3, T - 3);
      crack(g, T, T);
    }));
  }
  // --- Iso-Boden ---
  isoFloor = [];
  for (let v = 0; v < 4; v++) {
    isoFloor.push(makeDiamondTex((g, w, h) => {
      const b = v * 2;
      g.fillStyle = `rgb(${fr + b},${fg + b + 6},${fb + b + 13})`;
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 26);
      crack(g, w, h);
    }));
  }
  // --- Top-Down: Wand / Kiste / Bruestung ---
  texWall = makeTileTex(g => {
    const grad = g.createLinearGradient(0, 0, 0, T);
    grad.addColorStop(0, th.wall.top); grad.addColorStop(0.15, th.wall.a); grad.addColorStop(1, th.wall.b);
    g.fillStyle = grad; g.fillRect(0, 0, T, T);
    g.fillStyle = th.wall.trim; g.fillRect(2, 2, T - 4, 4);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.strokeRect(1.5, 1.5, T - 3, T - 3);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.moveTo(2, T / 2); g.lineTo(T - 2, T / 2); g.stroke();
    g.fillStyle = 'rgba(190,210,230,0.4)';
    for (const [nx, ny] of [[6, 8], [T - 6, 8], [6, T - 8], [T - 6, T - 8]]) {
      g.beginPath(); g.arc(nx, ny, 1.6, 0, Math.PI * 2); g.fill();
    }
  });
  texCrate = makeTileTex(g => {
    const grad = g.createLinearGradient(0, 0, T, T);
    grad.addColorStop(0, th.crate.top); grad.addColorStop(1, th.crate.b);
    g.fillStyle = grad; g.fillRect(6, 6, T - 12, T - 12);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(6, 6, T - 12, 4);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.strokeRect(7, 7, T - 14, T - 14);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(6, T / 2); g.lineTo(T - 6, T / 2); g.stroke();
    g.strokeStyle = th.crate.trim; g.lineWidth = 3;
    g.beginPath(); g.moveTo(T / 2, 7); g.lineTo(T / 2, T - 7); g.stroke();
  });
  texLow = makeTileTex(g => {                       // huefthohe Bruestung (Draufsicht)
    g.fillStyle = th.low.b; g.fillRect(3, 8, T - 6, T - 16);
    const grad = g.createLinearGradient(0, 8, 0, T - 8);
    grad.addColorStop(0, th.low.top); grad.addColorStop(1, th.low.a);
    g.fillStyle = grad; g.fillRect(4, 9, T - 8, T - 20);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.5;
    g.strokeRect(3.5, 8.5, T - 7, T - 17);
    g.strokeStyle = th.low.trim; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {                   // Sandsack-Fugen
      const x = 8 + i * ((T - 16) / 4);
      g.beginPath(); g.moveTo(x, 10); g.lineTo(x, T - 10); g.stroke();
    }
  });

  // --- Iso-Sprites der Gelaendeobjekte ---
  const panelDetail = (g, m) => {
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {                  // Panelfugen auf der Front
      const yy = m.top + 2 * m.hh + (m.hpx * i) / 3;
      g.beginPath();
      g.moveTo(m.cx - m.hw, m.top + m.hh + (m.hpx * i) / 3); g.lineTo(m.cx, yy);
      g.lineTo(m.cx + m.hw, m.top + m.hh + (m.hpx * i) / 3);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.14)';       // obere Kante
    g.beginPath();
    g.moveTo(m.cx - m.hw, m.top + m.hh); g.lineTo(m.cx, m.top); g.lineTo(m.cx + m.hw, m.top + m.hh);
    g.stroke();
  };
  const crateDetail = (g, m) => {
    g.strokeStyle = th.crate.trim; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(m.cx, m.top); g.lineTo(m.cx, m.top + 2 * m.hh);
    g.moveTo(m.cx - m.hw, m.top + m.hh); g.lineTo(m.cx + m.hw, m.top + m.hh);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.30)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(m.cx - m.hw / 2, m.top + m.hh / 2); g.lineTo(m.cx + m.hw / 2, m.top + m.hh * 1.5);
    g.stroke();
  };
  const lowDetail = (g, m) => {
    g.fillStyle = 'rgba(255,255,255,0.12)';         // Sandsack-Wulste
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(m.cx - m.hw / 2 + i * (m.hw / 2), m.top + m.hh * (0.6 + 0.2 * (i % 2)),
        m.hw / 4.2, m.hh / 3.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(m.cx - m.hw, m.top + m.hh); g.lineTo(m.cx, m.top); g.lineTo(m.cx + m.hw, m.top + m.hh);
    g.stroke();
  };
  isoSprites = {
    wall: makeBoxSprite(TILE_H[WALL], th.wall, panelDetail),
    crate: makeBoxSprite(TILE_H[CRATE], th.crate, crateDetail),
    low: makeBoxSprite(TILE_H[LOWWALL], th.low, lowDetail),
  };
}
// Iso-Sprite eines Gelaendeobjekts (oder null fuer Boden)
function isoSpriteFor(tile) {
  if (tile === WALL) return isoSprites.wall;
  if (tile === CRATE) return isoSprites.crate;
  if (tile === LOWWALL) return isoSprites.low;
  return null;
}
function blitIso(g, sprite, x, y) {
  g.drawImage(sprite, sx(x, y) - sprite.width / 2, sy(x, y) - (PAD + sprite.hpx));
}

/* ---------------- Boden-Puffer (Offscreen) ----------------
   Nur Boden + Decals + Kontakt-Schatten werden gebacken; Gelaendeobjekte
   zeichnet der Renderer pro Frame in Tiefenreihenfolge (sonst koennten
   Einheiten nie hinter einer Wand stehen).                          */
function renderGround() {
  if (!groundCanvas) {
    groundCanvas = document.createElement('canvas');
    groundCanvas.width = canvas.width; groundCanvas.height = canvas.height;
  }
  const g = groundCanvas.getContext('2d');
  g.clearRect(0, 0, groundCanvas.width, groundCanvas.height);
  if (!state.map) { groundDirty = false; return; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const variant = (x * 7 + y * 13) % texFloor.length;
    if (isIso()) {
      g.drawImage(isoFloor[variant], sx(x, y) - isoFloor[variant].width / 2, sy(x, y) - PAD);
    } else {
      g.drawImage(texFloor[variant], x * T, y * T);
    }
  }
  if (isIso()) {
    // Kontakt-Schatten: Boden vor hohen Objekten abdunkeln (Tiefe!)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = state.map[y][x];
      if (t === FLOOR) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= W || ny >= H || state.map[ny][nx] !== FLOOR) continue;
        g.fillStyle = t === WALL ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.16)';
        g.beginPath();
        const topX = sx(nx, ny), topY = sy(nx, ny);
        g.moveTo(topX, topY); g.lineTo(topX + VIEW.tw / 2, topY + VIEW.th / 2);
        g.lineTo(topX, topY + VIEW.th); g.lineTo(topX - VIEW.tw / 2, topY + VIEW.th / 2);
        g.closePath(); g.fill();
      }
    }
  }
  drawDecals(g);
  groundDirty = false;
}

// Blut & Brandspuren dauerhaft in den Boden brennen (als Liste, damit sie
// einen Ansichtswechsel und neu gebackenen Boden ueberstehen)
function addDecal(x, y, color, big) {
  const n = big ? 10 : 7;
  const dots = [];
  for (let i = 0; i < n; i++) {
    dots.push({
      dx: (Math.random() - 0.5) * (big ? 1.0 : 0.45),
      dy: (Math.random() - 0.5) * (big ? 1.0 : 0.45),
      r: (big ? 4 : 2) + Math.random() * (big ? 8 : 5),
      a: 0.2 + Math.random() * 0.3,
    });
  }
  decals.push({ x, y, color, dots });
  if (decals.length > 200) decals.shift();
  groundDirty = true;
}
function drawDecals(g) {
  for (const d of decals) {
    for (const dot of d.dots) {
      const wx = d.x + 0.5 + dot.dx, wy = d.y + 0.5 + dot.dy;
      g.globalAlpha = dot.a;
      g.fillStyle = d.color;
      g.beginPath();
      g.ellipse(sx(wx, wy), sy(wx, wy), dot.r, squash(dot.r), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

/* ---------------- Spielzustand ---------------- */
const state = {
  map: null,
  units: [],
  civs: [],
  civDead: 0,
  civEscaped: 0,
  turn: 'A',
  round: 1,
  over: false,
  winner: null,
  timeMode: 'tb',   // 'tb' | 'rt'
  paused: false,
};

let mode = null;            // 'hotseat' | 'ai' | 'online'
let localSides = [];
let mySide = null;
let selected = null;        // primaere Einheit (Anfuehrer)
let selection = [];         // alle ausgewaehlten Einheiten (Squad)
let formation = 'wedge';
let squadMode = 'cautious'; // 'cautious' (Deckung suchen) | 'aggressive' (stur vorruecken)
let menuSquadSize = 4;
let dragStart = null, dragCur = null, isDragging = false;
let fireMode = 'snap';      // 'snap' | 'aimed' | 'nade'
let hoverTile = null;
let reachable = new Map();
let busy = false;
let ws = null;
let menuTempo = 'tb';
let rtTimer = null;
let rtTickCount = 0;
let introUntil = 0;
const INTRO_MS = 2400;
function introActive() { return performance.now() < introUntil; }
let shakeT0 = -9999;
const effects = [];

// Sichtbarkeit & erkundetes Terrain je Seite
const vis = { A: new Set(), B: new Set() };
const seenTiles = { A: new Set(), B: new Set() };

function makeUnits() {
  state.units = [];
  if (state.commando) {
    const mkC = (side, name, x, y, tKey, idx) => {
      const t = UNIT_TYPES[tKey];
      return {
        id: side + idx, side, type: tKey, name, x, y,
        hp: t.hp, maxHp: t.hp, tu: t.tu, maxTu: t.tu, grenades: t.grenades,
        alive: true, rx: x, ry: y, stance: 'stand', rollUntil: 0, rollDur: 330,
        phase: 0, animName: 'idle', shotAt: -99999, fastSteps: 0, kills: 0, down: false, stable: false, bleed: 0, reserve: false,
        cd: 0, cdMax: 1, moveQueue: [], stepWait: 0, attackTarget: null,
      };
    };
    state.units.push(mkC('A', 'Silencer', 1, Math.floor(H / 2), 'hero', 0));
    const eTypes = ['assault', 'assault', 'assault', 'sniper', 'heavy'];
    eTypes.forEach((tk, i) => {
      const y = Math.round(2 + (H - 5) * i / (eTypes.length - 1));
      state.units.push(mkC('B', NAMES_B[i % NAMES_B.length], W - 2, y, tk, i));
    });
    applyTech();
    return;
  }
  const n = Math.max(2, Math.min(6, state.squadSize || 4));
  const comp = SQUAD_COMPS[n];
  const cybs = state.cyborgVets || [];
  const rowsFor = (count) => {
    const r = [];
    for (let i = 0; i < count; i++) r.push(Math.round(2 + (H - 5) * i / Math.max(1, count - 1)));
    return r;
  };
  const mkUnit = (side, name, x, y, tKey, idx) => {
    const t = UNIT_TYPES[tKey];
    return {
      id: side + idx, side, type: tKey, name,
      x, y, hp: t.hp, maxHp: t.hp, tu: t.tu, maxTu: t.tu,
      grenades: t.grenades, alive: true, rx: x, ry: y,
      stance: 'stand', rollUntil: 0, rollDur: 330, phase: 0, animName: 'idle', shotAt: -99999,
      down: false, stable: false, bleed: 0, reserve: false,
      cd: 0, cdMax: 1, moveQueue: [], stepWait: 0, attackTarget: null,
    };
  };
  const extra = cybs.length + (state.hasWalker ? 1 : 0);
  const rowsA = rowsFor(n + extra);
  const roster = state.roster;
  comp.forEach((tKey, i) => {
    let name = NAMES_A[i], type = tKey;
    const u = (() => {
      if (roster && roster.soldiers[i]) {
        const s = roster.soldiers[i];
        const b = statBonus(s);
        const un = mkUnit('A', s.name, 1, rowsA[i], s.type, i);
        un.maxHp += b.hp; un.hp = un.maxHp;
        un.acc = UNIT_TYPES[s.type].acc + b.acc;
        un.reactions = UNIT_TYPES[s.type].reactions + b.re;
        un.rosterIdx = i;
        return un;
      }
      return mkUnit('A', name, 1, rowsA[i], type, i);
    })();
    u.kills = 0;
    state.units.push(u);
  });
  cybs.forEach((v, i) => state.units.push(mkUnit('A', v.name, 1, rowsA[n + i], 'cyborg', n + i)));
  if (state.hasWalker) {
    state.units.push(mkUnit('A', 'KL-1 "Brutus"', 1, rowsA[n + cybs.length], 'walker', n + cybs.length));
  }
  const rowsB = rowsFor(n);
  comp.forEach((tKey, i) => state.units.push(mkUnit('B', NAMES_B[i], W - 2, rowsB[i], tKey, i)));
  applyTech();
}

// Erforschte Technologien auf Seite A anwenden (Laser, Panzerung, ...)
function applyTech() {
  const tb2 = techBonuses(state.tech || {});
  if (!tb2.dmg && !tb2.acc && !tb2.hp) return;
  for (const u of state.units) {
    if (u.side !== 'A') continue;
    u.dmgBonus = tb2.dmg;
    if (u.type !== 'walker') {
      u.maxHp += tb2.hp;
      u.hp = u.maxHp;
      u.acc = (u.acc !== undefined ? u.acc : UNIT_TYPES[u.type].acc) + tb2.acc;
    }
  }
}

/* ---------------- Zivilbevoelkerung ---------------- */
function makeCivs(seed) {
  const rng = mulberry32((seed ^ 0xC171) >>> 0);
  const n = 6 + Math.floor(rng() * 4);
  state.civs = [];
  let guard = 0;
  while (state.civs.length < n && guard++ < 500) {
    const x = 5 + Math.floor(rng() * (W - 10));
    const y = 1 + Math.floor(rng() * (H - 2));
    if (state.map[y][x] !== FLOOR) continue;
    if (state.civs.some(c => c.x === x && c.y === y)) continue;
    state.civs.push({ id: 'C' + state.civs.length, x, y, rx: x, ry: y,
      hp: 15, alive: true, panic: 0, escaped: false });
  }
}
function civAt(x, y) { return state.civs.find(c => c.alive && c.x === x && c.y === y) || null; }
function isHost() { return mode !== 'online' || mySide === 'A'; }

// Panik ausloesen (Schuesse, Explosionen) - laeuft deterministisch auf beiden Clients
function scareCivs(x, y, radius) {
  for (const c of state.civs) {
    if (!c.alive) continue;
    if (Math.hypot(c.x - x, c.y - y) <= radius) c.panic = Math.max(c.panic, 4);
  }
}

// Host wuerfelt die Zivilisten-Bewegung und verschickt sie als Befehl
function buildCivCmd() {
  const moves = [];
  for (const c of state.civs) {
    if (!c.alive) continue;
    const steps = c.panic > 0 ? 2 : (Math.random() < 0.35 ? 1 : 0);
    let cx = c.x, cy = c.y, esc = false;
    for (let s = 0; s < steps; s++) {
      let tx, ty;
      if (c.panic > 0) {
        const edges = [[0, cy], [W - 1, cy], [cx, 0], [cx, H - 1]];
        edges.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        tx = edges[0][0]; ty = edges[0][1];
      } else {
        tx = cx + Math.floor(Math.random() * 3) - 1;
        ty = cy + Math.floor(Math.random() * 3) - 1;
      }
      const dx = Math.sign(tx - cx), dy = Math.sign(ty - cy);
      if (!dx && !dy) continue;
      const cand = [[cx + dx, cy + dy], [cx + dx, cy], [cx, cy + dy]].filter(([nx, ny]) =>
        nx >= 0 && ny >= 0 && nx < W && ny < H && state.map[ny][nx] === FLOOR
        && !unitAt(nx, ny) && !civAt(nx, ny));
      if (!cand.length) break;
      cx = cand[0][0]; cy = cand[0][1];
      if (c.panic > 0 && (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1)) { esc = true; break; }
    }
    if (cx !== c.x || cy !== c.y || esc) moves.push({ id: c.id, x: cx, y: cy, esc });
  }
  return { type: 'civ', moves };
}

function applyCiv(cmd) {
  for (const m of cmd.moves) {
    const c = state.civs.find(c2 => c2.id === m.id);
    if (!c || !c.alive) continue;
    c.x = m.x; c.y = m.y;
    if (m.esc) {
      c.alive = false; c.escaped = true;
      state.civEscaped++;
      log('🏃 Ein Zivilist entkommt vom Schlachtfeld.');
    }
  }
  for (const c of state.civs) if (c.alive && c.panic > 0) c.panic--;
}

function unitAt(x, y) {
  return state.units.find(u => u.alive && !u.down && u.x === x && u.y === y) || null;
}
function downedAt(x, y) {
  return state.units.find(u => u.alive && u.down && u.x === x && u.y === y) || null;
}
function unitById(id) { return state.units.find(u => u.id === id); }
function blocked(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  return state.map[y][x] !== FLOOR;
}
function weaponOf(u) { return UNIT_TYPES[u.type].weapon; }

// Einheiten-Fabrik (auch fuer Basisverteidigung nutzbar)
function spawnUnit(side, name, x, y, tKey, idx) {
  const t = UNIT_TYPES[tKey];
  return {
    id: side + idx, side, type: tKey, name, x, y,
    hp: t.hp, maxHp: t.hp, tu: t.tu, maxTu: t.tu, grenades: t.grenades,
    alive: true, rx: x, ry: y, stance: 'stand', rollUntil: 0, rollDur: 330,
    phase: 0, animName: 'idle', shotAt: -99999, fastSteps: 0, kills: 0, down: false, stable: false, bleed: 0, reserve: false,
    cd: 0, cdMax: 1, moveQueue: [], stepWait: 0, attackTarget: null,
  };
}

/* ---------------- Sichtbarkeit (Fog of War) ---------------- */
function refreshVisibility() {
  for (const side of ['A', 'B']) {
    const v = new Set();
    for (const u of state.units) {
      if (!u.alive || u.down || u.side !== side) continue;
      const x0 = Math.max(0, u.x - VISION), x1 = Math.min(W - 1, u.x + VISION);
      const y0 = Math.max(0, u.y - VISION), y1 = Math.min(H - 1, u.y + VISION);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x - u.x, y - u.y) > VISION) continue;
        const k = x + ',' + y;
        if (v.has(k)) continue;
        if (losClear(u.x, u.y, x, y)) v.add(k);
      }
    }
    vis[side] = v;
    for (const k of v) seenTiles[side].add(k);
  }
}
function viewingSide() {
  if (mode === 'hotseat') return state.turn;
  return mySide || 'A';
}
function isVisibleTo(side, x, y) { return vis[side].has(x + ',' + y); }

/* ---------------- Pfadsuche ---------------- */
function computeReachable(unit) {
  const dist = new Map();
  const prev = new Map();
  const startKey = unit.x + ',' + unit.y;
  const budget = unit.reserve
    ? Math.max(0, unit.tu - weaponOf(unit).snap.cost) : unit.tu;
  dist.set(startKey, 0);
  const pq = [[0, unit.x, unit.y]];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, x, y] = pq.splice(bi, 1)[0];
    if (d > (dist.get(x + ',' + y) ?? Infinity)) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (blocked(nx, ny)) continue;
      if (unitAt(nx, ny)) continue;
      if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
      const cost = d + Math.round(((dx && dy) ? MOVE_DIAG : MOVE_ORTHO) * moveCostFactor(unit));
      if (cost > budget) continue;
      const k = nx + ',' + ny;
      if (cost < (dist.get(k) ?? Infinity)) {
        dist.set(k, cost);
        prev.set(k, x + ',' + y);
        pq.push([cost, nx, ny]);
      }
    }
  }
  const result = new Map();
  for (const [k, cost] of dist) {
    if (k === startKey) continue;
    const path = [];
    let cur = k;
    while (cur && cur !== startKey) {
      const [px2, py2] = cur.split(',').map(Number);
      path.unshift({ x: px2, y: py2 });
      cur = prev.get(cur);
    }
    result.set(k, { cost, path });
  }
  return result;
}

// Freie Pfadsuche ohne TU-Limit (fuer Echtzeit & KI), Kostendeckel gegen Endlosslauf.
// `ignore`: Set von Einheiten-IDs (z. B. Squad-Mitglieder), die nicht als Hindernis zaehlen.
function findPath(unit, tx, ty, maxCost = 400, ignore = null) {
  if (blocked(tx, ty)) return null;
  const occT = unitAt(tx, ty);
  if (occT && !(ignore && ignore.has(occT.id))) return null;
  const dist = new Map();
  const prev = new Map();
  const startKey = unit.x + ',' + unit.y;
  const targetKey = tx + ',' + ty;
  dist.set(startKey, 0);
  const pq = [[0, unit.x, unit.y]];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, x, y] = pq.splice(bi, 1)[0];
    if (x === tx && y === ty) break;
    if (d > (dist.get(x + ',' + y) ?? Infinity)) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (blocked(nx, ny)) continue;
      const occ = unitAt(nx, ny);
      if (occ && !(ignore && ignore.has(occ.id)) && !(nx === tx && ny === ty)) continue;
      if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
      const cost = d + ((dx && dy) ? MOVE_DIAG : MOVE_ORTHO);
      if (cost > maxCost) continue;
      const k = nx + ',' + ny;
      if (cost < (dist.get(k) ?? Infinity)) {
        dist.set(k, cost);
        prev.set(k, x + ',' + y);
        pq.push([cost, nx, ny]);
      }
    }
  }
  if (!dist.has(targetKey)) return null;
  const path = [];
  let cur = targetKey;
  while (cur && cur !== startKey) {
    const [px2, py2] = cur.split(',').map(Number);
    path.unshift({ x: px2, y: py2 });
    cur = prev.get(cur);
  }
  return path;
}

/* ---------------- Sichtlinie & Deckung ---------------- */
function losClear(x0, y0, x1, y1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3;
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const fx = x0 + (x1 - x0) * t;
    const fy = y0 + (y1 - y0) * t;
    const cx = Math.round(fx), cy = Math.round(fy);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    if (state.map[cy][cx] === WALL) return false;
  }
  return true;
}

// Deckung zwischen Schuetze und Ziel: das Feld, auf das sich das Ziel "lehnt".
// Voll hoch (Wand/Kiste) deckt immer; huefthohe Bruestung deckt kniend/liegend
// voll, stehend nur teilweise -> Haltungen lohnen sich jetzt sichtbar.
function coverTiles(shooter, target) {
  const dx = Math.sign(shooter.x - target.x);
  const dy = Math.sign(shooter.y - target.y);
  const checks = [];
  if (dx) checks.push([target.x + dx, target.y]);
  if (dy) checks.push([target.x, target.y + dy]);
  if (dx && dy) checks.push([target.x + dx, target.y + dy]);
  const out = [];
  for (const [cx, cy] of checks) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const t = state.map[cy][cx];
    if (t === WALL || t === CRATE || t === LOWWALL) out.push({ x: cx, y: cy, tile: t });
  }
  return out;
}
function hasCover(shooter, target) { return coverTiles(shooter, target).length > 0; }
// Deckungs-Malus in Prozentpunkten (0 = frei im Gelaende)
function coverPenalty(shooter, target) {
  const tiles = coverTiles(shooter, target);
  if (!tiles.length) return 0;
  const low = tiles.every(c => c.tile === LOWWALL);
  if (!low) return COVER_PENALTY;
  const st = (target && target.stance) || 'stand';
  return st === 'stand' ? LOWCOVER_PENALTY : COVER_PENALTY;
}
// Deckungsart fuer die Anzeige: 'full' | 'low' | null
function coverKind(shooter, target) {
  const tiles = coverTiles(shooter, target);
  if (!tiles.length) return null;
  return tiles.every(c => c.tile === LOWWALL) ? 'low' : 'full';
}

function hitChance(shooter, target, fm) {
  const t = UNIT_TYPES[shooter.type];
  const w = t.weapon;
  const m = w[fm];
  const d = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  const acc = (shooter.acc !== undefined) ? shooter.acc : t.acc;
  let chance = acc * m.mult * stanceAccMult(shooter);
  if (d > w.range) {
    const over = (d - w.range) / w.range;
    chance *= Math.max(0.15, 1 - over);
  }
  chance -= coverPenalty(shooter, target);
  chance -= stanceDefense(target);
  if (target.rollUntil && typeof performance !== 'undefined' && performance.now() < target.rollUntil) chance -= 25;
  return Math.max(5, Math.min(95, Math.round(chance)));
}

/* ============================================================
   BEFEHLE: planen (mit Wuerfelergebnissen) und anwenden
   ============================================================ */

/* ---- Bewegung (Rundenmodus) inkl. Reaktionsfeuer-Simulation ---- */
function planMoveCmd(unit, path, cost, opts = {}) {
  const cmd = { type: 'move', unit: unit.id, path, cost, reactions: [], died: false, roll: !!opts.roll };
  if (state.timeMode !== 'tb') return cmd;

  const enemies = state.units.filter(e => e.alive && e.side !== unit.side);
  const tuSim = new Map(enemies.map(e => [e.id, e.tu]));
  const reacted = new Set();
  let hp = unit.hp;
  let stepCosts = [];
  let prevPt = { x: unit.x, y: unit.y };
  for (const p of path) {
    const diag = (p.x !== prevPt.x && p.y !== prevPt.y);
    stepCosts.push(Math.round((diag ? MOVE_DIAG : MOVE_ORTHO) * moveCostFactor(unit)));
    prevPt = p;
  }

  outer:
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    for (const e of enemies.slice().sort((a, b) => a.id < b.id ? -1 : 1)) {
      if (reacted.has(e.id)) continue;
      const et = UNIT_TYPES[e.type];
      const snapCost = et.weapon.snap.cost;
      if ((tuSim.get(e.id) || 0) < snapCost) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > VISION) continue;
      if (!losClear(e.x, e.y, p.x, p.y)) continue;
      const reactChance = ((e.reactions !== undefined) ? e.reactions : et.reactions) * (cmd.roll ? 0.5 : 1);
      if (Math.random() * 100 >= reactChance) continue;
      // Reaktionsschuss!
      reacted.add(e.id);
      tuSim.set(e.id, tuSim.get(e.id) - snapCost);
      const chance = Math.max(5, hitChance(e, { x: p.x, y: p.y }, 'snap') - (cmd.roll ? 20 : 0));
      const hit = Math.random() * 100 < chance;
      const dmg = hit ? rollInt(et.weapon.dmgMin, et.weapon.dmgMax) : 0;
      cmd.reactions.push({ shooter: e.id, step: i, hit, dmg });
      if (hit) {
        hp -= dmg;
        if (hp <= 0) {
          cmd.died = true;
          cmd.path = path.slice(0, i + 1);
          cmd.cost = stepCosts.slice(0, i + 1).reduce((a, b) => a + b, 0);
          break outer;
        }
      }
    }
  }
  return cmd;
}

function applyMove(cmd) {
  const u = unitById(cmd.unit);
  if (!u || !u.alive || !cmd.path.length) return;
  u.tu -= cmd.cost;
  const dest = cmd.path[cmd.path.length - 1];
  u.x = dest.x; u.y = dest.y;
  if (cmd.roll) {
    u.rollDur = cmd.path.length * 55 + 150;
    u.rollUntil = performance.now() + u.rollDur;
    log(`${sideTag(u)} ${u.name} <b>hechtet zur Seite</b> (${cmd.cost} TU)! 🤸`);
  } else {
    log(`${sideTag(u)} ${u.name} bewegt sich (${cmd.cost} TU).`);
  }

  const stepMs = cmd.roll ? 55 : 90;
  const now = performance.now();
  for (const r of cmd.reactions) {
    const shooter = unitById(r.shooter);
    if (!shooter) continue;
    shooter.tu -= UNIT_TYPES[shooter.type].weapon.snap.cost;
    const stepPt = cmd.path[Math.min(r.step, cmd.path.length - 1)];
    const t0 = now + (r.step + 0.5) * stepMs;
    effects.push({ kind: 'tracer', t0, x0: shooter.x, y0: shooter.y, x1: stepPt.x, y1: stepPt.y, hit: r.hit });
    effects.push({ kind: 'float', t0: t0 + 60, x: stepPt.x, y: stepPt.y,
      text: r.hit ? '-' + r.dmg : 'verfehlt', color: r.hit ? '#fbbf24' : '#8494a8' });
    setTimeout(() => { sfx.reaction(); sfx.shot(); if (r.hit) sfx.hit(); }, Math.max(0, t0 - now));
    if (r.hit) u.hp -= r.dmg;
    log(`${sideTag(shooter)} <b>Reaktionsfeuer!</b> ${shooter.name} ${r.hit ? `trifft ${u.name} (<span class="dmg">${r.dmg}</span>)` : `verfehlt ${u.name}`}.`);
  }

  const willDie = cmd.died || u.hp <= 0;
  startMoveAnim(u, cmd.path, () => {
    if (willDie) {
      u.hp = Math.min(u.hp, 0);
      resolveCasualty(u);
    }
    refreshVisibility();
    updateUI();
  }, stepMs);
  refreshVisibility();
}

/* ---- Schuss ---- */
function planShootCmd(shooter, target, fm) {
  const chance = hitChance(shooter, target, fm);
  const hit = Math.random() * 100 < chance;
  const w = weaponOf(shooter);
  const dmg = hit ? rollInt(w.dmgMin, w.dmgMax) + (shooter.dmgBonus || 0) : 0;
  return { type: 'shoot', unit: shooter.id, target: target.id, mode: fm, hit, dmg };
}

function applyShoot(cmd) {
  const shooter = unitById(cmd.unit);
  const target = unitById(cmd.target);
  if (!shooter || !target || !shooter.alive || !target.alive || target.down || shooter.down) return;
  const w = weaponOf(shooter);
  shooter.facing = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  shooter.shotAt = performance.now();      // fuer die Rueckstoss-Animation
  if (state.timeMode === 'tb') shooter.tu -= w[cmd.mode].cost;
  else shooter.cd = shooter.cdMax = Math.round(w[cmd.mode].cost * CD_FACTOR);

  const fmName = cmd.mode === 'snap' ? 'Schnellschuss' : 'gezielter Schuss';
  effects.push({ kind: 'tracer', t0: performance.now(),
    x0: shooter.rx, y0: shooter.ry, x1: target.rx, y1: target.ry, hit: cmd.hit });
  effects.push({ kind: 'flash', t0: performance.now(), x: shooter.rx, y: shooter.ry });
  scareCivs(target.x, target.y, 6);
  sfx.shot();

  if (cmd.hit) {
    target.hp -= cmd.dmg;
    sfx.hit();
    effects.push({ kind: 'float', t0: performance.now(), x: target.rx, y: target.ry,
      text: '-' + cmd.dmg, color: '#fbbf24' });
    log(`${sideTag(shooter)} ${shooter.name} trifft ${target.name} (${fmName}): <span class="dmg">${cmd.dmg} Schaden</span>.`);
    if (target.hp <= 0) {
      if (target.side !== shooter.side) shooter.kills = (shooter.kills || 0) + 1;
      resolveCasualty(target);
    }
  } else {
    sfx.miss();
    effects.push({ kind: 'float', t0: performance.now(), x: target.rx, y: target.ry,
      text: 'verfehlt', color: '#8494a8' });
    log(`${sideTag(shooter)} ${shooter.name} verfehlt ${target.name} (${fmName}).`);
  }
}

/* ---- Granate ---- */
function planGrenadeCmd(unit, tx, ty) {
  const cmd = { type: 'grenade', unit: unit.id, x: tx, y: ty, hits: [], walls: [], crates: [], lows: [] };
  for (const v of state.units) {
    if (!v.alive) continue;
    const d = Math.hypot(v.x - tx, v.y - ty);
    if (d <= GRENADE.radius) {
      const base = rollInt(GRENADE.dmgMin, GRENADE.dmgMax);
      const dmg = Math.max(4, Math.round(base * (1 - d / (GRENADE.radius + 1))));
      cmd.hits.push({ id: v.id, dmg });
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - tx, y - ty);
    if (state.map[y][x] === CRATE && d <= GRENADE.radius) cmd.crates.push([x, y]);
    if (state.map[y][x] === LOWWALL && d <= GRENADE.radius && Math.random() < 0.75) cmd.lows.push([x, y]);
    if (state.map[y][x] === WALL && d <= 1.6 && Math.random() < GRENADE.wallChance) cmd.walls.push([x, y]);
  }
  cmd.civHits = [];
  for (const c of state.civs) {
    if (!c.alive) continue;
    const d = Math.hypot(c.x - tx, c.y - ty);
    if (d <= GRENADE.radius) {
      const base = rollInt(GRENADE.dmgMin, GRENADE.dmgMax);
      cmd.civHits.push({ id: c.id, dmg: Math.max(4, Math.round(base * (1 - d / (GRENADE.radius + 1)))) });
    }
  }
  return cmd;
}

function applyGrenade(cmd) {
  const u = unitById(cmd.unit);
  if (!u || !u.alive || u.grenades <= 0) return;
  u.grenades--;
  if (state.timeMode === 'tb') u.tu -= GRENADE.cost;
  else u.cd = u.cdMax = GRENADE.cdTicks;

  effects.push({ kind: 'boom', t0: performance.now(), x: cmd.x, y: cmd.y, r: GRENADE.radius });
  sfx.boom();
  log(`${sideTag(u)} ${u.name} wirft eine Granate! 💥`);

  for (const [x, y] of cmd.crates) state.map[y][x] = FLOOR;
  for (const [x, y] of (cmd.lows || [])) state.map[y][x] = FLOOR;
  for (const [x, y] of cmd.walls) {
    state.map[y][x] = FLOOR;
    log(`Eine Wand bei (${x},${y}) stuerzt ein!`);
  }
  for (const h of cmd.hits) {
    const v = unitById(h.id);
    if (!v || !v.alive) continue;
    v.hp -= h.dmg;
    effects.push({ kind: 'float', t0: performance.now() + 150, x: v.rx, y: v.ry, text: '-' + h.dmg, color: '#fbbf24' });
    log(`${sideTag(v)} ${v.name} wird von der Explosion erfasst: <span class="dmg">${h.dmg} Schaden</span>.`);
    if (v.hp <= 0) {
      if (v.side !== u.side) u.kills = (u.kills || 0) + 1;
      resolveCasualty(v);
    }
  }
  for (const h of (cmd.civHits || [])) {
    const c = state.civs.find(c2 => c2.id === h.id);
    if (!c || !c.alive) continue;
    c.hp -= h.dmg;
    if (c.hp <= 0) {
      c.alive = false;
      state.civDead++;
      addDecal(c.x, c.y, 'rgba(120,26,18,0.8)');
      effects.push({ kind: 'corpse', t0: performance.now(), x: c.x, y: c.y, side: 'C' });
      log('<b>☠ Ein Zivilist wurde von der Explosion getoetet!</b>');
    }
  }
  scareCivs(cmd.x, cmd.y, 9);
  shakeT0 = performance.now();
  if (cmd.walls.length || cmd.crates.length || (cmd.lows || []).length) renderGround();
  addDecal(cmd.x, cmd.y, 'rgba(12,12,12,0.85)', true);
  refreshVisibility();
}

/* ---- Haltung wechseln ---- */
function applyStance(cmd) {
  const u = unitById(cmd.unit);
  if (!u || !u.alive || u.type === 'walker') return;
  const st = cmd.stance;
  if (!['stand', 'kneel', 'prone'].includes(st) || (u.stance || 'stand') === st) return;
  if (state.timeMode === 'tb') u.tu -= (STANCE_TU[st] || 4);
  else u.cd = Math.max(u.cd, 4);
  u.stance = st;
  const txt = st === 'kneel' ? 'geht in die Knie 🧎' : st === 'prone' ? 'wirft sich hin 🛌' : 'steht auf 🧍';
  log(`${sideTag(u)} ${u.name} ${txt}.`);
}

/* ---- Tod, Verwundung & Sieg ---- */
function resolveCasualty(u) {
  // Maschinen, Held im Commando-Modus und bereits Niedergestreckte sterben sofort
  if (u.type === 'walker' || (mode === 'commando' && u.id === 'A0') || u.down) {
    killUnit(u);
    return;
  }
  u.down = true;
  u.stable = false;
  u.hp = 0;
  u.stance = 'prone';
  const medigel = state.tech && state.tech.medigel;
  u.bleed = state.timeMode === 'tb' ? BLEED_ROUNDS + (medigel ? 2 : 0) : BLEED_TICKS + (medigel ? 200 : 0);
  u.moveQueue = [];
  u.attackTarget = null;
  addDecal(u.x, u.y, 'rgba(120,26,18,0.6)');
  effects.push({ kind: 'float', t0: performance.now(), x: u.x, y: u.y, text: 'NIEDER!', color: '#ff5f4f' });
  sfx.death();
  log(`${sideTag(u)} <b>${u.name} geht zu Boden!</b> 🚑 ${state.timeMode === 'tb' ? `Verblutet in ${BLEED_ROUNDS} Runden` : 'Verblutet in 30s'} – stabilisieren!`);
  if (selection.includes(u)) setSelection(selection.filter(s => s !== u));
  refreshVisibility();
  checkVictory();
}

function applyStab(cmd) {
  const medic = unitById(cmd.unit);
  const target = unitById(cmd.target);
  if (!medic || !target || !medic.alive || medic.down || !target.down || target.stable) return;
  if (Math.hypot(medic.x - target.x, medic.y - target.y) > 1.6) return;
  if (state.timeMode === 'tb') medic.tu -= stabCost();
  else medic.cd = Math.max(medic.cd, 20);
  target.stable = true;
  effects.push({ kind: 'float', t0: performance.now(), x: target.x, y: target.y, text: '✚ stabil', color: '#4ade80' });
  log(`${sideTag(medic)} ${medic.name} <b>stabilisiert</b> ${target.name} ✚ – er ueberlebt das Gefecht.`);
}

function applyBleedout(cmd) {
  const u = unitById(cmd.unit);
  if (!u || !u.alive || !u.down) return;
  log(`${sideTag(u)} ${u.name} ist <b>verblutet</b>. ☠`);
  killUnit(u);
}

function killUnit(u) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = 0;
  u.moveQueue = [];
  addDecal(u.x, u.y, 'rgba(120,26,18,0.8)');
  effects.push({ kind: 'deathfade', t0: performance.now(), x: u.x, y: u.y, side: u.side });
  effects.push({ kind: 'corpse', t0: performance.now(), x: u.x, y: u.y, side: u.side });
  effects.push({ kind: 'float', t0: performance.now() + 250, x: u.x, y: u.y, text: '☠', color: '#ff5f4f' });
  sfx.death();
  log(`${sideTag(u)} <b>${u.name} wurde ausgeschaltet!</b>`);
  if (selection.includes(u)) setSelection(selection.filter(s => s !== u));
  refreshVisibility();
  checkVictory();
}

function checkVictory() {
  if (state.over) return;
  const aAlive = state.units.filter(u => u.side === 'A' && u.alive && !u.down).length;
  const bAlive = state.units.filter(u => u.side === 'B' && u.alive && !u.down).length;
  if (aAlive > 0 && bAlive > 0) return;
  const rescued = state.units.filter(u => u.alive && u.down).length;
  if (rescued) log(`🚁 <b>Medevac im Anflug:</b> ${rescued} Verwundete(r) werden vom Schlachtfeld evakuiert.`);
  state.over = true;
  state.winner = aAlive ? 'A' : 'B';
  stopRtLoop();
  const name = sideName(state.winner);
  const n = state.squadSize || 4;
  const fled = state.units.filter(u => u.escaped).length;
  let stats = `Überlebende – A: ${aAlive}/${n} · B: ${bAlive}/${n}`;
  if (fled) stats += ` · Geflohen: ${fled}`;
  if (state.civDead || state.civEscaped) stats += ` · Zivilisten: ${state.civDead} ☠ / ${state.civEscaped} entkommen`;
  stats += ` · Runden: ${state.round}`;
  let text = `${name} hat das Gefecht gewonnen! ${stats}`;
  if (mode === 'online') text = (state.winner === mySide ? 'Du hast das Gefecht gewonnen! 🏆 ' : 'Dein Squad wurde ausgeschaltet. ') + stats;
  if (mode === 'ai') text = (state.winner === 'A' ? 'Du hast die KI besiegt! 🏆 ' : 'Die KI hat dein Squad ausgeschaltet. ') + stats;
  if (mode === 'commando') {
    text = state.winner === 'A'
      ? `🕶 Auftrag erfuellt, Silencer! Alle Feinde ausgeschaltet. ${stats}`
      : `Der Silencer ist gefallen. ${stats}`;
    if (state.winner === 'A') { walletAddLoot(350); text += ' · 💰 Beute: +350 Cr.'; }
  }
  if (mode === 'ai' && state.winner === 'A') {
    const loot = 300 + 80 * aAlive;
    walletAddLoot(loot);
    text += ` · 💰 Beute: +${loot} Cr fuer den Basis-Ausbau.`;
  }
  function addResearchPts(n) {
    try { localStorage.setItem('apocarena.research', String((Number(localStorage.getItem('apocarena.research')) || 0) + n)); } catch { }
  }
  if (mode === 'ai' && state.winner === 'A') addResearchPts(5);
  if (state.defense) {
    try {
      localStorage.setItem('apocarena.defenseresult', JSON.stringify({ won: state.winner === 'A', wave: state.defense.wave }));
      localStorage.removeItem('apocarena.defense');
    } catch { }
    text += state.winner === 'A'
      ? ' · 🏰 Die Basis haelt! Bericht im Basis-Bau.'
      : ' · 🏰 Die Basis wurde ueberrannt... Bericht im Basis-Bau.';
    state.defense = null;
  }
  if (mode === 'ai' && state.missionInfo) {
    const civSaved = state.civs.filter(c => c.alive).length + state.civEscaped;
    try {
      localStorage.setItem('apocarena.missionresult', JSON.stringify({
        won: state.winner === 'A', name: state.missionInfo.name, org: state.missionInfo.org,
        kind: state.missionInfo.kind || 'standard',
        civSaved, civDead: state.civDead,
      }));
      localStorage.removeItem('apocarena.mission');
    } catch { }
    if (state.winner === 'A') {
      let pay = 150;
      if (state.missionInfo.kind === 'geisel') {
        pay += civSaved * 30;
        text += ` · 🎗️ ${civSaved} Geiseln gerettet (+${civSaved * 30} Cr)${state.civDead ? `, ${state.civDead} tot` : ''}.`;
      }
      if (state.missionInfo.kind === 'sabotage') pay += 150;
      if (state.missionInfo.kind === 'bergung') {
        addResearchPts(10);
        const arts = 2 + Math.floor(Math.random() * 2);
        try { localStorage.setItem('apocarena.artifacts', String((Number(localStorage.getItem('apocarena.artifacts')) || 0) + arts)); } catch { }
        text += ` · 🛸 ${arts} Alien-Artefakte geborgen (+10 🔬) – im Labor analysieren!`;
      }
      walletAddLoot(pay);
      text += ` · 🌆 Auftraggeber zahlt +${pay} Cr – Bericht auf der Stadtkarte.`;
    } else {
      text += ' · 🌆 Rueckzug! Bericht auf der Stadtkarte.';
    }
    state.missionInfo = null;
  }
  if (mode === 'ai' && state.roster) {
    let xpMsg = 0;
    for (const u of state.units) {
      if (u.side !== 'A' || u.rosterIdx === undefined) continue;
      const s = state.roster.soldiers[u.rosterIdx];
      if (!s) continue;
      s.missions = (s.missions || 0) + 1;
      s.kills = (s.kills || 0) + (u.kills || 0);
      const gained = 10 + 25 * (u.kills || 0) + (u.alive ? 15 : 0);
      s.xp = (s.xp || 0) + gained;
      xpMsg += gained;
    }
    saveRoster(state.roster);
    if (xpMsg > 0) text += ` · ⭐ ${xpMsg} XP fuer den Kader.`;
    const w = state.units.find(u2 => u2.type === 'walker');
    if (w && !w.alive && !w.escaped) {
      try { localStorage.setItem('apocarena.walker', '0'); } catch { }
      text += ' · 🔧 KL-1 wurde zerstoert – die Werkstatt kann einen neuen bauen.';
    }
  }
  setTimeout(() => showOverlay('Gefecht beendet', text, 'Zurueck zum Menue', backToMenu), 900);
}

/* ---- Zugende (nur Rundenmodus) ---- */
function applyEndTurn() {
  state.turn = state.turn === 'A' ? 'B' : 'A';
  if (state.turn === 'A') state.round++;
  for (const u of state.units) if (u.side === state.turn) u.tu = u.maxTu;
  for (const u of state.units) {
    if (!u.alive || !u.down || u.stable) continue;
    u.bleed--;
    if (u.bleed <= 0) applyBleedout({ unit: u.id });
    else log(`${sideTag(u)} ⏳ ${u.name} verblutet in ${u.bleed} Runde(n)!`);
  }
  autoSelectSquad();
  refreshVisibility();
  log(`— Runde ${state.round}: ${sideName(state.turn)} ist am Zug —`);
  updateUI();

  if (mode === 'hotseat' && !state.over) {
    showOverlay(`${sideName(state.turn)} ist dran`, 'Bildschirm uebergeben und weiterspielen.', 'Los geht\'s', hideOverlay);
  }
  if (mode === 'ai' && state.turn === 'B' && !state.over) {
    setTimeout(aiTakeTurn, 600);
  }
}

/* ---- Echtzeit-Ereignisse (owner-authoritative) ---- */
function applyRtMove(cmd) {
  const u = unitById(cmd.unit);
  if (!u || !u.alive) return;
  if (cmd.x !== u.x || cmd.y !== u.y) u.facing = Math.atan2(cmd.y - u.y, cmd.x - u.x);
  u.x = cmd.x; u.y = cmd.y;
  refreshVisibility();
}

/* ---- zentrale Anwendung ---- */
function applyCommand(cmd) {
  if (state.over) return;
  switch (cmd.type) {
    case 'move': applyMove(cmd); break;
    case 'shoot': applyShoot(cmd); break;
    case 'grenade': applyGrenade(cmd); break;
    case 'stance': applyStance(cmd); break;
    case 'stab': applyStab(cmd); break;
    case 'bleedout': applyBleedout(cmd); break;
    case 'end': applyEndTurn(); break;
    case 'rtMove': applyRtMove(cmd); break;
    case 'civ': applyCiv(cmd); break;
    default: break;
  }
  updateUI();
}

function issueCommand(cmd) {
  if (mode === 'online' && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cmd', data: cmd }));
  applyCommand(cmd);
  if (cmd.type === 'end' && isHost() && !state.over && state.civs.length) {
    issueCommand(buildCivCmd());
  }
}

/* ---------------- Bewegungsanimationen (Rundenmodus, mehrere gleichzeitig) ---------------- */
const moveAnims = [];
function startMoveAnim(unit, path, onDone, stepMs = 90) {
  busy = true;
  moveAnims.push({ unit, path, idx: 0, t0: performance.now(), stepMs, onDone });
}
function tickMoveAnim(now) {
  for (let i = moveAnims.length - 1; i >= 0; i--) {
    const a = moveAnims[i];
    const progress = (now - a.t0) / a.stepMs;
    if (progress >= 1) {
      a.idx++;
      a.t0 = now;
      if (a.idx >= a.path.length) {
        a.unit.rx = a.unit.x; a.unit.ry = a.unit.y;
        moveAnims.splice(i, 1);
        if (a.onDone) a.onDone();
        continue;
      }
    }
    const from = a.idx === 0 ? { x: a.path[0].x, y: a.path[0].y } : a.path[a.idx - 1];
    const to = a.path[a.idx];
    if (to) {
      const p = Math.min(1, (now - a.t0) / a.stepMs);
      a.unit.rx = from.x + (to.x - from.x) * p;
      a.unit.ry = from.y + (to.y - from.y) * p;
      if (to.x !== from.x || to.y !== from.y) {
        a.unit.facing = Math.atan2(to.y - from.y, to.x - from.x);
      }
    }
  }
  const wasBusy = busy;
  busy = moveAnims.length > 0;
  if (wasBusy && !busy) updateUI();
}

/* ---------------- Flucht (KI-Soldaten mit wenig HP) ---------------- */
function escapeUnit(u) {
  if (!u.alive) return;
  u.alive = false;
  u.escaped = true;
  u.moveQueue = [];
  if (selection.includes(u)) setSelection(selection.filter(s => s !== u));
  log(`${sideTag(u)} <b>${u.name} flieht vom Schlachtfeld!</b> 🏳️`);
  refreshVisibility();
  checkVictory();
  updateUI();
}

function tryFleeTB(u) {
  if (u.hp > u.maxHp * 0.3) return false;
  if (u.x === 0 || u.y === 0 || u.x === W - 1 || u.y === H - 1) { escapeUnit(u); return true; }
  const enemies = state.units.filter(e => e.alive && e.side !== u.side);
  if (!enemies.length) return false;
  const reach = computeReachable(u);
  let best = null, bs = -Infinity;
  for (const [k, info] of reach) {
    const [x, y] = k.split(',').map(Number);
    const dmin = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - x, e.y - y)), 99);
    const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
    const score = dmin - edgeDist * 1.2;
    if (score > bs) { bs = score; best = info; }
  }
  if (best && best.path.length) {
    log(`${sideTag(u)} ${u.name} ist schwer verwundet und <b>zieht sich zurueck</b>!`);
    issueCommand(planMoveCmd(u, best.path, best.cost));
    return true;
  }
  return false;
}

/* ============================================================
   KI (Rundenmodus, Seite B)
   ============================================================ */
function aiTakeTurn() {
  if (state.over || state.turn !== 'B' || state.timeMode !== 'tb') return;
  const myUnits = state.units.filter(u => u.side === 'B' && u.alive);
  let qi = 0;

  function visibleEnemies(u) {
    return state.units.filter(e => e.side === 'A' && e.alive && !e.down
      && isVisibleTo('B', e.x, e.y) && losClear(u.x, u.y, e.x, e.y));
  }

  function nextUnit() {
    if (state.over || state.turn !== 'B') return;
    if (qi >= myUnits.length) { setTimeout(() => issueCommand({ type: 'end' }), 500); return; }
    const u = myUnits[qi++];
    if (!u.alive) return nextUnit();
    actUnit(u, nextUnit);
  }

  function tryShoot(u) {
    if (!u.alive) return false;
    const enemies = visibleEnemies(u);
    if (!enemies.length) return false;
    const w = weaponOf(u);
    let best = null, bestC = -1;
    for (const e of enemies) {
      const c = hitChance(u, e, 'snap');
      if (c > bestC) { bestC = c; best = e; }
    }
    // Granate, wenn lohnend (2+ Ziele im Radius oder starkes Ziel nah)
    if (u.grenades > 0 && u.tu >= GRENADE.cost) {
      const d = Math.hypot(best.x - u.x, best.y - u.y);
      const clustered = enemies.filter(e => Math.hypot(e.x - best.x, e.y - best.y) <= GRENADE.radius).length;
      if (d <= GRENADE.range && clustered >= 2) {
        issueCommand(planGrenadeCmd(u, best.x, best.y));
        return true;
      }
    }
    const useAimed = u.tu >= w.aimed.cost && hitChance(u, best, 'aimed') > bestC + 10;
    const fm = useAimed ? 'aimed' : 'snap';
    if (u.tu < w[fm].cost) return false;
    if (hitChance(u, best, fm) < 22) return false;
    issueCommand(planShootCmd(u, best, fm));
    return true;
  }

  function actUnit(u, done) {
    if (!u.alive) { done(); return; }
    if (tryFleeTB(u)) {
      const wait = () => busy ? setTimeout(wait, 100) : done();
      wait();
      return;
    }
    if ((u.stance || 'stand') === 'stand' && visibleEnemies(u).length
        && u.tu >= STANCE_TU.kneel + weaponOf(u).snap.cost) {
      issueCommand({ type: 'stance', unit: u.id, stance: 'kneel' });
    }
    if (tryShoot(u)) { setTimeout(() => actUnit(u, done), 700); return; }
    const enemies = state.units.filter(e => e.side === 'A' && e.alive);
    if (!enemies.length) { done(); return; }
    const target = enemies.reduce((a, b) =>
      Math.hypot(a.x - u.x, a.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? a : b);
    const reach = computeReachable(u);
    const w = weaponOf(u);
    const reserve = Math.min(w.snap.cost, u.tu);
    let best = null, bestScore = Infinity;
    for (const [k, info] of reach) {
      if (info.cost > u.tu - reserve) continue;
      const [x, y] = k.split(',').map(Number);
      const d = Math.hypot(x - target.x, y - target.y);
      const losBonus = losClear(x, y, target.x, target.y) ? -3 : 0;
      const coverBonus = hasCover({ x: target.x, y: target.y }, { x, y }) ? -1.5 : 0;
      const score = d + losBonus + coverBonus;
      if (score < bestScore) { bestScore = score; best = info; }
    }
    if (best && best.path.length) {
      issueCommand(planMoveCmd(u, best.path, best.cost));
      const wait = () => busy ? setTimeout(wait, 100) : setTimeout(() => {
        if (u.alive && tryShoot(u)) setTimeout(done, 700); else done();
      }, 250);
      wait();
    } else done();
  }

  nextUnit();
}

/* ============================================================
   ECHTZEIT-ENGINE
   Jeder Client simuliert seine EIGENEN Einheiten (Besitz-
   Autoritaet) und sendet Ereignisse; Gegner-Einheiten sind
   Spiegelbilder, die per Event aktualisiert werden.
   ============================================================ */
function isLocalUnit(u) {
  if (mode === 'online') return u.side === mySide;
  return true; // KI-Modus: alles lokal (B wird von der KI gesteuert)
}

function startRtLoop() {
  stopRtLoop();
  rtTickCount = 0;
  rtTimer = setInterval(rtTick, TICK_MS);
}
function stopRtLoop() {
  if (rtTimer) { clearInterval(rtTimer); rtTimer = null; }
}

const pressedKeys = {};

function commandoTick() {
  const hero = unitById('A0');
  if (!hero || !hero.alive) return;
  if (hero.moveQueue.length) return;
  let dx = (pressedKeys.d ? 1 : 0) - (pressedKeys.a ? 1 : 0);
  let dy = (pressedKeys.s ? 1 : 0) - (pressedKeys.w ? 1 : 0);
  if (!dx && !dy) return;
  let tx = hero.x + dx, ty = hero.y + dy;
  const free = (x, y) => !blocked(x, y) && !unitAt(x, y);
  if (dx && dy && (blocked(hero.x + dx, hero.y) || blocked(hero.x, hero.y + dy))) { dy = 0; ty = hero.y; }
  if (!free(tx, ty)) {
    if (dx && free(hero.x + dx, hero.y)) { tx = hero.x + dx; ty = hero.y; }
    else if (dy && free(hero.x, hero.y + dy)) { tx = hero.x; ty = hero.y + dy; }
    else return;
  }
  hero.moveQueue = [{ x: tx, y: ty }];
  hero.stepWait = 0;
}

function commandoRoll() {
  const hero = unitById('A0');
  if (!hero || !hero.alive || state.timeMode !== 'rt') return;
  if (performance.now() < (hero.rollUntil || 0)) return;
  const dx = (pressedKeys.d ? 1 : 0) - (pressedKeys.a ? 1 : 0);
  const dy = (pressedKeys.s ? 1 : 0) - (pressedKeys.w ? 1 : 0);
  if (!dx && !dy) return;
  const path = [];
  let cx2 = hero.x, cy2 = hero.y;
  for (let i = 0; i < 2; i++) {
    const nx = cx2 + dx, ny = cy2 + dy;
    if (blocked(nx, ny) || unitAt(nx, ny)) break;
    path.push({ x: nx, y: ny });
    cx2 = nx; cy2 = ny;
  }
  if (!path.length) return;
  hero.moveQueue = path;
  hero.stepWait = 0;
  hero.fastSteps = path.length;
  hero.rollDur = 380;
  hero.rollUntil = performance.now() + 380;
  sfx.select();
}

function rtTick() {
  if (state.over || state.paused) return;
  rtTickCount++;
  if (mode === 'commando') commandoTick();

  for (const u of state.units) {
    if (!u.alive || !isLocalUnit(u)) continue;
    if (u.down) {
      if (!u.stable) {
        u.bleed--;
        if (u.bleed <= 0) issueCommand({ type: 'bleedout', unit: u.id });
      }
      continue;
    }
    if (u.cd > 0) u.cd--;

    // Vorsichtiger Modus: bei Feindkontakt anhalten und kaempfen (nur Spielerseite)
    if (u.moveQueue.length && squadMode === 'cautious'
        && u.side === (mode === 'online' ? mySide : 'A')) {
      const foeSide = u.side === 'A' ? 'B' : 'A';
      const wr = weaponOf(u).range;
      const contact = state.units.some(e => e.alive && e.side === foeSide
        && isVisibleTo(u.side, e.x, e.y)
        && Math.hypot(e.x - u.x, e.y - u.y) <= wr
        && losClear(u.x, u.y, e.x, e.y));
      if (contact) { u.moveQueue = []; }
    }

    // Bewegung (Tuerme sind stationaer)
    if (u.type === 'turret') u.moveQueue = [];
    if (u.moveQueue.length) {
      if (u.stepWait > 0) u.stepWait--;
      if (u.stepWait <= 0) {
        const next = u.moveQueue[0];
        if (blocked(next.x, next.y)) { u.moveQueue = []; }
        else if (unitAt(next.x, next.y)) { u.stepWait = 3; } // warten, Feld besetzt
        else {
          const diag = (next.x !== u.x && next.y !== u.y);
          u.facing = Math.atan2(next.y - u.y, next.x - u.x);
          u.moveQueue.shift();
          u.x = next.x; u.y = next.y;
          if (u.fastSteps > 0) { u.fastSteps--; u.stepWait = 1; }
          else u.stepWait = Math.round((diag ? STEP_TICKS_DIAG : STEP_TICKS_ORTHO) * moveCostFactor(u));
          if (mode === 'online' && ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ t: 'cmd', data: { type: 'rtMove', unit: u.id, x: u.x, y: u.y } }));
          }
          refreshVisibility();
        }
      }
    }

    // Feuern (Spielerseite: eigene Einheiten; KI-Seite B im KI-Modus ebenfalls lokal)
    if (u.cd === 0) {
      const enemySide = u.side === 'A' ? 'B' : 'A';
      let target = u.attackTarget ? unitById(u.attackTarget) : null;
      if (target && (!target.alive || target.down || !isVisibleTo(u.side, target.x, target.y))) { target = null; u.attackTarget = null; }
      if (!target) {
        // Auto-Feuer auf naechsten sichtbaren Gegner
        let bestD = Infinity;
        for (const e of state.units) {
          if (!e.alive || e.down || e.side !== enemySide) continue;
          if (!isVisibleTo(u.side, e.x, e.y)) continue;
          if (!losClear(u.x, u.y, e.x, e.y)) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          if (d < bestD) { bestD = d; target = e; }
        }
      }
      if (target && losClear(u.x, u.y, target.x, target.y)) {
        // Lokal gesteuerte Spielerseite nutzt den gewaehlten Schussmodus, KI-Einheiten Schnellschuss
        const playerSide = mode === 'online' ? mySide : 'A';
        const fm = u.side === playerSide ? (fireMode === 'nade' ? 'snap' : fireMode) : 'snap';
        const cmd = planShootCmd(u, target, fm);
        issueCommand(cmd);
      }
    }
  }

  // Echtzeit-KI (Seite B) alle 8 Ticks neu denken
  if ((mode === 'ai' || mode === 'commando') && rtTickCount % 8 === 0) rtAiThink();

  // Zivilbevoelkerung (Host-gesteuert) alle 12 Ticks
  if (isHost() && rtTickCount % 12 === 0 && state.civs.length) {
    issueCommand(buildCivCmd());
  }

  updateUI();
}

function rtAiThink() {
  for (const u of state.units) {
    if (!u.alive || u.side !== 'B') continue;
    // Schwer Verwundete fliehen zur Kartenkante
    if (u.hp < u.maxHp * 0.3) {
      if (u.x === 0 || u.y === 0 || u.x === W - 1 || u.y === H - 1) { escapeUnit(u); continue; }
      if (!u.fleeing) { u.fleeing = true; log(`${sideTag(u)} ${u.name} ist schwer verwundet und <b>flieht</b>!`); }
      u.attackTarget = null;
      if (!u.moveQueue.length) {
        const cands = [[0, u.y], [W - 1, u.y], [u.x, 0], [u.x, H - 1]]
          .sort((a, b) => Math.hypot(a[0] - u.x, a[1] - u.y) - Math.hypot(b[0] - u.x, b[1] - u.y));
        for (const [ex, ey] of cands) {
          const p = findPath(u, ex, ey);
          if (p) { u.moveQueue = p; break; }
        }
      }
      continue;
    }
    const visible = state.units.filter(e => e.side === 'A' && e.alive && isVisibleTo('B', e.x, e.y) && losClear(u.x, u.y, e.x, e.y));
    if (visible.length) {
      // stehen bleiben und kaempfen
      u.moveQueue = [];
      const nearest = visible.reduce((a, b) =>
        Math.hypot(a.x - u.x, a.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? a : b);
      u.attackTarget = nearest.id;
    } else if (!u.moveQueue.length) {
      const enemies = state.units.filter(e => e.side === 'A' && e.alive);
      if (!enemies.length) return;
      const target = enemies.reduce((a, b) =>
        Math.hypot(a.x - u.x, a.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? a : b);
      // freies Nachbarfeld des Ziels suchen
      let dest = null;
      for (let r = 1; r <= 3 && !dest; r++) {
        for (let dy = -r; dy <= r && !dest; dy++) for (let dx = -r; dx <= r && !dest; dx++) {
          const nx = target.x + dx, ny = target.y + dy;
          if (!blocked(nx, ny) && !unitAt(nx, ny)) dest = { x: nx, y: ny };
        }
      }
      if (dest) {
        const path = findPath(u, dest.x, dest.y);
        if (path) u.moveQueue = path.slice(0, 8);
      }
    }
  }
}

/* ---------------- Netzwerk ---------------- */
function connectWs(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onopen = onOpen;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'created') {
      menuStatus(`Match erstellt! Code: ${msg.code} – warte auf Mitspieler ...`);
      showOverlay('Warte auf Gegner', `Gib deinem Mitspieler diesen Code: ${msg.code}`, 'Abbrechen', () => { ws.close(); backToMenu(); });
    } else if (msg.t === 'start') {
      hideOverlay();
      mySide = msg.side;
      startGame('online', msg.seed, msg.rt ? 'rt' : 'tb', msg.size || 4);
    } else if (msg.t === 'cmd') {
      applyCommand(msg.data);
      // Host bewegt die Zivilbevoelkerung nach jedem Zugende
      if (msg.data.type === 'end' && isHost() && !state.over && state.civs.length) {
        issueCommand(buildCivCmd());
      }
    } else if (msg.t === 'peer_left') {
      if (!state.over) showOverlay('Verbindung beendet', 'Dein Gegner hat das Match verlassen.', 'Zurueck zum Menue', backToMenu);
    } else if (msg.t === 'error') {
      menuStatus(msg.msg);
      hideOverlay();
    }
  };
  ws.onclose = () => {
    ws = null;
    if (mode === 'online' && !state.over) {
      showOverlay('Verbindung verloren', 'Die Verbindung zum Server ist abgerissen. Das Match kann nicht fortgesetzt werden.',
        'Zurueck zum Menue', backToMenu);
    }
  };
}

/* ---------------- UI ---------------- */
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

function sideName(s) {
  if (mode === 'online') return s === mySide ? 'Dein Squad' : 'Gegnerisches Squad';
  if (mode === 'ai') return s === 'A' ? 'Dein Squad' : 'KI-Squad';
  if (mode === 'commando') return s === 'A' ? 'Silencer' : 'Feindliches Squad';
  return s === 'A' ? 'Spieler A' : 'Spieler B';
}
function sideTag(u) {
  return `<span class="${u.side.toLowerCase()}">[${u.side}]</span>`;
}
function log(html) {
  const el = $('log');
  const div = document.createElement('div');
  div.innerHTML = html;
  el.appendChild(div);
  while (el.children.length > 80) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function menuStatus(txt) { $('menuStatus').textContent = txt; }

function showOverlay(title, text, btnText, onClick) {
  $('overlayTitle').textContent = title;
  $('overlayText').textContent = text;
  $('overlayBtn').textContent = btnText;
  $('overlayBtn').onclick = onClick;
  $('overlay').classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function canControl() {
  if (introActive()) return false;
  if (state.timeMode === 'rt') return !state.over;
  return !state.over && !busy && localSides.includes(state.turn);
}
function canControlUnit(u) {
  if (state.over) return false;
  if (state.timeMode === 'rt') {
    if (mode === 'online') return u.side === mySide;
    return u.side === 'A';
  }
  return u.side === state.turn && localSides.includes(state.turn) && !busy;
}

function setSelection(arr) {
  selection = arr.filter(u => u && u.alive);
  selected = selection[0] || null;
  reachable = (selected && state.timeMode === 'tb') ? computeReachable(selected) : new Map();
}

// Standard: die ganze Gruppe ist ausgewaehlt. Anfuehrer = erster lebender Soldat.
function autoSelectSquad() {
  setSelection(state.units.filter(u => u.alive && canControlUnit(u)));
}

function updateUI() {
  const banner = $('turnBanner');
  if (state.timeMode === 'rt') {
    banner.textContent = state.paused ? '⏸ PAUSE' : '⚡ Echtzeit-Gefecht';
    banner.classList.remove('sideB');
  } else {
    banner.textContent = `Runde ${state.round} – ${sideName(state.turn)}`;
    banner.classList.toggle('sideB', state.turn === 'B');
  }

  const u = selected;
  if (u && u.alive) {
    const t = UNIT_TYPES[u.type];
    if (selection.length > 1) {
      $('uName').textContent = `Squad (${selection.length} Soldaten)`;
      $('uClass').textContent = selection.map(s => s.name).join(', ');
    } else {
      $('uName').textContent = u.name;
      const stIcon = { stand: '🧍', kneel: '🧎', prone: '🛌' }[u.stance || 'stand'];
      $('uClass').textContent = `${t.cls} · ${stIcon}${u.reserve ? ' · 🔭' : ''} · 💣 ${u.grenades}`;
    }
    $('uHp').style.width = (u.hp / u.maxHp * 100) + '%';
    $('uHpTxt').textContent = `${u.hp}/${u.maxHp}`;
    if (state.timeMode === 'tb') {
      $('uTu').style.width = (u.tu / u.maxTu * 100) + '%';
      $('uTuTxt').textContent = `${u.tu}/${u.maxTu}`;
    } else {
      const f = u.cdMax > 0 ? 1 - u.cd / u.cdMax : 1;
      $('uCd').style.width = (f * 100) + '%';
      $('uCdTxt').textContent = u.cd === 0 ? 'bereit' : (u.cd * TICK_MS / 1000).toFixed(1) + 's';
    }
    const w = t.weapon;
    $('uWeapon').textContent = `${w.name} · ${w.dmgMin}–${w.dmgMax} Schaden · Reichweite ${w.range} · Reaktion ${t.reactions}%`;
    if (fireMode === 'roll') {
      $('fmInfo').textContent = `Kampfrolle: ${ROLL_COST} TU · max. 2 Felder · Reaktionsfeuer nur halb so oft und -20% Treffer`;
    } else if (fireMode === 'nade') {
      $('fmInfo').textContent = `Granate: ${state.timeMode === 'tb' ? GRENADE.cost + ' TU' : (GRENADE.cdTicks * TICK_MS / 1000) + 's CD'} · ${GRENADE.dmgMin}–${GRENADE.dmgMax} Schaden · Wurfweite ${GRENADE.range} · Vorrat: ${u.grenades}`;
    } else {
      const fm = w[fireMode];
      $('fmInfo').textContent = state.timeMode === 'tb'
        ? `Kosten: ${fm.cost} TU · Genauigkeit ×${fm.mult}`
        : `Cooldown: ${(Math.round(fm.cost * CD_FACTOR) * TICK_MS / 1000).toFixed(1)}s · Genauigkeit ×${fm.mult}`;
    }
  } else {
    $('uName').textContent = '–';
    $('uClass').textContent = 'Keine Einheit ausgewaehlt';
    $('uHp').style.width = '0%'; $('uTu').style.width = '0%'; $('uCd').style.width = '0%';
    $('uHpTxt').textContent = ''; $('uTuTxt').textContent = ''; $('uCdTxt').textContent = '';
    $('uWeapon').textContent = '';
    $('fmInfo').textContent = '';
  }
  $('btnEndTurn').disabled = !(state.timeMode === 'tb' && canControl());
  syncStButtons();
}

/* ---------------- Eingabe: Auswahl, Drag-Box, Befehle ---------------- */
function evTile(ev) {
  const r = canvas.getBoundingClientRect();
  const cpx = (ev.clientX - r.left) / r.width * canvas.width;
  const cpy = (ev.clientY - r.top) / r.height * canvas.height;
  const t = screenToTile(cpx, cpy);
  return { px: cpx, py: cpy, x: t ? t.x : -1, y: t ? t.y : -1 };
}
// Bildschirmposition einer Einheit (fuer Box-Auswahl & Commando-Zielen)
function unitScreen(u) {
  return { x: sx(u.rx, u.ry), y: sy(u.rx, u.ry) - (isIso() ? 12 : 0) };
}

canvas.addEventListener('mousemove', (ev) => {
  const p = evTile(ev);
  hoverTile = (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) ? { x: p.x, y: p.y } : null;
  if (dragStart) {
    dragCur = p;
    if (!isDragging && Math.hypot(p.px - dragStart.px, p.py - dragStart.py) > 8) isDragging = true;
  }
  // Commando: Held zielt mit der Maus (Bildschirmwinkel zurueck ins Raster)
  if (mode === 'commando' && !state.over) {
    const hero = unitById('A0');
    if (hero && hero.alive && !hero.moveQueue.length) {
      const h = unitScreen(hero);
      if (isIso()) {
        // Bildschirm-Vektor -> Tile-Vektor (inverse Projektion, ohne Hoehe)
        const vx = (p.px - h.x) / (VIEW.tw / 2), vy = (p.py - h.y) / (VIEW.th / 2);
        hero.facing = Math.atan2((vy - vx) / 2, (vy + vx) / 2);
      } else {
        hero.facing = Math.atan2(p.py - h.y, p.px - h.x);
      }
    }
  }
});
canvas.addEventListener('mouseleave', () => { hoverTile = null; });

canvas.addEventListener('mousedown', (ev) => {
  ac(); // Audio bei erster Interaktion aktivieren
  startDrone();
  if (ev.button !== 0) return;
  dragStart = evTile(ev); dragCur = dragStart; isDragging = false;
});

canvas.addEventListener('mouseup', (ev) => {
  if (ev.button !== 0) return;
  const p = evTile(ev);
  if (isDragging && dragStart) {
    // Box-Auswahl eigener Einheiten (in Bildschirmkoordinaten – beide Ansichten)
    const x0 = Math.min(dragStart.px, p.px), x1 = Math.max(dragStart.px, p.px);
    const y0 = Math.min(dragStart.py, p.py), y1 = Math.max(dragStart.py, p.py);
    const picked = state.units.filter(u => {
      if (!u.alive || !canControlUnit(u)) return false;
      const sp = unitScreen(u);
      return sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1;
    });
    if (picked.length) { setSelection(picked); sfx.select(); updateUI(); }
  } else {
    pointAction(p.x, p.y, ev.shiftKey, false, ev.ctrlKey || ev.metaKey);
  }
  dragStart = null; dragCur = null; isDragging = false;
});

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const p = evTile(ev);
  pointAction(p.x, p.y, false, true); // Rechtsklick = reiner Befehl
});

function pointAction(x, y, additive, orderOnly = false, solo = false) {
  if (state.over || introActive() || x < 0 || y < 0 || x >= W || y >= H) return;
  const viewer = viewingSide();
  const raw = unitAt(x, y);
  const clicked = raw && (raw.side === viewer || isVisibleTo(viewer, x, y)) ? raw : null;

  // Klick auf niedergestreckten Kameraden -> naechster eigener Soldat stabilisiert
  const downed = downedAt(x, y);
  if (downed && downed.side === viewer && !downed.stable) {
    const medics = selection.filter(u2 => u2.alive && !u2.down && canControlUnit(u2)
      && Math.hypot(u2.x - x, u2.y - y) <= 1.6
      && (state.timeMode !== 'tb' || u2.tu >= stabCost()));
    if (medics.length) {
      issueCommand({ type: 'stab', unit: medics[0].id, target: downed.id });
      refreshPrimaryReachable();
    } else {
      log(`✚ Zum Stabilisieren muss ein Soldat NEBEN ${downed.name} stehen (${stabCost()} TU).`);
    }
    return;
  }

  // Eigene Einheit anklicken -> die GANZE Gruppe auswaehlen. Der Anfuehrer ist
  // fest (erster lebender Soldat). Strg+Klick = nur diese Einheit,
  // Shift+Klick = hinzufuegen/entfernen.
  if (!orderOnly && clicked && canControlUnit(clicked)) {
    if (additive) {
      if (selection.includes(clicked)) setSelection(selection.filter(s => s !== clicked));
      else setSelection([...selection, clicked]);
    } else if (solo) {
      setSelection([clicked]);
    } else {
      autoSelectSquad();
    }
    sfx.select(); updateUI();
    return;
  }

  const ctrl = selection.filter(u => u.alive && canControlUnit(u));
  if (!ctrl.length) return;
  if (state.timeMode === 'tb' && !canControl()) return;

  // Granate: wirft nur der Anfuehrer
  if (fireMode === 'nade') {
    const u = ctrl[0];
    if (u.grenades <= 0) { log('Keine Granaten mehr.'); return; }
    if (state.timeMode === 'tb' && u.tu < GRENADE.cost) { log('Nicht genug Time Units fuer eine Granate.'); return; }
    if (state.timeMode === 'rt' && u.cd > 0) { log('Waffe laedt noch.'); return; }
    const d = Math.hypot(x - u.x, y - u.y);
    if (d > GRENADE.range) { log('Zu weit fuer einen Granatenwurf.'); return; }
    if (!losClear(u.x, u.y, x, y)) { log('Keine Sichtlinie fuer den Wurf.'); return; }
    issueCommand(planGrenadeCmd(u, x, y));
    fireMode = 'snap'; syncFmButtons();
    refreshPrimaryReachable();
    return;
  }

  // Kampfrolle: Anfuehrer hechtet bis zu 2 Felder (Reaktionsfeuer halbiert & erschwert)
  if (fireMode === 'roll') {
    if (state.timeMode !== 'tb') {
      log('Die Kampfrolle gibt es nur im Rundenmodus.');
      fireMode = 'snap'; syncFmButtons();
      return;
    }
    const u = ctrl[0];
    if (u.type === 'walker') { log('Der Kampflaeufer macht keine Hechtrolle.'); return; }
    if ((u.stance || 'stand') === 'prone') { log('Liegend kann man nicht rollen – erst aufstehen.'); return; }
    if (u.tu < ROLL_COST) { log(`Nicht genug TU fuer eine Rolle (${ROLL_COST}).`); return; }
    const d = Math.hypot(x - u.x, y - u.y);
    const inf = reachable.get(x + ',' + y);
    if (d > 2.3 || !inf) { log('Rolle: maximal 2 Felder auf ein freies, erreichbares Feld.'); return; }
    issueCommand(planMoveCmd(u, inf.path, ROLL_COST, { roll: true }));
    fireMode = 'snap'; syncFmButtons();
    refreshPrimaryReachable();
    return;
  }

  // Gegner anklicken -> Angriff (alle ausgewaehlten Soldaten)
  if (clicked && clicked.side !== ctrl[0].side) {
    orderAttack(ctrl, clicked);
    refreshPrimaryReachable();
    return;
  }

  // Boden anklicken -> Bewegung (einzeln oder als Squad in Formation)
  if (state.timeMode === 'rt') {
    if (ctrl.length === 1) {
      const path = findPath(ctrl[0], x, y);
      if (path) { ctrl[0].moveQueue = path; ctrl[0].stepWait = 0; }
    } else orderSquadMove(ctrl, { x, y });
    return;
  }
  if (ctrl.length === 1) {
    const info = reachable.get(x + ',' + y);
    if (info) {
      issueCommand(planMoveCmd(ctrl[0], info.path, info.cost));
      refreshPrimaryReachable();
    }
  } else {
    orderSquadMove(ctrl, { x, y });
    refreshPrimaryReachable();
  }
}

function refreshPrimaryReachable() {
  const wait = () => busy ? setTimeout(wait, 80)
    : ((selected && selected.alive && state.timeMode === 'tb') && (reachable = computeReachable(selected)), updateUI());
  wait();
}

/* ---- Angriff: Salve (Rundenmodus) bzw. Zielmarkierung (Echtzeit) ---- */
function orderAttack(units, target) {
  if (state.timeMode === 'rt') {
    let n = 0;
    for (const u of units) if (u.side !== target.side) { u.attackTarget = target.id; n++; }
    if (n) log(`${sideTag(units[0])} ${n > 1 ? n + ' Soldaten nehmen' : units[0].name + ' nimmt'} ${target.name} ins Visier.`);
    return;
  }
  const fm = fireMode === 'nade' ? 'snap' : fireMode;
  let fired = 0;
  for (const u of units) {
    if (!target.alive) break;
    const w = weaponOf(u);
    if (u.tu < w[fm].cost) continue;
    if (!losClear(u.x, u.y, target.x, target.y)) continue;
    issueCommand(planShootCmd(u, target, fm));
    fired++;
  }
  if (!fired) log('Kein Soldat hat Sichtlinie oder genug TU fuer diesen Schuss.');
}

/* ---- Formationen: Slots berechnen und Squad-Bewegung ausfuehren ---- */
function findNearestFree(x, y, reserved, ignoreIds) {
  const q = [[x, y]];
  const seen = new Set([x + ',' + y]);
  while (q.length) {
    const [cx, cy] = q.shift();
    const k = cx + ',' + cy;
    if (cx >= 0 && cy >= 0 && cx < W && cy < H && !blocked(cx, cy) && !reserved.has(k)) {
      const occ = unitAt(cx, cy);
      if (!occ || (ignoreIds && ignoreIds.has(occ.id))) return { x: cx, y: cy };
    }
    if (seen.size > 60) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nk = (cx + dx) + ',' + (cy + dy);
      if (!seen.has(nk)) { seen.add(nk); q.push([cx + dx, cy + dy]); }
    }
  }
  return null;
}

function computeSlots(units, dest) {
  const lead = units[0];
  let dx = dest.x - lead.x, dy = dest.y - lead.y;
  if (!dx && !dy) dx = 1;
  const ang = Math.atan2(dy, dx);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const offs = FORMATIONS[formation];
  const ids = new Set(units.map(u => u.id));
  const reserved = new Set();
  const slots = [];
  for (let i = 0; i < units.length; i++) {
    const [fx, fy] = offs[Math.min(i, offs.length - 1)];
    const sx = Math.round(dest.x + fx * cos - fy * sin);
    const sy = Math.round(dest.y + fx * sin + fy * cos);
    const t2 = findNearestFree(sx, sy, reserved, ids);
    if (t2) { reserved.add(t2.x + ',' + t2.y); slots.push(t2); }
    else slots.push(null);
  }
  return slots;
}

// Vorsichtiger Modus: Slots in Richtung Deckung verschieben (Bedrohung = naechster
// sichtbarer Feind, sonst die Bewegungsrichtung).
function planSquadTargets(units, dest) {
  const slots = computeSlots(units, dest);
  if (squadMode !== 'cautious') return slots;
  const side = units[0].side;
  let threat = null, bd = Infinity;
  for (const e of state.units) {
    if (!e.alive || e.side === side) continue;
    if (!isVisibleTo(side, e.x, e.y)) continue;
    const d = Math.hypot(e.x - dest.x, e.y - dest.y);
    if (d < bd) { bd = d; threat = { x: e.x, y: e.y }; }
  }
  if (!threat) {
    const lead = units[0];
    let dx = dest.x - lead.x, dy = dest.y - lead.y;
    const len = Math.hypot(dx, dy) || 1;
    threat = { x: Math.round(dest.x + dx / len * 4), y: Math.round(dest.y + dy / len * 4) };
  }
  const ids = new Set(units.map(u => u.id));
  const reserved = new Set();
  const adjusted = [];
  for (const s of slots) {
    if (!s) { adjusted.push(null); continue; }
    let best = s, bestScore = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx2 = s.x + dx, cy2 = s.y + dy;
      if (cx2 < 0 || cy2 < 0 || cx2 >= W || cy2 >= H) continue;
      if (blocked(cx2, cy2)) continue;
      const k = cx2 + ',' + cy2;
      if (reserved.has(k)) continue;
      const occ = unitAt(cx2, cy2);
      if (occ && !ids.has(occ.id)) continue;
      const covered = hasCover(threat, { x: cx2, y: cy2 });
      const score = (covered ? 0 : 8) + Math.hypot(dx, dy);
      if (score < bestScore) { bestScore = score; best = { x: cx2, y: cy2 }; }
    }
    reserved.add(best.x + ',' + best.y);
    adjusted.push(best);
  }
  return adjusted;
}

function orderSquadMove(units, dest) {
  const slots = planSquadTargets(units, dest);
  const ids = new Set(units.map(u => u.id));
  // Greedy-Zuordnung: jeder Slot bekommt den naechsten freien Soldaten (verhindert Kreuzen)
  const remaining = units.slice();
  const pairs = [];
  for (const s of slots) {
    if (!s || !remaining.length) continue;
    let bi = 0, bd = Infinity;
    remaining.forEach((u, idx) => {
      const d = Math.hypot(u.x - s.x, u.y - s.y);
      if (d < bd) { bd = d; bi = idx; }
    });
    pairs.push([remaining.splice(bi, 1)[0], s]);
  }
  const reservedKeys = new Set(slots.filter(Boolean).map(s => s.x + ',' + s.y));
  for (const [u, s] of pairs) {
    if (u.x === s.x && u.y === s.y) continue;
    if (state.timeMode === 'rt') {
      const path = findPath(u, s.x, s.y, 400, ids);
      if (path) { u.moveQueue = path; u.stepWait = 0; }
    } else {
      if (u.tu <= 0) continue;
      // Vorsichtig: TU-Reserve fuer einen Reaktionsschuss behalten
      const budget = squadMode === 'cautious'
        ? Math.max(0, u.tu - weaponOf(u).snap.cost) : u.tu;
      if (budget <= 0) continue;
      const reach = computeReachable(u);
      let best = null, bd2 = Infinity;
      for (const [k, info] of reach) {
        if (info.cost > budget) continue;
        const [x, y] = k.split(',').map(Number);
        if (reservedKeys.has(k) && !(x === s.x && y === s.y)) continue;
        const score = Math.hypot(x - s.x, y - s.y) * 10 + info.cost * 0.05;
        if (score < bd2) { bd2 = score; best = info; }
      }
      if (best && best.path.length) issueCommand(planMoveCmd(u, best.path, best.cost));
    }
  }
  log(`Squad rueckt in Formation <b>${FORMATION_LABELS[formation]}</b> vor (${squadMode === 'cautious' ? 'vorsichtig, sucht Deckung' : 'aggressiv'}).`);
}

function syncFmButtons() {
  $('fmSnap').classList.toggle('active', fireMode === 'snap');
  $('fmAimed').classList.toggle('active', fireMode === 'aimed');
  $('fmNade').classList.toggle('active', fireMode === 'nade');
  $('fmRoll').classList.toggle('active', fireMode === 'roll');
}
$('fmSnap').onclick = () => { fireMode = 'snap'; syncFmButtons(); updateUI(); };
$('fmAimed').onclick = () => { fireMode = 'aimed'; syncFmButtons(); updateUI(); };
$('fmNade').onclick = () => { fireMode = 'nade'; syncFmButtons(); updateUI(); };
$('fmRoll').onclick = () => { fireMode = fireMode === 'roll' ? 'snap' : 'roll'; syncFmButtons(); updateUI(); };

function syncStButtons() {
  const s = selected ? (selected.stance || 'stand') : 'stand';
  $('stStand').classList.toggle('active', s === 'stand');
  $('stKneel').classList.toggle('active', s === 'kneel');
  $('stProne').classList.toggle('active', s === 'prone');
  $('stGuard').classList.toggle('active', !!(selected && selected.reserve));
}
function orderStance(stance) {
  const ctrl = selection.filter(u => u.alive && canControlUnit(u) && u.type !== 'walker');
  for (const u of ctrl) {
    if ((u.stance || 'stand') === stance) continue;
    if (state.timeMode === 'tb' && u.tu < (STANCE_TU[stance] || 4)) continue;
    issueCommand({ type: 'stance', unit: u.id, stance });
  }
  if (state.timeMode === 'tb' && selected && selected.alive) reachable = computeReachable(selected);
  updateUI();
}
$('stStand').onclick = () => orderStance('stand');
$('stKneel').onclick = () => orderStance('kneel');
$('stProne').onclick = () => orderStance('prone');
$('stGuard').onclick = () => {
  const ctrl = selection.filter(u => u.alive && canControlUnit(u));
  const newVal = !(selected && selected.reserve);
  for (const u of ctrl) u.reserve = newVal;
  if (state.timeMode === 'tb' && selected && selected.alive) reachable = computeReachable(selected);
  log(newVal
    ? '🔭 <b>Overwatch:</b> Squad haelt TU fuer Reaktionsfeuer zurueck.'
    : '🔭 Overwatch aufgehoben – volle Bewegungsreichweite.');
  updateUI();
};

function syncFoButtons() {
  const map = { wedge: 'foKeil', line: 'foLinie', column: 'foKolonne', box: 'foBox' };
  for (const f in map) $(map[f]).classList.toggle('active', formation === f);
}
$('foKeil').onclick = () => { formation = 'wedge'; syncFoButtons(); };
$('foLinie').onclick = () => { formation = 'line'; syncFoButtons(); };
$('foKolonne').onclick = () => { formation = 'column'; syncFoButtons(); };
$('foBox').onclick = () => { formation = 'box'; syncFoButtons(); };

function syncSmButtons() {
  $('smCautious').classList.toggle('active', squadMode === 'cautious');
  $('smAggro').classList.toggle('active', squadMode === 'aggressive');
  $('smInfo').textContent = squadMode === 'cautious'
    ? 'Sucht Deckung am Ziel, haelt TU-Reserve, stoppt bei Feindkontakt (Echtzeit).'
    : 'Rueckt stur in Formation vor, volles Tempo, keine Deckungssuche.';
}
$('smCautious').onclick = () => { squadMode = 'cautious'; syncSmButtons(); };
$('smAggro').onclick = () => { squadMode = 'aggressive'; syncSmButtons(); };

function syncSizeButtons() {
  document.querySelectorAll('.szbtn').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.size) === menuSquadSize));
}
document.querySelectorAll('.szbtn').forEach(b => {
  b.onclick = () => { menuSquadSize = Number(b.dataset.size); syncSizeButtons(); };
});

$('btnEndTurn').onclick = () => { if (state.timeMode === 'tb' && canControl()) issueCommand({ type: 'end' }); };
$('btnQuit').onclick = backToMenu;
$('btnMute').onclick = () => { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; };
$('btnPause').onclick = togglePause;
$('btnView').onclick = toggleView;

/* ---------------- Ansicht umschalten: Draufsicht <-> isometrisch ---------------- */
function loadViewPref() {
  try {
    const v = localStorage.getItem('apocarena.view');
    if (v === 'iso' || v === 'top') VIEW.mode = v;
  } catch { }
}
function syncViewButton() {
  const b = $('btnView');
  if (b) {
    b.textContent = isIso() ? '🧭 Iso' : '⬛ Top';
    b.title = 'Ansicht wechseln (V): isometrisch mit Hoehe / klassische Draufsicht';
  }
}
function setView(v) {
  if (v !== 'iso' && v !== 'top') return;
  VIEW.mode = v;
  try { localStorage.setItem('apocarena.view', v); } catch { }
  groundDirty = true;          // Boden-Puffer haengt an der Projektion
  renderGround();
  syncViewButton();
  if (mode) {
    log(v === 'iso'
      ? '🧭 Ansicht: <b>isometrisch</b> – Gelaendehoehe sichtbar, Figuren in Seitenansicht.'
      : '🧭 Ansicht: <b>Draufsicht</b> – klassisches Taktikraster.');
  }
}
function toggleView() { setView(isIso() ? 'top' : 'iso'); }

function togglePause() {
  if (state.timeMode !== 'rt' || mode === 'online') return;
  // (gilt fuer KI- und Commando-Modus)
  state.paused = !state.paused;
  $('btnPause').textContent = state.paused ? '▶ Weiter' : '⏸ Pause';
  updateUI();
}
document.addEventListener('keyup', (ev) => {
  const k = ev.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(k)) pressedKeys[k] = false;
});

document.addEventListener('keydown', (ev) => {
  if ($('game').classList.contains('hidden')) return;
  if (mode === 'commando') {
    const k = ev.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(k)) { pressedKeys[k] = true; ev.preventDefault(); return; }
    if (ev.key === 'Shift') { commandoRoll(); return; }
    if (k === 'g') { fireMode = fireMode === 'nade' ? 'snap' : 'nade'; syncFmButtons(); updateUI(); return; }
  }
  if (ev.code === 'Space') { ev.preventDefault(); togglePause(); }
  if (ev.key === 'm' || ev.key === 'M') { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; }
  if (ev.key === 'Escape') { setSelection([]); updateUI(); }
  if (ev.key === 'a' || ev.key === 'A') {
    const all = state.units.filter(u => u.alive && canControlUnit(u));
    if (all.length) { setSelection(all); sfx.select(); updateUI(); }
  }
  if (ev.key === 'f' || ev.key === 'F') {
    const i = FORMATION_ORDER.indexOf(formation);
    formation = FORMATION_ORDER[(i + 1) % FORMATION_ORDER.length];
    syncFoButtons();
    log(`Formation: <b>${FORMATION_LABELS[formation]}</b>`);
  }
  if (ev.key === 'k' || ev.key === 'K') {
    orderStance(selected && selected.stance === 'kneel' ? 'stand' : 'kneel');
  }
  if (ev.key === 'l' || ev.key === 'L') {
    orderStance(selected && selected.stance === 'prone' ? 'stand' : 'prone');
  }
  if (ev.key === 'r' || ev.key === 'R') {
    fireMode = fireMode === 'roll' ? 'snap' : 'roll';
    syncFmButtons(); updateUI();
  }
  if (ev.key === 'v' || ev.key === 'V') { toggleView(); }
  if (ev.key === 'o' || ev.key === 'O') { $('stGuard').onclick(); }
  if (ev.key === 'q' || ev.key === 'Q') {
    squadMode = squadMode === 'cautious' ? 'aggressive' : 'cautious';
    syncSmButtons();
    log(`Verhalten: <b>${squadMode === 'cautious' ? '🛡 Vorsichtig' : '⚔ Aggressiv'}</b>`);
  }
  if (ev.key >= '1' && ev.key <= '6') {
    const side = state.timeMode === 'rt' ? (mode === 'online' ? mySide : 'A') : state.turn;
    if (state.timeMode === 'tb' && !localSides.includes(state.turn)) return;
    const u = unitById(side + (Number(ev.key) - 1));
    if (u && u.alive) {
      if (ev.shiftKey && selection.length && !selection.includes(u)) setSelection([...selection, u]);
      else setSelection([u]);
      sfx.select();
      updateUI();
    }
  }
});

/* ---------------- Menue ---------------- */
$('tempoTb').onclick = () => setTempo('tb');
$('tempoRt').onclick = () => setTempo('rt');
function setTempo(t) {
  menuTempo = t;
  $('tempoTb').classList.toggle('active', t === 'tb');
  $('tempoRt').classList.toggle('active', t === 'rt');
  $('tempoInfo').textContent = t === 'tb'
    ? 'Klassisch: Zug um Zug mit Time Units, Reaktionsfeuer inklusive.'
    : 'Alles passiert gleichzeitig: Befehle geben, Waffen haben Abklingzeit. (Leertaste = Pause im KI-Modus)';
}

$('btnHotseat').onclick = () => startGame('hotseat', (Math.random() * 0xffffffff) >>> 0, 'tb', menuSquadSize);
$('btnAI').onclick = () => startGame('ai', (Math.random() * 0xffffffff) >>> 0, menuTempo, menuSquadSize);
$('btnCommando').onclick = () => startGame('commando', (Math.random() * 0xffffffff) >>> 0, 'rt', 4);
$('btnCreate').onclick = () => {
  menuStatus('Verbinde ...');
  connectWs(() => ws.send(JSON.stringify({ t: 'create', rt: menuTempo === 'rt', size: menuSquadSize })));
};
$('btnJoin').onclick = () => {
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) { menuStatus('Bitte einen 4-stelligen Code eingeben.'); return; }
  menuStatus('Verbinde ...');
  connectWs(() => ws.send(JSON.stringify({ t: 'join', code })));
};

/* ---------------- Spielstart / -ende ---------------- */
/* ---------------- Kader: XP, Level, Trainings-Boni ---------------- */
function loadTech() {
  try { return JSON.parse(localStorage.getItem('apocarena.tech') || '{}') || {}; } catch { return {}; }
}
function techBonuses(t) {
  return {
    dmg: (t.laser ? 2 : 0) + (t.plasma ? 3 : 0),
    acc: t.laser ? 5 : 0,
    hp: t.armor ? 10 : 0,
  };
}
function stabCost() { return (state.tech && state.tech.medigel) ? 4 : STAB_COST; }

function loadRoster() {
  try {
    const r = JSON.parse(localStorage.getItem('apocarena.roster') || 'null');
    if (r && Array.isArray(r.soldiers) && r.soldiers.length >= 6) return r;
  } catch { }
  const types = SQUAD_COMPS[6];
  return {
    soldiers: NAMES_A.map((n, i) => ({
      name: n, type: types[i], xp: 0, missions: 0, kills: 0,
      train: { hp: 0, acc: 0, re: 0 },
    })),
  };
}
function saveRoster(r) { try { localStorage.setItem('apocarena.roster', JSON.stringify(r)); } catch { } }
function levelOf(s) { return Math.floor((s.xp || 0) / 100) + 1; }
function statBonus(s) {
  const l = levelOf(s) - 1;
  const tr = s.train || { hp: 0, acc: 0, re: 0 };
  return { hp: 4 * l + tr.hp, acc: 2 * l + tr.acc, re: 3 * l + tr.re };
}

function walletAddLoot(n) {
  try {
    localStorage.setItem('apocarena.loot',
      String((Number(localStorage.getItem('apocarena.loot')) || 0) + n));
  } catch { }
}
function pendingLoot() {
  try { return Number(localStorage.getItem('apocarena.loot')) || 0; } catch { return 0; }
}
function updateMenuWallet() {
  const el = $('walletInfo');
  if (!el) return;
  const p = pendingLoot();
  el.textContent = p > 0 ? `💰 Beute-Konto: ${p} Cr – im Basis-Bau (🏗️) investieren!` : '';
}

function startGame(m, seed, tempo, size) {
  mode = m;
  state.timeMode = tempo || 'tb';
  state.squadSize = Math.max(2, Math.min(6, size || menuSquadSize || 4));
  let cybs = [];
  if (m === 'ai') {
    try {
      const b = JSON.parse(localStorage.getItem('apocarena.base') || 'null');
      if (b && Array.isArray(b.vets)) cybs = b.vets.filter(v => v.state === 'cyborg').slice(0, 2);
    } catch { }
  }
  state.cyborgVets = cybs;
  state.roster = (m === 'ai') ? loadRoster() : null;
  state.tech = (m === 'ai' || m === 'commando') ? loadTech() : {};
  state.hasWalker = false;
  if (m === 'ai') {
    try { state.hasWalker = localStorage.getItem('apocarena.walker') === '1'; } catch { }
  }
  state.commando = (m === 'commando');
  if (m === 'hotseat') { localSides = ['A', 'B']; mySide = null; }
  else if (m === 'ai' || m === 'commando') { localSides = ['A']; mySide = 'A'; }
  else { localSides = [mySide]; }

  state.seed = seed;
  state.arch = archetypeFor(seed);
  decals.length = 0;                 // alte Blutspuren gehoeren zur letzten Karte
  state.map = generateMap(seed);
  loadViewPref();
  makeTextures(seed);
  groundDirty = true;
  renderGround();
  makeUnits();
  makeCivs(seed);
  state.civDead = 0; state.civEscaped = 0;
  introUntil = performance.now() + INTRO_MS;
  noise(0.6, 0.15, 900); // Triebwerks-Rauschen
  state.turn = 'A'; state.round = 1; state.over = false; state.winner = null; state.paused = false;
  setSelection([]); busy = false; moveAnims.length = 0;
  fireMode = 'snap'; syncFmButtons(); syncFoButtons(); syncSmButtons();
  effects.length = 0;
  seenTiles.A = new Set(); seenTiles.B = new Set();
  refreshVisibility();
  $('log').innerHTML = '';

  $('menu').classList.add('hidden');
  $('game').classList.remove('hidden');
  document.body.classList.add('ingame');
  const tempoTxt = state.timeMode === 'rt' ? '⚡ Echtzeit' : '⏱ Rundenbasiert';
  const archTxt = ARCHETYPES[state.arch] ? ARCHETYPES[state.arch].label : '';
  $('modeLabel').textContent =
    (m === 'hotseat' ? 'Hotseat – 2 Spieler an einem Bildschirm'
    : m === 'ai' ? 'Gefecht gegen die KI'
    : m === 'commando' ? '🕶 Commando – WASD laufen · Maus zielen · Klick feuern · Shift Rolle · K/L Haltung · G Granate'
    : `Online-Match – du bist ${mySide === 'A' ? 'Spieler A (links, blau)' : 'Spieler B (rechts, rot)'}`)
    + ' · ' + tempoTxt + ' · 🗺 ' + archTxt;
  syncViewButton();
  log(`🗺 Einsatzgebiet: <b>${archTxt}</b> – ${ARCHETYPES[state.arch].desc}. Ansicht wechseln mit <b>V</b>.`);

  const rtLocal = state.timeMode === 'rt' && m !== 'online';
  $('btnPause').classList.toggle('hidden', !rtLocal);
  $('btnPause').textContent = '⏸ Pause';
  $('tuRow').classList.toggle('hidden', state.timeMode === 'rt');
  $('cdRow').classList.toggle('hidden', state.timeMode === 'tb');
  $('btnEndTurn').classList.toggle('hidden', state.timeMode === 'rt');

  if (state.timeMode === 'rt') {
    if (mode === 'commando') log('— 🕶 COMMANDO: WASD laufen · Maus zielen · Gegner anklicken · Shift = Hechtrolle · K/L = Haltung · G = Granate —');
    else log('— ⚡ Echtzeit-Gefecht beginnt! Gruppe ist ausgewaehlt – Ziel anklicken, Formation haelt sie zusammen. —');
    setTimeout(() => { if (mode && state.timeMode === 'rt' && !state.over) startRtLoop(); }, INTRO_MS);
  } else {
    log(`— Runde 1: ${sideName('A')} ist am Zug —`);
  }
  autoSelectSquad();
  menuStatus('');
  updateUI();
}

function backToMenu() {
  hideOverlay();
  stopRtLoop();
  if (ws) { try { ws.close(); } catch { } ws = null; }
  mode = null;
  $('game').classList.add('hidden');
  $('menu').classList.remove('hidden');
  document.body.classList.remove('ingame');
  updateMenuWallet();
  menuStatus('');
}

/* ============================================================
   ANIMATION & RENDERING
   ------------------------------------------------------------
   Zwei Ansichten teilen sich dieselbe Logik (Tile-Raster):
     · Top-Down  – klassisch, alles auf einen Blick
     · Isometrisch – Diamant-Raster, Gelaende mit Hoehe,
                     Figuren als animierte Seitenansicht
   Jede Einheit bekommt pro Frame einen Animationszustand aus
   ihrem Logik-Zustand (Haltung, Bewegungsqueue, Streckendelta):
     idle · walk · kneelIdle · crouchWalk · proneIdle · crawl · down · roll
   ============================================================ */

/* ---------------- Animations-Zustandsmaschine ---------------- */
function updateAnim(u, now) {
  const lx = (u._prx === undefined) ? u.rx : u._prx;
  const ly = (u._pry === undefined) ? u.ry : u._pry;
  u._prx = u.rx; u._pry = u.ry;
  const speed = Math.hypot(u.rx - lx, u.ry - ly);
  u.moving = speed > 0.0025;
  const stance = u.stance || 'stand';
  let name;
  if (u.down) name = 'down';
  else if ((u.rollUntil || 0) > now) name = 'roll';
  else if (stance === 'prone') name = u.moving ? 'crawl' : 'proneIdle';
  else if (stance === 'kneel') name = u.moving ? 'crouchWalk' : 'kneelIdle';
  else name = u.moving ? 'walk' : 'idle';
  if (name !== u.animName) {
    // Zyklus-Animationen behalten ihre Phase, Posen starten neu
    if (name !== 'walk' && name !== 'crawl' && name !== 'crouchWalk') u.phase = 0;
    u.animName = name;
  }
  const rate = name === 'crawl' ? 26 : name === 'crouchWalk' ? 14 : 17;
  if (u.moving && !u.down) u.phase = (u.phase || 0) + speed * rate;
  else if (!u.down) u.phase = (u.phase || 0) + 0.02;   // ruhiges Atmen
  // Richtung & Bildschirmwinkel der Waffe
  const fa = (u.facing !== undefined) ? u.facing : (u.side === 'A' ? 0 : Math.PI);
  u._dirX = Math.cos(fa); u._dirY = Math.sin(fa);
  u._gunAng = dirScreenAngle(u._dirX, u._dirY);
  u._sector = isIso() ? dirSector(u._dirX, u._dirY) : 0;
  return name;
}

function unitColors(u) {
  if (u.type === 'cyborg') {
    return {
      base: '#8d97a5', dark: '#4a525c', light: '#c2ccd8',
      armor: u.side === 'A' ? '#1a5c82' : '#8a2f26',
      visor: '#ff3b30', limb: '#5c6672',
    };
  }
  return u.side === 'A'
    ? { base: '#37b6ff', dark: '#1a5c82', light: '#7fd0ff', armor: '#274c63', visor: u.type === 'sniper' ? '#9fffcf' : '#a5e6ff', limb: '#2c333c' }
    : { base: '#ff5f4f', dark: '#8a2f26', light: '#ff9a8d', armor: '#5e3129', visor: u.type === 'sniper' ? '#9fffcf' : '#ffc9a5', limb: '#332b2a' };
}

/* ---------------- Isometrische Soldaten-Sprites ---------------- */
// Ein Bein: Huefte -> Knie -> Fuss, mit Stiefel
function isoLeg(g, hx, hy, fx, fy, w, col) {
  const bend = (fx - hx) || 0.6;
  const kx = (hx + fx) / 2 + Math.sign(bend) * 1.8;
  const ky = (hy + fy) / 2;
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
  g.fillStyle = '#14181e';
  g.beginPath(); g.ellipse(fx, fy - 0.5, w * 0.78, w * 0.52, 0, 0, Math.PI * 2); g.fill();
}
// Waffe entlang des Bildschirmwinkels (funktioniert fuer alle 8 Richtungen)
function isoWeapon(g, u, hx, hy, ang, recoil, C) {
  const gunLen = u.type === 'sniper' ? 21 : u.type === 'heavy' ? 15 : 17;
  const gunW = u.type === 'heavy' ? 4.2 : u.type === 'sniper' ? 2.2 : 3.2;
  const dx = Math.cos(ang), dy = Math.sin(ang) * 0.9;
  const kx = -dx * recoil * 3.6, ky = -dy * recoil * 3.6;
  g.strokeStyle = '#141920'; g.lineWidth = gunW + 1.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(hx + kx, hy + ky); g.lineTo(hx + dx * gunLen + kx, hy + dy * gunLen + ky); g.stroke();
  g.strokeStyle = '#9aa6b5'; g.lineWidth = Math.max(1, gunW - 1.2);
  g.beginPath(); g.moveTo(hx + dx * 2 + kx, hy + dy * 2 + ky); g.lineTo(hx + dx * (gunLen - 2) + kx, hy + dy * (gunLen - 2) + ky); g.stroke();
  if (u.type === 'sniper') { g.fillStyle = '#1d232b'; g.fillRect(hx + dx * 7 + kx - 2, hy + dy * 7 + ky - 3.4, 5, 4); }
  if (u.type === 'heavy') {
    g.fillStyle = '#232a33';
    g.beginPath(); g.roundRect(hx + dx * 5 + kx - 3, hy + dy * 5 + ky + 1, 7, 5.5, 1.5); g.fill();
  }
  return { mx: hx + dx * gunLen + kx, my: hy + dy * gunLen + ky };
}

function drawIsoSoldier(u, feetX, feetY, now) {
  const C = unitColors(u);
  const anim = u.animName || 'idle';
  const ph = u.phase || 0;
  const sector = u._sector || 0;
  const viewKind = (sector === 1 || sector === 2 || sector === 3) ? 'front'
    : (sector === 5 || sector === 6 || sector === 7) ? 'back' : 'side';
  const faceLeft = sector === 3 || sector === 4 || sector === 5;
  const recoil = Math.max(0, 1 - (now - (u.shotAt || -99999)) / 150);
  const gunAng = u._gunAng || 0;
  const scale = (u.type === 'heavy' ? 1.16 : u.type === 'hero' ? 1.08 : u.type === 'sniper' ? 0.97 : 1) * 1.12;

  ctx.save();
  ctx.translate(feetX, feetY);
  ctx.scale(faceLeft ? -scale : scale, scale);

  /* --- liegende Posen (robben / niedergestreckt) --- */
  if (anim === 'proneIdle' || anim === 'crawl' || anim === 'down') {
    const crawling = anim === 'crawl';
    const limp = anim === 'down';
    const bodyAng = Math.cos(gunAng) >= 0 ? 0 : Math.PI;   // Koerper liegt in Blickrichtung
    const dirSign = faceLeft ? -1 : 1;
    const pull = crawling ? Math.sin(ph) * 2.2 : 0;
    ctx.globalAlpha = limp ? 0.9 : 1;
    // Beine nach hinten, beim Robben abwechslungsweise angezogen
    for (const s of [-1, 1]) {
      const kick = crawling ? Math.max(0, Math.sin(ph + (s > 0 ? 0 : Math.PI))) * 3 : 0;
      isoLeg(ctx, -2 * dirSign, -3.5, (-11 - kick) * dirSign, -1.5 + s * 1.6, 3.1, C.limb);
    }
    // Rumpf flach am Boden
    const g = ctx.createLinearGradient(-8, -7, 8, 0);
    g.addColorStop(0, C.light); g.addColorStop(0.5, C.base); g.addColorStop(1, C.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse((-1 + pull * 0.3) * dirSign, -4.6, 9.5, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.dark; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse((-1 + pull * 0.3) * dirSign, -4.6, 9.5, 4.4, 0, 0, Math.PI * 2); ctx.stroke();
    // Arme: beim Robben abwechselnd nach vorn greifend
    for (const s of [-1, 1]) {
      const reach = crawling ? (6 + Math.max(0, Math.sin(ph + (s > 0 ? Math.PI : 0))) * 5) : 7;
      ctx.strokeStyle = C.armor; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2 * dirSign, -4.4 + s * 1.4);
      ctx.lineTo((reach + pull) * dirSign, -2.4 + s * 2.4);
      ctx.stroke();
    }
    // Helm
    const hx = (8 + pull * 0.6) * dirSign;
    const hg = ctx.createRadialGradient(hx, -6.6, 1, hx, -5.4, 5);
    hg.addColorStop(0, '#e8eef5'); hg.addColorStop(0.4, C.base); hg.addColorStop(1, C.dark);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hx, -5.4, 4.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(hx, -5.4, 4.1, 0, Math.PI * 2); ctx.stroke();
    if (!limp) {
      ctx.fillStyle = C.visor;
      ctx.beginPath(); ctx.arc(hx + 2.6 * dirSign, -5.2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    // Waffe liegt neben dem Koerper
    ctx.strokeStyle = '#141920'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4 * dirSign, -2.2); ctx.lineTo(16 * dirSign, -2.6); ctx.stroke();
    ctx.strokeStyle = '#9aa6b5'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(5 * dirSign, -2.2); ctx.lineTo(15 * dirSign, -2.6); ctx.stroke();
    ctx.globalAlpha = 1;
    void bodyAng;
    ctx.restore();
    return;
  }

  /* --- Kampfrolle: einmal um die eigene Achse --- */
  if (anim === 'roll') {
    const p = 1 - ((u.rollUntil - now) / (u.rollDur || 330));
    ctx.save();
    ctx.translate(0, -9);
    ctx.rotate(p * Math.PI * 2);
    ctx.fillStyle = C.base;
    ctx.beginPath(); ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.dark; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.armor;
    ctx.beginPath(); ctx.arc(5, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
    return;
  }

  /* --- Stehen / Knien (mit Gehzyklus) --- */
  const kneeling = anim === 'kneelIdle' || anim === 'crouchWalk';
  const walking = anim === 'walk' || anim === 'crouchWalk';
  const hipY = kneeling ? -7.5 : -12;
  const shY = kneeling ? -15.5 : -20.5;
  const headY = kneeling ? -19.5 : -25;
  const headR = kneeling ? 3.9 : 4.2;
  const fore = viewKind === 'side' ? 1 : 0.45;          // Verkuerzung frontal/rueckwaerts
  const sw = walking ? Math.sin(ph) : 0;
  const bob = walking ? -Math.abs(Math.cos(ph)) * 1.15 : Math.sin(now / 620) * 0.55;
  const step = walking ? 5.6 * fore : 2.6 * fore;

  // Beine
  if (kneeling) {
    // Hinteres Knie am Boden, vorderes Bein aufgestellt
    isoLeg(ctx, 0, hipY + bob, -5.5 * fore, -0.5, 3.2, C.limb);
    ctx.fillStyle = '#14181e';
    ctx.beginPath(); ctx.ellipse(-5.5 * fore, -0.6, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    isoLeg(ctx, 0, hipY + bob, 4.6 * fore, -0.5, 3.2, C.limb);
  } else {
    isoLeg(ctx, 0, hipY + bob, step * sw, -2.4 * Math.max(0, sw), 3.2, C.limb);
    isoLeg(ctx, 0, hipY + bob, -step * sw, -2.4 * Math.max(0, -sw), 3.2, C.limb);
  }

  // Rucksack (bei Rueckenansicht ueber dem Rumpf, sonst dahinter)
  const pack = () => {
    ctx.fillStyle = C.limb;
    ctx.beginPath(); ctx.roundRect(-6.4, shY + 1.5, 5, 9, 1.6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-6.4, shY + 1.5, 5, 9, 1.6); ctx.stroke();
  };
  if (viewKind !== 'back') pack();

  // Rumpf
  const tg = ctx.createLinearGradient(-5, shY, 5, hipY);
  tg.addColorStop(0, C.light); tg.addColorStop(0.55, C.base); tg.addColorStop(1, C.dark);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-4.4, hipY + bob);
  ctx.lineTo(-5.4, shY + bob + 1.5);
  ctx.lineTo(5.4, shY + bob + 1.5);
  ctx.lineTo(4.4, hipY + bob);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.dark; ctx.lineWidth = 1.2;
  ctx.stroke();
  // Brustgurt
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-4.8, shY + bob + 4); ctx.lineTo(4.8, shY + bob + 6); ctx.stroke();
  if (viewKind === 'back') pack();

  // Schultern
  ctx.fillStyle = C.armor;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(s * 5.2, shY + bob + 2.2, 2.6, 2.1, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Arme zur Waffe (vorderer Arm am Griff, hinterer am Handschutz)
  const handY = shY + bob + 6.5;
  const gx = Math.cos(gunAng), gy = Math.sin(gunAng) * 0.9;
  const grip = { x: 4.2 - gx * recoil * 3.6, y: handY - gy * recoil * 3.6 };
  ctx.strokeStyle = C.armor; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4.6, shY + bob + 3); ctx.lineTo(grip.x - 3.2, grip.y + 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4.6, shY + bob + 3); ctx.lineTo(grip.x, grip.y); ctx.stroke();

  // Waffe + Muendungsfeuer
  const muzzle = isoWeapon(ctx, u, grip.x, grip.y, gunAng, recoil, C);
  if (recoil > 0.72) {
    ctx.globalAlpha = (recoil - 0.72) / 0.28;
    const fg = ctx.createRadialGradient(muzzle.mx, muzzle.my, 0.5, muzzle.mx, muzzle.my, 7);
    fg.addColorStop(0, '#fff6c8'); fg.addColorStop(0.5, '#ffb03a'); fg.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(muzzle.mx, muzzle.my, 7, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Helm mit Visier (Rueckenansicht: ohne Visier, dafuer Nackenschutz)
  const hx = viewKind === 'front' ? 1.2 : viewKind === 'back' ? -1.2 : 1.6;
  const hg = ctx.createRadialGradient(hx, headY - 1.5 + bob, 1, hx, headY + bob, headR + 1.5);
  hg.addColorStop(0, '#eef3f8'); hg.addColorStop(0.35, C.base); hg.addColorStop(1, C.dark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(hx, headY + bob, headR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(hx, headY + bob, headR, 0, Math.PI * 2); ctx.stroke();
  if (viewKind === 'back') {
    ctx.fillStyle = C.armor;
    ctx.beginPath(); ctx.roundRect(hx - 3.4, headY + bob + 1.5, 6.8, 3.4, 1.4); ctx.fill();
  } else {
    const glow = u.type === 'cyborg'
      ? 0.55 + 0.45 * Math.sin(now / 240)
      : 0.75 + 0.25 * Math.sin(now / 700);
    ctx.globalAlpha = glow;
    ctx.fillStyle = C.visor;
    ctx.beginPath();
    ctx.ellipse(hx + 2.4, headY + bob + 0.4, 1.7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Kampflaeufer (Mech) in Iso: zwei Beinpods, Rumpf, Zwillingskanonen
function drawIsoWalker(u, feetX, feetY, now) {
  const C = unitColors(u);
  const bob = Math.sin((u.phase || 0) * 2) * (u.moving ? 1.6 : 0.4);
  ctx.save();
  ctx.translate(feetX, feetY);
  // Beinpods
  for (const s of [-1, 1]) {
    const lift = u.moving ? Math.max(0, Math.sin((u.phase || 0) + (s > 0 ? 0 : Math.PI))) * 2.5 : 0;
    ctx.strokeStyle = '#2b323c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 6, -12 + bob); ctx.lineTo(s * 9, -3 - lift); ctx.stroke();
    ctx.fillStyle = '#1d232b';
    ctx.beginPath(); ctx.ellipse(s * 9, -2 - lift, 4.5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Rumpf
  const g = ctx.createLinearGradient(-10, -22, 10, -8);
  g.addColorStop(0, C.light); g.addColorStop(0.5, C.base); g.addColorStop(1, C.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-11, -22 + bob, 22, 12, 3);
  ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.roundRect(-11, -22 + bob, 22, 12, 3); ctx.stroke();
  // Kanzel
  ctx.fillStyle = '#d9f4ff';
  ctx.beginPath(); ctx.ellipse(3, -22 + bob, 5.5, 4.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.ellipse(3, -22 + bob, 5.5, 4.2, 0, 0, Math.PI * 2); ctx.stroke();
  // Zwillingskanonen in Blickrichtung
  const ang = u._gunAng || 0;
  for (const off of [-3, 3]) {
    const bx = Math.cos(ang) * 15, by = Math.sin(ang) * 13;
    ctx.strokeStyle = '#141920'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(2, -17 + bob + off * 0.4); ctx.lineTo(2 + bx, -17 + bob + by + off * 0.4); ctx.stroke();
    ctx.strokeStyle = '#9aa6b5'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(3, -17 + bob + off * 0.4); ctx.lineTo(1 + bx * 0.9, -17 + bob + by * 0.9 + off * 0.4); ctx.stroke();
  }
  ctx.restore();
  void now;
}

// MG-/Laser-Turm in Iso: Sockel + drehbarer Kopf
function drawIsoTurret(u, feetX, feetY) {
  const C = unitColors(u);
  ctx.save();
  ctx.translate(feetX, feetY);
  ctx.fillStyle = '#232b35';
  ctx.beginPath();
  ctx.moveTo(0, -12); ctx.lineTo(13, -6); ctx.lineTo(0, 0); ctx.lineTo(-13, -6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#39434f';
  ctx.beginPath();
  ctx.moveTo(0, -16); ctx.lineTo(13, -10); ctx.lineTo(0, -4); ctx.lineTo(-13, -10);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.base; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -16); ctx.lineTo(13, -10); ctx.lineTo(0, -4); ctx.lineTo(-13, -10);
  ctx.closePath(); ctx.stroke();
  const ang = u._gunAng || 0;
  ctx.strokeStyle = '#141920'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(Math.cos(ang) * 14, -12 + Math.sin(ang) * 12); ctx.stroke();
  ctx.fillStyle = u.dmgBonus ? '#ff8c66' : '#37b6ff';
  ctx.beginPath(); ctx.arc(0, -12, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Zivilist in Iso (einfache Figur mit Gehzyklus, panisch = schneller)
function drawIsoCiv(c, feetX, feetY, now) {
  const ph = c.phase || 0;
  const sw = c.moving ? Math.sin(ph) : 0;
  const bob = c.moving ? -Math.abs(Math.cos(ph)) * 1.1 : Math.sin(now / 800) * 0.4;
  ctx.save();
  ctx.translate(feetX, feetY);
  for (const s of [-1, 1]) {
    ctx.strokeStyle = '#4a4436'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -8 + bob); ctx.lineTo(3.6 * sw * s, -2.2 * Math.max(0, sw * s)); ctx.stroke();
  }
  const g = ctx.createLinearGradient(-4, -16, 4, -8);
  g.addColorStop(0, '#e2d78a'); g.addColorStop(1, '#a89a55');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(-4, -16 + bob, 8, 9, 2.5); ctx.fill();
  ctx.strokeStyle = '#6e6538'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(-4, -16 + bob, 8, 9, 2.5); ctx.stroke();
  ctx.fillStyle = '#d9c9a0';
  ctx.beginPath(); ctx.arc(0, -18.5 + bob, 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6e6538'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, -18.5 + bob, 3, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/* ---------------- Top-Down-Soldat (Draufsicht) ----------------
   Bekannter Look, jetzt mit Gehzyklus (Fuesse), Atmen im Stand und
   Rueckstoss beim Schuss.                                          */
function drawTopDownUnit(u, cx, cy, now) {
  const C = unitColors(u);
  const anim = u.animName || 'idle';
  const ang = (u.facing !== undefined) ? u.facing : (u.side === 'A' ? 0 : Math.PI);
  const recoil = Math.max(0, 1 - (now - (u.shotAt || -99999)) / 150);
  const walking = anim === 'walk' || anim === 'crouchWalk' || anim === 'crawl';

  ctx.save();
  ctx.translate(cx, cy);
  if (anim === 'roll') {
    const p = 1 - ((u.rollUntil - now) / (u.rollDur || 330));
    ctx.rotate(ang + p * Math.PI * 2);
    ctx.scale(0.9, 0.9);
  } else {
    ctx.rotate(ang);
  }
  const breathe = (anim === 'idle' || anim === 'kneelIdle') ? 1 + Math.sin(now / 620) * 0.025 : 1;
  const uscale = (u.type === 'heavy' ? 1.18 : 1)
    * (anim === 'kneelIdle' || anim === 'crouchWalk' ? 0.86 : 1) * breathe;
  ctx.scale(uscale, uscale);

  // Fuesse im Gehzyklus (senkrecht zur Blickrichtung)
  if (walking && anim !== 'crawl') {
    const sw = Math.sin(u.phase || 0);
    for (const s of [-1, 1]) {
      const off = sw * 5 * s;
      ctx.fillStyle = '#14181e';
      ctx.beginPath();
      ctx.ellipse(1 + Math.abs(off) * 0.2, 7 * s + off * 0.55, 3.2, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const back = -recoil * 1.8;
  // Rucksack
  ctx.fillStyle = C.limb;
  ctx.fillRect(-14 + back, -6, 6, 12);
  ctx.strokeStyle = '#161b21'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-14 + back, -6, 6, 12);
  // Waffe
  const wl = u.type === 'sniper' ? 24 : u.type === 'heavy' ? 17 : 19;
  const ww = u.type === 'heavy' ? 5 : u.type === 'sniper' ? 2.5 : 3.5;
  ctx.strokeStyle = '#141920'; ctx.lineWidth = ww + 1.5;
  ctx.beginPath(); ctx.moveTo(2 + back, 4.5); ctx.lineTo(wl + back, 4.5); ctx.stroke();
  ctx.strokeStyle = '#9aa6b5'; ctx.lineWidth = Math.max(1, ww - 1);
  ctx.beginPath(); ctx.moveTo(3 + back, 4.5); ctx.lineTo(wl - 1 + back, 4.5); ctx.stroke();
  if (u.type === 'sniper') { ctx.fillStyle = '#1d232b'; ctx.fillRect(8 + back, 2.5, 5, 4); }
  if (u.type === 'heavy') { ctx.fillStyle = '#1d232b'; ctx.fillRect(wl - 3 + back, 1, 4, 7); }
  // Torso
  const bodyGrad = ctx.createLinearGradient(-8, -10, 6, 10);
  bodyGrad.addColorStop(0, C.light); bodyGrad.addColorStop(0.5, C.base); bodyGrad.addColorStop(1, C.dark);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.ellipse(-1 + back, 0, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.dark; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(-1 + back, 0, 9, 11, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(-1 + back, -9); ctx.lineTo(-1 + back, 9); ctx.stroke();
  // Schulterpanzer
  for (const syy of [-10, 10]) {
    const sg = ctx.createRadialGradient(-1, syy - 2, 1, -1, syy, 6);
    sg.addColorStop(0, C.light); sg.addColorStop(1, C.armor);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(-1 + back, syy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(-1 + back, syy, 5.5, 0, Math.PI * 2); ctx.stroke();
  }
  // Arm zur Waffe
  ctx.strokeStyle = C.armor; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(back, 8); ctx.lineTo(8 + back, 4.5); ctx.stroke();
  // Helm mit Leucht-Visier
  const hg = ctx.createRadialGradient(1, -2, 1, 2, 0, 8);
  hg.addColorStop(0, '#e8eef5'); hg.addColorStop(0.35, C.base); hg.addColorStop(1, C.dark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(2 + back, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(2 + back, 0, 7, 0, Math.PI * 2); ctx.stroke();
  if (u.type === 'cyborg') {
    ctx.fillStyle = 'rgba(255,90,70,0.45)';
    ctx.beginPath(); ctx.arc(6.8 + back, 1.5, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(6.8 + back, 1.5, 1.8, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = C.visor;
    ctx.beginPath(); ctx.ellipse(7.2 + back, 0, 2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Muendungsfeuer
  if (recoil > 0.72) {
    ctx.globalAlpha = (recoil - 0.72) / 0.28;
    const fg = ctx.createRadialGradient(wl + 3 + back, 4.5, 0.5, wl + 3 + back, 4.5, 9);
    fg.addColorStop(0, '#fff6c8'); fg.addColorStop(0.5, '#ffb03a'); fg.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(wl + 3 + back, 4.5, 9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ---------------- Eine Einheit zeichnen (beide Ansichten) ---------------- */
function drawUnit(u, now) {
  const cx = sx(u.rx, u.ry), cy = sy(u.rx, u.ry);
  const headroom = isIso() ? (u.type === 'walker' ? 34 : 30) : 22;

  // Auswahl-Markierung am Boden
  if (selection.includes(u)) {
    ctx.strokeStyle = u === selected ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + (isIso() ? 2 : 0), 16, squash(16), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Echtzeit-Zielmarkierung
  if (state.timeMode === 'rt' && selected && selected.attackTarget === u.id && u.side !== selected.side) {
    ctx.strokeStyle = 'rgba(255,95,79,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, 19, squash(19), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy); ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 24, cy);
    ctx.moveTo(cx, cy - squash(24)); ctx.lineTo(cx, cy - squash(14));
    ctx.moveTo(cx, cy + squash(14)); ctx.lineTo(cx, cy + squash(24));
    ctx.stroke();
  }

  // Schatten
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx + (isIso() ? 2 : 1.5), cy + (isIso() ? 1 : 4), isIso() ? 12 : 13, squash(isIso() ? 12 : 8), 0, 0, Math.PI * 2);
  ctx.fill();

  if (isIso()) {
    if (u.type === 'turret') drawIsoTurret(u, cx, cy);
    else if (u.type === 'walker') drawIsoWalker(u, cx, cy, now);
    else drawIsoSoldier(u, cx, cy, now);
  } else if (u.type === 'turret') {
    const ang = u._gunAng || 0;
    ctx.fillStyle = '#232b35';
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = u.side === 'A' ? '#37b6ff' : '#ff5f4f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#141920'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * 15, cy + Math.sin(ang) * 15); ctx.stroke();
    ctx.fillStyle = u.dmgBonus ? '#ff8c66' : '#37b6ff';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  } else if (u.type === 'walker') {
    drawWalkerUnit(cx, cy, u.side, u._gunAng || 0);
  } else if ((u.animName || '') === 'proneIdle' || (u.animName || '') === 'crawl' || (u.animName || '') === 'down') {
    const C = unitColors(u);
    drawProneUnit(cx, cy, u, u._gunAng || 0, C.base, C.dark, C.light);
  } else {
    drawTopDownUnit(u, cx, cy, now);
  }

  // HP / TU / Cooldown ueber dem Kopf
  const bw = 24;
  const by = cy - headroom;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(cx - bw / 2, by, bw, 4);
  const hpFrac = u.hp / u.maxHp;
  ctx.fillStyle = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#fbbf24' : '#ff5f4f';
  ctx.fillRect(cx - bw / 2, by, bw * hpFrac, 4);
  if (state.timeMode === 'tb' && u.side === state.turn) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - bw / 2, by + 5, bw, 3);
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(cx - bw / 2, by + 5, bw * (u.tu / u.maxTu), 3);
  }
  if (state.timeMode === 'rt' && u.side === viewingSide() && u.cdMax > 0 && u.cd > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - bw / 2, by + 5, bw, 3);
    ctx.fillStyle = '#37b6ff'; ctx.fillRect(cx - bw / 2, by + 5, bw * (1 - u.cd / u.cdMax), 3);
  }
}

/* ---------------- Frame ---------------- */
function render(now) {
  requestAnimationFrame(render);
  if (!state.map || $('game').classList.contains('hidden')) return;
  tickMoveAnim(now);

  // Echtzeit: weiche Interpolation aller Einheiten zur Logik-Position
  if (state.timeMode === 'rt') {
    for (const u of state.units) {
      if (!u.alive) continue;
      u.rx += (u.x - u.rx) * 0.22;
      u.ry += (u.y - u.ry) * 0.22;
      if (Math.abs(u.x - u.rx) < 0.01) u.rx = u.x;
      if (Math.abs(u.y - u.ry) < 0.01) u.ry = u.y;
    }
  }

  const viewer = viewingSide();
  const visible = vis[viewer];
  const explored = seenTiles[viewer];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  const sAge = now - shakeT0;
  if (sAge < 400) {
    const m = 7 * (1 - sAge / 400);
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
  }

  // 1) Boden (vorgebacken: Textur + Decals + Kontakt-Schatten)
  if (groundDirty) renderGround();
  if (groundCanvas) ctx.drawImage(groundCanvas, 0, 0);

  // 2) Nebel des Krieges
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = x + ',' + y;
    const unseen = !explored.has(k);
    const dim = !unseen && !visible.has(k);
    if (!unseen && !dim) continue;
    ctx.fillStyle = unseen ? '#04060a' : 'rgba(2,4,8,0.55)';
    tilePath(x, y);
    ctx.fill();
  }

  // 3) erreichbare Felder (Rundenmodus, Einzelauswahl)
  if (state.timeMode === 'tb' && selected && selection.length === 1 && canControl()) {
    ctx.fillStyle = 'rgba(55,182,255,0.16)';
    for (const k of reachable.keys()) {
      const [rx2, ry2] = k.split(',').map(Number);
      tilePath(rx2, ry2);
      ctx.fill();
    }
  }

  // 4) Granaten-Zielvorschau
  if (fireMode === 'nade' && selected && selected.alive && hoverTile && canControlUnit(selected)) {
    const d = Math.hypot(hoverTile.x - selected.x, hoverTile.y - selected.y);
    const ok = d <= GRENADE.range && losClear(selected.x, selected.y, hoverTile.x, hoverTile.y);
    ctx.strokeStyle = ok ? 'rgba(251,191,36,0.8)' : 'rgba(130,130,130,0.5)';
    ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx(hoverTile.x + 0.5, hoverTile.y + 0.5), sy(hoverTile.x + 0.5, hoverTile.y + 0.5),
      GRENADE.radius * (isIso() ? VIEW.tw / 2 : T), GRENADE.radius * (isIso() ? VIEW.th / 2 : T),
      0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = ok ? '#fbbf24' : '#98a4b3';
    ctx.fillText(ok ? '💣' : 'ausser Reichweite',
      sx(hoverTile.x + 0.5, hoverTile.y + 0.5), sy(hoverTile.x + 0.5, hoverTile.y + 0.5) - (isIso() ? 26 : T / 2 + 4));
  }

  // 5) Formations-Vorschau bei Mehrfachauswahl
  if (selection.length > 1 && fireMode !== 'nade' && hoverTile && selected && canControlUnit(selected)) {
    const hovUnit = unitAt(hoverTile.x, hoverTile.y);
    if (!hovUnit || hovUnit.side === selected.side) {
      const ctrl = selection.filter(u => u.alive && canControlUnit(u));
      if (ctrl.length > 1) {
        const slots = computeSlots(ctrl, hoverTile);
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(55,182,255,0.75)';
        for (const s of slots) {
          if (!s) continue;
          ctx.beginPath();
          ctx.ellipse(sx(s.x + 0.5, s.y + 0.5), sy(s.x + 0.5, s.y + 0.5), 10, squash(10), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#aadcff';
        ctx.fillText(FORMATION_LABELS[formation],
          sx(hoverTile.x + 0.5, hoverTile.y + 0.5), sy(hoverTile.x + 0.5, hoverTile.y + 0.5) - (isIso() ? 22 : T / 2 + 2));
      }
    }
  }

  // 6) Pfadvorschau / Ziel-Info
  if (fireMode !== 'nade' && selected && selected.alive && hoverTile &&
      ((state.timeMode === 'tb' && canControl()) || (state.timeMode === 'rt' && canControlUnit(selected)))) {
    const hovRaw = unitAt(hoverTile.x, hoverTile.y);
    const hov = hovRaw && isVisibleTo(viewer, hovRaw.x, hovRaw.y) ? hovRaw : null;
    if (hov && hov.side !== selected.side) {
      const clear = losClear(selected.x, selected.y, hov.x, hov.y);
      ctx.strokeStyle = clear ? 'rgba(255,95,79,0.75)' : 'rgba(130,130,130,0.5)';
      ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(selected.rx, selected.ry), sy(selected.rx, selected.ry) - squash(8));
      ctx.lineTo(sx(hov.rx, hov.ry), sy(hov.rx, hov.ry) - squash(8));
      ctx.stroke();
      ctx.setLineDash([]);
      const fmShow = fireMode === 'nade' ? 'snap' : fireMode;
      const ck = clear ? coverKind(selected, hov) : null;
      const label = clear
        ? hitChance(selected, hov, fmShow) + ' %' + (ck === 'full' ? ' (Deckung)' : ck === 'low' ? ' (halb)' : '')
        : 'keine Sicht';
      ctx.font = 'bold 14px sans-serif';
      const lx = sx(hov.rx, hov.ry), ly = sy(hov.rx, hov.ry) - (isIso() ? 34 : 26);
      ctx.fillStyle = 'rgba(10,14,19,0.85)';
      const tw2 = ctx.measureText(label).width;
      ctx.fillRect(lx - tw2 / 2 - 6, ly - 14, tw2 + 12, 20);
      ctx.fillStyle = clear ? '#ff8d81' : '#98a4b3';
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
    } else if (state.timeMode === 'tb' && selection.length === 1) {
      const info = reachable.get(hoverTile.x + ',' + hoverTile.y);
      if (info) {
        ctx.fillStyle = 'rgba(55,182,255,0.5)';
        for (const p of info.path) {
          ctx.beginPath();
          ctx.ellipse(sx(p.x + 0.5, p.y + 0.5), sy(p.x + 0.5, p.y + 0.5), 4, squash(4), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = '#aadcff';
        ctx.textAlign = 'center';
        ctx.fillText(info.cost + ' TU',
          sx(hoverTile.x + 0.5, hoverTile.y + 0.5), sy(hoverTile.x + 0.5, hoverTile.y + 0.5) - (isIso() ? 20 : T / 2 + 2));
      }
    }
  }

  // 7) Echtzeit: Bewegungs-Routen der Auswahl
  if (state.timeMode === 'rt' && selection.length) {
    ctx.fillStyle = 'rgba(55,182,255,0.45)';
    for (const su of selection) {
      if (!su.alive) continue;
      for (const p of su.moveQueue) {
        ctx.beginPath();
        ctx.ellipse(sx(p.x + 0.5, p.y + 0.5), sy(p.x + 0.5, p.y + 0.5), 3.5, squash(3.5), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 8) Tiefensortierter Durchlauf: Gelaende + Einheiten + Zivilisten + Leichen.
  //    Sortierung nach (x + y) -> Nahes ueberdeckt Fernes, Einheiten koennen
  //    damit wirklich hinter Waenden stehen.
  const drawables = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = x + ',' + y;
    const tile = state.map[y][x];
    if (tile !== FLOOR && explored.has(k)) {
      drawables.push({ d: x + y + (isIso() ? 0 : -0.6), kind: 'tile', x, y, tile });
    }
  }
  const introP = introActive() ? 1 - (introUntil - now) / INTRO_MS : 1;
  const shipYNow = -2.5 + (H + 5) * Math.min(1, introP * 1.05);
  for (const u of state.units) {
    if (!u.alive) continue;
    if (introActive() && u.y > shipYNow) continue;      // noch nicht abgesetzt
    const isOwn = u.side === viewer;
    const k = u.x + ',' + u.y;
    if (!u.down && !isOwn && !visible.has(k)) continue;
    if (u.down && !isOwn && !visible.has(k)) continue;
    drawables.push({ d: u.rx + u.ry + 0.4, kind: u.down ? 'downed' : 'unit', u });
  }
  for (const c of state.civs) {
    if (!c.alive || !visible.has(c.x + ',' + c.y)) continue;
    drawables.push({ d: c.rx + c.ry + 0.5, kind: 'civ', c });
  }
  for (const e of effects) {
    if (e.kind !== 'corpse') continue;
    if (!explored.has(e.x + ',' + e.y)) continue;
    drawables.push({ d: e.x + e.y + 0.2, kind: 'corpse', e });
  }
  drawables.sort((a, b) => a.d - b.d);

  for (const it of drawables) {
    if (it.kind === 'tile') {
      if (isIso()) {
        blitIso(ctx, isoSpriteFor(it.tile), it.x, it.y);
      } else {
        const tex = it.tile === WALL ? texWall : it.tile === CRATE ? texCrate : texLow;
        if (tex) ctx.drawImage(tex, it.x * T, it.y * T);
      }
    } else if (it.kind === 'civ') {
      const c = it.c;
      c.rx += (c.x - c.rx) * 0.15;
      c.ry += (c.y - c.ry) * 0.15;
      updateCivAnim(c, now);
      const ccx = sx(c.rx + 0.5, c.ry + 0.5), ccy = sy(c.rx + 0.5, c.ry + 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(ccx + 1, ccy, 7, squash(7), 0, 0, Math.PI * 2); ctx.fill();
      if (isIso()) {
        drawIsoCiv(c, ccx, ccy, now);
      } else {
        const civGrad = ctx.createRadialGradient(ccx - 2, ccy - 3, 1, ccx, ccy, 9);
        civGrad.addColorStop(0, '#e2d78a'); civGrad.addColorStop(1, '#a89a55');
        ctx.fillStyle = civGrad;
        ctx.beginPath(); ctx.arc(ccx, ccy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6e6538'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ccx, ccy, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#0d1117'; ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Z', ccx, ccy + 0.5);
        ctx.textBaseline = 'alphabetic';
      }
      if (c.panic > 0) {
        ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('!', ccx + 10, ccy - (isIso() ? 26 : 8));
      }
    } else if (it.kind === 'corpse') {
      const e = it.e;
      const age = now - e.t0;
      ctx.globalAlpha = Math.min(0.7, 1 - age / 6000 + 0.2);
      ctx.strokeStyle = e.side === 'A' ? '#2a6a8f' : e.side === 'B' ? '#8f3a32' : '#7a7a52';
      ctx.lineWidth = 3;
      const cx2 = sx(e.x + 0.5, e.y + 0.5), cy2 = sy(e.x + 0.5, e.y + 0.5);
      ctx.beginPath();
      ctx.moveTo(cx2 - 8, cy2 - squash(8)); ctx.lineTo(cx2 + 8, cy2 + squash(8));
      ctx.moveTo(cx2 + 8, cy2 - squash(8)); ctx.lineTo(cx2 - 8, cy2 + squash(8));
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (it.kind === 'downed') {
      const u = it.u;
      updateAnim(u, now);
      const dcx = sx(u.x, u.y), dcy = sy(u.x, u.y);
      if (isIso()) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(dcx, dcy, 13, squash(13), 0, 0, Math.PI * 2); ctx.fill();
        drawIsoSoldier(u, dcx, dcy, now);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.85;
        const C = unitColors(u);
        drawProneUnit(dcx, dcy, u, u._gunAng || 0, '#6b7480', '#454d57', C.light);
        ctx.restore();
      }
      ctx.textAlign = 'center';
      if (!u.stable) {
        const pulse = 0.5 + 0.4 * Math.sin(now / 250);
        ctx.fillStyle = `rgba(255,60,50,${pulse})`;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('🚑', dcx, dcy - (isIso() ? 22 : 14));
        const frac = state.timeMode === 'tb' ? u.bleed / BLEED_ROUNDS : u.bleed / BLEED_TICKS;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(dcx - 12, dcy + (isIso() ? 8 : 12), 24, 3);
        ctx.fillStyle = '#ff5f4f';
        ctx.fillRect(dcx - 12, dcy + (isIso() ? 8 : 12), 24 * Math.max(0, frac), 3);
      } else {
        ctx.fillStyle = '#4ade80'; ctx.font = 'bold 12px sans-serif';
        ctx.fillText('✚', dcx, dcy - (isIso() ? 20 : 12));
      }
    } else {
      const u = it.u;
      updateAnim(u, now);
      drawUnit(u, now);
    }
  }

  // 9) Effekte (Deckel gegen unbegrenztes Wachstum)
  if (effects.length > 400) effects.splice(0, effects.length - 400);
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const age = now - e.t0;
    if (age < 0) continue;
    if (e.kind === 'tracer') {
      if (age > 220) { effects.splice(i, 1); continue; }
      const alpha = 1 - age / 220;
      const lift = isIso() ? 0.5 : 0;
      ctx.strokeStyle = e.hit ? `rgba(255,230,120,${alpha})` : `rgba(180,190,200,${alpha * 0.7})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx(e.x0, e.y0, lift), sy(e.x0, e.y0, lift));
      ctx.lineTo(sx(e.x1, e.y1, lift), sy(e.x1, e.y1, lift));
      ctx.stroke();
    } else if (e.kind === 'float') {
      if (age > 1100) { effects.splice(i, 1); continue; }
      const alpha = 1 - age / 1100;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, sx(e.x, e.y), sy(e.x, e.y) - 12 - age / 40);
      ctx.globalAlpha = 1;
    } else if (e.kind === 'boom') {
      if (age > 550) { effects.splice(i, 1); continue; }
      const p = age / 550;
      const r = e.r * (isIso() ? VIEW.tw / 2 : T) * (0.3 + p * 0.9);
      const bx = sx(e.x, e.y), byy = sy(e.x, e.y);
      ctx.globalAlpha = 1 - p;
      const grad = ctx.createRadialGradient(bx, byy, 2, bx, byy, r);
      grad.addColorStop(0, '#fff7cc');
      grad.addColorStop(0.4, '#ffb03a');
      grad.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(bx, byy, r, squash(r), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'flash') {
      if (age > 120) { effects.splice(i, 1); continue; }
      const fa = 1 - age / 120;
      ctx.fillStyle = `rgba(255,230,140,${fa * 0.8})`;
      ctx.beginPath();
      ctx.ellipse(sx(e.x, e.y, 0.45), sy(e.x, e.y, 0.45), 6 + age / 10, squash(6 + age / 10), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === 'deathfade') {
      if (age > 450) { effects.splice(i, 1); continue; }
      const p2 = age / 450;
      ctx.save();
      ctx.translate(sx(e.x, e.y), sy(e.x, e.y));
      ctx.rotate(p2 * 1.6);
      ctx.globalAlpha = 1 - p2;
      ctx.fillStyle = e.side === 'A' ? '#37b6ff' : '#ff5f4f';
      ctx.beginPath();
      ctx.ellipse(0, 0, 12 * (1 - p2 * 0.4), squash(12) * (1 - p2 * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    } else if (e.kind === 'corpse') {
      if (age > 6000) effects.splice(i, 1);   // gezeichnet im Tiefen-Durchlauf
    }
  }

  // 10) Auswahlbox beim Ziehen
  if (isDragging && dragStart && dragCur) {
    const rx0 = Math.min(dragStart.px, dragCur.px), ry0 = Math.min(dragStart.py, dragCur.py);
    const rw = Math.abs(dragCur.px - dragStart.px), rh = Math.abs(dragCur.py - dragStart.py);
    ctx.fillStyle = 'rgba(55,182,255,0.12)';
    ctx.fillRect(rx0, ry0, rw, rh);
    ctx.strokeStyle = 'rgba(55,182,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx0 + .5, ry0 + .5, rw, rh);
  }

  // 11) Intro: Dropships setzen die Squads ab
  if (introActive()) {
    for (const side of ['A', 'B']) {
      const shipX = side === 'A' ? 1.5 : W - 1.5;
      const scx = sx(shipX, shipYNow), scy = sy(shipX, shipYNow);
      ctx.fillStyle = side === 'A' ? '#1e6a99' : '#993d33';
      ctx.beginPath();
      ctx.ellipse(scx, scy, isIso() ? 34 : T * 0.95, squash(isIso() ? 34 : T * 0.95) * (isIso() ? 1.6 : 1) * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.ellipse(scx, scy - 4, isIso() ? 20 : T * 0.55, squash(isIso() ? 20 : T * 0.55), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,200,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(scx, scy + (isIso() ? 12 : T * 0.5), isIso() ? 16 : T * 0.45, squash(isIso() ? 16 : T * 0.45), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(215,225,238,0.9)';
    ctx.fillText('🚁 Transporter setzen die Squads ab ...', canvas.width / 2, 26);
  }

  ctx.restore();
}

// Zivilisten-Animation (eigener, kleiner Zustandsautomat)
function updateCivAnim(c, now) {
  const lx = (c._prx === undefined) ? c.rx : c._prx;
  const ly = (c._pry === undefined) ? c.ry : c._pry;
  c._prx = c.rx; c._pry = c.ry;
  const speed = Math.hypot(c.rx - lx, c.ry - ly);
  c.moving = speed > 0.002;
  const rate = c.panic > 0 ? 30 : 16;
  if (c.moving) c.phase = (c.phase || 0) + speed * rate;
  else c.phase = (c.phase || 0) + 0.015;
  void now;
}

requestAnimationFrame(render);

// Liegender Soldat (robbt, flaches Profil)
function drawProneUnit(cx, cy, u, ang, color, darker, light) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 2, 15, 6, ang, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // Waffe nach vorn
  ctx.strokeStyle = '#141920'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(9, 2); ctx.lineTo(23, 2); ctx.stroke();
  ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(22, 2); ctx.stroke();
  // flacher Koerper
  const g = ctx.createLinearGradient(-10, -5, 10, 5);
  g.addColorStop(0, light); g.addColorStop(0.5, color); g.addColorStop(1, darker);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(-1, 0, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = darker; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(-1, 0, 11, 5, 0, 0, Math.PI * 2); ctx.stroke();
  // Beine
  ctx.strokeStyle = darker; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-16, -3); ctx.moveTo(-10, 2); ctx.lineTo(-16, 3); ctx.stroke();
  // Helm vorn
  const hg = ctx.createRadialGradient(8, -1, 1, 8, 0, 5);
  hg.addColorStop(0, '#e8eef5'); hg.addColorStop(0.4, color); hg.addColorStop(1, darker);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(8, 0, 4.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(8, 0, 4.6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = u.type === 'cyborg' ? '#ff3b30' : '#a5e6ff';
  ctx.beginPath(); ctx.arc(11.4, 0, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Kampflaeufer (grosse Einheit aus der Mech-Werkstatt)
function drawWalkerUnit(cx, cy, side, ang) {
  const S = side === 'A'
    ? { base: '#37b6ff', dark: '#1a5c82', light: '#7fd0ff' }
    : { base: '#ff5f4f', dark: '#8a2f26', light: '#ff9a8d' };
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 5, 19, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.scale(0.8, 0.8);
  for (const sy of [-16, 16]) { // Beinpods
    ctx.fillStyle = '#2b323c';
    ctx.beginPath(); ctx.roundRect(-12, sy - 6, 20, 12, 4); ctx.fill();
    ctx.strokeStyle = '#12161c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-12, sy - 6, 20, 12, 4); ctx.stroke();
    ctx.strokeStyle = '#79848f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, sy); ctx.lineTo(5, sy); ctx.stroke();
  }
  for (const sy of [-7, 7]) { // Zwillingskanonen
    ctx.strokeStyle = '#141920'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(8, sy); ctx.lineTo(30, sy); ctx.stroke();
    ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(9, sy); ctx.lineTo(28, sy); ctx.stroke();
    ctx.fillStyle = '#1d232b'; ctx.fillRect(26, sy - 2.5, 5, 5);
  }
  const g = ctx.createLinearGradient(-14, -14, 12, 14); // Rumpf
  g.addColorStop(0, S.light); g.addColorStop(0.5, S.base); g.addColorStop(1, S.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(14, -8); ctx.lineTo(6, -13); ctx.lineTo(-12, -11);
  ctx.lineTo(-15, 0); ctx.lineTo(-12, 11); ctx.lineTo(6, 13); ctx.lineTo(14, 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#333b46'; // Raketenpod
  ctx.beginPath(); ctx.roundRect(-13, -9, 8, 8, 2); ctx.fill();
  ctx.fillStyle = '#ff8c66';
  for (const [mx, my] of [[-11, -7], [-8, -7], [-11, -4], [-8, -4]]) {
    ctx.beginPath(); ctx.arc(mx, my, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  const cg = ctx.createRadialGradient(6, -2, 1, 5, 0, 8); // Kanzel
  cg.addColorStop(0, '#d9f4ff'); cg.addColorStop(0.5, S.base); cg.addColorStop(1, S.dark);
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.ellipse(5, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(5, 0, 7, 6, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.ellipse(7.5, -1.5, 2.5, 1.6, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

loadViewPref();
syncViewButton();
updateMenuWallet();

/* ---------------- Basisverteidigung: die eigene Basis als Schlachtfeld ---------------- */
function startBaseDefense(payload) {
  startGame('ai', (Math.random() * 0xffffffff) >>> 0, 'rt', 4);
  state.arch = 'bunker';
  makeTextures(state.seed);
  // Karte: Fels = Wand, Gaenge/Raeume = Boden
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) state.map[y][x] = WALL;
  for (let y = 0; y < Math.min(H, payload.tiles.length); y++) {
    for (let x = 0; x < Math.min(W, payload.tiles[y].length); x++) {
      if (payload.tiles[y][x] === 1) state.map[y][x] = FLOOR;
    }
  }
  groundDirty = true;
  renderGround();
  state.civs = [];
  // BFS-Helfer: freie Bodenfelder rund um einen Punkt
  const freeAround = (sx, sy, count) => {
    const out = [];
    const seen = new Set([sx + ',' + sy]);
    const q = [[sx, sy]];
    while (q.length && out.length < count) {
      const [cx2, cy2] = q.shift();
      if (cx2 >= 0 && cy2 >= 0 && cx2 < W && cy2 < H && state.map[cy2][cx2] === FLOOR
          && !state.units.some(u2 => u2.alive && u2.x === cx2 && u2.y === cy2)) {
        out.push({ x: cx2, y: cy2 });
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k2 = (cx2 + dx) + ',' + (cy2 + dy);
        if (!seen.has(k2)) { seen.add(k2); q.push([cx2 + dx, cy2 + dy]); }
      }
    }
    return out;
  };
  // Squad an der Kommandozentrale aufstellen
  const defenders = state.units.filter(u => u.side === 'A');
  const spotsA = freeAround(payload.kom.x, payload.kom.y, defenders.length + 2);
  defenders.forEach((u, i) => {
    const s = spotsA[i] || spotsA[0];
    u.x = s.x; u.y = s.y; u.rx = s.x; u.ry = s.y;
  });
  // Geschuetztuerme als stationaere Verbuendete
  let ti = 100;
  for (const t2 of (payload.turrets || [])) {
    const [tx, ty] = t2.k.split(',').map(Number);
    if (ty >= H || state.map[ty][tx] !== FLOOR) continue;
    const tu2 = spawnUnit('A', t2.type === 'laser' ? 'Laser-Turm' : 'MG-Turm', tx, ty, 'turret', ti++);
    if (t2.type === 'laser') { tu2.maxHp = 80; tu2.hp = 80; tu2.dmgBonus = 6; }
    state.units.push(tu2);
  }
  // Raider ersetzen Seite B, stroemen vom Eingang herein
  state.units = state.units.filter(u => u.side === 'A');
  const wave2 = Math.max(1, payload.wave | 0);
  const nR = 4 + Math.min(8, wave2);
  const spotsB = freeAround(payload.entrance.x, Math.max(1, payload.entrance.y), nR + 2);
  for (let i = 0; i < nR; i++) {
    const s = spotsB[i] || spotsB[0] || { x: payload.entrance.x, y: 1 };
    const r = spawnUnit('B', 'Raider ' + (i + 1), s.x, s.y, i % 4 === 3 ? 'heavy' : 'assault', i);
    r.maxHp += wave2 * 6;
    r.hp = r.maxHp;
    state.units.push(r);
  }
  state.defense = { wave: wave2 };
  autoSelectSquad();
  refreshVisibility();
  log(`— 🏰 <b>BASISVERTEIDIGUNG (Welle ${wave2}):</b> ${nR} Raider stuermen deine Basis! Halte die Kommandozentrale – deine Tuerme feuern mit. —`);
  updateUI();
}

try {
  const paramsD = new URLSearchParams(location.search);
  if (paramsD.get('defense') === '1') {
    const payload = JSON.parse(localStorage.getItem('apocarena.defense') || 'null');
    if (payload) setTimeout(() => startBaseDefense(payload), 350);
  }
} catch { }

// Stadt-Einsatz: von der Stadtkarte entsandt (?mission=1)
function startCityMission(mis) {
  startGame('ai', (Math.random() * 0xffffffff) >>> 0, menuTempo, menuSquadSize);
  state.missionInfo = mis;
  // Stadt-Einsaetze spielen auf passendem Gelaende
  state.arch = mis.kind === 'geisel' ? 'stadt' : mis.kind === 'sabotage' ? 'lager' : 'nest';
  makeTextures(state.seed);
  groundDirty = true;
  if (mis.kind === 'geisel') {
    // Geiselrettung: das Gebaeude ist voller Zivilisten
    const rng3 = mulberry32((Math.random() * 0xffffffff) >>> 0);
    let added = 0, guard = 0;
    while (added < 6 && guard++ < 300) {
      const x = 5 + Math.floor(rng3() * (W - 10));
      const y = 1 + Math.floor(rng3() * (H - 2));
      if (state.map[y][x] !== FLOOR) continue;
      if (state.civs.some(c => c.x === x && c.y === y)) continue;
      state.civs.push({ id: 'C' + (state.civs.length + 90), x, y, rx: x, ry: y,
        hp: 15, alive: true, panic: 0, escaped: false });
      added++;
    }
    log(`🌆 <b>GEISELRETTUNG in "${mis.name}":</b> ${state.civs.length} Zivilisten im Gebiet – jeder Ueberlebende zaehlt! Jeder Tote kostet Ansehen.`);
  } else if (mis.kind === 'sabotage') {
    log(`🌆 <b>SABOTAGE-ABWEHR in "${mis.name}":</b> Sichere die Industrieanlage – Bonuspraemie winkt!`);
  } else {
    log(`🌆 <b>STADT-EINSATZ:</b> Alien-Aktivitaet in "${mis.name}" – saeubere das Gebiet!`);
  }
}
try {
  const params = new URLSearchParams(location.search);
  if (params.get('mission') === '1') {
    const mis = JSON.parse(localStorage.getItem('apocarena.mission') || 'null');
    if (mis) setTimeout(() => startCityMission(mis), 350);
  }
} catch { }
