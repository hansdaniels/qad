# Baubarkeitsprüfung

Status: Entwurf, 15. Oktober 2026. Ergänzt [SPEC.md](./SPEC.md), Abschnitte 5 bis 8.
Die Typen stehen in [`packages/model-core/src/buildability.ts`](./packages/model-core/src/buildability.ts).

## 1. Zweck und Abgrenzung

Die Baubarkeitsprüfung beantwortet die Frage: _Lässt sich das so aus den
Katalogteilen zusammenstecken und verschrauben?_ Sie prüft geometrische
Montierbarkeit im Rahmen der Katalogregeln, nicht Statik, Montagereihenfolge oder
Erreichbarkeit von Schrauben (SPEC 2).

Prüfer und Solver sind getrennt:

|          | Solver (`RealizationSolver`)           | Prüfer (`BuildabilityChecker`)             |
| -------- | -------------------------------------- | ------------------------------------------ |
| Eingabe  | Entwurf, Katalog, vorige Realisierung  | Entwurf, **fertige** Realisierung, Katalog |
| Aufgabe  | Teile, Varianten und Stellungen wählen | Gewählte Lösung unabhängig nachrechnen     |
| Ergebnis | Realisierung oder Konflikt             | Bericht mit Urteil und Befunden            |

Der Prüfer ändert nichts. Er vertraut gespeicherten Posen nicht, sondern rechnet
sie aus Anker, Anschlussstellen und Verbindungsregeln nach.

## 2. Schrittweiser Einbau

Im Editor entsteht ein Modell Teil für Teil. Jeder Schritt ist ein `EditCommand`
und durchläuft den Ablauf aus SPEC 8:

```text
Bearbeitung → Solver (betroffener Bereich) → Prüfer (betroffener Bereich)
            → buildable: übernehmen
            → not-buildable / undetermined: ablehnen, alter Stand bleibt
```

Daraus folgt die zentrale Invariante: **Jeder übernommene Modellstand ist baubar.**
Ein Schritt muss deshalb nur prüfen, was er berührt:

| Schritt                                  | Geprüft wird                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Rohr an offenen Verbindungspunkt anbauen | Kupplungswahl und Winkel dort, Kollision des neuen Rohrs und der neuen/gewechselten Kupplung                                         |
| Rohr an bestehenden Punkt anbauen        | wie oben, zusätzlich alle Teile, deren Kupplung gewechselt wurde                                                                     |
| Rohrenden verbinden (Ring schließen)     | Ringschluss über den neuen Ring, dann wie oben                                                                                       |
| Platte einsetzen                         | Lage gegenüber den tragenden Rohren, Bohrungen aller Platten an diesen Rohren, Kollision der Platte                                  |
| Variante oder Drehung fixieren           | Ringe und Platten am betroffenen Rohr, ggf. Kollisionen bei Bogenrohren                                                              |
| Teil entfernen                           | Struktur (keine hängenden Referenzen), zusätzlich Geometrie und Kollisionen aller vom Solver geänderten Teile                        |
| Anker verschieben                        | Lagen aller Teile der Baugruppe neu ableiten; Kollisionen gegen alle übrigen Baugruppen prüfen. Innere Beziehungen bleiben erhalten. |

Zwischenstände sind gültig, solange sie baubar sind: Ein offenes Rohrende, ein
noch nicht geschlossener Rahmen oder ein Rohr ohne Platte sind keine Fehler.

Ein Bearbeitungsschritt übergibt dem Prüfer einen `EditContext` (eigener
Parameter, nicht Teil der Prüfoptionen):

- `affectedParts`: alle im Kandidaten vorhandenen Teile, die durch Bearbeitung
  oder Solver hinzugefügt, ersetzt, bewegt oder in ihren Bedingungen bzw.
  Verbindungen geändert wurden, einschließlich abhängiger Teile, Ringe und
  Plattenbefestigungen. Bei einer Ankerbewegung sind das sämtliche Teile der
  bewegten Baugruppe. Fehlt das Feld, gelten alle Teile als betroffen.
- `addedConnectionIds`: die gegenüber dem gültigen Ausgangszustand neu
  hinzugefügten physischen Verbindungen, einschließlich vom Solver erzeugter
  Ersatzverbindungen. Sie dienen der Wahl der schließenden Kanten (Stufe 2).

