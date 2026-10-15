import { quadroArticleCatalog, type ColourId, type FamilyId } from '@qad/model-core';
import { fitColour, tubeColours, type ColourRange } from './colours';

export interface PaletteChoice {
  readonly familyId: FamilyId;
  readonly colour: ColourId;
}

/**
 * Tube families of the first stage, one entry per family named by its standard
 * variant. The 35 cm tube is by far the most used part and comes first.
 */
const FIRST = 'tube-35cm';
const FAMILIES = quadroArticleCatalog.entries
  .filter((e) => e.category === 'tube' && e.stage === 'initial' && e.drilling.kind === 'standard')
  .sort((a, b) => Number(b.familyId === FIRST) - Number(a.familyId === FIRST));
const DEFAULT_COLOUR = quadroArticleCatalog.defaultColours.tube ?? 'red';

interface PaletteProps {
  readonly choice: PaletteChoice | undefined;
  readonly range: ColourRange;
  readonly onChoose: (choice: PaletteChoice | undefined) => void;
}

/** Parts to build with. Connectors are chosen automatically and therefore not offered. */
export function Palette({ choice, range, onChoose }: PaletteProps) {
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
                onChoose(
                  active
                    ? undefined
                    : {
                        familyId: family.familyId,
                        colour: fitColour(family.familyId, choice?.colour ?? DEFAULT_COLOUR, range),
                      },
                )
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
            {tubeColours(current.familyId, range).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={{ fontSize: 13, color: '#555' }}>
        {choice
          ? 'Freien Arm (grau) anklicken; Esc legt das Rohr ab.'
          : 'Rohr wählen, dann an einem freien Arm anbauen.'}
      </p>
    </section>
  );
}
