import { quadroArticleCatalog, quadroPartCatalog, type ColourId, type FamilyId } from '@qad/model-core';
import { fitColour, familyColours, type ColourRange } from './colours';

export interface PaletteChoice {
  readonly kind: 'tube' | 'plate';
  readonly familyId: FamilyId;
  readonly colour: ColourId;
}

/**
 * Tube families of the first stage, one entry per family named by its standard
 * variant. The 35 cm tube is by far the most used part and comes first.
 */
const FIRST = 'tube-35cm';
const TUBES = quadroArticleCatalog.entries
  .filter((e) => e.category === 'tube' && e.stage === 'initial' && e.drilling.kind === 'standard')
  .sort((a, b) => Number(b.familyId === FIRST) - Number(a.familyId === FIRST));
/** Plates the geometry catalog can place. */
const PLATES = quadroArticleCatalog.entries.filter(
  (e) => e.category === 'plate' && quadroPartCatalog.partTypes.some((t) => t.kind === 'plate' && t.id === e.id),
);

interface PaletteProps {
  readonly choice: PaletteChoice | undefined;
  readonly range: ColourRange;
  readonly onChoose: (choice: PaletteChoice | undefined) => void;
}

const CURVED = new Set(TUBES.filter((t) => t.category === 'tube' && t.shape === 'bent').map((t) => t.familyId));
const HINTS = {
  tube: 'Freien Arm (grau) anklicken; Esc legt das Rohr ab.',
  curved: 'Freien Arm (grau) anklicken; R wählt die Biegerichtung, Esc legt das Rohr ab.',
  plate: 'Fläche zwischen vier Rohren anklicken; R dreht die Flansche, Esc legt die Platte ab.',
};

/** Parts to build with. Connectors are chosen automatically and therefore not offered. */
export function Palette({ choice, range, onChoose }: PaletteProps) {
  const entry = (kind: PaletteChoice['kind'], familyId: FamilyId, name: string) => {
    const active = familyId === choice?.familyId;
    const fallback = quadroArticleCatalog.defaultColours[kind] ?? 'red';
    // Keep a chosen colour when switching between parts of the same kind.
    const colour = choice?.kind === kind ? choice.colour : fallback;
    return (
      <button
        key={familyId}
        type="button"
        onClick={() => onChoose(active ? undefined : { kind, familyId, colour: fitColour(familyId, colour, range) })}
        style={{
          textAlign: 'left',
          padding: '6px 8px',
          border: active ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
          borderRadius: 4,
          background: active ? '#e8f0fb' : '#fff',
          color: '#111',
          cursor: 'pointer',
        }}
      >
        {name}
      </button>
    );
  };
  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Rohre</h3>
      <div style={{ display: 'grid', gap: 4 }}>{TUBES.map((t) => entry('tube', t.familyId, t.name))}</div>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Platten</h3>
      <div style={{ display: 'grid', gap: 4 }}>{PLATES.map((p) => entry('plate', p.familyId, p.name))}</div>
      {choice ? (
        <label style={{ display: 'block', marginTop: 8, fontSize: 14 }}>
          Farbe{' '}
          <select value={choice.colour} onChange={(e) => onChoose({ ...choice, colour: e.target.value })}>
            {familyColours(choice.familyId, range).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={{ fontSize: 13, color: '#555' }}>
        {choice
          ? HINTS[choice.kind === 'tube' && CURVED.has(choice.familyId) ? 'curved' : choice.kind]
          : 'Rohr oder Platte wählen, dann im Modell anbauen.'}
      </p>
    </section>
  );
}
