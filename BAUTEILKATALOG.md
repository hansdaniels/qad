# Bauteilkatalog

Status: Stand des Shops vom 15. Oktober 2026. Ergänzt [SPEC.md](./SPEC.md), Abschnitte 4.1 und 12.
Die Typen stehen in [`src/article-catalog.ts`](./src/article-catalog.ts), die Daten in
[`src/quadro-articles.ts`](./src/quadro-articles.ts) (`quadroArticleCatalog`).

## 1. Zweck und Abgrenzung

Der Bauteilkatalog legt fest, **welche** QUADRO-Teile das Programm kennt: Familien,
Varianten, Artikelnummern und Farben. Er ist die Artikelebene, kein geometrischer
Katalog. `PartCatalog` (`src/catalog.ts`) braucht Anschlusslagen, Bohrungsmuster und
Kollisionsgeometrie. Diese Daten liefert der Shop nicht (SPEC 11), deshalb enthält
dieser Katalog keine Maße.

Zahlen stammen nur aus Produktnamen und sind Bezeichnungen:

| Feld | Bedeutung | Keine Aussage über |
| --- | --- | --- |
| `nominalLengthCm` | „Rohr 35 cm“ | Mittellinienlänge, Abstand der Verbindungspunkte |
| `drilling.designationDeg` | „Rohr 35 cm **90°** (4 Löcher)“ bezeichnet die Bohrungsvariante | Biegewinkel (SPEC 12) |
| `nominalSizeCm` | „Platte 40 × 40 cm“ | Lochbild, Befestigungslagen |
| `tubeGridCm` | Shophinweis „für Rohre mit einer Länge von 35 cm“ | Rohrabstand in mm |
| `designationDeg` (Kupplung) | „Winkelkupplung (45°)“ | Versatz und Anschlusslagen |

Ein Eintrag wird zum `PartType`, sobald seine Geometrie geprüft ist. Die Eintrags-ID
(Shop-Handle) ist als künftige `PartTypeId` gedacht, `familyId` als `FamilyId`:
Einträge einer Familie sind Varianten, die der Solver gegeneinander tauschen darf.

## 2. Umfang

| Kategorie | Einträge | Stufe `initial` (SPEC 2) | Stufe `later` (SPEC 9) |
| --- | ---: | --- | --- |
| Kupplungen | 17 | Raumkupplungen 3–6-armig, Flächenkupplungen 2-armig (90°, 180°), 3- und 4-armig, Winkelkupplung 45° | Flexikupplungen, Lochzapfen-, Lagerkupplung, Doppelrohrverbinder, Rohrklammer |
| Rohre | 15 | gerade Rohre 10, 15, 20, 25, 35, 52, 75 cm; Bohrungsvarianten zu 15 und 35 cm; Bogenrohr mit Variante | – |
| Platten | 12 | Platte 40 × 40 cm | weitere Größen, Lochplatte, Acrylglas, Holzgitter und deren Halteplatten |
| Rutschen | 3 | – | Modular- und Bogenrutschen-Körper, Auslauf |
| Zubehör | 2 | – | Rohrkappe, Bodenverankerung |
| Schrauben | 7 | – | alle; Stückzahl je Packung in `packSize` für die spätere Stückliste |

Rohrfamilien haben genau eine Standardvariante (`drilling.kind === 'standard'`):

| Familie | Varianten |
| --- | --- |
| `tube-15cm`, `tube-35cm` | Standard, 90° (4 Löcher), 135° (3 Löcher), 180° (4 Löcher) |
| `curved-tube` | Standard, 135° (3 Löcher) |
| übrige Längen | nur Standard |

## 3. Nicht aufgenommen

