/* End-to-End-Test: zwei WebSocket-Clients spielen ueber den echten Server */
'use strict';
const { WebSocket } = require('ws');

const URL = 'ws://localhost:' + (process.env.PORT || 3100);
let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✔ ' : '  ✘ FEHLER: ') + name);
  if (!cond) failures++;
}

function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
function nextMsg(ws) {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d))));
}

(async () => {
  // 1) Raum erstellen (Echtzeit-Flag + Squad-Groesse)
  const a = await connect();
  a.send(JSON.stringify({ t: 'create', rt: true, size: 6 }));
  const created = await nextMsg(a);
  check('Raum erstellt mit Code', created.t === 'created' && created.code.length === 4);

  // 2) Beitritt mit falschem Code
  const x = await connect();
  x.send(JSON.stringify({ t: 'join', code: 'ZZZZ' }));
  const err = await nextMsg(x);
  check('Falscher Code wird abgelehnt', err.t === 'error');
  x.close();

  // 3) Beitritt mit richtigem Code -> beide erhalten Start mit gleichem Seed + rt-Flag
  const b = await connect();
  const pStartA = nextMsg(a);
  b.send(JSON.stringify({ t: 'join', code: created.code }));
  const [startA, startB] = await Promise.all([pStartA, nextMsg(b)]);
  check('Beide Clients erhalten Start', startA.t === 'start' && startB.t === 'start');
  check('Gleicher Karten-Seed', startA.seed === startB.seed);
  check('Seiten korrekt verteilt', startA.side === 'A' && startB.side === 'B');
  check('Echtzeit-Flag uebertragen', startA.rt === true && startB.rt === true);
  check('Squad-Groesse uebertragen', startA.size === 6 && startB.size === 6);

  // 4) Befehls-Relay A -> B und B -> A
  const cmd1 = { type: 'move', unit: 'A0', path: [{ x: 2, y: 3 }], cost: 4, reactions: [], died: false };
  const pB = nextMsg(b);
  a.send(JSON.stringify({ t: 'cmd', data: cmd1 }));
  const relayed = await pB;
  check('Befehl A->B weitergeleitet', relayed.t === 'cmd' && relayed.data.unit === 'A0');

  const cmd2 = { type: 'rtMove', unit: 'B1', x: 20, y: 5 };
  const pA = nextMsg(a);
  b.send(JSON.stringify({ t: 'cmd', data: cmd2 }));
  const relayed2 = await pA;
  check('Echtzeit-Event B->A weitergeleitet', relayed2.data.type === 'rtMove' && relayed2.data.x === 20);

  // 5) Verbindungsabbruch -> Gegner wird informiert
  const pLeft = nextMsg(b);
  a.close();
  const left = await pLeft;
  check('Gegner erhaelt peer_left', left.t === 'peer_left');
  b.close();

  console.log(failures === 0 ? '\nNETZWERK-TESTS BESTANDEN ✅' : `\n${failures} TEST(S) FEHLGESCHLAGEN ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Testfehler:', e.message); process.exit(1); });
