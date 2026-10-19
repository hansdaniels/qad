# Geometriedaten aus dem QUADRO-Designprogramm

Status: Kandidatenwerte, 15. Oktober 2026. Ergänzt [SPEC.md](./SPEC.md), Abschnitt 11.
Noch nicht am Teil nachgemessen. Als vorläufiger Geometriekatalog umgesetzt in
`packages/model-core/src/quadro-geometry.ts` (`quadroPartCatalog`).

## 1. Quelle und Methode

Quelle ist das QUADRO-Designprogramm 1.3 (2006) des Herstellers,
`https://quadroworld.com/files/apps/QUADRO-Setup-Deutsch.zip`. Es enthält keine
Geometriedateien; die Teile werden im Programmcode aus Konstanten erzeugt.

Das Programm wurde nicht ausgeführt. Seine Zeichenfunktionen wurden in einem
x86-Emulator aufgerufen, die OpenGL-Aufrufe abgefangen und die Eckpunkte in
Teilkoordinaten ausgewertet. Die Konstanten wurden zusätzlich im Maschinencode
nachgelesen; Zeichnung, Anschlussberechnung und Anbaulogik ergeben dieselben
Werte. Einheit im Programm ist mm.

Laut Hersteller sind die Teile seitdem kompatibel geblieben; die Sicherheitsanweisung
von 2025 verweist noch auf das Programm. Das Programm ist ein
Darstellungsmodell: Werte, die es nicht zeichnet (Bohrungen, Wandstärken, Toleranzen),
fehlen, und gezeichnete Werte können vereinfacht sein.

## 2. Raster, Rohr und Kupplung

| Größe                             | Wert                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Außendurchmesser Rohr             | 50                                                                                      |
| Rohr im eigenen Rahmen            | von 25 bis Nennlänge + 25, Ursprung im Kupplungsmittelpunkt                             |
| Abstand der Kupplungsmittelpunkte | Nennlänge + 50, z. B. 35-cm-Rohr → 400                                                  |
| Kupplungskörper                   | Ø 50, reicht in jeder Armrichtung bis 25 (Armschulter)                                  |
| Kupplungsarm (steckt im Rohr)     | von 25 bis 75, außen Ø 41,7, innen Ø 34, an der Spitze auf 5 mm Länge auf Ø 39 angefast |

Alle Raum- und Flächenkupplungen sind im Programm ein Typ mit einer Bitmaske der
belegten Richtungen (Bit 0–5: +x, −x, +y, −y, +z, −z); Körper und Arme sind für alle
gleich.

Der Abstand von 400 für 35-cm-Rohre passt zur Platte 40 × 40 cm, die der Shop für
35-cm-Rohre angibt. Die Preisliste des Programms nennt die Platten entsprechend
„für 35 cm x 35 cm“, „für 15 cm x 35 cm“ und „für 25 cm x 25 cm“.

Das Programm kennt an normalen Kupplungen nur rechte Winkel („Das Rohr trifft nicht
im rechten Winkel auf die Kupplung. Eine Verbindung ist nicht möglich!“), wie das
Modell der sechs Achsrichtungen in [BAUTEILKATALOG.md](./BAUTEILKATALOG.md).

## 3. Winkelkupplung 45°

Die Winkelkupplung wird mit ihrer Hülse wie ein Rohr auf einen Arm einer normalen
Kupplung geschoben. Koordinaten im Rahmen dieses Arms: Ursprung O im
Kupplungsmittelpunkt, +x entlang des Arms nach außen, y in der Ebene des Zapfens.

