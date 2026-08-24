# Apoc Arena

Ein rundenbasiertes **und** Echtzeit-Squad-Taktikspiel im Browser, inspiriert vom
Battlescape aus *X-COM: Apocalypse*. Komplett eigenstaendig (keine Original-Spieldaten
noetig), geschrieben in Vanilla JavaScript + Canvas, Server in Node.js.

## Starten

```bash
npm install
npm start        # laeuft auf http://localhost:3000 (PORT-Umgebungsvariable moeglich)
```

## Spielmodi

| Modus | Beschreibung |
|---|---|
| 🎮 Hotseat | 2 Spieler abwechselnd an einem Bildschirm (rundenbasiert) |
| 🤖 KI-Gefecht | Solo gegen die KI – rundenbasiert oder Echtzeit |
| 🌐 Online-PvP | Match erstellen → 4-stelligen Code teilen → Gegner tritt bei. Rundenbasiert oder Echtzeit |

## Mechaniken

- **Time Units (Rundenmodus)**: Bewegung 4 TU (gerade) / 6 TU (diagonal), Schnellschuss vs. gezielter Schuss
- **Echtzeit-Modus**: keine Zuege – Waffen haben Abklingzeiten, Einheiten feuern automatisch auf sichtbare Feinde, Bewegungs- und Zielbefehle jederzeit
- **Squad-Movement & Formationen**: Die Gruppe ist der Standard – Klick auf einen Soldaten waehlt das ganze Squad (Anfuehrer ist fest: der erste lebende Soldat). 4 Formationen (◆ Keil, ▬ Linie, ▮ Kolonne, ▣ Box), rotieren in Bewegungsrichtung, Slots kollisionsfrei (Greedy-Zuordnung). Squad-Angriff = Salve (Runden) bzw. gemeinsame Zielmarkierung (Echtzeit)
- **Squad-Groesse einstellbar**: 2–6 Soldaten pro Seite (Menue; Empfehlung 4, Maximum 6 wie im Original-Apocalypse). Online bestimmt der Match-Ersteller die Groesse
- **Verhaltensmodi** (Taste `Q`): 🛡 **Vorsichtig** – Squad sucht am Ziel automatisch Deckung zur Bedrohung, behaelt TU-Reserve fuers Reaktionsfeuer und stoppt in Echtzeit bei Feindkontakt. ⚔ **Aggressiv** – rueckt stur in Formation vor, volles Tempo, keine Deckungssuche
- **Fog of War**: Sichtweite 11 Felder pro Einheit, Wände blockieren Sicht, erkundetes Terrain bleibt in Erinnerung
- **Reaktionsfeuer** (Rundenmodus): Einheiten mit Rest-TU schiessen automatisch auf Feinde, die sich durch ihr Blickfeld bewegen
- **Deckung**: Kisten/Waende zwischen Schuetze und Ziel geben −20 % Trefferchance. Neue **huefthohe Bruestung** (`LOWWALL`, Sandsack/Mauerrest/Harzgrat): blockt nur die Bewegung, man schiesst drueber – deckt kniend/liegend voll (−20 %), stehend nur halb (−12 %)
- **Granaten**: Flaechenschaden, zerstoeren Kisten sicher, Bruestungen mit 75 % und Waende mit 40 % Chance – Friendly Fire inklusive!
- **Isometrische Ansicht** (Taste `V`, wird gespeichert): Diamant-Raster mit sichtbarer Gelaendehoehe, Hoehen-Picking und Tiefensortierung (Einheiten stehen wirklich *hinter* Waenden). Die klassische **Draufsicht** bleibt ein Tastendruck entfernt – dieselbe Logik, nur andere Projektion
- **Level-Design**: vier deterministische Karten-Archetypen mit je eigenem Tileset – 🏚 Bunkerhof (Beton), 🏙 Stadtstrasse (Backstein, Truemmer), 📦 Lagerhalle (Fracht, Regale), 👾 Aliennest (organisch). Gespiegelt & verbindungsgeprueft fuer faire Spawns
- **Animationen**: eigener Zustandsautomat pro Einheit – 🧍 stehen/atmen, gehen mit Gehzyklus, 🧎 geduckt gehen, 🛌 robben, Kampfrolle, Niedergestreckt – plus Rueckstoss, Muendungsfeuer und pulsierendes Visier, in *beiden* Ansichten
- **Atmosphaere**:
  - 🚁 **Transporter-Intro**: Dropships fliegen zu Beginn die Spawn-Zonen ab und setzen die Squads sichtbar ab
  - 🏃 **Zivilbevoelkerung**: Zivilisten wuseln ueber die Karte, geraten bei Feuergefechten in Panik und fliehen zum Kartenrand. Granaten kennen keine Unschuldigen – zivile Opfer landen in der Endstatistik
  - 🏳️ **Fliehende Gegner**: schwer verwundete KI-Soldaten (< 30 % HP) brechen den Kampf ab, ziehen sich zur Kante zurueck und verlassen das Schlachtfeld
  - 💥 Screenshake bei Explosionen, Muendungsfeuer, Leichen-Marker, synthetischer Sound
