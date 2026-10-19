import {
  articleEntryId,
  quadroArticleCatalog,
  quadroPartCatalog,
  type ChangeKind,
  type Comparison,
  type PartId,
} from '@qad/model-core';
import { colourName } from './colours';

/** Contour colours of the changes; the parts keep their own colours. */
export const CHANGE_COLOURS: Readonly<Record<Exclude<ChangeKind, 'kept'>, string>> = {
  removed: '#d32f2f',
  swapped: '#f08c00',
  moved: '#1f6fd1',
  added: '#2e9e44',
};

const GROUPS: readonly { readonly kind: Exclude<ChangeKind, 'kept'>; readonly title: string }[] = [
  { kind: 'removed', title: 'Abbauen' },
  { kind: 'swapped', title: 'Tauschen' },
  { kind: 'moved', title: 'Versetzen' },
  { kind: 'added', title: 'Anbauen' },
];

const NAMES = new Map(quadroArticleCatalog.entries.map((e) => [e.id, e.name]));
const nameOf = (typeId: string) => NAMES.get(articleEntryId(quadroPartCatalog, typeId)) ?? typeId;

interface RebuildProps {
  readonly comparison: Comparison;
  /** Name of the other file and whether it is the state before. */
  readonly reference: string;
  readonly referenceBefore: boolean;
  readonly onlyChanges: boolean;
  readonly onOnlyChanges: (only: boolean) => void;
  readonly onSwap: () => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** Parts of the current model to highlight; the other file's parts cannot be selected. */
  readonly onHighlight: (parts: readonly PartId[]) => void;
}

/** What a rebuild from before to after takes, part by part and as a parts list difference. */
export function Rebuild({
  comparison,
  reference,
  referenceBefore,
  onlyChanges,
  onOnlyChanges,
  onSwap,
  onOpen,
  onClose,
  onHighlight,
}: RebuildProps) {
  const current = (c: Comparison['changes'][number]) => (referenceBefore ? c.after : c.before);
  const groups = GROUPS.map(({ kind, title }) => {
    const lines = new Map<string, { name: string; partIds: PartId[]; count: number }>();
    for (const change of comparison.changes.filter((c) => c.kind === kind)) {
      const name =
        kind === 'swapped'
          ? `${nameOf(change.before!.typeId)} → ${nameOf(change.after!.typeId)}`
          : nameOf((change.after ?? change.before)!.typeId);
      const line = lines.get(name) ?? { name, partIds: [], count: 0 };
      const part = current(change)?.partId;
      lines.set(name, { ...line, count: line.count + 1, partIds: part ? [...line.partIds, part] : line.partIds });
    }
    return {
      kind,
      title,
      lines: [...lines.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  });
  const needed = comparison.bill.filter((d) => d.difference > 0);
  const spare = comparison.bill.filter((d) => d.difference < 0);
  const changed = groups.some((g) => g.lines.length > 0);
  const article = (d: Comparison['bill'][number]) =>
    `${Math.abs(d.difference)} × ${d.line.name}${d.line.colour ? ` (${colourName(d.line.colour)})` : ''}`;
  return (
    <section style={{ fontSize: 14 }}>
      <p style={{ margin: '12px 0 4px', overflowWrap: 'anywhere' }}>
        {referenceBefore ? 'Vorher' : 'Nachher'}: <strong>{reference}</strong>
        <br />
        {referenceBefore ? 'Nachher' : 'Vorher'}: das aktuelle Modell
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
        <button type="button" onClick={onSwap}>
          Richtung tauschen
        </button>
        <button type="button" onClick={onOpen}>
          Andere Datei …
        </button>
        <button type="button" onClick={onClose}>
          Vergleich beenden
        </button>
      </div>
      <label style={{ display: 'block', margin: '4px 0 8px' }}>
        <input type="checkbox" checked={onlyChanges} onChange={(e) => onOnlyChanges(e.target.checked)} /> Nur Änderungen
        deutlich zeigen
      </label>
      {!changed ? <p>Keine Unterschiede.</p> : null}
      {groups.map(({ kind, title, lines }) =>
        lines.length > 0 ? (
          <div key={kind} style={{ marginTop: 8 }}>
            <h4 style={{ margin: '0 0 4px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden
                style={{ width: 12, height: 12, borderRadius: 6, border: `3px solid ${CHANGE_COLOURS[kind]}` }}
              />
              {title}
            </h4>
            <ul style={{ margin: 0, paddingLeft: 18 }} onMouseLeave={() => onHighlight([])}>
              {lines.map((line) => (
                <li key={line.name} onMouseEnter={() => onHighlight(line.partIds)}>
                  {line.count} × {line.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {needed.length > 0 || spare.length > 0 ? (
        <>
          <h4 style={{ margin: '16px 0 4px', fontSize: 14 }}>Stückliste</h4>
          {needed.length > 0 ? (
            <>
              <p style={{ margin: '4px 0' }}>Zusätzlich nötig:</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {needed.map((d) => (
                  <li key={d.line.key}>{article(d)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {spare.length > 0 ? (
            <>
              <p style={{ margin: '8px 0 4px' }}>Danach übrig:</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {spare.map((d) => (
                  <li key={d.line.key}>{article(d)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
