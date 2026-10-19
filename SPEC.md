# GBK-Modellierungsprogramm

Status: Entwurf auf Grundlage der bisherigen Fachentscheidungen, 15. Oktober 2026.

## 1. Ziel und Bedienprinzip

Das Programm dient zum Entwerfen von Konstruktionen aus einem Großbaukasten (GBK) aus Rohren, Kupplungen und Platten. Es ist ein CAD-Editor mit festen Bauteilgeometrien und Einrastmöglichkeiten.

Beim Zeichnen eines Rohrgerüsts muss der Benutzer keine normalen Kupplungen auswählen. Er setzt Rohre und bestimmt ihre Beziehungen zueinander. Das Programm ermittelt passende Kupplungen, nötige Zwischenstücke und geeignete Bohrungsvarianten automatisch.

Ein bestehender Verbindungspunkt kann um weitere Rohre ergänzt werden. Die erforderliche Kupplung darf sich dabei ändern, ohne die Identität der Verbindung oder bereits angeschlossener Rohre zu verlieren.

Einrasten erfolgt anhand gültiger Bauteilanschlüsse und daraus berechneter Platzierungsvorschläge. Ein sichtbares Raster unterstützt die Bedienung, ist aber keine globale Einschränkung sämtlicher Bauteilpositionen.

## 2. Geltungsbereich der ersten Umsetzung

Enthalten sind:

- Gerade Rohre in den für erste Modelle benötigten Längen.
- Automatische Auswahl normaler Flächen- und Raumkupplungen.
- Geschlossene Rohrgerüste mit eindeutigen Teilidentitäten.
- Mindestens eine Standardplatte einschließlich automatischer Wahl geeigneter Rohrbohrungen.
- Mindestens eine Winkelkupplung als Zwischenstück und ein Bogenrohr als Prüfung des allgemeinen Geometriemodells.
- Darstellung automatisch gewählter Sondervarianten und geometrischer Konflikte.
- Speichern und Laden von Entwurf und zugehöriger Realisierung.

Die konkrete Teileauswahl und deren Geometrie werden im Katalog festgelegt. Ein kleiner, geometrisch geprüfter Katalog genügt für den Anfang.

Die Prüfung betrifft geometrische Montierbarkeit im Rahmen der hinterlegten Regeln. Tragfähigkeit, Materialverformung, Montageschritte und Erreichbarkeit von Schrauben sind zunächst nicht abgedeckt. Sicherheitsregeln des Herstellers (Verankerung, Etagenabstand, Fallhöhe) und eine Prüfung auf offene Rohrenden sind nicht vorgesehen; mögliche Kopffallen meldet eine eigene Funktion neben der Baubarkeitsprüfung (Abschnitt 7.4). Ein geometrisch gültiges Modell ist damit noch keine statisch oder hinsichtlich aller Herstellervorgaben geprüfte Konstruktion.

## 3. Zwei fachliche Ebenen

### 3.1 Entwurf

Der Entwurf enthält die vom Benutzer gewünschten Rohre, Verbindungspunkte, Platten und relativen Anordnungen. Er beschreibt die Konstruktion unabhängig davon, welche gewöhnliche Kupplung aktuell erforderlich ist.

Ein Entwurfs-Verbindungspunkt ist eine logische Verbindungsstelle. Er ist nicht zwingend der gemeinsame räumliche Schnittpunkt aller physischen Anschlüsse. Seine Realisierung kann aus mehreren Teilen bestehen.

### 3.2 Physische Realisierung

Die Realisierung enthält konkrete Bauteilinstanzen mit IDs und Verbindungen zwischen ihren Befestigungsstellen. Sie wird aus dem Entwurf und dem Teilekatalog ermittelt.

Beispiel:

```text
Entwurf:              gerades Rohr — schräge Verbindung — gerades Rohr
Physische Realisierung: Rohr — Raumkupplung — Winkelkupplung — Rohr
```

Die Realisierung bestimmt die tatsächlichen Anschlusslagen und Bauteilpositionen. Benötigte Versätze dürfen nicht durch das Zusammenziehen mehrerer Anschlüsse auf einen gedachten Punkt verschwinden.

Für automatisch erzeugte Teile werden stabile Zuordnungen zum Entwurf geführt. Unveränderte physische Teile behalten ihre IDs. Ein Teiletypwechsel ist nachvollziehbar und ersetzt keine referenzierte Entwurfsidentität.

## 4. Fachliches Datenmodell

Die folgenden Strukturen beschreiben fachliche Anforderungen, noch kein verbindliches Implementierungs- oder Dateiformat.

### 4.1 Teilekatalog

Ein `PartType` beschreibt einen Bauteiltyp:

- Stabile Typkennung und gegebenenfalls Hersteller-Artikelnummer.
- Kategorie, etwa Rohr, Kupplung, Platte oder Adapter.
- Geometrie zur Darstellung und zur Kollisionsprüfung.
- Befestigungsstellen in einem lokalen Koordinatensystem.
- Kompatibilitätsregeln und zulässige Verbindungsstellungen.
- Bei Rohren: Form, Längenfamilie und Bohrungsmuster.
- Bei Varianten: Merkmale, die automatisch gewechselt werden dürfen.