| Was | Grund |
| --- | --- |
| [Textilien/Netze](https://quadroshop.com/collections/textiles), Flügelschrauben (nur für Netze) | außen vor |
| [Pool](https://quadroshop.com/collections/pools), Aqua, Rutschenverlängerung (Wasserrutsche) | außen vor |
| [Mobil](https://quadroshop.com/collections/wheels): Multirad, Radlager, Arretierung, Schwimmrad, Radkappe, Laufrollen und Adapter | zurückgestellt; bei Bedarf nachtragen |
| Holz-Profil 80 cm | nicht benötigt |
| Integralrutsche, Acrylglas (Integralrutsche) | vorerst ignoriert |
| Platten-, Lochplatten- und Halbplattensets, Rutschen-Komplettsets, Rutschenrahmen, Schraubensets | Zusammenstellungen aus Einzelteilen, die bereits im Katalog stehen |
| Schlüssel (Kunststoff, Edelstahl) | Werkzeug, kein Bauteil |
| [QUADRO Pro](https://quadroshop.com/collections/quadro-pro), QUADROmini | Komplettmodelle bzw. eigenes System |

Ein Test (`test/article-catalog.test.mjs`) stellt sicher, dass diese Produkte nicht
versehentlich wieder aufgenommen werden.

## 4. Kupplungsformen

Raum- und Flächenkupplungen haben Arme in den sechs Achsrichtungen ±x, ±y, ±z
(`armDirections`). Eine Kupplung darf beliebig gedreht werden, solange Achsen auf
Achsen fallen (24 Drehungen). Es zählt also nur die Anordnung der Arme:

| Arme | fehlende Richtungen | Kupplung |
| ---: | --- | --- |
| 6 | keine | Raumkupplung 6-armig |
| 5 | eine | Raumkupplung 5-armig |
| 4 | zwei gegenüberliegende | Flächenkupplung 4-armig (Plus-Zeichen) |
| 4 | zwei benachbarte | Raumkupplung 4-armig (T in der Fläche, ein Arm nach oben) |
| 3 | drei paarweise benachbarte | Raumkupplung 3-armig (Ecke) |
| 3 | zwei gegenüberliegende und eine weitere | Flächenkupplung 3-armig (T) |
| 2 | zwei Paare, Arme gegenüber | Flächenkupplung 2-armig (180°) |
| 2 | zwei Paare, Arme benachbart | Flächenkupplung 2-armig (90°) |

Damit gehört zu jeder Anordnung von 2 bis 6 Achsrichtungen genau eine Kupplung;
ein Test prüft das für alle 57 Teilmengen. Die automatische Kupplungswahl (SPEC 6)
und Stufe 3 der Baubarkeitsprüfung können für achsparallele Rohre direkt darauf
aufbauen.

Nicht erfasst sind Armlagen, Einstecktiefen und die Lage der Bohrungen; das bleibt
Katalog-Geometrie (SPEC 11). Winkelkupplung, Lochzapfen-, Lager- und Flexikupplungen
haben keine `armDirections`.

## 5. Farben

`ArticleCatalog.colours` ordnet jedem Farbschlüssel (`ColourId`) den Farbnamen des
Shops zu. Derselbe Schlüssel steht in jedem `Article` und in `Appearance.colour` von
Rohr- und Plattenabsicht. `resolveArticle(catalog, typeId, colour?)` liefert damit
zur gewählten Variante und Farbe die Artikelnummer, z. B. `tube-35cm` + `red` → `00535`.

| Schlüssel | Shopname | Art |
| --- | --- | --- |
| `blue`, `green`, `yellow`, `red` | Blau, Grün, Gelb, Rot | Grundfarben, bei allen Rohren und Platten mit Farbwahl |
| `pearl-white`, `dark-grey`, `dove-blue`, `moody-blue`, `may-green`, `emerald-green`, `bunnys-nose`, `tawny-port` | Pearl White, Dark Grey, … | Designfarben, nur bei einem Teil der Artikel |
| `black`, `white`, `transparent`, `metallic` | Schwarz, Weiß, Transparent, Metallic | feste Farben von Kupplungen, Zubehör, Acrylglas und Schrauben |
| `classic`, `petrol`, `mint`, `berry` | Classic, Petrol, Mint, Berry | Mischung (`kind: 'mix'`), nur bei Rohrschrauben |

### Standardfarben

| Kategorie | Standardfarbe (`defaultColours`) |
| --- | --- |
| Rohre | Rot |
| Platten | Blau (Kontrast zu den roten Rohren) |
| Kupplungen | Schwarz |
| übrige | erste Farbe in Shopreihenfolge |

`resolveArticle` wählt in dieser Reihenfolge:

1. die gewünschte Farbe, wenn der Teiletyp darin erhältlich ist,
2. sonst die Standardfarbe der Kategorie,
3. sonst die erste Farbe des Eintrags, z. B. Rot beim Doppelrohrverbinder, den es
   nicht in Schwarz gibt.

Der Editor gibt für jedes Rohr und jede Platte eine Farbe mit und belegt sie mit
der Standardfarbe vor. Fehlt sie trotzdem, etwa in einer von Hand geschriebenen
Datei, gilt die Standardfarbe. Jedes Rohr ist in Rot erhältlich, jede
Rasterkupplung in Schwarz.

### Farbe und Bohrungsvarianten

Bohrungsvarianten gibt es in weniger Farben als die Standardrohre ihrer Familie:

| Familie | Standard | Bohrungsvarianten |
| --- | --- | --- |
| `tube-15cm` | 12 Farben | nur Grundfarben |
| `tube-35cm` | 12 Farben | 90°, 135°: Grundfarben und Dark Grey; 180°: nur Grundfarben |
| `curved-tube` | Grundfarben, Pearl White, Dark Grey | 135°: nur Grundfarben |

**Eine fehlende Farbe ist kein Fehler.** Verlangt eine Platte an einem Rohr in
Pearl White die 90°-Variante, wird das Rohr als 90°-Variante in Rot realisiert
(`substituted: true`). Die Farbe schließt also nie eine Variante aus; sie ist nur eine
Präferenz: Unter sonst gleichwertigen Varianten wählt der Solver eine in der
gewünschten Farbe. Der Editor markiert ein ersetztes Rohr wie eine automatisch
gewählte Sondervariante (SPEC 8).

Die tatsächliche Farbe wird nicht gespeichert. Sie folgt aus Teiletyp der
Realisierung, gewünschter Farbe und Katalog; die Wunschfarbe bleibt im Entwurf
erhalten und greift wieder, sobald die Standardvariante zurückkehrt.

## 6. Aktualisieren

Die Kollektionen liefern unter `/collections/<name>/products.json` maschinenlesbare
Daten (`handle`, `title`, `variants[].sku`, `variants[].title`). Ein neuer Abruf wird
gegen `quadroArticleCatalog` verglichen; Abweichungen werden von Hand übernommen.
Danach wird `version` auf das Abrufdatum gesetzt. Artikelnummern sind die SKUs des
Shops. Wo die Produktbeschreibung weitere Angaben macht (z. B. Maße von Acrylglas
und Holzgitter), werden sie nicht übernommen, bis sie geprüft sind.

## 7. Offene Punkte

- Geometrie aller `initial`-Einträge: Anschlusslagen, Einstecktiefen, Bohrungsmuster
  (SPEC 11). Erst damit entstehen `PartType`s. Kandidatenwerte für Raster, Rohr,
  Kupplung und Winkelkupplung stehen in [GEOMETRIE.md](./GEOMETRIE.md).
- Die Zod-Prüfung des Dateiformats kennt den Katalog nicht; ob ein Farbschlüssel
  existiert, gehört zur fachlichen Prüfung beim Laden.
