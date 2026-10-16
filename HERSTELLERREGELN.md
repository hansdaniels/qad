# Regeln des Herstellers

Status: Auswertung vom 15. Oktober 2026. Ergänzt [SPEC.md](./SPEC.md) und
[BAUBARKEIT.md](./BAUBARKEIT.md). Die Regeln dienen als Hintergrund für Katalog und
Geometrie. Geprüft wird davon nur die Kopffalle (Abschnitt 3), als eigene Funktion neben
der Baubarkeitsprüfung (SPEC 7.4). Die übrigen Konstruktions-
und Sicherheitsregeln, auch offene Rohrenden, werden nicht geprüft.

Quellen:

- Sicherheitsanweisung „Sicherheit“, Version 4.9 (2025),
  `https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf`, im Folgenden
  „Anleitung“ mit Abschnittsnummer.
- QUADRO-Designprogramm 1.3 (2006), ausgewertet wie in [GEOMETRIE.md](./GEOMETRIE.md).
  Die Anleitung von 2025 verweist noch auf dieses Programm.
- Auskunft des Auftraggebers aus eigener Bauerfahrung, im Folgenden „Auskunft“. Danach
  sind die Teile seit 1979 funktional gleich.

## 1. Konstruktion

| Regel                                                                                                                                                     | Quelle                 | Bedeutung für das Modell                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auf jedes Rohr gehören immer zwei Kupplungszapfen; unverbundene oder unverschraubte Rohre und Kupplungszapfen sind nicht erlaubt.                         | Anleitung 1.1          | Ein fertiges Modell hat keine offenen Rohrenden und keine freien Kupplungsarme. Wird nicht geprüft; `findOpenEnds` ermittelt offene Rohrenden, damit der Editor sie hervorhebt. Freie Kupplungsarme entstehen nicht: Die Kupplung ermittelt ihre Arme automatisch aus den angeschlossenen Rohren (Auto-Kupplung), und zu jeder Anordnung gibt es eine exakt passende. |
| Rohrschrauben werden durch eine 90°-Drehung fixiert.                                                                                                      | Anleitung 1.1          | Verschraubung je Rohrende durch Rohrbohrung und Kupplungsarm.                                                                                                                                                                                                                                                                                                         |
| Platten nur belasten, wenn sie an allen vier Seiten mit Rohren verschraubt sind.                                                                          | Anleitung 1.3          | Jede Platte braucht vier erfüllte Befestigungen (SPEC 7.3).                                                                                                                                                                                                                                                                                                           |
| Platten immer um 90° versetzt zueinander einsetzen, damit alle vier Plattenschrauben greifen. An Plattenstellen hält allein die Plattenschraube das Rohr. | Anleitung 1.3          | Die Plattenschraube sitzt in der Bohrung am Rohrende anstelle der Rohrschraube. Zwei Platten am selben Rohrende brauchen zwei Bohrungen; daher die Bohrungsvarianten (Abschnitt 4).                                                                                                                                                                                   |
| Trifft eine waagerechte Platte auf eine senkrechte Halbplatte, wird die Halbplatte an der Perforation um 90° geknickt.                                    | Anleitung 1.4          | Halbplatte hat eine zweite Einbauform.                                                                                                                                                                                                                                                                                                                                |
| Rohr- und Schraubenfarbe stimmen immer überein.                                                                                                           | Anleitung 9.4          | Stückliste: Rohrschrauben in der Farbe des Rohrs.                                                                                                                                                                                                                                                                                                                     |
| Platten liegen von oben oder von unten auf einem Rahmen aus vier Rohren; die Flansche greifen innen an die Rohre.                                         | Auskunft               | Eine Rahmenfläche bietet die Platte auf beiden Seiten an, mit je zwei Flanschrichtungen.                                                                                                                                                                                                                                                                              |
| Bei einer Plattform zeigen die Wandplatten nach außen, der Boden liegt innen.                                                                             | Auskunft               | Die Wandflansche sitzen an den Pfosten; trägt ein Pfosten zwei Wände, braucht er ein 90°-Rohr.                                                                                                                                                                                                                                                                        |
| Senkrechte Stufenteile einer Treppe mit Platten zu verdecken, geht nur mit geknickten Platten (mit Gewalt).                                               | Auskunft               | Eine Wand innen neben einem Boden innen kollidiert; geknickte Platten sind ein späterer Schritt.                                                                                                                                                                                                                                                                      |
| Die Winkelkupplung wird an ihrer Hülse mit einer schwarzen Plattenschraube auf dem Kupplungsarm verschraubt.                                              | Auskunft               | Stückliste: eine schwarze Plattenschraube je Winkelkupplung.                                                                                                                                                                                                                                                                                                          |
| Schrauben bei waagerechten Rohren nach unten, bei senkrechten nach innen.                                                                                 | Anleitung 9.5          | Empfehlung für die Drehstellung freier Rohre.                                                                                                                                                                                                                                                                                                                         |
| Kupplungen dürfen nur rechtwinklig angeschlossen werden.                                                                                                  | Programm, Meldung 4212 | Entspricht den sechs Achsrichtungen (BAUTEILKATALOG 4).                                                                                                                                                                                                                                                                                                               |