Eine `AttachmentSite` besitzt eine innerhalb des Typs stabile Kennung, eine lokale Position und eine lokale Orientierung. Sie kann ein Rohrende, eine Bohrung oder eine andere definierte Montageposition beschreiben. Neue Arten seitlicher Befestigungen müssen ergänzbar bleiben.

Die Anschlussgeometrie berücksichtigt Einstecktiefen und tatsächliche montierte Abstände. Nennlänge, sichtbare Rohrlänge und Abstand zwischen konstruktiven Bezugspunkten dürfen nicht gleichgesetzt werden.

Katalogversionen sind identifizierbar. Ein gespeichertes Modell muss die verwendete Geometrieversion benennen, damit eine Katalogänderung seine Form nicht unbemerkt verändert.

### 4.2 Entwurfsobjekte und Identität

| Objekt            | Inhalt                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `TubeIntent`      | Stabile Rohr-ID, Form-/Längenfamilie, Beziehungen seiner Enden, Farbe und Variantenwahlregel                  |
| `JunctionIntent`  | Stabile Verbindungspunkt-ID und die dort gewünschten Anschlussbeziehungen                                     |
| `PlateIntent`     | Stabile Platten-ID, Typfamilie, gewünschte Lage relativ zu den tragenden Rohren und Befestigungsanforderungen |
| `PlacementAnchor` | Äußere Position und Orientierung einer zusammenhängenden Baugruppe                                            |

Rohre referenzieren bestehende Verbindungspunkte über IDs. Beim Schließen einer Konstruktion wird der vorhandene Punkt wiederverwendet. Objektgraphen werden über Referenzen gespeichert, nicht durch rekursives Einbetten ganzer Objekte.

IDs sichern Identität. Zusätzliche fachliche Regeln verhindern, dass dieselbe Verbindung versehentlich doppelt angelegt wird. Räumliche Nähe allein vereinigt keine Objekte; das erfolgt durch eine bestätigte Einrast- oder Verbindungsoperation.

### 4.3 Relative Geometrie

Die Topologie allein bestimmt die Form nicht. Der Entwurf speichert deshalb auch die gewählten relativen Anschlussrichtungen und, wo erforderlich, Drehstellungen oder lokale Bezugssysteme.

Diese Angaben reichen zusammen mit der gewählten Realisierung zur Bestimmung der Geometrie. Eine Richtungsangabe allein reicht nicht, wenn die Drehung um diese Richtung weitere Teile räumlich versetzt.

Für eine vollständig bestimmte zusammenhängende Baugruppe genügt ein äußerer Anker mit Position und Orientierung. Noch offene Freiheitsgrade werden ausdrücklich als solche geführt oder durch eine zulässige Standardwahl belegt. Sie dürfen nicht stillschweigend als feste fachliche Vorgaben gespeichert werden.

### 4.4 Physische Bauteile und Verbindungen

```ts
type PartInstance = {
  id: string;
  typeId: string;
};

type AttachmentRef = {
  partId: string;
  siteId: string;
};

type Connection = {
  id: string;
  a: AttachmentRef;
  b: AttachmentRef;
  connectionTypeId: string;
  // Bei Bedarf: zulässige Drehstellung oder Gelenkparameter.
};
```

Alle Bauteile, einschließlich gewöhnlicher Kupplungen, Winkelkupplungen und Bogenrohre, besitzen eigene Instanz-IDs. Es gibt keine Regel, dass sich Rohre und Kupplungen im Graphen abwechseln müssen.

Mehrere Rohre können unterschiedliche Anschlüsse derselben Kupplungsinstanz referenzieren. Rückwärtsindizes werden berechnet; beide Referenzrichtungen müssen nicht unabhängig gepflegt werden.

Eine einzelne Bohrung benötigt zunächst keine eigene Instanz-ID. `partId` und die im Typ definierte `siteId` identifizieren sie gemeinsam.

## 5. Positionen und Berechnung

Die Lage eines physischen Bauteils ist eine vollständige räumliche Transformation: Position plus Orientierung, intern beispielsweise als Quaternion und Translation.

Von einem Baugruppenanker aus werden weitere Lagen anhand lokaler Befestigungsstellen und ihrer Verbindungsregeln berechnet. Bei starren Verbindungen wird die zulässige relative Transformation angewandt. Nicht bestimmte Drehstellungen werden bei der Lösungsfindung berücksichtigt.

Berechnete absolute Bauteilpositionen sind abgeleitete Daten. Sie können für Darstellung und schnelles Laden zwischengespeichert werden. Sie sind nicht unabhängig von den Beziehungen editierbar und werden bei Änderungen neu geprüft.

