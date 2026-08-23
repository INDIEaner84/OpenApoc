/* Soldaten-Labor: prozedurale Design-Prototypen, live gerendert.
   Vier Designs x drei Klassen x zwei Teamfarben, rotierend. */
'use strict';

const canvas = document.getElementById('labCanvas');
const ctx = canvas.getContext('2d');

const SIDES = {
  A: { base: '#37b6ff', dark: '#1a5c82', light: '#7fd0ff', armor: '#274c63' },
  B: { base: '#ff5f4f', dark: '#8a2f26', light: '#ff9a8d', armor: '#5e3129' },
};
const CLASSES = [
  { key: 'assault', label: 'Sturm', wl: 20, ww: 3, body: 12 },
  { key: 'sniper', label: 'Sniper', wl: 27, ww: 2.2, body: 11 },
  { key: 'heavy', label: 'Heavy', wl: 17, ww: 5.5, body: 14 },
];

/* ---------- Hintergrund: Bodentextur wie im Spiel ---------- */
function drawFloor() {
  for (let y = 0; y < canvas.height; y += 40) {
    for (let x = 0; x < canvas.width; x += 40) {
      const shade = ((x / 40 * 7 + y / 40 * 13) % 5) * 2;
      ctx.fillStyle = `rgb(${25 + shade},${31 + shade},${39 + shade})`;
      ctx.fillRect(x, y, 40, 40);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(x + .5, y + .5, 39, 39);
    }
  }
}

/* ---------- Design 1: Aktuell (Kreis + Visier) ---------- */
function drawCurrent(cx, cy, cls, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(cx + 1.5, cy + 4, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#141920'; ctx.lineWidth = cls.ww + 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 5, cy + Math.sin(ang) * 5);
  ctx.lineTo(cx + Math.cos(ang) * cls.wl, cy + Math.sin(ang) * cls.wl);
  ctx.stroke();
  ctx.strokeStyle = '#8b95a5'; ctx.lineWidth = cls.ww - 1;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 6);
  ctx.lineTo(cx + Math.cos(ang) * (cls.wl - 1), cy + Math.sin(ang) * (cls.wl - 1));
  ctx.stroke();
  const g = ctx.createRadialGradient(cx - 4, cy - 5, 2, cx, cy, 13);
  g.addColorStop(0, S.light); g.addColorStop(1, S.base);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, cls.body, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = S.dark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, cls.body, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(8,12,18,0.85)';
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, cls.body - 3, ang - 0.65, ang + 0.65);
  ctx.closePath(); ctx.fill();
}

