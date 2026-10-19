# Bauplan-Format für GBK-Modelle

Status: Version 1, 16. Oktober 2026. Ergänzt [SPEC.md](./SPEC.md), Abschnitt 13.6.

Ein Bauplan beschreibt einen bestehenden GBK-Bau als Folge von Bauschritten:
„von Punkt A ein 35-cm-Rohr nach rechts, das Ende heißt B“. Er ist dafür gedacht,
dass ein Sprachmodell (LLM) ihn aus Fotos eines Baus schreibt. Der Editor öffnet
ihn über „Öffnen …“ wie eine Modelldatei. Dabei baut er die Schritte mit denselben
Funktionen nach, die auch beim Anbauen mit der Maus wirken: Kupplungen,
Bohrungsvarianten und Plattenschrauben ergeben sich von selbst, und jeder Schritt
wird auf Baubarkeit geprüft. Passt ein Schritt nicht, nennt der Editor seine
Nummer und den Grund.

Das gespeicherte Modellformat (`qad-construction`) eignet sich nicht zum Schreiben
von Hand oder durch ein LLM, weil es die berechnete Realisierung mit allen Teilen,
Lagen und Drehungen enthält.

## 1. Auftrag an das Sprachmodell

Diesen Abschnitt und den Rest der Datei kann man einem LLM zusammen mit den
Fotos geben.

> Du bekommst ein oder mehrere Fotos eines Baus aus einem Großbaukasten.
> Übertrage ihn in einen Bauplan nach dieser Beschreibung. Gib ausschließlich das
> JSON-Dokument aus, ohne Erläuterungen davor oder danach. Was du nicht sicher
> erkennen kannst, ergänze plausibel und vermerke es in `notes`. Teile, die das
> Format nicht kennt, lässt du weg und nennst sie ebenfalls in `notes`.

## 2. Was auf den Fotos zu sehen ist

GBK-Bauten bestehen aus farbigen Rohren mit 5 cm Durchmesser, die in schwarzen
Kupplungen stecken. Kupplungen gibt man im Bauplan nicht an; welche Kupplung an
einem Punkt sitzt, folgt aus den Rohren, die dort enden. Ein **Punkt** ist der
Mittelpunkt einer Kupplung, oder bei einem offenen Rohrende die Stelle, an der
dort eine Kupplung säße.

Fast alle Rohre laufen genau waagerecht oder senkrecht und rechtwinklig
zueinander. Der Abstand zweier Punkte ist die Rohrlänge plus 5 cm, weil jede
Kupplung 2,5 cm in das Rohr hineinreicht.

### Gerade Rohre

| `part`      | Rohr  | Abstand der Punkte | Hinweis                                                     |
| ----------- | ----- | ------------------ | ----------------------------------------------------------- |
| `tube-35cm` | 35 cm | 40 cm              | mit Abstand das häufigste Rohr; im Zweifel dieses           |
| `tube-15cm` | 15 cm | 20 cm              | halb so großes Feld wie beim 35er, z. B. Stufen und Leitern |
| `tube-75cm` | 75 cm | 80 cm              | so lang wie zwei 35er-Felder                                |
| `tube-25cm` | 25 cm | 30 cm              | selten                                                      |
| `tube-20cm` | 20 cm | 25 cm              | selten                                                      |
| `tube-10cm` | 10 cm | 15 cm              | selten                                                      |
| `tube-52cm` | 52 cm | 57 cm              | selten                                                      |

Längen schätzt man am besten im Vergleich: Ein Feld aus 35er-Rohren ist ein
Quadrat von 40 cm, genau so groß wie eine Platte 40 × 40 cm. Zwei hintereinander gesteckte
Rohre sind zwei Schritte mit einem Punkt dazwischen, nicht ein langes Rohr.

### Bogenrohr

`curved-tube` ist ein Viertelkreisbogen. Es verbindet zwei Punkte, die in der
Anfangsrichtung 40 cm und in der Endrichtung 40 cm auseinanderliegen, also wie
zwei 35er-Rohre über Eck, nur ohne Kupplung in der Ecke.

### Schräges Rohr

Ein gerades Rohr im 45°-Winkel sitzt auf einer **Winkelkupplung**: einem
schwarzen Bauteil, das auf den Arm einer normalen Kupplung gesteckt ist und einen
schrägen Zapfen hat. Schräge Rohre sind selten. Ihr freies Ende liegt nicht im
Raster; dort lässt sich nichts weiter anbauen.

### Platten