Für geschlossene Wege gilt: Wird ein bereits positioniertes Teil auf einem weiteren Weg erreicht, müssen Position und Orientierung innerhalb definierter Toleranzen übereinstimmen. Andernfalls liegt ein Konflikt vor. Der Berechnungsdurchlauf besucht Instanzen anhand ihrer IDs und erzeugt beim erneuten Erreichen keine Kopien.

Schrägen dürfen außerhalb eines globalen ganzzahligen Rasters liegen. Numerische Toleranzen werden zentral für Längen und Winkel festgelegt. Wiederholtes Runden auf Rasterpunkte ist keine Lösung für geometrische Widersprüche.

## 6. Automatische Teilewahl

Die Realisierung ermittelt gemeinsam:

- Passende normale Kupplungen für die gewünschten Anschlussrichtungen.
- Benötigte Winkeladapter und ihre Orientierung.
- Geeignete Rohrvarianten und noch wählbare Rohrdrehungen.
- Kompatible Befestigungsstellen für Platten.

Lokale Entscheidungen müssen gegen den betroffenen Gesamtaufbau geprüft werden. Eine passende Kupplung an einem Punkt garantiert noch keinen geschlossenen Rahmen; eine passende Bohrung für eine Platte garantiert noch nicht die Befestigung aller weiteren Platten am selben Rohr.

Nicht jede Bohrungsvariante ist in jeder Farbe erhältlich. Die gewünschte Farbe ist deshalb nur eine Präferenz und schließt keine Variante aus: Ist die gewählte Variante in dieser Farbe nicht erhältlich, wird sie in der Standardfarbe realisiert: Rohre Rot, Platten Blau, Kupplungen Schwarz (siehe [Bauteilkatalog](./BAUTEILKATALOG.md), Abschnitt 5).

Unter mehreren gültigen Lösungen werden bestehende Teile und Varianten möglichst beibehalten. Erst danach greifen dokumentierte Standardpräferenzen. Die Auswahl soll reproduzierbar sein.

Die erste Umsetzung (`packages/model-core/src/solver.ts`) arbeitet so:

- Alle Verbindungspunkte einer Baugruppe übernehmen die Orientierung ihres Ankers; die Rohrrichtungen sind darin achsparallel.
- Je Verbindungspunkt mit mindestens zwei Rohren wird die Kupplung mit genau passender Armzahl und eine der 24 achsparallelen Drehungen gewählt; die bisherige Wahl bleibt, solange sie passt.
- Lagen werden vom Anker aus über die Verbindungsregeln berechnet, Drehstellungen aus deren Wertebereich gewählt, bisherige bevorzugt. Ein Ring, der einen bereits platzierten Punkt verfehlt, ist ein Konflikt.
- Ein offenes Rohrende hat keine Kupplung; sein Verbindungspunkt liegt eine Armlänge vor der Stirnseite.
- Teile behalten ihre ID über Herkunft und Rolle; neue IDs sind `tube:<id>/body` und `junction:<id>/connector`.
- Ein Rohrende auf einer 45°-Diagonale zwischen zwei Achsen erhält eine Winkelkupplung auf einem freien Arm der Auto-Kupplung (Rolle `angle-adapter:<Rohr>:<Ende>`). Jede Diagonale ist über zwei Arme erreichbar. Das Rohrende kann den Arm ausdrücklich nennen (`adapterArm`, so setzt es der Editor); sonst bleibt der bisherige Arm, und erst danach gilt der erste freie in fester Reihenfolge (+x, −x, +y, −y, +z, −z). Ein Ring, der nur mit dem anderen Arm schließt, wird ohne Angabe noch als Konflikt gemeldet.
- Andere Winkel und Platten realisiert die erste Umsetzung nicht; sie führen zu einem Konflikt.

Der Benutzer kann eine Variante fixieren. Dann ist sie eine Bedingung der Lösungsfindung. Kann der Aufbau damit nicht realisiert werden, wird ein Konflikt gemeldet; die Fixierung wird nicht stillschweigend aufgehoben.

## 7. Besondere Bauteilregeln

### 7.1 Winkelkupplungen

Winkelkupplungen können zwischen einer gewöhnlichen Kupplung und einem schrägen Rohr sitzen. Sie sind eigenständige Bauteile mit mehreren lokalen Anschlusslagen. Winkel und räumlicher Versatz stammen aus dem Katalog.

Am freien Ende eines schrägen Rohrs, das der Editor anbaut, steckt das Rohr direkt in einer gewöhnlichen Kupplung, die um 45° mitgekippt ist, wie am First oder an der oberen Dachkante eines Pultdachs. Der Verbindungspunkt speichert diese Neigung gegenüber dem Raster seiner Baugruppe (`tilt`); Rohre, die dort weiter angebaut werden, geben sie an ihre neuen Verbindungspunkte weiter. Trifft das Schrägrohr dort auf eine vorhandene Kupplung, deren Arme in dieselben Richtungen zeigen, steckt es in ihr; so treffen sich zwei von den Traufen angebaute Dachschrägen in einer Kupplung am First. So entstehen gekippte Rahmen, die als Ring schließen und Platten tragen. Ein Rohrende verbindet sich nur mit einem vorhandenen Verbindungspunkt, dessen Arme in dieselben Richtungen zeigen; um Vierteldrehungen verdreht darf er sein, etwa am First zweier spiegelbildlich gebauter Dachbinder.

