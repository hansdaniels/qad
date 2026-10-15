# QAD-Modellkern

TypeScript-Schnittstellen für den QUADRO-Modellkern gemäß [SPEC.md](../../SPEC.md).
Er enthält die Verträge, den Solver, die Baubarkeitsprüfung und `ModelCore`, der
Bearbeitungen anwendet, löst, prüft und übernimmt. Die QUADRO-Geometrie ist vorläufig
und ausdrücklich als solche gekennzeichnet ([GEOMETRIE.md](../../GEOMETRIE.md)).

## Entwicklung

```sh
pnpm install
pnpm run check
pnpm run build
pnpm test
```

Das Projekt erzeugt ESM und Typdeklarationen in `dist/`. Zod 4 prüft das
Speicherformat zur Laufzeit. Der Kern verwendet keine DOM- oder Node-APIs und soll
im Browser, in einem Worker und unabhängig von der Darstellung laufen.
Die TypeScript-Konfiguration enthält die DOM-Typbibliothek, weil Zods Deklarationen
den Webstandard-Typ `URL` referenzieren. Build-Werkzeuge verwenden Node.js.
`check` prüft auch das [Beispiel zum Anlegen eines Rohrs](./examples/add-tube.ts).

## Öffentliche Schnittstelle

Import über `src/index.ts` während der Entwicklung bzw. den Paketexport nach dem Build:

```ts
import type { ModelCore, EditCommand } from '@qad/model-core';

export function previewEdit(core: ModelCore, command: EditCommand) {
  const preview = core.preview(command);
  if (preview.status === 'invalid') return preview.diagnostics;
  return preview.candidate.realization;
}
```

| Modul | Verantwortung |
| --- | --- |
| `ids` | Persistente Identitäten und Referenzen |
| `geometry` | Millimeter, Radiant, vollständige lokale Bezugssysteme |
| `catalog` | Versionierte Typen, Anschlüsse, Bohrungen und Verbindungsregeln |
| `design` | Benutzerabsicht, Variantenbedingungen und Baugruppenanker |
| `realization` | Konkrete Teile, Verbindungen, Plattenbefestigungen und berechnete Lagen |
| `commands` | Atomare Bearbeitungen einschließlich mehrerer zusammengehöriger Schritte |
| `diagnostics` | Strukturierte Konflikte mit Referenzen für Markierungen im Editor |
| `buildability` | Baubarkeitsbericht für schrittweisen Einbau, Ringschlussfehler und Hinweise ([Entwurf](../../BAUBARKEIT.md)) |
| `model-core` | `createModelCore`: Befehle anwenden, lösen, prüfen, nur Baubares übernehmen (`preview`, `execute`) |
| `solver` | Realisierung aus dem Entwurf: Auto-Kupplung, Lagen, Drehstellungen, Ringschluss (`solveRealization`) |
| `buildability-checker` | Umsetzung der Prüfung, Stufen 1–4 (`checkBuildability`, `DEFAULT_TOLERANCE`) |
| `collision` | Konvexe Kollisionsformen: GJK-Abstand, Eindringtiefe, Achsenkreuzung |
| `math` | Posen, Quaternionen, die 24 Achsdrehungen |
| `core` | Solver, Vorschau und geprüfte Übernahme eines Modellstands |
| `persistence` | Versioniertes Dokument und Vertrag für geprüftes Laden |
| `article-catalog` | Bauteilkatalog auf Artikelebene: Familien, Varianten, Artikelnummern, Farbschlüssel und Standardfarben, ohne Maße; `resolveArticle` ([Übersicht](../../BAUTEILKATALOG.md)) |
| `open-ends` | Offene Rohrenden für die Hervorhebung im Editor (`findOpenEnds`) |
| `quadro-geometry` | Vorläufiger QUADRO-Geometriekatalog, Kollisionsformen und Verbindungsauswerter |
| `quadro-articles` | Katalogdaten aus dem QUADRO-Shop (`quadroArticleCatalog`) |
| `document-schema` | Zod-4-Schema des vollständigen Dateiformats, daraus abgeleiteter Dokumenttyp |
| `parse-document` | JSON einlesen und Formatfehler mit Pfadangaben melden |

## Speicherformat und Validierung