Platten liegen in einem Rahmen aus vier geraden Rohren und sind an zwei davon
festgeschraubt. Sie können oben auf einem waagerechten Rahmen liegen (Boden,
Stufe), darunter hängen oder seitlich an einem senkrechten Rahmen sitzen (Wand).

| `part`               | Platte                | passt in einen Rahmen aus |
| -------------------- | --------------------- | ------------------------- |
| `panel-40-40cm`      | Platte 40 × 40 cm     | 35 × 35 cm                |
| `panel-40-20cm`      | Platte 40 × 20 cm     | 35 × 15 cm                |
| `panel-30-30cm`      | Platte 30 × 30 cm     | 25 × 25 cm                |
| `hole-panel-40-40cm` | Lochplatte 40 × 40 cm | 35 × 35 cm, nur als Wand  |

Die Lochplatte hat runde Löcher zum Durchschauen; sie darf nach Hersteller nicht
waagerecht als Boden eingebaut werden.

### Rutschen

Unterstützt ist die **Modularrutsche**, eine gerade Rutsche aus einem oder mehreren
Körpern, unten mit einem **Auslauf**. Ein Körper hängt oben an einem waagerechten
35-cm-Querrohr, etwa der Vorderkante einer Plattform, und reicht von dort
**zwei Etagen (80 cm) tiefer und drei Felder (120 cm) weiter** bis zu einem
gleich liegenden Querrohr, auf dem er unten aufliegt. Dort hängt entweder der
nächste Körper (Doppelrutsche) oder der Auslauf. Unter der Rutsche laufen
meist zwei Bodenschienen aus 35er-Rohren bis zum unteren Querrohr.

| `part`               | Teil                   |
| -------------------- | ---------------------- |
| `modular-slide-body` | Modularrutschen-Körper |
| `curved-slide-body`  | Bogenrutschen-Körper   |
| `slide-runout`       | Rutschenauslauf        |

Auf Fotos erkennt man die Modularrutsche so:

- **Körper:** eine gerade, breite Kunststoffwanne mit hohen Seitenwänden, etwa
  50 cm breit, meist rot. Stöße zwischen zwei Körpern sind als Querfuge mit
  Schrauben an beiden Seiten zu sehen; jeder Abschnitt zwischen Oberkante,
  Fugen und Auslauf ist ein Körper.
- **Auslauf:** das flache, nach oben gebogene Endstück am Boden, meist gelb oder
  dunkelgrau. Es gehört immer dazu, auch wenn es halb verdeckt ist.
- **Oberes Querrohr:** das Rohr an der Vorderkante der Plattform, über das die
  Rutsche oben greift; links und rechts davon stehen die Pfosten, oft mit
  Bogenrohren als Haltegriff darüber. Seine Höhe ergibt sich aus der Zahl der
  Körper: je Körper zwei Etagen (80 cm).
- **Unteres Querrohr:** liegt 120 cm vor dem oberen; bei einem einzelnen Körper
  am Boden am Ende der beiden Bodenschienen, bei einer Doppelrutsche auf einem
  Zwischengestell zwei Etagen hoch.
- **`toward`** ist die Richtung, in die man hinunterrutscht, vom Turm weg.

Passen Höhe und Länge auf dem Foto nicht zu 80 cm je Körper und 120 cm
Abstand, baut man das Gerüst trotzdem nach diesem Maß und vermerkt die
Abweichung in `notes`.

Die Bogenrutsche kennt das Format noch nicht.

### Farben

| `colour`        | Farbe         | Hinweis               |
| --------------- | ------------- | --------------------- |
| `red`           | Rot           | Standard für Rohre    |
| `blue`          | Blau          | Standard für Platten  |
| `green`         | Grün          |                       |
| `yellow`        | Gelb          |                       |
| `pearl-white`   | Pearl White   | neuere Farben ab hier |
| `dark-grey`     | Dark Grey     |                       |
| `dove-blue`     | Dove Blue     | helles Graublau       |
| `moody-blue`    | Moody Blue    | dunkles Blau          |
| `may-green`     | May Green     | helles Grün           |
| `emerald-green` | Emerald Green | dunkles Grün          |
| `bunnys-nose`   | Bunny’s Nose  | Rosa                  |
| `tawny-port`    | Tawny Port    | Weinrot               |

Rohre mit 20 und 52 cm und das Bogenrohr gibt es nur in einem Teil dieser Farben,
den Rutschenkörper in Rot, Dove Blue, May Green und Bunny’s Nose, den Auslauf in
Gelb und Dark Grey. Eine nicht lieferbare Farbe meldet der Editor mit der Liste
der möglichen.

