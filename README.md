# QUADRO-Modellierungsprogramm

Browseranwendung zum Entwerfen von QUADRO-Konstruktionen ([SPEC.md](./SPEC.md)).

| Verzeichnis | Inhalt |
| --- | --- |
| [`packages/model-core`](./packages/model-core) | Modellkern: Verträge, Solver, Baubarkeitsprüfung, `ModelCore`, Bauteil- und Geometriekatalog |
| `apps/editor` | Editor (React, react-three-fiber), im Aufbau |

Fachliche Dokumente:

| Dokument | Inhalt |
| --- | --- |
| [SPEC.md](./SPEC.md) | Anforderungen und Datenmodell |
| [BAUBARKEIT.md](./BAUBARKEIT.md) | Baubarkeitsprüfung |
| [BAUTEILKATALOG.md](./BAUTEILKATALOG.md) | Teilefamilien, Artikel, Farben, Kupplungsformen |
| [GEOMETRIE.md](./GEOMETRIE.md) | Vorläufige Geometrie aus dem QUADRO-Designprogramm 2006 |
| [HERSTELLERREGELN.md](./HERSTELLERREGELN.md) | Konstruktions- und Sicherheitsregeln des Herstellers |

## Entwicklung

```sh
pnpm install
pnpm run check
pnpm test
```