| Element                                 | Wert                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Hülse                                   | Ø 50, von x = 25 (Armschulter) bis x = 95, bei x = 95 geschlossen       |
| Schnittpunkt P von Arm- und Zapfenachse | x = 108,3, y = 0                                                        |
| Zapfenrichtung                          | 135° zu +x, also (−cos 45°, sin 45°): 45° zur Linie zurück zur Kupplung |
| Zapfen (steckt im schrägen Rohr)        | Ø 42, von 61 bis 111 ab P entlang der Zapfenachse                       |
| Schulter am Zapfenansatz                | Ø 50, 61 ab P                                                           |
| Körper                                  | Ø 50 entlang der Zapfenachse von der Schulter bis zur Ebene x = 95      |
| Seitlicher Versatz aus der Zapfenebene  | keiner                                                                  |

Für das schräge Rohr verhält sich die Winkelkupplung wie eine Kupplung mit dem
gedachten Mittelpunkt **V = P + 36 · Zapfenrichtung = (82,84; 25,46)**. Der Zapfen
liegt dann wie ein normaler Arm bei 25 bis 75 ab V. Das Programm rechnet genau so:
`Armrahmen · Tx(108,3) · Rz(135°) · Tx(36)`; der Anbau in Gegenrichtung verwendet
`Tx(36) · Rx(180°) · Rz(45°) · Tx(−108,3)`.

Die Drehung um die Armachse wählt das Programm nur aus den 24 achsparallelen
Drehungen. Der Zapfen liegt also in einer Ebene, die von der Armachse und einer
weiteren Rasterachse aufgespannt wird. Ob am Teil alle vier 90°-Stellungen
verschraubbar sind, ist offen.

Folgerung für das Raster: Zwei Winkelkupplungen an diagonal gegenüberliegenden
Ecken eines 40er-Quadrats ergeben einen Abstand V–V von 646,8, also ein Rohr von
596,8 mm. Das ist keine Shoplänge. Schräge Rohre schließen im Raster also
nicht ohne Weiteres; das ist nach SPEC 5 zulässig, muss aber im Ringschluss
geprüft werden.

## 4. Bogenrohr

Ein Viertelbogen in einer Ebene. Rahmen: Ursprung in der Kupplung an Ende a,
+x entlang des Rohrs an Ende a, y in der Biegeebene.

| Element            | Wert                                               |
| ------------------ | -------------------------------------------------- |
| Gerades Ende a     | x = 25 bis 75 auf y = 0                            |
| Bogen              | Mittellinienradius 325, Mittelpunkt (75; 325), 90° |
| Gerades Ende b     | y = 325 bis 375 auf x = 400                        |
| Kupplung an Ende b | (400; 400), Rohr verlässt sie in −y                |
| Mittellinienlänge  | 2 · 50 + π/2 · 325 ≈ 610,5                         |

Das Bogenrohr verbindet also zwei Kupplungen, die in zwei Rasterrichtungen je 400
auseinanderliegen, mit rechtwinklig ankommenden Enden. Die geraden Enden sind genau
so lang wie ein Kupplungsarm. Das Programm kennt nur diese eine Größe. Die
Biegeebene enthält beide Rohrenden; eine Drehung um ein Ende dreht die Ebene mit
(SPEC 7.2).

## 5. Platten

Rahmen: Ursprung in der Mitte zwischen den vier Kupplungen, z = 0 in der Ebene der
Rohrachsen, Platte oberhalb.

| Element      | Wert                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Außenmaß     | Rastermaß, also Nennlänge + 50 je Seite: 400 × 400, 200 × 400, 300 × 300                                                                               |
| Ecken        | gerundet, Radius ≈ 25; ausgespart um den Kupplungsmittelpunkt, sodass senkrechte Rohre Platz haben (Auskunft); im Modell ein Quadrat von 25,12 je Ecke |
| Oberseite    | z = 25,12, liegt auf den Rohren auf                                                                                                                    |
| Flansche     | an den beiden Kanten entlang der ersten Plattenabmessung, innen an den Rohren (Abstand zur Rohrachse 25,12), bis z = −22                               |
| Bohrungen    | je zwei in jedem Flansch, auf Höhe der Rohrachse (z = 0), 50 vom Kupplungsmittelpunkt, also 25 vom Rohrende; Ø 20                                      |
| Flanschlänge | endet eine Plattendicke vor den querliegenden Rohren (Annahme, damit Wand außen und Boden innen zusammenpassen)                                        |
| Dicke        | vorläufig 3 für Platte und Flansche, nicht gemessen                                                                                                    |