- **3 Klassen**: Sturmsoldat (2×), Scharfschuetze (Reichweite 16), Schwerer Soldat (viel HP)
- **Faire Karten**: prozedural generiert aus Seed, gespiegelt, Begehbarkeit garantiert

## Steuerung

**Die Gruppe ist der Standard**: Beim Spielstart und zu jedem Zugbeginn ist automatisch das ganze Squad ausgewaehlt; ein Klick auf einen Soldaten waehlt ebenfalls die ganze Gruppe (der angeklickte wird Anfuehrer der Formation).

- **Klick auf eigenen Soldaten**: ganze Gruppe auswaehlen (Anfuehrer fest = erster lebender Soldat)
- **Strg+Klick** oder Tasten `1`–`6`: einzelnen Soldaten steuern · **Shift** = hinzufuegen/entfernen
- **Q** oder Verhalten-Buttons: 🛡 Vorsichtig / ⚔ Aggressiv umschalten
- **Box ziehen**: Teilgruppe auswaehlen · **A**: alle · **Esc**: abwaehlen
- **Klick auf Feld**: Gruppe rueckt in Formation vor (Vorschau am Cursor); Einzelsoldat bewegt sich normal
- **Rechtsklick**: reiner Befehl (bewegt/greift an, aendert nie die Auswahl)
- **F** oder Formations-Buttons: Formation wechseln (Keil / Linie / Kolonne / Box)
- **Klick auf Gegner**: Salve der Gruppe (Rundenmodus) bzw. gemeinsames Ziel (Echtzeit)
- **💣-Button**: Granatenmodus, dann Zielfeld klicken (wirft der Anfuehrer)
- **V** oder 🧭-Button oben: Ansicht wechseln (isometrisch / Draufsicht)
- **Leertaste**: Pause (nur Echtzeit gegen KI) · **M**: Ton an/aus

## Architektur

- `server.js` – statischer Webserver + WebSocket-Relay (Raum-Codes, Seed-Verteilung, Befehlsweiterleitung)
- `public/game.js` – gesamte Spiellogik & Rendering. **Alle** Zustandsaenderungen laufen als
  serialisierbare Befehle durch `applyCommand()` – lokal wie uebers Netz identisch.
  Der ausfuehrende Client wuerfelt (Treffer/Schaden) und schickt die Ergebnisse mit
  (owner-authoritative) → keine Desyncs, kein Server-Gamestate noetig.
- Karten werden aus dem vom Server verteilten Seed **deterministisch** auf beiden Clients erzeugt.
- **Projektionsschicht** (`sx/sy/screenToTile/tilePath/squash`): Die Logik bleibt im
  Tile-Raster; Top-Down und Isometrie sind zwei reine Darstellungen derselben
  Zustaende. `VIEW.mode` ist nur lokal (nie Teil von Befehlen) → online-sicher.
  Gelaende mit Hoehe (Wand/Kiste/Bruestung) wird als fertige Iso-Sprites gebacken
  und pro Frame in Tiefenreihenfolge sortiert; Blut/Brandspuren liegen als Liste
  und ueberstehen Ansichtswechsel & neu gebackenen Boden.

## Kampagnen-Loop (Spiel ⇄ Basis)

- **Beute**: Siege im KI-Gefecht bringen Credits (300 + 80 je Ueberlebendem) ins Kampagnen-Konto (`localStorage`)
- **Basis-Bau** (`/base.html`, Dungeon-Keeper-Stil): Gaenge in den Fels graben, Sicherheitstueren, Spreng-/Gasfallen, MG-/Laser-Tuerme, 2×2-Raeume mit Energie-Bilanz – und eine **Angriffs-Simulation** in Wellen. Die Beute aus Gefechten wird beim Betreten der Basis gutgeschrieben. Die Basis wird automatisch gespeichert
- **Cyborg-Veteranen**: Cyborg-Labor bauen → Veteranen aus dem Cryo-Schlaf reaktivieren → sie kaempfen im naechsten KI-Gefecht als **Cyborg-Einheit** mit (62 HP, Reaktion 75, integrierte Armkanone, rotes Cyberauge)
- **Soldaten-Labor** (`/lab.html`): Design-Prototypen (Soldaten, Android, Cyborg, Kampflaeufer) und Konzept-Artworks
- **Stadtkarte** (`/city.html`, X-COM-Apocalypse-Look): isometrische Nacht-Neon-Stadt mit
  extrudierten Gebaeuden (Hoehe je Funktion, beleuchtete Fenster, Neon-Dachkanten in
  Org-Farbe, flackernde Reklame, Dachdetails), **Elevated-Rail** mit fahrenden Pods,
  **Flugverkehr** mit Lichtspuren und Bodenschatten, Wolken-Schatten, **Tag/Nacht** und
  **Regen** mit Pfuetzen-Neon-Schimmer und Blitz. UFOs, Absturzstellen und Strassengefechte
  bleiben klickbar; Klick/Hover laufen ueber die iso-Rueckprojektion.

## Tests

```bash
npm test           # test-sim.js (Gefechts-Engine) + test-base.js (Basis-Bau)
node test-net.js   # End-to-End: 2 WebSocket-Clients gegen echten Server (PORT=3100 empfohlen)
```