Die Strukturprüfung bleibt global, damit auch gelöschte Teile, getrennte
Komponenten und hängende Referenzen erfasst werden. Kollisionskandidaten werden
gegen alle Teile gesucht, nicht nur innerhalb von `affectedParts`. Diese Abdeckung
wird vom Modellkern sichergestellt; eine beliebige Teilmenge genügt nicht als
Nachweis für das Gesamtmodell.

Ohne `EditContext` läuft die Vollprüfung: alle Teile betroffen, keine
zurückgestellten Kanten. So prüft das Laden (Abschnitt 3); auch eine Prüfung auf
Anforderung läuft so. Tests vergleichen die schrittweise Prüfung mit einer
Vollprüfung, der nur dieselben `addedConnectionIds` übergeben werden.

## 3. Laden

Die Invariante aus Abschnitt 2 gilt nur innerhalb einer Sitzung. Eine Datei ist
nicht vertrauenswürdig: Sie kann von Hand bearbeitet, beschädigt oder mit anderen
Toleranzen gespeichert worden sein. `ConstructionCodec.decode` prüft daher das
ganze Modell:

1. Format mit Zod (`parseConstructionDocument`).
2. Katalog-ID und -Version; eine Abweichung wird ohne Migration abgelehnt.
3. Vollprüfung der **gespeicherten** Realisierung. Posen werden neu berechnet
   und mit den gespeicherten verglichen; eine Abweichung ist ein Datenfehler.
4. Nur bei `verdict === 'buildable'` wird übernommen. Bei `not-buildable` oder
   `undetermined` wird nichts übernommen; der Bericht wird angezeigt.

Die gespeicherten Bearbeitungsschritte werden nicht nachgespielt. Die Datei
enthält keine Bearbeitungsgeschichte, eine erfundene Reihenfolge würde
bestimmen, welche Verbindung einen Ring „schließt“, und jeder Schritt würde den
Solver aufrufen, der andere Varianten oder Drehungen als gespeichert wählen
dürfte. Geprüft wird der gespeicherte Zustand, nicht eine Neuberechnung.

Die Vollprüfung durchläuft die Komponenten trotzdem schrittweise ab ihrem Anker
(Abschnitt 5, Stufe 2). Der Aufwand ist linear im Verbindungsgraphen,
n·log n in der Kollisionsprüfung und lokal je Rohr bei den Platten.

Nicht übernommen wird auch stillschweigende Reparatur. Eine spätere Funktion
kann den Solver mit der gespeicherten Realisierung als Vorlage aufrufen und das
Ergebnis als Vorschau zur Bestätigung anbieten; sie gehört zu den unvollständigen
Entwürfen, die SPEC 8 ausdrücklich auf später verschiebt.

## 4. Urteil

```text
buildable       alle Prüfungen bestanden
not-buildable   mindestens ein Fehler
undetermined    kein Fehler nachgewiesen, aber erforderliche Katalogdaten fehlen
```

`undetermined` ist bewusst kein „bestanden“: Fehlende Herstellermaße werden nicht
durch Annahmen ersetzt (SPEC 11). Der Bericht nennt, welche Daten fehlen.
Ein nachgewiesener Fehler hat Vorrang: Auch bei zusätzlich fehlenden Daten lautet
das Urteil dann `not-buildable`. Nur `buildable` erlaubt eine Übernahme, sowohl bei
Bearbeitungen als auch beim Laden. Warnungen allein verhindern dieses Urteil nicht.

## 5. Prüfstufen

Die Stufen laufen in fester Reihenfolge. Eine Stufe läuft nur für die
Zusammenhangskomponenten, deren Voraussetzungen die vorige Stufe erfüllt hat;
andere Komponenten werden weiter geprüft, damit ein Fehler nicht alle übrigen
Befunde verdeckt.

### Stufe 1: Struktur und Referenzen

- Katalog-ID und -Version stimmen mit dem Entwurf überein.
- IDs sind eindeutig; jede Referenz zeigt auf ein existierendes Objekt.
- Jede `AttachmentRef` nennt eine Stelle, die der Teiletyp definiert.
- Die Schnittstellen beider Seiten passen zur `ConnectionType` (Reihenfolge a/b).
- Die Belegung einer Stelle überschreitet nicht ihre `capacity`.
- Parameter parametrischer Verbindungen liegen in ihrem Wertebereich.
- Quaternionen und Richtungen sind normiert, Zahlen endlich.
- Keine doppelten Verbindungen zwischen denselben Stellen, keine zwei Rohre
  zwischen denselben Verbindungspunkten mit gleicher Anschlussrichtung.
- Jede Zusammenhangskomponente besitzt genau einen Anker.