Damit entsprechen die Shopnamen (40 × 40, 40 × 20, 30 × 30 cm) dem Außenmaß.

Die Halbplatte 40 × 20 gibt es im Modell in zwei Lagen: Flansche an den langen
Seiten (Zelle 400 × 200) oder an den kurzen (Zelle 200 × 400, Auskunft). In der
zweiten Lage kann an jedem Flanschende eine Lasche um 90° geknickt sein
(Anleitung des Herstellers, 1.4). Dann steht die Platte auf der waagerechten
Platte darunter:

| Element      | Wert                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Plattenkante | endet an der geknickten Seite gerade, 28,12 von der Rohrachse (Oberseite der waagerechten Platte)           |
| Lasche       | 20 lang, flach auf der waagerechten Platte, vom Flansch nach innen; Tiefe wie der Flansch (z = −22 … 25,12) |
| Markierung   | Strich quer über die ganze Platte an der geraden Kante, auf der Sichtseite (nur Darstellung)                |

Die Lasche ist aus der Abbildung der Anleitung geschätzt, nicht gemessen. Die
Laschen im ungeknickten Zustand stellt das Modell nicht dar.
Bohrungen und Plattenschrauben stellt das Programm nicht dar. Die Bohrungen sind
Auskunft des Auftraggebers: Seit 1979 sind die Teile funktional gleich, jede Platte
hat zwei Flansche mit je zwei Schrauben. Die Plattenschrauben sitzen an denselben
Stellen wie die Rohrschrauben zwischen Rohr und Kupplungsarm; statt bündig mit der
Rohraußenfläche abzuschließen, halten sie den Flansch der Platte. Die Bohrung im
Flansch liegt deshalb genau über der Rohrbohrung am Rohrende.

Ein Rohr trägt an jedem Ende eine Bohrung (Ø 20, Mitte 25 vom Rohrende, Auskunft);
die Lage der Bohrungen der Sonderrohre ist die Hypothese aus
[HERSTELLERREGELN.md](./HERSTELLERREGELN.md), Abschnitt 4. Im Modell sitzt die
Rohrbohrung als Anschlussstelle auf der Rohrachse, +Z zeigt radial durch die Bohrung
nach außen; die Plattenstelle sitzt am selben Punkt mit +Z zum Rohr hin.

## 6. Weitere Kupplungen und Zubehör

| Teil                              | Programm             | Geometrie                                                                                                                                                                          |
| --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flexikupplung                     | „1 Arm ohne Bolzen“  | Zwei Gelenkaugen Ø 50 mit Bohrung Ø 42, je 12,5 breit, bei −25…−12,5 und 0…12,5 auf der Gelenkachse x; ein Kupplungsarm senkrecht dazu (25 bis 75)                                 |
| Flexibolzen 15 cm                 | Länge als Parameter  | Rohr Ø 41,7/Ø 34 von −75 bis 75 auf der Gelenkachse. Er trägt die Gelenkaugen im Bereich ±25; seine Enden stecken wie Kupplungsarme in den anschließenden Rohren                   |
| Lagerkupplung                     |                      | Ring um ein durchlaufendes Rohr: Bohrung Ø 50,1, außen Ø 57, 50 breit. Radialer Stutzen Ø 50 bis 78 von der Ringachse; gedachter Kupplungsmittelpunkt für das radiale Rohr bei 103 |
| Doppelrohrverbinder               |                      | Zwei Halbschalen um zwei parallele, sich berührende Rohre (Achsabstand 50), Wand 3, 50 breit                                                                                       |
| Rohrklammer                       | „Pool / Zelt“        | C-förmige Klammer um ein Rohr (innen Ø 50, Wand ≈ 4, 50 breit) mit einer Lippe bis ≈ 69 von der Rohrachse                                                                          |
| Rohrkappe                         |                      | Kopf Ø 50, 4 dick, außen auf dem Rohrende; Stopfen Ø 41,7/Ø 34, 20 tief im Rohr                                                                                                    |
| Lochkupplung / Lochzapfenkupplung | Untertyp je Variante | Gezeichnet nur ein Zapfen Ø 42 von −25 bis 25 mit Schultern Ø 50; Zuordnung zu den heutigen Varianten 00841/00843 unklar                                                           |

