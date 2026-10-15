import type { BillLine, PartId } from '@qad/model-core';
import { colourName, displayColour } from './colours';

interface BillOfMaterialsProps {
  readonly lines: readonly BillLine[];
  readonly onHighlight: (parts: readonly PartId[]) => void;
  readonly onExport: () => void;
}

const cell = { padding: '4px 6px', borderBottom: '1px solid #e3e6ea', verticalAlign: 'top' } as const;

/** Parts list by article; hovering a line highlights its parts in the model. */
export function BillOfMaterials({ lines, onHighlight, onExport }: BillOfMaterialsProps) {
  const pieces = lines.filter((l) => l.category !== 'fastener').reduce((sum, l) => sum + l.quantity, 0);
  const substituted = lines.some((l) => l.substituted > 0);
  return (
    <section style={{ fontSize: 13 }}>
      <p style={{ margin: '12px 0 8px', fontSize: 14 }}>
        {pieces} Teile ohne Schrauben ·{' '}
        <button type="button" onClick={onExport} disabled={lines.length === 0}>
          Als CSV speichern
        </button>
      </p>
      {lines.length === 0 ? (
        <p>Noch keine Teile.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }} onMouseLeave={() => onHighlight([])}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={cell}>Anz.</th>
              <th style={cell}>Teil</th>
              <th style={cell}>Art.-Nr.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} onMouseEnter={() => onHighlight(line.partIds)}>
                <td style={{ ...cell, textAlign: 'right' }}>{line.quantity}</td>
                <td style={cell}>
                  {line.name}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555' }}>
                    <span
                      aria-hidden
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        border: '1px solid #999',
                        background: displayColour(line.colour),
                      }}
                    />
                    {colourName(line.colour)}
                    {line.substituted > 0 ? ' *' : ''}
                  </div>
                  {line.note ? <div style={{ color: '#8a1c1c' }}>{line.note}</div> : null}
                </td>
                <td style={{ ...cell, fontFamily: 'monospace' }}>{line.articleNumber ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {substituted ? (
        <p style={{ color: '#555' }}>* Gewünschte Farbe gibt es für dieses Teil nicht, deshalb Standardfarbe.</p>
      ) : null}
      <p style={{ color: '#555' }}>
        Schrauben: eine Rohrschraube je Rohrende an einer Kupplung, in der Farbe des Rohrs; eine schwarze
        Plattenschraube je Winkelkupplung an ihrer Hülse.
      </p>
    </section>
  );
}

/** Semicolon-separated with BOM, so spreadsheet programs set to German open it directly. */
export function billCsv(lines: readonly BillLine[]): string {
  const quote = (value: string | number | undefined) => {
    const text = value === undefined ? '' : String(value);
    return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = [
    ['Anzahl', 'Artikelnummer', 'Bezeichnung', 'Farbe'],
    ...lines.map((l) => [l.quantity, l.articleNumber, l.name, colourName(l.colour)]),
  ];
  return '﻿' + rows.map((row) => row.map(quote).join(';')).join('\r\n') + '\r\n';
}