`parseConstructionDocument(json)` prüft Formatkennung, Schemaversion und die
vollständige verschachtelte Struktur. Unbekannte Felder werden abgelehnt;
es gibt keine automatische Typumwandlung, Ergänzung von Standardwerten oder
stillschweigende Entfernung von Daten. Einzige Ausnahme ist die Farbe von Rohren
und Platten: Fehlt sie, wird Rot bzw. Blau eingesetzt. Zahlen müssen endlich,
Revisionen ganze nichtnegative Zahlen und IDs nichtleer sein. Optionale Felder
dürfen fehlen.

Der Typ `ConstructionDocument` wird aus `ConstructionDocumentSchema` abgeleitet.
Das Snapshot-Schema wird beim Übersetzen gegen `ConstructionSnapshot` geprüft;
die fachlichen Schnittstellen bleiben unabhängig von Zod.

Ein erfolgreiches Einlesen bestätigt nur das Format. Referenzen, eindeutige IDs,
Katalogversion, normierte Quaternionen und die geometrische Baubarkeit müssen
anschließend fachlich geprüft werden, bevor ein Modellstand übernommen wird.
Der vollständige `ConstructionCodec` mit dieser fachlichen Prüfung ist weiterhin
ein Schnittstellenvertrag. Künftige Dateiversionen werden ausdrücklich abgelehnt,
bis passende Migrationen implementiert sind.

Rohre referenzieren ihre logischen Verbindungspunkte; deren Mitgliederlisten werden
abgeleitet. Physische Verbindungen referenzieren allgemeine Befestigungsstellen.
Kupplungen und Adapter sind eigenständige Teile und folgen keiner alternierenden
Reihenfolge. Ein Teilewechsel erhält die Entwurfsidentität; unveränderte physische
Teile behalten ihre IDs über `origin` und dessen stabile Rolle.

`EditCommand` kann beispielsweise neue Verbindungspunkte, ein Rohr und einen Anker
gemeinsam anlegen. Erst nach Prüfung aller Operationen wird die Änderung gültig.
Entfernen löscht keine abhängigen Objekte stillschweigend mit. Beim Aufteilen einer
Baugruppe müssen ihre Anker innerhalb derselben Bearbeitung angepasst werden.

Alle Datenstrukturen verwenden `readonly` und sind JSON-fähig. Das ersetzt keine
Laufzeitvalidierung oder tiefe Unveränderlichkeit. IDs sind zunächst benannte
String-Aliasse; der Kern muss Eindeutigkeit und Referenzen prüfen. Ein erfolgreicher
Typcheck ist kein Baubarkeitsnachweis. Pose-Quaternionen und Richtungsvektoren müssen
normiert, Zahlen endlich und Anschlussbelegungen sowie Ringschlüsse geprüft werden.

Noch offene Freiheitsgrade dürfen in Vorschauen vorkommen. Ein gültiger Modellstand
enthält eine konkrete Realisierung: Freie Vorgaben bleiben im Entwurf frei, die
gewählte Stellung steht in der Realisierung. Auswahl soll gültige bisherige Teile
bevorzugen und bei gleichen Eingaben reproduzierbar bleiben.

Der Solver (`solveRealization`) ermittelt aus dem Entwurf die Realisierung für gerade
Rohre und Bogenrohre an achsparallelen Verbindungspunkten mit Auto-Kupplung, schräge
Rohre über Winkelkupplungen, Ringschluss und offene Enden. Die Baubarkeitsprüfung (`checkBuildability`) setzt die Stufen 1 bis 4
um und bestätigt jede Lösung des Solvers unabhängig. `quadroPartCatalog` ist ein
vorläufiger Geometriekatalog der QUADRO-Teile mit den Werten des Designprogramms von 2006
([GEOMETRIE.md](../../GEOMETRIE.md)), noch nicht am Teil gemessen. `createModelCore` bildet die Konsistenzgrenze
(SPEC 8): Jede Bearbeitung wird auf einer Kopie angewendet, gelöst und unabhängig
geprüft; nur ein baubares Ergebnis wird übernommen. Nächste Schritte: Viewer und Editor,
Stufe 5 (Platten) nach Klärung der Bohrungsmaße.