### Stufe 2: Lagen und Ringschlüsse („kommt das Rohr dort an?“)

Die Komponente wird ab ihrem Anker per Breitensuche über Instanz-IDs durchlaufen.
Für eine Verbindung von Stelle `sa` an Teil `A` zu Stelle `sb` an Teil `B` gilt:

```text
T_B = T_A · frame(sa) · bInA · frame(sb)⁻¹
```

Die Kanten des Spannbaums legen die Lagen fest. Jede weitere Kante schließt
genau einen Ring. Für sie wird der Restfehler berechnet:

```text
S_a = T_A · frame(sa)
S_b_expected = S_a · bInA
S_b_actual = T_B · frame(sb)
R = S_b_expected⁻¹ · S_b_actual
```

`R` liegt im erwarteten Rahmen von Stelle b. Für die Zerlegung in den Achsen von
Stelle a werden Translation und Rotation getrennt umgerechnet. Mit `Q` als
Rotationsanteil von `bInA` gilt:

```text
deltaP_a = Q · translation(R)
deltaQ_a = Q · rotation(R) · Q⁻¹
```

`deltaP_a` ist die tatsächliche minus die erwartete Position von Stelle b,
ausgedrückt in den Achsen von Stelle a. Weil die +Z-Achse jeder Stelle vom
eigenen Teil weg zum Gegenstück zeigt (`AttachmentSite.frame`), bedeutet ein
positiver Axialanteil immer, dass Stelle b weiter entfernt liegt als die Regel
verlangt; das gilt unabhängig davon, welche Seite der Regel Rohr oder Muffe ist.
Die erwartete Lage enthält die Einstecktiefe bereits über `bInA`. Es wird kein zusätzlicher Hebelarm aus
einer Konjugation mit der vollständigen Transformation eingeführt. Die Meldung
wird daraus physisch lesbar zerlegt:

| Anteil               | Bedeutung bei einem Rohrende in einer Kupplung                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axial (`deltaP_a.z`) | Abweichung entlang der nach außen gerichteten +Z-Achse von Stelle a: positiv Spalt (nicht vollständig gesteckt), negativ Überdeckung (tiefer als die Regel erlaubt) |
| lateral              | `sqrt(deltaP_a.x² + deltaP_a.y²)`, seitlicher Versatz in mm                                                                                                         |
| Kippwinkel           | Kippanteil von `deltaQ_a` relativ zur lokalen Z-Achse                                                                                                               |
| Verdrehung um `z`    | Verdrehanteil von `deltaQ_a` um die lokale Z-Achse (relevant bei Bogenrohren, Bohrungen)                                                                            |

Liegt einer der Anteile außerhalb der zentralen Toleranz, entsteht
`loop-closure-conflict`. Alle Teile des Rings sind Subjekte; die schließende
Verbindung wird hervorgehoben. Der Spannwald wird zunächst ohne die in
`addedConnectionIds` genannten Kanten gebildet: Komponenten, Startteile und
Breitensuche sind nach IDs geordnet; die Komponente des Ankers wird zuerst besucht.
Danach werden die zurückgestellten Kanten nach ID eingefügt. Verbindet eine solche
Kante noch getrennte Bäume, wird sie Baumkante; andernfalls ist sie eine schließende
Kante. Anschließend werden die Lagen ab dem Anker über den fertigen Spannbaum
berechnet. Ohne `EditContext` (Laden) gibt es keine zurückgestellten Kanten,
und allein die deterministische Breitensuche bestimmt die Baumkanten.

Schließt eine neue Verbindung einen zuvor offenen Weg, ist damit genau diese neue
Kante die schließende Kante. Fügt eine atomare Bearbeitung mehrere Verbindungen
hinzu, bestimmt deren ID-Reihenfolge reproduzierbar die schließenden Kanten. Es
wird keine Bearbeitungsgeschichte aus Teil-IDs oder dem aktuellen Snapshot erraten.

Zusätzlich vergleicht diese Stufe gespeicherte Posen mit den nachgerechneten
(Cache-Abweichung ist ein Datenfehler, kein Baubarkeitsproblem) und die
Realisierung mit dem Entwurf: Rohrendrichtungen im Verbindungspunkt-Rahmen,
fixierte Drehstellungen und Varianten, Plattenlagen.

Hinweise (der Prüfer ändert nichts): Axialfehler entspricht einer anderen
Rohrlänge → `change-tube-family`; Winkelfehler entspricht einem Winkeladapter →
`insert-adapter`; Verdrehung bei Bogenrohr → `change-roll`.