## 3. Richtungen

Man wählt ein Foto als Vorderansicht und legt fest:

- `+x` nach rechts, `-x` nach links,
- `+y` vom Betrachter weg nach hinten, `-y` nach vorn zum Betrachter,
- `+z` nach oben, `-z` nach unten.

Auf den anderen Fotos rechnet man die Richtungen in diese Festlegung um. Eine
schräge Richtung schreibt man aus zwei Achsen zusammen: `"+x+z"` ist 45° nach
rechts oben.

## 4. Aufbau der Datei

```text
{
  "format": "qad-bauplan",       fest
  "version": 1,                  fest
  "name": "Spielhaus",           optional
  "start": "0/0/0",              Name des ersten Punkts
  "steps": [ … ],                Bauschritte in Bauerfolge
  "notes": [ "…" ]               optional: Unsicheres, Weggelassenes
}
```

Der Startpunkt liegt am besten an der vorderen linken unteren Kupplung. Jeder
Schritt geht von einem Punkt aus, der schon gebaut ist: dem Startpunkt oder dem
Ende eines früheren Rohrs.

### Rohrschritt

```text
{
  "kind": "tube",
  "part": "tube-35cm",           Rohr aus der Tabelle in Abschnitt 2
  "from": "0/0/0",               vorhandener Punkt
  "direction": "+x",             Richtung vom Punkt weg; schräg z. B. "+x+z"
  "bend": "+z",                  nur beim Bogenrohr: Richtung am Ende des Bogens
  "to": "40/0/0",                optional: Name des Endpunkts
  "colour": "red"                optional, Standard Rot
}
```

`to` benennt den Endpunkt. Ist der Name neu, heißt der Endpunkt ab jetzt so. Ist
er schon vergeben, muss das Rohr genau dort enden; so schließt man einen Rahmen.
Endet ein Rohr an einem vorhandenen Punkt, muss dessen Name in `to` stehen. Ohne
`to` bleibt der Endpunkt namenlos und offen, etwa für ein frei endendes Rohr.

### Plattenschritt

```text
{
  "kind": "plate",
  "part": "panel-40-40cm",       Platte aus der Tabelle in Abschnitt 2
  "corners": ["0/0/0", "40/0/0", "40/40/0", "0/40/0"],   die vier Rahmenecken, beliebige Reihenfolge
  "side": "+z",                  auf welcher Seite des Rahmens die Platte liegt
  "flanges": "x",                optional: Achse, entlang der die Flansche laufen
  "colour": "blue"               optional, Standard Blau
}
```

`side` zeigt vom Rahmen zur Platte: `+z` ist ein Boden, der oben auf dem Rahmen
liegt, `-z` eine Platte unter dem Rahmen. Bei Wänden zeigt `side` meist nach
außen, z. B. `-y` für eine Wand an der Vorderseite. Liegt in einem Raum ein Boden
innen auf dem unteren Rahmen, sitzen die Wände außen; so stoßen Boden und Wände
nicht aneinander.

Die Flansche sind die umgebogenen Ränder, mit denen die Platte an zwei der vier
Rohre geschraubt ist. Ohne `flanges` wählt der Editor die Lage, die mit
Standardrohren auskommt. Die Halbplatte 40 × 20 kann ihre Flansche an den langen
oder an den kurzen Seiten haben.

Setzstufen einer Treppe sind Halbplatten an den Pfosten unter der Stufenkante.
Liegt die Halbplatte auf der Seite einer waagerechten Platte, die an ihrer
Unterkante anschließt, knickt der Editor dort die Laschen ihrer Flansche um 90°
(Anleitung des Herstellers, 1.4); im Bauplan ist dafür nichts anzugeben.

### Rutschenschritt

```text
{
  "kind": "slide",
  "part": "modular-slide-body",  Rutschenteil aus der Tabelle in Abschnitt 2
  "tube": ["40/0/80", "40/40/80"],   die beiden Enden des Querrohrs, an dem es hängt
  "toward": "+x",                Richtung, in die die Rutsche vom Rohr wegläuft
  "colour": "red"                optional
}
```

Der Auslauf hängt am unteren Querrohr des untersten Körpers, mit derselben
Richtung `toward`. Bei einer Doppelrutsche hängt der zweite Körper am unteren
Querrohr des ersten.

### Loses Bauteil

Steht neben dem Bau ein Teil, das nicht mit ihm verbunden ist, etwa ein zweiter
Turm, beginnt es mit einem eigenen Punkt:

```text
{
  "kind": "point",
  "name": "-240/0/0",            Name des neuen Punkts
  "at": [-240, 0, 0]             Lage in cm, in denselben Richtungen ab dem Startpunkt
}
```

Von diesem Punkt aus baut man das lose Teil wie gewohnt weiter. Man legt es auf
dasselbe 40-cm-Raster wie den Hauptbau, auch wenn es in echt etwas versetzt
steht, und vermerkt das in `notes`. So lässt es sich im Editor später mit
passenden Rohren an den Hauptbau anschließen.

## 5. Vorgehen

1. **Raster erkennen.** Wie viele Felder ist der Bau breit (x), tief (y) und hoch
   (z)? Welche Felder sind 40 cm, welche 20 cm oder 80 cm? Zwei Fotos aus
   verschiedenen Richtungen helfen, verdeckte Rohre zu finden.
2. **Punkte nach ihrer Lage benennen**, in Zentimetern als `x/y/z`, z. B.
   `"40/0/80"`. Dann sieht man jedem Schritt an, ob Richtung und Länge zum
   Endpunkt passen: Von `"40/0/80"` mit `tube-35cm` nach `+y` kommt man zu
   `"40/40/80"`.
3. **Erst ein Gerüst, dann die Schließrohre.** Zuerst jeden Punkt einmal
   erreichen, z. B. den unteren Rahmen und die senkrechten Pfosten. Danach die
   übrigen Rohre zwischen schon vorhandenen Punkten, jeweils mit `to`.
4. **Bogenrohre und schräge Rohre** an ihrem Anfangspunkt anbauen. Ein Bogenrohr
   kann auch an einem vorhandenen Punkt enden (dann mit `to`).
5. **Platten und Rutschen zuletzt**, wenn ihr Rahmen vollständig steht; Rutschen
   von oben nach unten, den Auslauf am Schluss.
6. **Unsicheres in `notes`**, z. B. „Rückseite nicht sichtbar, wie Vorderseite
   angenommen“. Teile, die das Format nicht kennt, ebenfalls: Bogenrutschen, Räder,
   Netze, Stoffe, Acrylglas, Holzgitter, Rohrkappen, Bodenanker, Klammern.

## 6. Beispiele

### Würfel

Ein Würfel aus 35er-Rohren mit Boden, einer Lochplatte als Rückwand und einem
Bogenrohr, das oben rechts vorn nach rechts hinausragt:

```json
{
  "format": "qad-bauplan",
  "version": 1,
  "name": "Würfel mit Boden",
  "start": "0/0/0",
  "steps": [
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/0", "direction": "+x", "to": "40/0/0" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/0", "direction": "+y", "to": "40/40/0" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/0", "direction": "-x", "to": "0/40/0" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/0", "direction": "-y", "to": "0/0/0" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/0", "direction": "+z", "to": "0/0/40", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/0", "direction": "+z", "to": "40/0/40", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/0", "direction": "+z", "to": "40/40/40", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/0", "direction": "+z", "to": "0/40/40", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/40", "direction": "+x", "to": "40/0/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/40", "direction": "+y", "to": "40/40/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/40", "direction": "-x", "to": "0/40/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/40", "direction": "-y", "to": "0/0/40", "colour": "blue" },
    { "kind": "plate", "part": "panel-40-40cm", "corners": ["0/0/0", "40/0/0", "40/40/0", "0/40/0"], "side": "+z" },
    {
      "kind": "plate",
      "part": "hole-panel-40-40cm",
      "corners": ["0/40/0", "40/40/0", "40/40/40", "0/40/40"],
      "side": "+y",
      "colour": "green"
    },
    { "kind": "tube", "part": "curved-tube", "from": "40/0/40", "direction": "+z", "bend": "+x", "colour": "green" }
  ],
  "notes": ["Farbe des Bogenrohrs auf dem Foto nicht sicher erkennbar."]
}
```

### Rutschenturm

Ein Turm aus zwei Etagen mit Boden oben, einer Modularrutsche nach rechts und
gelben Bodenschienen bis zum Auslauf:

```json
{
  "format": "qad-bauplan",
  "version": 1,
  "name": "Rutschenturm",
  "start": "0/0/0",
  "steps": [
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/0", "direction": "+x", "to": "40/0/0", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/0", "direction": "+y", "to": "40/40/0", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/0", "direction": "-x", "to": "0/40/0", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/0", "direction": "-y", "to": "0/0/0", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/0", "direction": "+z", "to": "0/0/40", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/0", "direction": "+z", "to": "40/0/40", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/0", "direction": "+z", "to": "40/40/40", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/0", "direction": "+z", "to": "0/40/40", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/40", "direction": "+x", "to": "40/0/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/40", "direction": "+y", "to": "40/40/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/40", "direction": "-x", "to": "0/40/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/40", "direction": "-y", "to": "0/0/40", "colour": "blue" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/40", "direction": "+z", "to": "0/0/80", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/40", "direction": "+z", "to": "40/0/80", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/40", "direction": "+z", "to": "40/40/80", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/40", "direction": "+z", "to": "0/40/80", "colour": "green" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/0/80", "direction": "+x", "to": "40/0/80", "colour": "red" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/80", "direction": "+y", "to": "40/40/80", "colour": "red" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/80", "direction": "-x", "to": "0/40/80", "colour": "red" },
    { "kind": "tube", "part": "tube-35cm", "from": "0/40/80", "direction": "-y", "to": "0/0/80", "colour": "red" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/0/0", "direction": "+x", "to": "80/0/0", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "80/0/0", "direction": "+x", "to": "120/0/0", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "120/0/0", "direction": "+x", "to": "160/0/0", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "40/40/0", "direction": "+x", "to": "80/40/0", "colour": "yellow" },
    { "kind": "tube", "part": "tube-35cm", "from": "80/40/0", "direction": "+x", "to": "120/40/0", "colour": "yellow" },
    {
      "kind": "tube",
      "part": "tube-35cm",
      "from": "120/40/0",
      "direction": "+x",
      "to": "160/40/0",
      "colour": "yellow"
    },
    { "kind": "tube", "part": "tube-35cm", "from": "160/0/0", "direction": "+y", "to": "160/40/0", "colour": "yellow" },
    { "kind": "plate", "part": "panel-40-40cm", "corners": ["0/0/80", "40/0/80", "40/40/80", "0/40/80"], "side": "+z" },
    { "kind": "slide", "part": "modular-slide-body", "tube": ["40/0/80", "40/40/80"], "toward": "+x", "colour": "red" },
    { "kind": "slide", "part": "slide-runout", "tube": ["160/0/0", "160/40/0"], "toward": "+x", "colour": "yellow" }
  ]
}
```

## 7. Meldungen beim Öffnen

Der Editor baut die Schritte der Reihe nach und hört beim ersten Fehler auf. Die
Meldung beginnt mit der Schrittnummer, gezählt ab 1. Häufige Fälle:

| Meldung                                             | Ursache und Abhilfe                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Punkt „…“ ist noch nicht gebaut.                    | `from` oder eine Ecke nennt einen Punkt, der erst später entsteht; Schritte umordnen.       |
| Das Rohrende trifft Punkt „…“ nicht (… mm daneben). | Eine Rohrlänge auf dem Weg dorthin stimmt nicht; Raster nachzählen.                         |
| Das Rohrende trifft den vorhandenen Punkt „…“.      | Das Rohr schließt einen Rahmen; den vorhandenen Namen in `to` eintragen.                    |
| Am Punkt „…“ ist die Richtung … schon belegt.       | Dort steckt schon ein Rohr; Richtung oder Ausgangspunkt prüfen.                             |
| Zwischen … gibt es keinen freien Rahmen …           | Die vier Ecken bilden keinen Rahmen aus vier Rohren in passender Größe, oder er ist belegt. |
| Auf der Seite … ist kein Platz für die Platte.      | Andere Seite wählen; die Meldung nennt die möglichen.                                       |
| Am Rohr … kann kein Rutschenkörper … hängen.        | Das untere Querrohr fehlt oder liegt nicht 80 cm tiefer und 120 cm weiter.                  |
| Kollision, Ringschluss oder andere Prüfmeldungen    | Der Schritt ist so nicht baubar, etwa weil sich Teile überschneiden.                        |

## 8. Grenzen

- Nur Rohre, Bogenrohre, schräge Rohre auf Winkelkupplungen, die Platten und die
  Modularrutsche aus Abschnitt 2. Kupplungen, Schrauben und Bohrungsvarianten bestimmt der Editor.
- Platten nur in Rahmen aus vier geraden Rohren, nicht an Bogenrohren.
- Am freien Ende eines schrägen Rohrs lässt sich nichts anbauen.
- Der Bauplan wird beim Öffnen in ein Modell übersetzt; gespeichert wird danach
  im Modellformat, unter dem Namen des Bauplans mit „-modell“ angehängt. Die
  Schritte selbst bleiben nicht erhalten.
- Die Einträge aus `notes` zeigt der Editor nach dem Öffnen als Hinweise an.