## 2. Sicherheit

| Regel                                                                                                                                                                                                                             | Quelle        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Ab 60 cm Höhe müssen Öffnungen mit Innenmaß 35 × 15 cm durch eine Halbplatte 40 × 20 geschlossen werden (Strangulationsgefahr).                                                                                                   | Anleitung 2   |
| Bei einer Plattformhöhe über 60 cm muss das Modell dauerhaft an Wand oder Boden befestigt werden; im Freien mit Bodenverankerung (35-cm-Rohre, 4-armige Raum- und 3-armige Flächenkupplungen an den äußersten Ecken, 35 cm tief). | Anleitung 6.1 |
| Modelle sind bis 100 kg belastbar; Eigenkonstruktionen auf Kippsicherheit prüfen.                                                                                                                                                 | Anleitung 6.2 |
| Abstand von Etage zu Etage höchstens 40 cm.                                                                                                                                                                                       | Anleitung 7   |
| Freie Fallhöhe je nach Boden bis 60, 100, 150 oder 250 cm; über 250 cm unzulässig.                                                                                                                                                | Anleitung 7   |
| Hindernisfreie Zone von 200 cm um das Modell.                                                                                                                                                                                     | Anleitung 8   |

## 3. Prüfungen im Designprogramm

### Kopffalle

Umgesetzt als `findHeadTraps` (SPEC 7.4). Das Programm meldet eine mögliche Kopffalle für zwei gerade Rohre, wenn

1. sie parallel sind (|cos| > 0,99),
2. ihre Achsen 151 bis 299 mm auseinanderliegen (lichte Weite 101 bis 249 mm),
3. sie sich in Längsrichtung um mehr als 149 mm überlappen,
4. mindestens eine Ecke der Öffnung 599 mm oder höher liegt (z nach oben) und
5. keine Steckplatte die Öffnung schließt.

Im 400er-Raster betrifft das Rohrabstände von 200 und 250 mm, also Öffnungen
zwischen 15- bzw. 20-cm-Rohren; 150 und 300 sind nicht betroffen. Das deckt die
Regel der Anleitung (35 × 15 cm ab 60 cm) ab.

### Überschneidungen

Das Programm zeichnet das Modell im OpenGL-Feedback-Modus und schneidet die
Dreiecke paarweise. Die Prüfgeometrie ist die Anzeigegeometrie; eingesteckte
Kupplungsarme werden nicht gezeichnet. Rohr und Kupplung berühren sich dadurch nur
in der Schulterebene, was nicht als Überschneidung zählt. Für BAUBARKEIT Stufe 4
heißt das: Kollisionshüllen ohne eingesteckte Teile machen `allowedOverlap` an
Steckverbindungen weitgehend überflüssig.

### Kupplungswahl

Das Programm legt Kupplungen automatisch an und benennt sie aus der Maske der
belegten Richtungen. Für alle 57 Anordnungen von 2 bis 6 Achsrichtungen ergibt sich
genau die Zuordnung aus [BAUTEILKATALOG.md](./BAUTEILKATALOG.md), Abschnitt 4
(z. B. 3 gerade, 12 Winkel-, 8 Eck-Anordnungen).

## 4. Bohrungsvarianten (Hypothese)

Aus den Abbildungen der Anleitung (Seiten 3 und 22), nicht gemessen:

| Rohr           | Bohrungen je Ende                      | Winkel zwischen den Bohrungen eines Endes |
| -------------- | -------------------------------------- | ----------------------------------------- |
| Standard       | 1, an beiden Enden auf derselben Seite | –                                         |
| 4 Löcher, 180° | 2 (Durchgangsbohrung)                  | 180°                                      |
| 4 Löcher, 90°  | 2                                      | 90°                                       |
| 3 Löcher, 135° | 2 an einem Ende, 1 am anderen          | 135°                                      |

Laut Auskunft liegt die Bohrungsmitte 25 vom Rohrende, der Durchmesser ist 20.
Plattenschrauben nutzen dieselben Bohrungen wie die Rohrschrauben. Offen und am Teil
zu messen bleibt die Lage der Bohrungen beider Enden zueinander bei den Sonderrohren.