/* ---------- Design 2: Taktisch (Schultern, Rucksack, Helm) ---------- */
function drawTactical(cx, cy, cls, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(cx + 1.5, cy + 4, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const s = cls.key === 'heavy' ? 1.18 : 1;
  ctx.scale(s, s);
  // Rucksack
  ctx.fillStyle = '#2c333c';
  ctx.fillRect(-14, -6, 6, 12);
  ctx.strokeStyle = '#161b21'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-14, -6, 6, 12);
  // Waffe (rechts gehalten)
  ctx.strokeStyle = '#141920'; ctx.lineWidth = cls.ww + 1.5;
  ctx.beginPath(); ctx.moveTo(2, 4.5); ctx.lineTo(cls.wl, 4.5); ctx.stroke();
  ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = Math.max(1, cls.ww - 1);
  ctx.beginPath(); ctx.moveTo(3, 4.5); ctx.lineTo(cls.wl - 1, 4.5); ctx.stroke();
  if (cls.key === 'sniper') { // Zielfernrohr
    ctx.fillStyle = '#1d232b'; ctx.fillRect(8, 2.5, 5, 4);
  }
  if (cls.key === 'heavy') { // Muendung
    ctx.fillStyle = '#1d232b'; ctx.fillRect(cls.wl - 3, 1, 4, 7);
  }
  // Torso (Panzerplatte)
  const g = ctx.createLinearGradient(-8, -10, 6, 10);
  g.addColorStop(0, S.light); g.addColorStop(0.5, S.base); g.addColorStop(1, S.dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = S.dark; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9, 11, 0, 0, Math.PI * 2); ctx.stroke();
  // Brustlinie
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(-1, -9); ctx.lineTo(-1, 9); ctx.stroke();
  // Schulterpanzer
  for (const sy of [-10, 10]) {
    const sg = ctx.createRadialGradient(-1, sy - 2, 1, -1, sy, 6);
    sg.addColorStop(0, S.light); sg.addColorStop(1, S.armor);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(-1, sy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(-1, sy, 5.5, 0, Math.PI * 2); ctx.stroke();
  }
  // Arm zur Waffe
  ctx.strokeStyle = S.armor; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(8, 4.5); ctx.stroke();
  // Helm
  const hg = ctx.createRadialGradient(1, -2, 1, 2, 0, 8);
  hg.addColorStop(0, '#e8eef5'); hg.addColorStop(0.35, S.base); hg.addColorStop(1, S.dark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(2, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(2, 0, 7, 0, Math.PI * 2); ctx.stroke();
  // Leucht-Visier vorn
  ctx.fillStyle = cls.key === 'sniper' ? '#9fffcf' : '#a5e6ff';
  ctx.beginPath(); ctx.ellipse(7.2, 0, 2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---------- Design 3: Comic (dicke Outlines, flache Farben) ---------- */
function drawComic(cx, cy, cls, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 5, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const s = cls.key === 'heavy' ? 1.22 : 1;
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // Waffe
  ctx.strokeStyle = '#10141a'; ctx.lineWidth = cls.ww + 4;
  ctx.beginPath(); ctx.moveTo(2, 5); ctx.lineTo(cls.wl, 5); ctx.stroke();
  ctx.strokeStyle = '#aeb9c8'; ctx.lineWidth = cls.ww;
  ctx.beginPath(); ctx.moveTo(3, 5); ctx.lineTo(cls.wl - 1.5, 5); ctx.stroke();
  // Schultern (flach, mit Outline)
  for (const sy of [-9.5, 9.5]) {
    ctx.fillStyle = S.base;
    ctx.strokeStyle = '#10141a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(-1, sy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // Torso
  ctx.fillStyle = S.base;
  ctx.strokeStyle = '#10141a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9.5, 11.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // helle Flaeche (Cel-Shading)
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.ellipse(-3.5, -4, 4.5, 6, -0.4, 0, Math.PI * 2); ctx.fill();
  // Helm
  ctx.fillStyle = S.light;
  ctx.strokeStyle = '#10141a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(2, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Visier
  ctx.fillStyle = '#10141a';
  ctx.beginPath(); ctx.ellipse(7.5, 0, 2.6, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---------- Design 4: Pixel-Art (Offscreen, ohne Glaettung skaliert) ---------- */
const pixCache = {};
function makePixelSprite(cls, S) {
  const key = cls.key + S.base;
  if (pixCache[key]) return pixCache[key];
  const c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  const g = c.getContext('2d');
  const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const wide = cls.key === 'heavy' ? 1 : 0;
  // Schultern
  P(7 - wide, 4, 4, 4, S.dark); P(7 - wide, 16, 4, 4, S.dark);
  P(8 - wide, 5, 3, 3, S.base); P(8 - wide, 17, 3, 3, S.base);
  // Torso
  P(6 - wide, 7, 8 + wide * 2, 10, S.dark);
  P(7 - wide, 8, 6 + wide * 2, 8, S.base);
  P(7 - wide, 8, 3, 4, S.light);
  // Helm
  P(10, 9, 6, 6, S.dark);
  P(11, 10, 4, 4, S.light);
  P(14, 11, 2, 2, '#0c1016'); // Visier
  // Waffe
  const wl = cls.key === 'sniper' ? 9 : cls.key === 'heavy' ? 6 : 7;
  P(13, 14, wl, cls.key === 'heavy' ? 3 : 2, '#161b22');
  P(13, 14, wl - 1, 1, '#9aa6b5');
  pixCache[key] = c;
  return c;
}
function drawPixel(cx, cy, cls, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 5, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.imageSmoothingEnabled = false;
  const sc = cls.key === 'heavy' ? 1.5 : 1.35;
  ctx.drawImage(makePixelSprite(cls, S), -12 * sc, -12 * sc, 24 * sc, 24 * sc);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
}

/* ---------- Spezialeinheiten: Android, Cyborg, Kampflaeufer ---------- */
function drawAndroid(cx, cy, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 4, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // integrierter Armblaster
  ctx.strokeStyle = '#1a1f26'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(2, 5); ctx.lineTo(17, 5); ctx.stroke();
  ctx.strokeStyle = '#cfd6df'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(3, 5); ctx.lineTo(15, 5); ctx.stroke();
  ctx.fillStyle = S.base; // Muendungsglut
  ctx.beginPath(); ctx.arc(17, 5, 2, 0, Math.PI * 2); ctx.fill();
  // schlanker Chrom-Torso
  const g = ctx.createLinearGradient(-8, -8, 6, 8);
  g.addColorStop(0, '#f2f5f9'); g.addColorStop(0.5, '#c3ccd7'); g.addColorStop(1, '#8b95a3');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(-1, 0, 7.5, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5b6572'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(-1, 0, 7.5, 9.5, 0, 0, Math.PI * 2); ctx.stroke();
  // Panel-Linien
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(4, -4); ctx.moveTo(-6, 4); ctx.lineTo(4, 4); ctx.stroke();
  // Energiekern
  ctx.fillStyle = S.base;
  ctx.beginPath(); ctx.arc(-2, 0, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(-2.5, -0.5, 1, 0, Math.PI * 2); ctx.fill();
  // schmale Schultern
  for (const sy of [-8.5, 8.5]) {
    ctx.fillStyle = '#dde3ea';
    ctx.beginPath(); ctx.arc(-1, sy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5b6572'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-1, sy, 4, 0, Math.PI * 2); ctx.stroke();
  }
  // Kuppelkopf mit Leucht-Visierband
  const hg = ctx.createRadialGradient(1, -2, 1, 2, 0, 7);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.5, '#d7dde5'); hg.addColorStop(1, '#97a1ae');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(2, 0, 6.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5b6572'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(2, 0, 6.2, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = S.base; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(2, 0, 4.2, -0.9, 0.9); ctx.stroke();
  ctx.restore();
}

function drawCyborg(cx, cy, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(cx + 1.5, cy + 4, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // Kabelstraenge vom Ruecken
  ctx.strokeStyle = '#3a424d'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-11, -3); ctx.quadraticCurveTo(-14, 0, -11, 3); ctx.stroke();
  // schwerer Unterarm-Geschuetzarm (Maschinenseite unten/rechts)
  ctx.strokeStyle = '#141920'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(1, 6); ctx.lineTo(18, 6); ctx.stroke();
  ctx.strokeStyle = '#7c8794'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(2, 6); ctx.lineTo(16, 6); ctx.stroke();
  ctx.fillStyle = S.base; // Energiezelle am Lauf
  ctx.fillRect(8, 4, 4, 4);
  // Torso: halb organisch (Teamfarbe), halb Metall
  const g = ctx.createLinearGradient(-8, -10, 6, 10);
  g.addColorStop(0, S.light); g.addColorStop(0.5, S.base); g.addColorStop(1, S.dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  // Metallhaelfte
  ctx.save();
  ctx.beginPath(); ctx.rect(-11, 0, 22, 12);
  ctx.clip();
  const mg = ctx.createLinearGradient(-8, 0, 6, 11);
  mg.addColorStop(0, '#9aa4b2'); mg.addColorStop(1, '#4c545f');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(6, 4); ctx.moveTo(-6, 8); ctx.lineTo(4, 8); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(-1, 0, 9, 11, 0, 0, Math.PI * 2); ctx.stroke();
  // Naht
  ctx.strokeStyle = '#0e1319'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(8, 0); ctx.stroke();
  // Schultern: organisch oben, Metall unten
  ctx.fillStyle = S.armor;
  ctx.beginPath(); ctx.arc(-1, -10, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(-1, -10, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6b7480';
  ctx.beginPath(); ctx.arc(-1, 10, 6.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c';
  ctx.beginPath(); ctx.arc(-1, 10, 6.2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.arc(-2.5, 8.5, 2, 0, Math.PI * 2); ctx.fill();
  // Kopf: Halbhelm + rotes Cyberauge
  const hg = ctx.createRadialGradient(1, -2, 1, 2, 0, 8);
  hg.addColorStop(0, '#e8eef5'); hg.addColorStop(0.4, S.base); hg.addColorStop(1, '#4c545f');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(2, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(2, 0, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#0e1319';
  ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(2, 7); ctx.stroke();
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath(); ctx.arc(6.5, 2.5, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,110,0.5)';
  ctx.beginPath(); ctx.arc(6.5, 2.5, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawWalker(cx, cy, S, ang) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 6, 24, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // Beinpods mit Hydraulik
  for (const sy of [-16, 16]) {
    ctx.fillStyle = '#2b323c';
    ctx.beginPath();
    ctx.roundRect(-12, sy - 6, 20, 12, 4);
    ctx.fill();
    ctx.strokeStyle = '#12161c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-12, sy - 6, 20, 12, 4); ctx.stroke();
    ctx.strokeStyle = '#79848f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, sy); ctx.lineTo(5, sy); ctx.stroke();
  }
  // Zwillingskanonen
  for (const sy of [-7, 7]) {
    ctx.strokeStyle = '#141920'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(8, sy); ctx.lineTo(30, sy); ctx.stroke();
    ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(9, sy); ctx.lineTo(28, sy); ctx.stroke();
    ctx.fillStyle = '#1d232b';
    ctx.fillRect(26, sy - 2.5, 5, 5);
  }
  // Rumpf
  const g = ctx.createLinearGradient(-14, -14, 12, 14);
  g.addColorStop(0, S.light); g.addColorStop(0.5, S.base); g.addColorStop(1, S.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(14, -8); ctx.lineTo(6, -13); ctx.lineTo(-12, -11);
  ctx.lineTo(-15, 0); ctx.lineTo(-12, 11); ctx.lineTo(6, 13); ctx.lineTo(14, 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 2;
  ctx.stroke();
  // Raketenwerfer-Pod hinten
  ctx.fillStyle = '#333b46';
  ctx.beginPath(); ctx.roundRect(-13, -9, 8, 8, 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(-13, -9, 8, 8, 2); ctx.stroke();
  ctx.fillStyle = '#ff8c66';
  for (const [mx, my] of [[-11, -7], [-8, -7], [-11, -4], [-8, -4]]) {
    ctx.beginPath(); ctx.arc(mx, my, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  // Cockpit-Kanzel mit Glas
  const cg = ctx.createRadialGradient(6, -2, 1, 5, 0, 8);
  cg.addColorStop(0, '#d9f4ff'); cg.addColorStop(0.5, S.base); cg.addColorStop(1, S.dark);
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.ellipse(5, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(5, 0, 7, 6, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.ellipse(7.5, -1.5, 2.5, 1.6, 0.3, 0, Math.PI * 2); ctx.fill();
  // Antenne
  ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-16, 14); ctx.stroke();
  ctx.fillStyle = S.base;
  ctx.beginPath(); ctx.arc(-16, 14, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

const SPECIALS = [
  { name: 'Android', fn: drawAndroid },
  { name: 'Cyborg', fn: drawCyborg },
  { name: 'Kampflaeufer', fn: drawWalker },
];

/* ---------- Layout & Animation ---------- */
const DESIGNS = [
  { name: '1 · AKTUELL — Kreis + Visier (Status quo)', fn: drawCurrent },
  { name: '2 · TAKTISCH — Schulterpanzer, Rucksack, Leucht-Visier (mein Favorit)', fn: drawTactical },
  { name: '3 · COMIC — dicke Outlines, Cel-Shading', fn: drawComic },
  { name: '4 · PIXEL-ART — Retro, ohne Glaettung skaliert', fn: drawPixel },
];

function render(now) {
  requestAnimationFrame(render);
  drawFloor();
  const t = now / 1000;
  let rowY = 70;
  for (const d of DESIGNS) {
    ctx.fillStyle = '#d7e1ee';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(d.name, 24, rowY - 38);
    let col = 0;
    for (const sideKey of ['A', 'B']) {
      for (const cls of CLASSES) {
        const cx = 90 + col * 140;
        const ang = t * 0.7 + col * 0.9;
        d.fn(cx, rowY, cls, SIDES[sideKey], ang);
        ctx.fillStyle = '#8494a8';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cls.label, cx, rowY + 38);
        col++;
      }
    }
    rowY += 172;
  }

  // Spezialeinheiten-Sektion
  ctx.fillStyle = '#37b6ff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SPEZIALEINHEITEN — Android · Cyborg (Veteranen-Wiedergeburt) · Kampflaeufer', 24, rowY - 38);
  let col = 0;
  for (const sideKey of ['A', 'B']) {
    for (const sp of SPECIALS) {
      const cx = 90 + col * 140;
      const angle = t * 0.7 + col * 0.9;
      sp.fn(cx, rowY + 12, SIDES[sideKey], angle);
      ctx.fillStyle = '#8494a8';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sp.name, cx, rowY + 62);
      col++;
    }
  }
}
requestAnimationFrame(render);