### 7.2 Bogenrohre

Ein Bogenrohr ist ein einzelnes Rohr mit einer ID und eigenen Endanschlüssen. Es kann geometrisch einer Folge aus zwei geraden Rohren und einer Ecke ähneln, bleibt jedoch ein Teil in Auswahl, Bestand und Stückliste.

Ein gedachter Eckpunkt ist kein verfügbarer Anschluss. Die Biegeebene ist geometrisch relevant: Eine Drehung am ersten Ende verändert die Lage des zweiten Endes. Eine solche Drehung darf nicht ausschließlich zur Anpassung von Bohrungen vorgenommen werden, ohne den übrigen Aufbau zu prüfen.

### 7.3 Platten und Rohrbohrungen

Platten werden relativ zu den tragenden parallelen Rohren und den benötigten Montagepositionen beschrieben. Ihr Typ legt die vollständige Befestigungsgeometrie fest.

Das Bohrungsmuster eines Rohrtyps beschreibt Position und Richtung der einzelnen Bohrungen einschließlich der um 90° wechselnden Ausrichtungen und vorhandener Sondervarianten.

Eine Platte schränkt sowohl die zulässige Rohrvariante als auch die zulässige Rohrdrehung ein. Alle Platten an einem Rohr müssen gleichzeitig montierbar sein.

Ohne entsprechende Befestigungsanforderung ist die Bohrungsausrichtung fachlich unerheblich, soweit andere Verbindungen sie nicht festlegen. Der Editor soll dann keine unnötige Variantenauswahl verlangen.

Die vom Benutzer gewünschte Plattenbefestigung wird getrennt von der aktuell gewählten konkreten Bohrung gespeichert. Beim automatischen Variantenwechsel wird die Zuordnung neu berechnet. Eine ausdrücklich fixierte Befestigung bleibt eine Bedingung.

Wie bei den Rohrbohrungen wählt der Löser auch die Ausführung einer Platte: die Lage der Flansche, die zu den Befestigungen passt (die Halbplatte 40 × 20 hat Flansche an den langen oder an den kurzen Seiten), und geknickte Laschen. Eine senkrechte Halbplatte, an deren Kante auf ihrer Seite eine waagerechte Platte anschließt, bekommt dort geknickte Laschen und steht auf dieser Platte ([HERSTELLERREGELN.md](./HERSTELLERREGELN.md), Abschnitt 1). Das ergibt Setzstufen an Treppen. Die Varianten sind derselbe Artikel; Stückliste und Umbau-Vergleich zählen sie als eine Platte. Der Editor markiert die geknickte Kante mit einem Strich in einer Signalfarbe quer über die Sichtseite der Platte.

### 7.4 Kopffallen

`findHeadTraps` meldet mögliche Kopffallen nach der Regel des Designprogramms des Herstellers ([HERSTELLERREGELN.md](./HERSTELLERREGELN.md), Abschnitt 3): zwei gerade, parallele Rohre mit 151 bis 299 mm Achsabstand, die sich um mehr als 149 mm überlappen, mit einer Ecke der Öffnung ab 599 mm Höhe. Ecken sind die Enden der Überlappung auf beiden Rohrachsen. Als Boden gilt der tiefste Punkt des Modells, also die Unterseite der tiefsten Kupplung oder Rohroberfläche; wo das Programm den Boden ansetzt, ist nicht belegt. Eine Platte in der Zelle zwischen beiden Rohren schließt die Öffnung, auch wenn ihre Flansche an den anderen beiden Rohren sitzen, wie bei einer Setzstufe aus einer Halbplatte. Bogenrohre bilden keine Seite einer Kopffalle.

Die Meldung ist ein Hinweis, kein Befund der Baubarkeit: Das Modell bleibt baubar und speicherbar. Der Editor zeigt neben dem Revisionszähler ein Warnzeichen mit der Anzahl; ein Klick öffnet die Liste über der Seitenleiste, und beim Überfahren eines Eintrags werden die beiden Rohre hervorgehoben.

### 7.5 Rutschen

Unterstützt sind der Modularrutschen-Körper, die Bogenrutsche und der Rutschenauslauf als eigene Entwurfsobjekte (`SlideIntent`). Eine Rutsche hängt an der Mitte eines geraden, waagerechten 35-cm-Rohrs und läuft quer dazu in der Richtung `toward` weg, angegeben im Rahmen des Verbindungspunkts a dieses Rohrs, dessen +z als oben gilt. Ein Körper reicht nach Auskunft des Auftraggebers zwei Etagen (800 mm) tiefer und drei Felder (1200 mm) weiter und liegt dort auf einem parallelen Rohr auf. An diesem hängt der nächste Körper oder der Auslauf. Die Bogenrutsche dreht beim Hinunterrutschen um 90° nach links und liegt zwei Etagen tiefer, 600 mm weiter und 600 mm links auf einem 35-cm-Rohr quer zum Aufhängerohr auf; der Auslauf hängt dort und läuft nach links weiter. Die Aufhängung ist eine typisierte Verbindung zwischen der Rohrmitte und der Rutsche; jedes gerade Rohr kann eine Rutsche je Seite tragen.

