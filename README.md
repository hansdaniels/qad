# GBK-Modellierungsprogramm

Browseranwendung zum Entwerfen von Konstruktionen aus einem Großbaukasten (GBK) ([SPEC.md](./SPEC.md)).

| Verzeichnis                                    | Inhalt                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`packages/model-core`](./packages/model-core) | Modellkern: Verträge, Solver, Baubarkeitsprüfung, `ModelCore`, Bauteil- und Geometriekatalog                 |
| [`apps/editor`](./apps/editor)                 | Editor (React, react-three-fiber, drei), im Aufbau: Demo-Modell, Teileauswahl, Rohre an freien Armen anbauen |

Fachliche Dokumente:

| Dokument                                     | Inhalt                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| [SPEC.md](./SPEC.md)                         | Anforderungen und Datenmodell                        |
| [BAUBARKEIT.md](./BAUBARKEIT.md)             | Baubarkeitsprüfung                                   |
| [BAUTEILKATALOG.md](./BAUTEILKATALOG.md)     | Teilefamilien, Artikel, Farben, Kupplungsformen      |
| [GEOMETRIE.md](./GEOMETRIE.md)               | Vorläufige Geometrie aus dem Designprogramm 2006     |
| [HERSTELLERREGELN.md](./HERSTELLERREGELN.md) | Konstruktions- und Sicherheitsregeln des Herstellers |

## Entwicklung

Werkzeug ist [Vite+](https://viteplus.dev); `vp run -r` führt die Paketskripte im
ganzen Workspace aus.

```sh
vp install
vp run -r check
vp run -r test
vp run -r build
pnpm --filter @qad/editor dev   # Editor im Browser, http://localhost:5173
```

## Veröffentlichen

Der Editor ist eine reine Browser-App: `apps/editor/dist/` (eine `index.html` und
`assets/`) läuft auf jedem statischen Webspace, auch in einem Unterordner. Modelle
bleiben im Browser des Nutzers; an den Server geht nichts.

`pnpm run deploy` baut und lädt per SFTP hoch. Das Ziel steht in `deploy.env`
(nicht im Repository); gesetzte Umgebungsvariablen gehen vor:

```sh
QAD_SFTP=benutzer@host            # SFTP-Zugang; Port und Schlüssel ggf. in ~/.ssh/config
QAD_SFTP_DIR=webroots/www/qad     # Zielordner, ohne Angabe der Startordner des Zugangs
```

Jeder Build hat einen neuen Dateinamen in `assets/`; die alten bleiben zunächst
liegen. `pnpm run deploy clean` löscht dort alles, worauf die `index.html` auf
dem Server nicht mehr verweist, `pnpm run deploy deploy clean` lädt hoch und
räumt danach auf, mit einer Passwortabfrage für beides.