Bei der Flexikupplung ergibt sich: Gelenkachse durch den gedachten
Kupplungsmittelpunkt, Rohre am Bolzen wie an einer geraden Kupplung (Abstand 25 zur
Schulter), Drehwinkel um den Bolzen frei. Zwei Flexikupplungen greifen mit
versetzten Augen ineinander.

## 7. Rutschen

Bogenrutsche (alt 10023, heute Körper 10027) und Rutschenauslauf (10034, gleiche
Nummer) sind im Programm quadratische NURBS-Flächen; die Kontrollpunkte liegen vor.
Befestigungspunkte zeichnet das Programm als Schraubköpfe:

| Teil         | Befestigungspunkte (x, y, z)                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Bogenrutsche | (±228; 140; 0) seitlich, (±140; 0; −29) unten, (600; −660; 371) und (600; −660; 829) am anderen Ende |
| Auslauf      | Fläche über ±225 in x; liegt auf Rohren bei z = 0 und z = 400                                        |

Die gerade Rutsche des Programms (alt 10015) ließ sich nicht emulieren und ist
ohnehin der Vorgänger der heutigen Modularrutsche.

Bogenrutsche und Auslauf übernimmt das Modell als Flächen (`quadro-slide-surfaces.ts`),
gedreht in den Rahmen der Rutsche: Ursprung auf der Achse des Rohrs, an dem sie
hängt, x vom Rohr weg, y quer, z nach oben (Programm: x quer, y oben, z vom Rohr
weg; rechtshändig wie OpenGL). Die Gewichte gelten für euklidische Punkte; so
legt sich der Haken am Einstieg um das Rohr.

| Teil         | Ergebnis                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bogenrutsche | U-Profil 400 breit innen, Wände 190 hoch. Hakt über das Aufhängerohr, dreht beim Hinunterrutschen um 90° nach links und liegt 800 tiefer, 600 weiter und 600 links auf einem Rohr quer zum Aufhängerohr auf (Boden 30 über dessen Achse). Passt zu Abb. 3 und 4 in Sicherheitsanweisung 1.21 und zum Turm aus zwei Etagen |
| Auslauf      | Hakt über sein Rohr (Boden 26 über der Achse) und liegt 400 weiter auf einem parallelen Rohr auf; 453 lang                                                                                                                                                                                                                |

Die Bogenrutsche ist ein Teil mit fester Drehrichtung. Die Sicherheitsanweisung
(1.21) baut ihren Unterbau mit Sonderlängen (25, 20, 10, 15 cm) und einem
135°-Rohr; im Modell genügt ein 35-cm-Rohr an der Auflagestelle. Schrauben: zwei
Plattenschrauben oben, zwei konische an den Seiten, zwei Rutschenschrauben am
Auslauf, wie im Programm gezeichnet und im Bogenrutschen-Schraubenset des
Herstellers.

Für die Modularrutsche gilt vorläufig (`SLIDE` in `quadro-geometry.ts`, Fläche in `quadro-slide-surfaces.ts`):