Prüfstufe 6 verlangt die passende Rohrlänge und beim Körper das Auflagerohr. Bogenrutsche und Auslauf haben die Form aus dem Designprogramm des Herstellers (NURBS-Flächen); der Modularrutschen-Körper ist danach nachgebildet: Profil des Auslaufs, gerades Gefälle mit gerundeten Enden. Für die Kollisionsprüfung zählen Hüllen entlang der Fläche ohne die Haken an den Rohren. Die Stückliste zählt je Rutsche zwei konische Rutschenschrauben, oben je Modularrutschen-Körper eine und je Bogenrutsche zwei Plattenschrauben, und je Stoß auf der nächsten Rutsche zwei Gegenstücke mit einer Rutschenschraube, bei der Bogenrutsche zwei, wie im Schraubenset des Herstellers. Die Maße der Modularrutsche außer Gefälle und Länge sowie die Schraubenzahlen sind aus der Sicherheitsanweisung des Herstellers (Abschnitte 1.20, 1.21 und 1.24) abgelesen und vorläufig ([GEOMETRIE.md](./GEOMETRIE.md), Abschnitt 7). Den Unterbau der Bogenrutsche mit den Sonderlängen aus der Anleitung prüft der Editor nicht; er verlangt nur das Auflagerohr.

Dateien ohne Rutschen bleiben lesbar; ein fehlendes Feld `slides` gilt als leer.

## 8. Änderungen, Invarianten und Editorverhalten

Änderungen erfolgen über fachliche Operationen wie `RohrAnbauen`, `RohrendenVerbinden`, `PlatteEinsetzen`, `VarianteFixieren` und `BauteilEntfernen`.

Ablauf einer Änderung:

1. Gewünschte Änderung als vorläufigen Zustand erzeugen.
2. Kandidaten für Bauteile und Anschlussstellungen bestimmen.
3. Geometrie und betroffene Befestigungen berechnen.
4. Strukturelle und geometrische Regeln prüfen.
5. Gültigen Entwurf und Realisierung gemeinsam übernehmen.

Bei einem Konflikt bleibt die bisherige gültige Konstruktion erhalten. Eine ungültige Vorschau ist erlaubt und wird klar markiert. Eine Speicherung unvollständiger Entwürfe wäre eine spätere, ausdrücklich zu kennzeichnende Funktion.

Zu den Regeln gehören:

- Referenzierte Teile und Befestigungsstellen existieren.
- Befestigungsstellen sind kompatibel; Belegung folgt den Regeln des Verbindungstyps.
- Keine versehentlichen doppelten Rohre beziehungsweise Verbindungen.
- Anschlusspositionen und Orientierungen passen zusammen.
- Geschlossene Wege sind geometrisch konsistent.
- Sämtliche Plattenbefestigungen und fixierten Varianten bleiben erfüllbar.
- Keine unzulässigen Kollisionen. Vorgesehene Stecküberlappungen werden durch Anschlussregeln berücksichtigt.

Offene Rohrenden, also Enden ohne weiteres Rohr am selben Verbindungspunkt, hebt der Editor hervor; sie sind kein Fehler. Der Editor zeigt automatisch gewählte besondere Rohrvarianten dauerhaft erkennbar an und hebt einen Wechsel kurz hervor. Dasselbe gilt für ein Teil, das nicht in der gewünschten Farbe erhältlich ist und deshalb in der Standardfarbe erscheint. Die konkrete Variante erscheint auch in der Stückliste. Konflikte markieren die beteiligten Teile und nennen die verletzte Bedingung.

Im Sinne von DDD bildet die Konstruktion die Konsistenzgrenze für Änderungen. Ein Domain Service ermittelt Realisierungen und prüft Geometrie. Der Editor formuliert Absichten und stellt Ergebnisse dar; er umgeht die fachlichen Invarianten nicht.

## 9. Erweiterbarkeit und Reihenfolge

