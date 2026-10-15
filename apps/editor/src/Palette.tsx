import { quadroArticleCatalog, type ColourId, type FamilyId } from '@qad/model-core';

export interface PaletteChoice {
  readonly familyId: FamilyId;
  readonly colour: ColourId;
}

/** Tube families of the first stage: one entry per family, its standard variant names it. */
const FAMILIES = quadroArticleCatalog.entries.filter(
  (e) => e.category === 'tube' && e.stage === 'initial' && e.drilling.kind === 'standard',
);
const COLOUR_NAMES = new Map(quadroArticleCatalog.colours.map((c) => [c.id, c.name]));
const DEFAULT_COLOUR = quadroArticleCatalog.defaultColours.tube ?? 'red';

interface PaletteProps {
  readonly choice: PaletteChoice | undefined;
  readonly onChoose: (choice: PaletteChoice | undefined) => void;
}

/** Parts to build with. Connectors are chosen automatically and therefore not offered. */
export function Palette({ choice, onChoose }: PaletteProps) {
  const current = FAMILIES.find((f) => f.familyId === choice?.familyId);
  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Teile</h3>
      <div style={{ display: 'grid', gap: 4 }}>
        {FAMILIES.map((family) => {
          const supported = family.category === 'tube' && family.shape === 'straight';
          const active = family.familyId === choice?.familyId;
          return (
            <button
              key={family.familyId}
              type="button"
              disabled={!supported}
              title={supported ? undefined : 'Folgt: Biegeebene muss wählbar sein'}
              onClick={() =>
                onChoose(active ? undefined : { familyId: family.familyId, colour: choice?.colour ?? DEFAULT_COLOUR })
              }
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                border: active ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
                borderRadius: 4,
                background: active ? '#e8f0fb' : '#fff',
                color: supported ? '#111' : '#999',
                cursor: supported ? 'pointer' : 'default',
              }}
            >
              {family.name}
              {supported ? '' : ' (folgt)'}
            </button>
          );
        })}
      </div>
      {current && choice ? (
        <label style={{ display: 'block', marginTop: 8, fontSize: 14 }}>
          Farbe{' '}
          <select value={choice.colour} onChange={(e) => onChoose({ ...choice, colour: e.target.value })}>
            {current.articles.map((a) => (
              <option key={a.colour} value={a.colour}>
                {COLOUR_NAMES.get(a.colour) ?? a.colour}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={{ fontSize: 13, color: '#555' }}>
        {choice ? 'Einen freien Arm (grau) anklicken.' : 'Rohr wählen, dann an einem freien Arm anbauen.'}
      </p>
    </section>
  );
}