| Größe                           | Wert                                                                                                                                                                                                                                         | Quelle                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Gefälle und Länge eines Körpers | 800 mm tiefer, 1200 mm weiter, jeweils zwischen den Achsen der beiden Querrohre                                                                                                                                                              | Auskunft                                  |
| Aufhängung                      | Mitte eines 35-cm-Querrohrs, Körper zwischen den Pfosten an dessen Enden                                                                                                                                                                     | Sicherheitsanweisung 1.20 und 1.24        |
| Form                            | Profil des Auslaufs (innen 400 breit, Wände 145 hoch über dem Boden); hakt über das obere Querrohr wie der Auslauf, Boden flach bis 150, gerades Gefälle bis 1050, flach 30 über dem unteren Querrohr, Rand liegt auf dem Boden des Auslaufs | nachgebildet aus Auslauf und Bogenrutsche |
| Kollision                       | Hüllen entlang der Fläche ab 44 vor dem oberen Querrohr bis zum Auslauf                                                                                                                                                                      | wie bei der Bogenrutsche                  |

Nachzumessen sind Breite, Wandhöhe und Verlauf der Gleitfläche. Der Auslauf
hat inzwischen die Form aus dem Programm (siehe oben).

## 8. Nicht im Programm

- Bohrungsmuster der Rohre und Bohrungsvarianten (90°, 135°, 180°); eine Hypothese
  aus den Abbildungen der Anleitung steht in [HERSTELLERREGELN.md](./HERSTELLERREGELN.md), Abschnitt 4.
  Abstand und Durchmesser der Rohrbohrung sind Auskunft (Abschnitt 5).
- Schrauben.
- Bodenverankerung, Acrylglas, Holzgitter und ihre Halteplatten, Lochplatte,
  Modularrutsche.
- Lochmuster der Lochplatte: 3 × 3 runde Löcher im Quadratraster, Abstand etwa
  107 mm, Durchmesser etwa 57 mm. Geschätzt aus der aktuellen Produktabbildung des
  Herstellers im Verhältnis zur Plattenbreite, nicht gemessen. Ältere Fotos zeigen
  ein anderes, versetztes Muster mit kleineren Löchern. Das Muster dient nur der
  Darstellung; für Kollisionen gilt die Lochplatte als geschlossen.

## 8a. Darstellung

Nur für die Anzeige, ohne Einfluss auf Kollisionen (`quadroDisplayGeometry`):
Rohre sind hohl mit Innendurchmesser 42 mm, geschätzt aus dem Kupplungsarm (Ø 41,7),
der hineinpasst. Der Kupplungskörper ist bündig mit den Rohren und nach außen gewölbt: die
konvexe Hülle einer Kugel Ø 50 in der Mitte und der Ränder Ø 50 an den Schultern
aller Arme; gegenüberliegende Arme ergeben einen durchgehenden Zylinder. Bogenrohre sind ein Ringstück
zwischen zwei hohlen geraden Enden. Die Winkelkupplung besteht aus geschlossener
Hülse und Körper als Zylinder. Platten haben an den Ecken viertelkreisförmige Aussparungen
mit 25 mm Radius um den Kupplungsmittelpunkt; für Kollisionen bleiben sie eckig.
Auf der Oberseite jeder Platte zeigt je ein Strich über jedem Flansch, von
Schraube zu Schraube und 15 mm innen neben dem Flansch, wie die Platte
verschraubt ist; die echten Platten tragen solche Markierungen (Sicherheitsanweisung
1.3). Der Editor zeichnet sie dunkel auf hellen und hell auf dunklen Platten.

## 9. Offen

- Nachmessen der Werte aus Abschnitt 3 an einer Winkelkupplung (00911), außerdem
  stichprobenartig Rohrdurchmesser, Armlänge und Bogenradius.
- Lage der Schraubbohrungen an Hülse, Arm und Zapfen; zulässige Drehstellungen
  der Hülse auf dem Arm.
- Einstecktiefen: Das Programm setzt Rohrende = Armschulter; ob ein Spalt bleibt,
  zeigt es nicht.
- Bohrungsmuster der Rohre: Quelle fehlt, am Teil messen oder beim Hersteller anfragen.