| Spätere Erweiterung                                                    | Bereits vorzusehende Grundlage                                       | Später nötige Arbeit                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Weitere Längen, Bohrungsvarianten und Plattenformen                    | Katalog, Befestigungsstellen und Variantenwahl                       | Geometrien, Daten und Auswahlregeln                                                        |
| Kappen und Bodenverankerungen                                          | Allgemeine Bauteile und Anschlusstypen                               | Teiledefinitionen und Montagebedingungen                                                   |
| Klammern und Doppelrohrverbinder                                       | Befestigungen auch außerhalb der Rohrenden                           | Konkrete seitliche Befestigungsregeln                                                      |
| Rutschen und weiteres starres Zubehör                                  | Teile mit mehreren Befestigungsstellen                               | Geometrien, Montagebedingungen und Baugruppenkomfort                                       |
| Räder, Lager und Flexikupplungen                                       | Typisierte Verbindungen mit Parametern                               | Gelenkverhalten und gegebenenfalls zusätzliche Solverlogik                                 |
| Textilien, Netze und Poolfolien                                        | Referenzen auf mehrere Befestigungen                                 | Rahmenbedingungen und vereinfachte Darstellung                                             |
| Schrauben und andere Befestigungsmittel                                | Auswertbare montierte Verbindungen                                   | Automatische Stücklistenableitung                                                          |
| Fest gewählte Kupplung, z. B. 6-armig als Vorbereitung für einen Anbau | Auto-Kupplung als Standard, Verbindungspunkte mit stabiler Identität | Fixierung am `JunctionIntent` analog zur Rohrvariante; freie Arme in `findOpenEnds` melden |

Gelenke werden im Modellkonzept berücksichtigt. Die erste Umsetzung benötigt keine Bewegungssimulation und unterstützt nur festgelegte Stellungen. Bewegliche geschlossene Mechanismen erfordern später zusätzliche Berechnungslogik.

Für flexible Elemente werden zunächst Befestigungen und benötigte Rahmenformen betrachtet. Verformungssimulation bleibt außerhalb dieses Vorhabens.

## 10. Abnahmeszenarien für den Modellkern

1. Ein rechtwinkliger Rahmen lässt sich ohne manuelle Kupplungswahl zeichnen. Beim Schließen werden bestehende IDs referenziert; es entstehen keine Duplikate.
2. Ein weiteres Rohr an einem vorhandenen Verbindungspunkt ändert die nötige Kupplung, ohne angeschlossene Rohre neu anzulegen.
3. Eine schräge Verbindung wird mit einem eigenständigen Winkeladapter und dessen tatsächlichem Versatz realisiert.
4. Ein Bogenrohr wird als einzelnes Teil behandelt; seine Biegeebene beeinflusst die Lage angeschlossener Teile.
5. Das Einsetzen einer Platte wählt bei Bedarf eine passende Rohrbohrungsvariante. Rohr-ID und bestehende erfüllbare Befestigungen bleiben erhalten.
6. Zwei widersprüchliche Plattenbefestigungen oder eine ungeeignete fixierte Rohrvariante führen zu einer verständlichen Konfliktanzeige.
7. Ein geometrisch unmöglicher Ringschluss wird abgelehnt, ohne den gültigen Ausgangszustand zu verändern.
8. Das Verschieben einer Baugruppe verändert ihren Anker; innere Beziehungen und Teilidentitäten bleiben erhalten.
9. Speichern und Laden erhält IDs, Beziehungen, Fixierungen und gewählte Realisierung. Positionscaches lassen sich reproduzieren.
10. Ein neuer Rohrtyp oder eine weitere Plattenform kann durch Katalogergänzung aufgenommen werden, ohne das grundlegende Verbindungsformat zu ändern.

## 11. Noch zu klärende Geometriedaten

- Tatsächliche lokale Anschlusslagen, Einstecktiefen und Befestigungsmaße.
- Zulässige Drehstellungen sowie die Wirkung der Verschraubung auf die Rohrdrehung.
- Bohrungsmuster aller zunächst unterstützten Varianten.
- Exakte Befestigungsgeometrie der ersten Platte.
- Geometrische Entsprechung zwischen Bogenrohr und der genannten Ersatzfolge aus zwei Rohren und einer Ecke.
- Zulässige Stecküberlappungen und geeignete Kollisionsgeometrien.
- Zentrale Längen- und Winkeltoleranzen.

Ungeprüfte Maße und Anschlussannahmen werden nicht als gesicherte Katalogdaten übernommen. Kandidatenwerte aus dem Designprogramm des Herstellers stehen in [GEOMETRIE.md](./GEOMETRIE.md), Konstruktions- und Sicherheitsregeln des Herstellers in [HERSTELLERREGELN.md](./HERSTELLERREGELN.md).

## 12. Quellen zur Teileübersicht

Die Shopseiten dienen zur Identifikation der Teilefamilien. Sie ersetzen keine vollständigen technischen Anschlussdaten. Winkelangaben im Produktnamen können Bohrungsvarianten bezeichnen und dürfen nicht automatisch als Biegewinkel interpretiert werden.

Die daraus abgeleiteten Teilefamilien und Artikel stehen im [Bauteilkatalog](./BAUTEILKATALOG.md).