### Stufe 3: Winkel an Verbindungspunkten

Stufe 2 bestätigt, dass die _gewählten_ Teile zusammenpassen. Stufe 3 erklärt,
_warum_ ein Verbindungspunkt keine Realisierung hat. Die gewünschten
Rohrrichtungen eines `JunctionIntent` müssen sich durch eine einzige Drehung auf
paarweise verschiedene Muffen eines Kupplungstyps abbilden lassen, ggf. über
Winkeladapter.

Ist das nicht möglich (`junction-angle-unsupported`), nennt der Befund für die
beste Zuordnung je Rohr die Abweichung zur nächsten Muffe, z. B. „Rohr t7 weicht
12,4° von der nächsten Muffe ab“. Dieselbe Rechnung liefert dem Editor beim
Anbauen die zulässigen Richtungen (SPEC 13.4).

### Stufe 4: Kollisionen und Kreuzungen

- Breitphase: Hüllquader aller Teile in einer Bounding-Volume-Hierarchie.
- Schmalphase über einen `CollisionGeometryProvider`, der Katalog-Schlüssel in
  Primitive auflöst: Kapseln für gerade Rohre, Kapselketten für Bogenrohre,
  konvexe Hüllen für Kupplungen, Quader für Platten.
- Ausgenommen ist nur das `allowedOverlap`-Volumen der jeweiligen Verbindung,
  ausgedrückt im Rahmen von Stelle a. Ein verbundenes Paar ist nicht pauschal
  von der Prüfung befreit.

| Code        | Situation                                                            |
| ----------- | -------------------------------------------------------------------- |
| `crossing`  | Zwei Rohrachsen schneiden sich ohne gemeinsamen Verbindungspunkt     |
| `collision` | Sonstige Durchdringung, mit Eindringtiefe in mm                      |
| `clearance` | Warnung: Abstand kleiner als ein Mindestabstand, keine Durchdringung |

Eine Kreuzung ist typischerweise ein vergessener Verbindungspunkt; der Befund
nennt die Kreuzungsstelle mit Stationen auf beiden Rohren.

### Stufe 5: Platten und Bohrungen

Für jede Plattenbefestigung wird aus Plattenlage, Plattenstelle und
Verbindungsregel die **erforderliche Bohrungslage im Rohr** berechnet:

```text
H_req = T_Rohr⁻¹ · T_Platte · frame(plattenstelle) · bInA⁻¹    (Platte = Seite b)
```

`H_req` wird zerlegt in Station `s` entlang der Mittellinie, Umfangswinkel `φ`
um die Rohrachse und einen Restabstand quer zur Achse. Passt der Restabstand
nicht, stimmt der Rohrabstand nicht zum Lochbild der Platte.

Alle Platten an einem Rohr werden zusammen geprüft (SPEC 7.3). Die Kandidaten
sind Variante (fixiert: nur diese), Drehstellung (Schnittmenge der zulässigen
Drehwerte beider Rohrenden; fixiert oder Bogenrohr: festgelegt) und Wendung
(nur bei gleichwertigen Enden). Eine Bohrung erfüllt eine Befestigung, wenn
Station und Umfangswinkel innerhalb der Toleranz liegen und die Schnittstellen
passen. Die Kandidatenzahl ist klein; vollständige Aufzählung genügt. Der Solver
wählt einen erfüllenden Kandidaten, der Prüfer bestätigt ihn.

Bei geraden Rohren verschieben Variante und Drehung keine anderen Teile. Die
Plattenprüfung ist dann lokal je Rohr, was das Einsetzen einer Platte billig macht.

Findet sich kein Kandidat, ist das ein `plate-mount-conflict`. Der Befund enthält
die erforderlichen Bohrungslagen (`RequiredHole`) aller Befestigungen am Rohr,
damit die Meldung konkret ist: welche Platte, welche Station, welcher Winkel,
und welche vorhandene Bohrung am nächsten liegt.

## 6. Bericht

```text
BuildabilityReport
  verdict
  findings[]          Diagnostic + Messwerte + Hinweise
  missingCatalogData  fehlende Geometrieschlüssel
  stats               Teile, Verbindungen, Ringe, geprüfte Paare
```

Hinweise tragen, wo möglich, fertige `DesignOperation`s, damit der Editor sie
über `ModelCore.preview` als Vorschau zeigen kann.

## 7. Abnahmetests

Mit einem kleinen synthetischen Prüfkatalog:

1. Quadratischer Rahmen, Rohr für Rohr gebaut: jeder Zwischenstand `buildable`;
   beim Schließen ein Ring mit Restfehler 0.
2. Rahmen mit einem um eine Längenstufe zu kurzen Rohr: Schließen wird abgelehnt,
   positiver Axialanteil (Spalt) in mm an der neuen Verbindung, alter Stand bleibt.
   Ein zu langes Rohr liefert denselben Betrag mit negativem Vorzeichen. Beide
   Fälle jeweils mit Rohrende als Seite a und als Seite b der Regel.
3. Rohr in eine Richtung, die keine Kupplung bietet: `junction-angle-unsupported`
   mit Winkelabweichung.
4. Zwei sich kreuzende Rohre ohne Verbindungspunkt: `crossing` mit Stationen.
5. Rohr-Kupplung-Paare innerhalb `allowedOverlap`: keine Kollision; knapp
   außerhalb: `collision` mit Eindringtiefe.
6. Platte passt nur mit gedrehtem Rohr: Solver wählt die Drehung, Prüfer bestätigt.
7. Zweite Platte am selben Rohr ohne gemeinsamen Kandidaten: `plate-mount-conflict`
   mit beiden erforderlichen Bohrungslagen; die erste Platte bleibt unverändert.
8. Rohrabstand passt nicht zum Lochbild: `plate-mount-conflict` mit Restabstand.
9. Fehlende Kollisionsgeometrie: `undetermined` mit Schlüssel in `missingCatalogData`;
   Bearbeitung und Laden werden abgelehnt, auch wenn kein Fehlerbefund vorliegt.
   Bei gleichzeitig nachgewiesenem Fehler lautet das Urteil `not-buildable`.
10. Schrittweise Prüfung und Vollprüfung mit denselben `addedConnectionIds`
    (ohne `affectedParts`) liefern dieselben Befunde in derselben Reihenfolge.
11. Datei mit von Hand verschobener Rohrlage oder gelöschter Verbindung: Laden
    wird abgelehnt, der Bericht nennt die Teile; nichts wird repariert.
12. Laden eines gültigen Modells ändert keine Variante, Drehung oder ID.
13. Eine Baugruppe wird in eine andere verschoben: `collision`, Übernahme abgelehnt,
    bisheriger Anker unverändert. Eine kollisionsfreie Verschiebung bleibt gültig.
14. Ringschluss mit gedrehtem `bInA`, einschließlich nicht paralleler Z-Achsen:
    bekannte axiale und laterale Positionsfehler sowie Kippung und Verdrehung
    werden in den Achsen von Stelle a mit korrektem Vorzeichen gemeldet.
15. Die neue Ringschlusskante hat die kleinste ID und würde in einer gewöhnlichen
    Breitensuche Baumkante werden: Mit `addedConnectionIds` wird trotzdem diese
    Kante als schließend hervorgehoben. Mehrere neue Kanten, darunter Brücken,
    werden deterministisch behandelt.

## 8. Umsetzung

`checkBuildability` in [`packages/model-core/src/buildability-checker.ts`](./packages/model-core/src/buildability-checker.ts)
setzt die Stufen 1 bis 4 um. Festlegungen, die über die Abschnitte oben hinausgehen:

| Thema                      | Festlegung                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toleranzen                 | Standard 1 mm und 1° (`DEFAULT_TOLERANCE`); der Aufrufer übergibt sie.                                                                                                                                                                                                                                                                                                                                                                               |
| Anker                      | Er legt die Lage des primären Teils seines Ziels fest: Rolle `body` bei Rohr und Platte, Rolle `connector` beim Verbindungspunkt. Ein Verbindungspunkt ohne Rohre hat nichts zu platzieren (leerer Anfang einer Sitzung). Hat der Verbindungspunkt keine Kupplung (offenes Ende), ist das Rohr dort das Startteil; seine Stirnseite muss eine Armlänge vor dem Punkt liegen, seine freie Drehung wird übernommen. Von dort wird alles neu berechnet. |
| Verbindungspunkt-Rahmen    | Steht in `intentPoses` und gehört zur gewählten Realisierung. Die Kupplung muss im Punkt sitzen und darin achsparallel gedreht sein (eine der 24 Drehungen).                                                                                                                                                                                                                                                                                         |
| Rohrrichtung               | Das Rohrende im Entwurf zeigt mit +Z ins Rohr, die Anschlussstelle mit +Z hinaus. Bei freier Drehstellung wird nur die Richtung verglichen, bei fester die volle Orientierung.                                                                                                                                                                                                                                                                       |
| Parametrische Verbindungen | Ihr Auswerter kommt über `connectionEvaluators`; fehlt er, ist das fehlendes Katalogdatum (`undetermined`).                                                                                                                                                                                                                                                                                                                                          |
| Gesperrte Baugruppen       | Struktur- oder Ankerfehler sperren die Baugruppe für Stufe 2, ein Befund in Stufe 2 sperrt sie für Stufe 4.                                                                                                                                                                                                                                                                                                                                          |
| Stufe 3                    | Prüft Verbindungspunkte mit mindestens zwei Rohren gegen alle Kupplungstypen des Katalogs; Verbindungspunkte mit Winkeladapter noch nicht.                                                                                                                                                                                                                                                                                                           |
| Stufe 4                    | GJK-Abstand zwischen Kapseln, Quadern und konvexen Hüllen; Eindringtiefe als kleinste Überlappung über 262 Richtungen mit Verfeinerung. Berührung innerhalb der Toleranz ist keine Kollision. `allowedOverlap` wird über Stichprobenpunkte im Überlappungsbereich geprüft. Warnungen `clearance` nur zwischen nicht verbundenen Teilen.                                                                                                              |
| Kreuzung                   | Zwei gerade Rohre, deren Achsen sich innerhalb der Toleranz schneiden, ohne direkte Verbindung; Stationen ab Ende a.                                                                                                                                                                                                                                                                                                                                 |
| Stufe 5                    | Umgesetzt. Die Passung der Plattenschrauben in den Rohrbohrungen prüft der Ringschluss (Stufe 2); Stufe 5 prüft Realisierung, Lage und Pflichtbefestigungen jeder Platte. Bohrungen der Sonderrohre sind Hypothese (HERSTELLERREGELN.md, Abschnitt 4).                                                                                                                                                                                               |
| Hinweise                   | `remedies` bleiben vorerst leer.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GBK-Katalog                | `quadroPartCatalog` ist vorläufig (GEOMETRIE.md). Ein Rohr sitzt mit der Stirnseite an der Armschulter; seine Drehung auf dem Arm ist ein Parameter in 90°-Schritten, bis geklärt ist, wie viele Schraubstellungen es gibt. Kollisionsformen sind Außenhüllen ohne eingesteckte Arme.                                                                                                                                                                |

Die Abnahmetests aus Abschnitt 7 stehen in `packages/model-core/test/buildability.test.mjs` mit einem
synthetischen Katalog (`packages/model-core/test/fixtures.mjs`); 6 bis 8 (Platten) stehen mit dem
GBK-Katalog in `packages/model-core/test/plates.test.mjs`.
`packages/model-core/test/quadro.test.mjs` prüft den vorläufigen GBK-Katalog: 35er-Rahmen, falsches
Rohr im Ring, Bogenrohr als Rahmeneck und Winkelkupplung mit schrägem Rohr.

## 9. Später: Hinweis auf zusätzliche Bohrungen

Passt für eine Platte keine Katalogvariante, könnte der Editor zusätzliche
Schraublöcher vorschlagen. Das ist bewusst nicht Teil dieses Schritts und lässt
sich ohne Umbau nachrüsten:

- Stufe 5 berechnet die erforderlichen Bohrungslagen (`RequiredHole`) ohnehin.
  Ein Vorschlag ist im Wesentlichen diese Liste, umgerechnet auf einen Kandidaten
  aus Variante und Drehung, mit der kleinsten Zahl fehlender Bohrungen.
- Ein _Hinweis_ braucht keine Datenänderung: neue Hinweisart, sonst nichts.
- Erst eine _angenommene_ Nachbohrung ändert das Modell: eine Bohrung am
  `TubeIntent`, ein neues Urteil „baubar mit Nacharbeit“, eine neue
  Schemaversion und Bohrregeln im Katalog (Abstand zu Enden und Bohrungen).

## 10. Offene Punkte

- Zahlenwerte für Toleranzen und Mindestabstände (SPEC 11).
- Kopffallen gehören nicht zur Baubarkeit; sie bekommen später eine eigene
  Prüffunktion (SPEC 9, [HERSTELLERREGELN.md](./HERSTELLERREGELN.md)).
- Ob die Verschraubung die Rohrdrehung auf diskrete Werte festlegt.
- Montierbarkeit starrer geschlossener Ringe (Einfädeln ohne Verformung) bleibt
  außerhalb; der Prüfer garantiert nur die geometrische Konsistenz des Endzustands.