- [Teileübersicht](https://quadroshop.com/pages/parts)
- [Kupplungen](https://quadroshop.com/collections/connectors)
- [Rohre](https://quadroshop.com/collections/tubes)
- [Platten](https://quadroshop.com/collections/panels)
- [Mobil](https://quadroshop.com/collections/wheels)
- [Rutschen](https://quadroshop.com/collections/slides)
- [Textilien und Netze](https://quadroshop.com/collections/textiles)
- [Pool](https://quadroshop.com/collections/pools)
- [Schrauben](https://quadroshop.com/collections/screws)

## 13. Technische Architektur und Browserbedienung

### 13.1 Plattform und Grafik

Die Anwendung wird als Browseranwendung in TypeScript umgesetzt. Der Modellkern läuft zunächst vollständig im Browser. Für den lokalen Editor ist kein Anwendungsserver erforderlich; Konten, gemeinsame Projekte und Synchronisierung sind spätere Erweiterungen.

Für die 3D-Darstellung wird Three.js mit dem WebGL-2-basierten `WebGLRenderer` verwendet. WebGPU ist keine Voraussetzung der ersten Umsetzung. Ein späterer Wechsel wird anhand konkreter Anforderungen bewertet.

Werkzeugleisten, Teileauswahl, Eigenschaften und Konfliktmeldungen werden als HTML-Bedienelemente umgesetzt. Die Wahl eines UI-Frameworks und des Build-Werkzeugs ist noch offen.

### 13.2 Trennung der Verantwortlichkeiten

```text
Modellkern in TypeScript
        ↕
Editor: Auswahl, Werkzeuge, Vorschau, Undo/Redo
        ↕
Three.js: Darstellung, Kamera und Objekterkennung
```

- Der Modellkern enthält Fachobjekte, Katalogregeln, Realisierung und geometrische Prüfungen. Er ist unabhängig von Three.js, DOM und UI-Framework testbar.
- Der Editor übersetzt Eingaben in fachliche Operationen und verwaltet Auswahl, Werkzeugzustand, vorläufige Änderungen und Undo/Redo.
- Die Darstellung erzeugt und aktualisiert Three.js-Objekte aus der berechneten Realisierung. Dargestellte Teile sind ihren fachlichen IDs zugeordnet.

Three.js-Szenenobjekte bilden nicht das persistierte Fachmodell. Kamerabewegungen ändern ausschließlich den Ansichtszustand. Das Verschieben einer Baugruppe ist dagegen eine fachliche Änderung ihres Ankers.

### 13.3 Navigation und Ansichten

- Eine frei um einen Zielpunkt drehbare 3D-Ansicht mit Pan und Zoom wird über `CameraControls` (camera-controls, über drei) umgesetzt; gezoomt wird zum Mauszeiger hin. Verschoben wird mit der rechten Maustaste, mit Umschalt und linker Maustaste oder mit zwei Fingern; Knöpfe und die Tasten + und − zoomen schrittweise.
- Zusätzlich werden feste orthografische Ansichten von oben, vorn und der Seite angeboten. Sie lassen sich nur verschieben und zoomen; die Rückkehr zur 3D-Ansicht stellt deren letzte Lage wieder her. „Einpassen“ zeigt das ganze Modell, in der 3D-Ansicht ohne den Blickwinkel zu ändern.
- Eine perspektivische Ansicht unterstützt das räumliche Verständnis; orthografische Ansichten unterstützen präzise Platzierung.
- Die Explosionsansicht (Knopf neben den Zoom-Knöpfen, Taste E) zeigt schematisch, wie das Modell zusammengesteckt ist; klare Erkennbarkeit geht vor wahren Größen: Rohre und Bogenrohre werden dünne Stäbe, die an jedem Ende 70 mm vor der Kupplung enden, Kupplungen ein kleiner Kern mit allen Armen als kurzen Stäben, Winkelkupplungen dünne Stäbe für Hülse und Zapfen, beide weiß mit schwarzen Linien wie in einer technischen Zeichnung; Platten schrumpfen in ihrer Ebene. Sie ändert nur die Darstellung; Auswahl und Anbauen funktionieren weiter.
- Auswahl und Erkennung von Teilen unter dem Mauszeiger erfolgen über `Raycaster` mit Rückzuordnung zu fachlichen IDs.
- Kameranavigation und Bearbeitungswerkzeuge erhalten getrennte Eingabegesten, damit das Setzen eines Rohrs nicht gleichzeitig die Ansicht dreht.

### 13.4 Platzieren und Vorschau

Jedes neue Rohr und jede neue Platte erhält eine Farbe; sie ist ein Pflichtfeld. Der Editor belegt sie mit der Standardfarbe des Katalogs vor (Rohre Rot, Platten Blau) und gibt sie immer mit. Fehlt sie in einer Datei, setzt das Einlesen diese Standardfarbe ein.

Eine Platte bietet der Editor auf der Seite der Rahmenfläche an, die zur Kamera zeigt; die Ziele der abgewandten Seite sind ausgeblendet und nehmen keine Klicks an. Für eine Platte auf der anderen Seite dreht man die Ansicht. Die Teileauswahl zeigt zunächst nur die gängigen Teile. Rohre mit 10, 20, 25 und 52 cm, die Platte 30 × 30 cm und die Lochplatte sind nach Auskunft des Auftraggebers kein Standard; sie erscheinen erst mit der Einstellung „Alle“. Bereits verbaute Teile bleiben davon unberührt.

Beim Anbauen werden gültige Anschlussrichtungen und Platzierungskandidaten sichtbar angeboten. Eine Vorschau zeigt das entstehende Rohr und die betroffene Realisierung. Die Domänenlogik bestimmt zulässige Positionen und Einrastmöglichkeiten.

Eine Mausposition im Bild legt allein keine eindeutige Position im Raum fest. Platzierungswerkzeuge verwenden deshalb vorhandene Anschlüsse, gewählte Richtungen oder eine definierte Arbeitsebene zur Ermittlung ihrer Kandidaten.

Generische freie Objekttransformationen dürfen fachliche Bedingungen nicht umgehen. Änderungen werden über die in Abschnitt 8 beschriebenen Operationen geprüft und übernommen.

Ein ganzes Bauteil (eine zusammenhängende Baugruppe) wird über den Knopf „Verschieben“ an einem gewählten Teil bewegt. Ein Griff mit drei Pfeilen (`TransformControls` aus drei) verschiebt es auf dem Boden und hebt oder senkt es, nie unter den Boden; es rastet im 40-cm-Raster ein und zusätzlich überall dort, wo ein freier Arm des Bauteils einem freien Arm eines anderen gegenübersteht und genau ein gerades Standardrohr dazwischen passt (`connectionSnaps`); der Editor nennt dann das Rohr. Ein Klick auf eine Pfeilspitze schiebt bis zum nächsten Halt in dieser Richtung, dem nächsten Rasterfeld oder einer näheren Anschlussstelle. Pfeiltasten verschieben um ein Rasterfeld, Bild auf und Bild ab heben und senken um eines, R und der Drehknopf drehen um 90° um die Hochachse durch einen Verbindungspunkt nahe der Mitte. `moveAssembly` setzt dafür nur den Anker neu; Teile, IDs und Beziehungen bleiben erhalten (Abnahmeszenario 8). Eine Lage, die mit anderen Teilen kollidiert, wird nicht übernommen.

### 13.4a Umbau vergleichen

Der Reiter „Umbau“ vergleicht das aktuelle Modell mit einer zweiten Modelldatei oder einem Bauplan, die nur zum Ansehen geladen wird; die Richtung (welche Datei vorher, welche nachher ist) lässt sich tauschen, und die Vergleichsdatei lässt sich jederzeit neu laden, auch mitten im Umbau. `compareConstructions` gleicht nach dem Ort ab, nicht nach IDs, damit auch getrennt entstandene Dateien vergleichbar sind: gleiches Teil am gleichen Ort bleibt, eine andere Teilart desselben Typs am gleichen Ort wird getauscht (etwa eine Kupplung mit mehr Armen oder ein Rohr mit anderer Bohrung), ein Teil mit derselben ID an anderem Ort wird versetzt, alles Übrige wird ab- oder angebaut. Dazu kommt die Differenz der Stücklisten.

In der 3D-Ansicht behalten alle Teile ihre eigene Farbe; Änderungen tragen eine Kontur (drei `Outlines`): grün angebaut, orange getauscht, blau versetzt, rot abgebaut. Teile der anderen Datei, die im aktuellen Modell fehlen, erscheinen durchscheinend an ihrem Ort, die alte Lage versetzter Teile blass. Auf Wunsch werden unveränderte Teile durchscheinend.

### 13.5 Technische Referenzen

- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer)
- [camera-controls](https://github.com/yomotsu/camera-controls)
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Three.js WebGPURenderer als mögliche spätere Alternative](https://threejs.org/docs/pages/WebGPURenderer.html)

### 13.6 Speicherformat und Eingangsvalidierung

Das Speicherformat ist zunächst JSON mit Formatkennung und Schemaversion.
Zod 4 prüft beim Einlesen die Dateistruktur; der Dokumenttyp wird aus dem Schema
abgeleitet. Unbekannte Versionen und Felder werden nicht stillschweigend übernommen.
Diese Formatprüfung ersetzt weder die Prüfung fachlicher Referenzen und
Katalogbedingungen noch die geometrische Baubarkeitsprüfung durch den Modellkern.

Daneben öffnet der Editor Baupläne ([BAUPLAN.md](./BAUPLAN.md)): eine Folge von Bauschritten in Weltrichtungen, die etwa ein Sprachmodell aus Fotos eines Baus schreibt. `importPlan` baut die Schritte mit den Bearbeitungsbefehlen des Editors nach und prüft jeden wie eine Bearbeitung; der erste nicht baubare Schritt wird mit Nummer und Grund gemeldet. Ein Schritt `point` beginnt ein loses Bauteil mit eigenem Anker. Schneller Weg: Die Schritte werden nur gelöst und das fertige Modell einmal geprüft; scheitert diese Prüfung, wird jeder Schritt geprüft, um den ersten nicht baubaren zu nennen.

Schließt ein angebautes Rohr an einen Verbindungspunkt eines anderen Bauteils an, gibt dieses Bauteil seinen Anker auf; es liegt schon dort, wo das Rohr endet, und die verbundene Baugruppe hat wieder genau einen Anker.
